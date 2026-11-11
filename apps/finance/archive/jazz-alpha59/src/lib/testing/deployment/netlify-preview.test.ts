import { spawn } from 'node:child_process'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'

const generatedId = '77777777-7777-4777-8777-777777777777'
const generatedSecret = 'PRIVATE_GENERATED_SECRET'
const inheritedSecret = 'PRIVATE_INHERITED_SECRET'
const directories: string[] = []
afterEach(async () => {
	await Promise.all(
		directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
	)
})

async function fixture(
	options: {
		context?: string
		response?: unknown
		status?: number
		readinessStatus?: number
		timeoutReadinessOnce?: boolean
		failCommand?: string
		waitCommand?: string
	} = {}
) {
	const directory = await mkdtemp(join(tmpdir(), 'jazz-preview-entry-'))
	directories.push(directory)
	const recordsPath = join(directory, 'records.jsonl')
	const hookPath = join(directory, 'fetch.mjs')
	await writeFile(recordsPath, '', { mode: 0o600 })
	await writeFile(
		hookPath,
		`import { appendFileSync } from 'node:fs';
 let readinessCalls = 0;
	globalThis.fetch = async (url, options) => {
	 appendFileSync(process.env.FIXTURE_RECORDS, JSON.stringify({ request: String(url), method: options.method, redirect: options.redirect, adminSecret: options.headers?.['X-Jazz-Admin-Secret'] }) + '\\n');
	 if (String(url).includes('/admin/permissions/head') && ${JSON.stringify(options.timeoutReadinessOnce ?? false)} && readinessCalls++ === 0) return new Promise((_resolve, reject) => { const keepAlive = setInterval(() => {}, 1000); options.signal.addEventListener('abort', () => { clearInterval(keepAlive); reject(options.signal.reason); }, { once: true }); });
	 return new Response(JSON.stringify(${JSON.stringify(options.response ?? { appId: generatedId, adminSecret: generatedSecret, backendSecret: 'PRIVATE_UNUSED_BACKEND' })}), { status: String(url).endsWith('/api/apps/generate') ? ${options.status ?? 200} : ${options.readinessStatus ?? 200}, headers: { 'content-type': 'application/json' } });
	};`
	)
	await writeFile(
		join(directory, 'pnpm'),
		`#!/usr/bin/env node
	const { appendFileSync } = require('node:fs');
	const command = process.argv[2];
	const recordCommand = () => appendFileSync(process.env.FIXTURE_RECORDS, JSON.stringify({ command,
	 appId: process.env.PUBLIC_JAZZ_APP_ID, cliAppId: process.env.JAZZ_APP_ID,
	 serverUrl: process.env.PUBLIC_JAZZ_SERVER_URL, cliServerUrl: process.env.JAZZ_SERVER_URL,
	 adminSecret: process.env.JAZZ_ADMIN_SECRET, backendSecret: process.env.BACKEND_SECRET,
	 jazzBackendSecret: process.env.JAZZ_BACKEND_SECRET }) + '\\n');
	if (command === ${JSON.stringify(options.waitCommand)}) {
	 process.on('SIGTERM', () => { appendFileSync(process.env.FIXTURE_RECORDS, JSON.stringify({ terminated: command }) + '\\n'); process.exit(0); });
	 setInterval(() => {}, 1000);
	 recordCommand();
	} else {
	 recordCommand();
	 if (command === 'deploy:jazz') console.log(process.env.JAZZ_ADMIN_SECRET);
 if (command === 'deploy:jazz' && command === ${JSON.stringify(options.failCommand)}) console.error('Permissions head fetch failed: 404 ' + process.env.JAZZ_ADMIN_SECRET);
	 process.exit(command === ${JSON.stringify(options.failCommand)} ? 1 : 0);
	}
	`,
		{ mode: 0o700 }
	)
	const child = spawn(
		process.execPath,
		['--experimental-strip-types', '--import', hookPath, resolve('netlify-preview.ts')],
		{
			env: {
				...process.env,
				PATH: `${directory}${delimiter}${process.env.PATH}`,
				CONTEXT: options.context ?? 'deploy-preview',
				FIXTURE_RECORDS: recordsPath,
				PUBLIC_JAZZ_APP_ID: 'STALE_APP_ID',
				JAZZ_APP_ID: 'STALE_CLI_APP_ID',
				PUBLIC_JAZZ_SERVER_URL: 'https://stale.example.com',
				JAZZ_SERVER_URL: 'https://stale-cli.example.com',
				JAZZ_ADMIN_SECRET: inheritedSecret,
				BACKEND_SECRET: inheritedSecret,
				JAZZ_BACKEND_SECRET: inheritedSecret
			},
			stdio: ['ignore', 'pipe', 'pipe']
		}
	)
	let output = ''
	child.stdout.on('data', (chunk) => {
		output += chunk.toString()
	})
	child.stderr.on('data', (chunk) => {
		output += chunk.toString()
	})
	const completed = new Promise<{ code: number | null; output: string }>((resolve, reject) => {
		child.once('error', reject)
		child.once('close', (code) => resolve({ code, output }))
	})
	return {
		child,
		completed,
		records: async () =>
			(await readFile(recordsPath, 'utf8'))
				.trim()
				.split('\n')
				.filter(Boolean)
				.map((line): unknown => JSON.parse(line))
	}
}

