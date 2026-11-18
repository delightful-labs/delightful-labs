import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { UserConfig } from 'vite'
import { jazzWorkerOptions } from 'delightful-local-first/backend/jazz/worker-build'

const require = createRequire(import.meta.url)
const jazzRoot = dirname(require.resolve('jazz-tools/package.json'))
export const jazzWasmEntry = createRequire(require.resolve('jazz-tools/package.json')).resolve(
	'jazz-wasm'
)

/** Shared by the application and its isolated worker bundle proof. */
export function workerRuntimeBuildConfig() {
	return {
		resolve: {
			alias: [
				{
					find: /^#jazz-broker-worker/,
					replacement: join(jazzRoot, 'dist/worker/jazz-broker-worker.js')
				},
				{ find: /^jazz-wasm$/, replacement: jazzWasmEntry },
				{
					find: /^#jazz-wasm-binary/,
					replacement: join(dirname(jazzWasmEntry), 'jazz_wasm_bg.wasm')
				}
			]
		},
		worker: jazzWorkerOptions('_app/immutable/assets/[name].[hash][extname]')
	} satisfies Pick<UserConfig, 'resolve' | 'worker'>
}
