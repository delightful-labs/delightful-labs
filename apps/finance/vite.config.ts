import { paraglideVitePlugin } from '@inlang/paraglide-js'
import { defineConfig, loadEnv } from 'vite'
import { sveltekit } from '@sveltejs/kit/vite'
import adapter from '@sveltejs/adapter-auto'
import vercelAdapter from '@sveltejs/adapter-vercel'
import { jazzDev } from './tooling/jazz-dev.js'
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte'
import svg from '@poppanator/sveltekit-svg'
import { dirname, join } from 'node:path'
import { jazzWasmEntry } from './tooling/jazz-wasm.js'
import { workerAssetsManifest } from './tooling/worker-assets-manifest.js'

export default defineConfig({
	// A different page origin has different browser storage. Never silently change ports.
	server: { host: '0.0.0.0', port: 5173, strictPort: true },
	ssr: {
		noExternal: ['jazz-tools'],
		external: ['jazz-tools/backend', 'jazz-napi', '@vercel/functions', '@vercel/sandbox', 'ws']
	},
	resolve: {
		alias: [
			{ find: /^jazz-wasm$/, replacement: jazzWasmEntry },
			{ find: /^#jazz-wasm-binary/, replacement: join(dirname(jazzWasmEntry), 'jazz_wasm_bg.wasm') }
		]
	},
	// Vendored DUI updates must be loaded from the current package, not a cached bundle.
	optimizeDeps: {
		exclude: ['delightful-ui'],
		include: [
			'delightful-local-first/backup/archive',
			'jazz-tools',
			'jazz-tools/client',
			'jazz-tools/local-first'
		]
	},
	plugins: [
		workerAssetsManifest(),
		jazzDev(process.env.FINANCE_PREVIEW !== 'true'),
		{
			name: 'finance-jazz-endpoint',
			config(_config, { command }) {
				if (command === 'serve' || process.env.VERCEL)
					process.env.PUBLIC_JAZZ_SERVER_URL = 'same-origin'
			}
		},
		{
			name: 'finance-debug-default',
			config(config, { command, mode }) {
				const env = loadEnv(mode, config.envDir ?? config.root ?? process.cwd(), 'PUBLIC_DEBUG')
				process.env.PUBLIC_DEBUG ??=
					env.PUBLIC_DEBUG ?? String(command === 'serve' && mode === 'development')
			}
		},
		sveltekit({
			adapter: process.env.VERCEL
				? vercelAdapter({ runtime: 'nodejs24.x', regions: ['iad1'], maxDuration: 300 })
				: adapter(),
			preprocess: vitePreprocess(),
			// The cached client-only shell must resolve assets at a different document URL.
			paths: { relative: false },
			prerender: { entries: ['*'] }
		}),
		svg(),
		paraglideVitePlugin({
			project: './project.inlang',
			outdir: './src/lib/paraglide',
			emitTsDeclarations: true,
			strategy: ['cookie', 'baseLocale']
		})
	]
})
