import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { InlineConfig } from 'vite'

/** Resolve the binary beside the SDK's own WASM package, preserving its version. */
export function jazzFixtureAssets(): Pick<InlineConfig, 'resolve' | 'optimizeDeps'> {
	const require = createRequire(import.meta.url)
	const wasmEntry = createRequire(require.resolve('jazz-tools/package.json')).resolve('jazz-wasm')
	return {
		optimizeDeps: {
			exclude: ['jazz-wasm'],
			include: ['jazz-tools', 'jazz-tools/client', 'jazz-tools/local-first', 'xstate', 'zod']
		},
		resolve: {
			alias: [
				{ find: /^jazz-wasm$/, replacement: wasmEntry },
				{ find: /^#jazz-wasm-binary/, replacement: join(dirname(wasmEntry), 'jazz_wasm_bg.wasm') }
			]
		}
	}
}
