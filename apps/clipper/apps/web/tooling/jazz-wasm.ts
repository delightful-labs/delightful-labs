import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
const require = createRequire(import.meta.url)
export const jazzBrokerWorkerEntry = join(
	dirname(require.resolve('jazz-tools/package.json')),
	'dist/worker/jazz-broker-worker.js'
)
export const jazzWasmEntry = createRequire(require.resolve('jazz-tools/package.json')).resolve(
	'jazz-wasm'
)
