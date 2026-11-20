import type { UserConfig } from 'vite'
import {
	jazzWorkerOptions,
	resolveJazzWorkerAssets
} from 'delightful-local-first/backend/jazz/worker-build'

const assets = resolveJazzWorkerAssets(import.meta.url)

/** Shared by the application and its isolated worker bundle proof. */
export function workerRuntimeBuildConfig() {
	return {
		envPrefix: ['VITE_', 'PUBLIC_'],
		resolve: {
			alias: [
				{
					find: /^#jazz-broker-worker/,
					replacement: assets.brokerEntry
				},
				{ find: /^jazz-wasm$/, replacement: assets.wasmEntry },
				{
					find: /^#jazz-wasm-binary/,
					replacement: assets.wasmBinary
				}
			]
		},
		worker: jazzWorkerOptions('_app/immutable/assets/[name].[hash][extname]')
	} satisfies Pick<UserConfig, 'resolve' | 'worker' | 'envPrefix'>
}
