import { defineConfig } from '@playwright/test'
import base from './base.js'

const enabled = process.env.PUBLIC_DEBUG === 'true'
const production = process.env.DEBUG_PRODUCTION_SMOKE === 'true'
const port = Number(process.env.FINANCE_E2E_PORT ?? (production ? 5185 : enabled ? 5182 : 5183))

export default defineConfig({
	...base,
	fullyParallel: false,
	testIgnore: [],
	testMatch: 'debugging.e2e.ts',
	grep: production
		? /deployed debug build/
		: /debug flag controls|HMR replacement|startup failure diagnostics/,
	workers: 1,
	timeout: 90_000,
	expect: { timeout: 20_000 },
	use: {
		baseURL: `http://127.0.0.1:${port}`,
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
		video: 'off'
	},
	metadata: { debugEnabled: enabled },
	webServer: {
		env: {
			// Do not inherit hosted/local development credentials from .env.
			PUBLIC_JAZZ_APP_ID: '77777777-7777-4777-8777-777777777777',
			PUBLIC_JAZZ_SERVER_URL: '',
			JAZZ_ADMIN_SECRET: ''
		},
		command: production
			? `pnpm preview --host 0.0.0.0 --port ${port} --strictPort`
			: `pnpm dev:agent --host 0.0.0.0 --port ${port}`,
		url: `http://127.0.0.1:${port}`,
		reuseExistingServer: process.env.FINANCE_E2E_REUSE_SERVER === 'true' && !process.env.CI
	}
})
