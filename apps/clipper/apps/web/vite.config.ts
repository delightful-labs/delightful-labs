import { offlineAssets } from './tooling/offline-assets.js'
import netlifyAdapter from '@sveltejs/adapter-netlify'
import vercelAdapter from '@sveltejs/adapter-vercel'
import { sveltekit } from '@sveltejs/kit/vite'
import { defineConfig } from 'vite'
import {
	jazzWorkerOptions,
	resolveJazzWorkerAssets
} from 'delightful-local-first/backend/jazz/worker-build'
import { jazzDev } from './tooling/jazz-dev.js'
import svg from '@poppanator/sveltekit-svg'

const assets = resolveJazzWorkerAssets(import.meta.url)

export default defineConfig(({ command, mode }) => {
	const development =
		command === 'serve' && ['dev', 'dev:agent'].includes(process.env.npm_lifecycle_event ?? '')
	if (process.env.VERCEL || development) {
		process.env.PUBLIC_JAZZ_APP_ID ??= '9c0871ad-3ea3-49d0-9eaf-b034914da924'
		if (process.env.CLIPPER_TEST_EXTERNAL_JAZZ !== 'true' || process.env.CLIPPER_TEST !== 'true')
			process.env.PUBLIC_JAZZ_SERVER_URL = 'same-origin'
		process.env.CAPTURE_GATEWAY_ENABLED ??= 'true'
	}
	if (mode === 'agent') process.env.PUBLIC_DEBUG = 'true'
	if (mode === 'agent' || process.env.CLIPPER_TEST === 'true')
		process.env.CLIPPER_EPHEMERAL_JAZZ = 'true'
	return {
		worker: jazzWorkerOptions(),
		envPrefix: ['VITE_', 'PUBLIC_'],
		// Workers and account routes load dependencies lazily. Prebundle them
		// so a cold optimizer cannot reload an active account or job.
		optimizeDeps: {
			exclude: ['delightful-ui', 'jazz-wasm', 'microlighter'],
			include: [
				'@atcute/lexicons/syntax',
				'minisearch',
				'@mozilla/readability',
				'@mozilla/readability/JSDOMParser.js',
				'jazz-tools',
				'jazz-tools/client',
				'jazz-tools/local-first',
				'delightful-local-first/auth/atproto/workflow',
				'delightful-local-first/recovery/view',
				'delightful-local-first/forms/lifecycle',
				'delightful-local-first/diagnostics/logger',
				'delightful-local-first/backend/jazz/restoration',
				'delightful-local-first/data/observation-workflow',
				'delightful-local-first/backend/jazz/session-runtime',
				'delightful-local-first/session/runtime',
				'delightful-local-first/session/sign-out/workflow',
				'delightful-local-first/restoration/workflow',
				'delightful-local-first/recovery/workflow',
				'delightful-local-first/workspace/creation/workflow',
				'delightful-local-first/workspace/initialization',
				'delightful-local-first/workspace/startup',
				'delightful-local-first/transactions/workflow',
				'delightful-local-first/lifecycle/operation/workflow',
				'delightful-local-first/worker/request/workflow',
				'delightful-local-first/worker/browser-job',
				'delightful-local-first/worker/channel/workflow',
				'delightful-local-first/worker/effect-drain/workflow'
			]
		},
		ssr: { external: ['jazz-tools', 'jazz-napi', '@vercel/functions', '@vercel/sandbox', 'ws'] },
		build: {
			// Bundle MicroLighter's lazy grammar imports into offline shell assets.
			dynamicImportVarsOptions: { exclude: [/node_modules\/(?!.*microlighter)/] }
		},
		resolve: {
			alias: [
				{ find: /^#jazz-broker-worker/, replacement: assets.brokerEntry },
				{ find: /^jazz-wasm$/, replacement: assets.wasmEntry },
				{ find: /^#jazz-wasm-binary/, replacement: assets.wasmBinary }
			]
		},
		plugins: [
			offlineAssets(),
			jazzDev(command === 'serve' && (development || process.env.CLIPPER_TEST === 'true')),
			sveltekit({
				adapter: process.env.VERCEL
					? vercelAdapter({ runtime: 'nodejs24.x', regions: ['iad1'], maxDuration: 300 })
					: netlifyAdapter(),
				outDir:
					command === 'serve'
						? process.env.CLIPPER_TEST === 'true'
							? process.env.CLIPPER_TEST_WORKER === 'true'
								? '.svelte-kit/e2e-worker'
								: '.svelte-kit/e2e'
							: mode === 'agent'
								? '.svelte-kit/agent'
								: '.svelte-kit/local'
						: '.svelte-kit',
				paths: { relative: false },
				serviceWorker: { register: false },
				...(process.env.CLIPPER_SHELL_VERSION
					? { version: { name: process.env.CLIPPER_SHELL_VERSION } }
					: {})
			}),
			svg()
		],
		server: {
			watch: {
				ignored: [
					'**/.clipper-dev/**',
					'**/.netlify/**',
					'**/.offline-test-builds/**',
					'**/.svelte-kit/output/**',
					'**/build/**'
				]
			},
			host: process.env.CLIPPER_TEST === 'true' ? '127.0.0.1' : '0.0.0.0',
			port: 5173,
			strictPort: true,
			...(process.env.CLIPPER_TEST === 'true'
				? {
						// The native job fixture invokes the actual extension producer/Worker.
						fs: { allow: ['.', '../extension/src'] }
					}
				: {})
		},
		preview: { host: '127.0.0.1', port: 4173, strictPort: true }
	}
})
