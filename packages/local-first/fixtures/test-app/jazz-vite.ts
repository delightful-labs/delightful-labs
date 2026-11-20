import { resolveJazzWorkerAssets } from 'delightful-local-first/backend/jazz/worker-build'
import type { InlineConfig } from 'vite'

/** Resolve the binary beside the SDK's own WASM package, preserving its version. */
export function jazzFixtureAssets(): Pick<InlineConfig, 'resolve' | 'optimizeDeps'> {
	const assets = resolveJazzWorkerAssets(import.meta.url)
	return {
		optimizeDeps: {
			exclude: ['jazz-tools', 'jazz-wasm'],
			include: ['xstate', 'zod']
		},
		resolve: {
			alias: [
				{ find: /^jazz-wasm$/, replacement: assets.wasmEntry },
				{ find: /^#jazz-wasm-binary/, replacement: assets.wasmBinary }
			]
		}
	}
}