it('binds fresh credentials only to schema deployment and overrides stale app settings', async () => {
	const run = await fixture()
	const result = await run.completed
	expect(result.code).toBe(0)
	expect(await run.records()).toEqual([
		{
			request: 'https://v2.dashboard.jazz.tools/api/apps/generate',
			method: 'POST',
			redirect: 'error'
		},
		{
			request: `https://v2.sync.jazz.tools/apps/${generatedId}/admin/permissions/head`,
			redirect: 'error',
			adminSecret: generatedSecret
		},
		{
			command: 'deploy:jazz',
			appId: generatedId,
			cliAppId: generatedId,
			serverUrl: 'https://v2.sync.jazz.tools/',
			cliServerUrl: 'https://v2.sync.jazz.tools/',
			adminSecret: generatedSecret
		},
		{
			command: 'build',
			appId: generatedId,
			cliAppId: generatedId,
			serverUrl: 'https://v2.sync.jazz.tools/',
			cliServerUrl: 'https://v2.sync.jazz.tools/'
		}
	])
	expect(result.output).toContain('Ready with disposable Jazz app')
	for (const secret of [generatedSecret, inheritedSecret, 'PRIVATE_UNUSED_BACKEND'])
		expect(result.output).not.toContain(secret)
})

it.each(['production', 'branch-deploy'])(
	'the actual entry refuses %s without provisioning',
	async (context) => {
		const run = await fixture({ context })
		expect((await run.completed).code).toBe(1)
		expect(await run.records()).toEqual([])
	}
)

it.each([
	{ response: { appId: 'invalid', adminSecret: generatedSecret } },
	{ response: { appId: generatedId } },
	{ status: 429, response: { error: generatedSecret } }
])('does not launch commands or leak failed provision responses: %j', async (options) => {
	const run = await fixture(options)
	const result = await run.completed
	expect(result.code).toBe(1)
	expect(await run.records()).toHaveLength(1)
	expect(result.output).not.toContain(generatedSecret)
	expect(result.output).toContain('failed')
})

it.each(['deploy:jazz', 'build'])(
	'stops after %s failure without leaking secrets',
	async (failCommand) => {
		const run = await fixture({ failCommand })
		const result = await run.completed
		expect(result.code).toBe(1)
		expect(result.output).toContain('partial')
		expect(result.output).not.toContain(generatedSecret)
		expect(await run.records()).toHaveLength(failCommand === 'deploy:jazz' ? 3 : 4)
		if (failCommand === 'deploy:jazz')
			expect(result.output).toContain('Jazz admin request failed with HTTP 404.')
	}
)

it.each(['deploy:jazz', 'build'])(
	'SIGTERM cancels %s and waits for its termination before exiting',
	async (waitCommand) => {
		const run = await fixture({ waitCommand })
		try {
			// Child startup competes with the full suite; leave time within the 5s test for shutdown.
			await vi.waitFor(
				async () => expect(await run.records()).toHaveLength(waitCommand === 'deploy:jazz' ? 3 : 4),
				{ timeout: 3000 }
			)
			run.child.kill('SIGTERM')
			expect((await run.completed).code).toBe(130)
			expect(await run.records()).toContainEqual({ terminated: waitCommand })
			if (waitCommand === 'deploy:jazz')
				expect(await run.records()).not.toContainEqual(
					expect.objectContaining({ command: 'build' })
				)
		} finally {
			if (run.child.exitCode === null) run.child.kill('SIGKILL')
		}
	}
)

it('does not deploy after readiness rejects the generated credential', async () => {
	const run = await fixture({ readinessStatus: 401 })
	const result = await run.completed
	expect(result.code).toBe(1)
	expect(result.output).toContain('readinessFailed')
	expect(result.output).not.toContain(generatedSecret)
	expect(await run.records()).toHaveLength(2)
})

it('waits through a timed-out cold-app request without creating another app', async () => {
	const run = await fixture({ timeoutReadinessOnce: true })
	const result = await run.completed
	expect(result.code).toBe(0)
	expect(await run.records()).toHaveLength(5)
	expect(result.output).toContain('routingDelay')
	expect(result.output).not.toContain(generatedSecret)
}, 15_000)
