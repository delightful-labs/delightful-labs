import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { UserConfig } from 'vite'

const require = createRequire(import.meta.url)
export const jazzWasmEntry = createRequire(require.resolve('jazz-tools/package.json')).resolve(
	'jazz-wasm'
)

/** Shared by the application and its isolated worker bundle proof. */
export function workerRuntimeBuildConfig() {
	return {
		resolve: {
			alias: [
				{ find: /^jazz-wasm$/, replacement: jazzWasmEntry },
				{
					find: /^#jazz-wasm-binary/,
					replacement: join(dirname(jazzWasmEntry), 'jazz_wasm_bg.wasm')
				}
			]
		},
		worker: {
			format: 'es',
			rolldownOptions: {
				output: { assetFileNames: '_app/immutable/assets/[name].[hash][extname]' }
			}
		}
	} satisfies Pick<UserConfig, 'resolve' | 'worker'>
}
