import { spawn } from 'node:child_process'
import { createActor, toPromise } from 'xstate'
import { z } from 'zod'
import {
	jazzPreviewBuild,
	type PreviewJazzApp
} from './src/lib/machines/persistence/jazz-preview-build.ts'

const serverUrl = 'https://v2.sync.jazz.tools/'
const provisionUrl = 'https://v2.dashboard.jazz.tools/api/apps/generate'
const credentialsSchema = z.object({ appId: z.uuid(), adminSecret: z.string().min(1) })

async function provision(signal: AbortSignal): Promise<PreviewJazzApp> {
	const response = await fetch(provisionUrl, {
		method: 'POST',
		redirect: 'error',
		signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)])
	})
	if (!response.ok) throw new Error(`Jazz provisioning returned HTTP ${response.status}`)
	const body: unknown = await response.json()
	return credentialsSchema.parse(body)
}

async function waitForApp(app: PreviewJazzApp, signal: AbortSignal): Promise<'ready' | 'pending'> {
	const startedAt = performance.now()
	try {
		const response = await fetch(`${serverUrl}apps/${app.appId}/admin/permissions/head`, {
			headers: { 'X-Jazz-Admin-Secret': app.adminSecret },
			redirect: 'error',
			signal: AbortSignal.any([signal, AbortSignal.timeout(5_000)])
		})
		console.info(
			`[preview-build] Jazz readiness HTTP ${response.status} after ${Math.round(performance.now() - startedAt)}ms.`
		)
		await response.body?.cancel()
		if (
			response.status === 404 ||
			response.status === 502 ||
			response.status === 503 ||
			response.status === 504
		)
			return 'pending'
		if (!response.ok) {
			console.error(`[preview-build] Jazz readiness request failed with HTTP ${response.status}.`)
			throw new Error('Jazz readiness request failed')
		}
		return 'ready'
	} catch (error) {
		// A cold app can take longer than an individual request deadline to start.
		if (!signal.aborted && error instanceof DOMException && error.name === 'TimeoutError') {
			console.info('[preview-build] Jazz readiness request timed out.')
			return 'pending'
		}
		if (!signal.aborted)
			console.error('[preview-build] Jazz readiness request failed; details withheld.')
		throw error
	}
}

function previewEnvironment(appId: string): NodeJS.ProcessEnv {
	const env = { ...process.env }
	// Never hand inherited production/preview credentials to the frontend build.
	delete env.JAZZ_ADMIN_SECRET
	delete env.BACKEND_SECRET
	delete env.JAZZ_BACKEND_SECRET
	return {
		...env,
		JAZZ_APP_ID: appId,
		JAZZ_SERVER_URL: serverUrl,
		PUBLIC_JAZZ_APP_ID: appId,
		PUBLIC_JAZZ_SERVER_URL: serverUrl
	}
}

/** Own one process group until close, including interrupted pnpm subprocesses. */
function run(command: string, env: NodeJS.ProcessEnv, signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		signal.throwIfAborted()
		const grouped = process.platform !== 'win32'
		const child = spawn('pnpm', [command], {
			env,
			detached: grouped,
			// Jazz errors can contain server payloads. Never echo its private environment/output.
			stdio: command === 'build' ? 'inherit' : ['ignore', 'ignore', 'pipe']
		})
		let deploymentError = ''
		child.stderr?.on('data', (chunk: Buffer) => {
			// Retain only a bounded buffer; print no server text or credentials.
			deploymentError = (deploymentError + chunk.toString()).slice(-16_384)
		})
		let killTimer: ReturnType<typeof setTimeout> | undefined
		function kill(killSignal: NodeJS.Signals) {
			if (!child.pid) return
			try {
				if (grouped) process.kill(-child.pid, killSignal)
				else child.kill(killSignal)
			} catch (error) {
				if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error
			}
		}
		function abort() {
			kill('SIGTERM')
			killTimer = setTimeout(() => kill('SIGKILL'), 5_000)
			killTimer.unref()
		}
		function cleanup() {
			signal.removeEventListener('abort', abort)
			clearTimeout(killTimer)
		}
		signal.addEventListener('abort', abort, { once: true })
		child.once('error', () => {
			cleanup()
			reject(new Error(`Could not start ${command}`))
		})
		child.once('close', (code) => {
			cleanup()
			if (signal.aborted) reject(new Error(`${command} cancelled`))
			else if (code !== 0) {
				const httpStatus = deploymentError.match(
					/(?:Permissions head fetch|Schema publish|Schema fetch|Schema list fetch|Permissions publish|Migration publish) failed:\s*(\d{3})\b/
				)?.[1]
				if (httpStatus)
					console.error(`[preview-build] Jazz admin request failed with HTTP ${httpStatus}.`)
				reject(new Error(`${command} failed with exit code ${code}`))
			} else resolve()
		})
	})
}

const actor = createActor(jazzPreviewBuild, {
	input: {
		context: process.env.CONTEXT,
		provision,
		waitForApp,
		deploy: (app, signal) =>
			run(
				'deploy:jazz',
				{ ...previewEnvironment(app.appId), JAZZ_ADMIN_SECRET: app.adminSecret },
				signal
			),
		build: (appId, signal) => run('build', previewEnvironment(appId), signal)
	}
})
const cancel = () => actor.send({ type: 'CANCEL' })
process.once('SIGINT', cancel)
process.once('SIGTERM', cancel)
actor.subscribe((snapshot) => {
	// State names are static. Never inspect or log credential-bearing context/errors.
	console.info(`[preview-build] ${JSON.stringify(snapshot.value)}`)
})
actor.start()
const result = await toPromise(actor)
process.removeListener('SIGINT', cancel)
process.removeListener('SIGTERM', cancel)
if (result.outcome === 'succeeded') {
	console.info(
		`[preview-build] Ready with disposable Jazz app ${result.appId}; expires in 14 days.`
	)
} else {
	console.error(
		`[preview-build] ${result.outcome}; deployment stopped. No shared Jazz app was used.`
	)
	process.exitCode = result.outcome === 'cancelled' ? 130 : 1
}
