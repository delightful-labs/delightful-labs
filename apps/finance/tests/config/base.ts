import { defineConfig } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const port = process.env.FINANCE_E2E_PORT ?? '5180'
const baseURL = `http://127.0.0.1:${port}`

// Reuse only a server explicitly identified as belonging to this agent session.
export default defineConfig({
	testDir: fileURLToPath(new URL('..', import.meta.url)),
	tsconfig: fileURLToPath(new URL('../tsconfig.json', import.meta.url)),
	testMatch: '**/*.e2e.ts',
	testIgnore: [
		'**/component-presentation.e2e.ts',
		'**/pwa.e2e.ts',
		'**/pwa-cold-start.e2e.ts',
		'**/worker-bundle.e2e.ts',
		'**/startup-stalled-remote.e2e.ts',
		'**/debugging.e2e.ts',
		'**/fake-data.e2e.ts'
	],
	fullyParallel: true,
	workers: process.env.CI ? 2 : 1,
	timeout: 120_000,
	expect: { timeout: 15_000 },
	reporter: [['list'], ['json', { outputFile: 'test-results/results.json' }]],
	use: {
		baseURL,
		trace: process.env.CI ? 'retain-on-failure' : 'off',
		screenshot: 'only-on-failure',
		video: 'off'
	},
	webServer: {
		// General application coverage includes the explicitly enabled developer tools.
		// Dedicated flag suites still qualify PUBLIC_DEBUG=false independently.
		env: { PUBLIC_DEBUG: 'true' },
		// Offline worker creation needs the real production asset/service-worker cache.
		// The dedicated E2E config retains static fixtures and disposable native data.
		command: `FINANCE_PREVIEW=true pnpm exec vite build --config vite.e2e.config.ts && FINANCE_PREVIEW=true pnpm exec vite preview --config vite.e2e.config.ts --host 0.0.0.0 --port ${port} --strictPort`,
		url: baseURL,
		timeout: 180_000,
		reuseExistingServer: process.env.FINANCE_E2E_REUSE_SERVER === 'true' && !process.env.CI
	}
})
