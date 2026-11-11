import { defineConfig } from '@playwright/test'
import base from './base.js'

const seedEnabled = process.env.PUBLIC_FAKE_DATA === 'true'
const debugEnabled = process.env.PUBLIC_DEBUG === 'true'
const port = Number(process.env.FINANCE_E2E_PORT ?? (seedEnabled ? 5186 : 5187))
export default defineConfig({
	...base,
	fullyParallel: false,
	testIgnore: [],
	testMatch: 'fake-data.e2e.ts',
	workers: 1,
	timeout: 90_000,
	expect: { timeout: 20_000 },
	metadata: { seedEnabled, debugEnabled },
	use: {
		baseURL: `http://127.0.0.1:${port}`,
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
		video: 'off'
	},
	webServer: {
		command: `pnpm dev:agent --host 0.0.0.0 --port ${port}`,
		url: `http://127.0.0.1:${port}`,
		reuseExistingServer: process.env.FINANCE_E2E_REUSE_SERVER === 'true' && !process.env.CI,
		env: {
			PUBLIC_FAKE_DATA: String(seedEnabled),
			PUBLIC_DEBUG: String(debugEnabled),
			PUBLIC_JAZZ_APP_ID: '77777777-7777-4777-8777-777777777777',
			PUBLIC_JAZZ_SERVER_URL: '',
			JAZZ_ADMIN_SECRET: ''
		}
	}
})
