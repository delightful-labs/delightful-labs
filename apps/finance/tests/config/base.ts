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
		'**/pwa.e2e.ts',
		'**/pwa-cold-start.e2e.ts',
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
		command: `pnpm dev:agent --host 127.0.0.1 --port ${port} --strictPort`,
		url: baseURL,
		reuseExistingServer: process.env.FINANCE_E2E_REUSE_SERVER === 'true' && !process.env.CI
	}
})
