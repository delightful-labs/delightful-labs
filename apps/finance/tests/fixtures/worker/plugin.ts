import { fileURLToPath } from 'node:url'
import type { Plugin, UserConfig } from 'vite'
const path = (name: string) => fileURLToPath(new URL(name, import.meta.url))
function fixturePlugin(): Plugin {
	return {
		name: 'finance-native-worker-fixtures',
		enforce: 'pre',
		transform(code, id) {
			if (this.environment.name === 'ssr') return
			const file = id.split('?')[0]
			if (file?.endsWith('/src/lib/runtime/worker/client.ts'))
				return [
					'import {registerFixtureWorker} from ' + JSON.stringify(path('./window.ts')) + ';',
					code.replace(
						'const worker = createWorker()',
						'const worker = createWorker();registerFixtureWorker(worker)'
					)
				].join('\n')
			if (file?.endsWith('/src/lib/runtime/worker/application.worker.ts'))
				return ['import ' + JSON.stringify(path('./registry.ts')) + ';', code].join('\n')
			if (file && /\/backend\/jazz\/session-runtime\.[jt]s$/.test(file)) {
				const opening = 'const session = await createJazzClient(captured)'
				if (code.includes('captureSession(session)')) return
				if (!code.includes(opening)) this.error('Native session fixture capture boundary changed')
				return [
					'import {captureSession} from ' + JSON.stringify(path('./session.ts')) + ';',
					code.replace(opening, opening + ';captureSession(session)')
				].join('\n')
			}
		}
	}
}
/** Fixture capture observes our one native adapter; it never aliases or replaces the SDK. */
export function workerFixtureConfig() {
	return {
		// Preserve one ESM capture slot instead of inlining it into dependency output.
		optimizeDeps: { exclude: ['delightful-local-first'] },
		plugins: [fixturePlugin()],
		worker: { plugins: () => [fixturePlugin()] }
	} satisfies UserConfig
}
