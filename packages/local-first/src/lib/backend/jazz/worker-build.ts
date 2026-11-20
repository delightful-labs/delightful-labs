import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

/** Node/build-only: resolve assets from the consumer's SDK and its own WASM dependency. */
export function resolveJazzWorkerAssets(consumerUrl: string | URL) {
	const sdk = createRequire(consumerUrl).resolve('jazz-tools/package.json')
	const wasmEntry = createRequire(sdk).resolve('jazz-wasm')
	return {
		brokerEntry: join(dirname(sdk), 'dist/worker/jazz-broker-worker.js'),
		wasmEntry,
		wasmBinary: join(dirname(wasmEntry), 'jazz_wasm_bg.wasm')
	}
}

/** Keep Jazz's account registry in one module instance. Split worker chunks can
 * import their entry again, which affected WebKit builds evaluate a second time. */
export function jazzWorkerOptions(assetFileNames?: string): {
	format: 'es'
	rolldownOptions: { output: { codeSplitting: false; assetFileNames?: string } }
} {
	return {
		format: 'es',
		rolldownOptions: {
			output: {
				codeSplitting: false,
				...(assetFileNames === undefined ? {} : { assetFileNames })
			}
		}
	}
}
