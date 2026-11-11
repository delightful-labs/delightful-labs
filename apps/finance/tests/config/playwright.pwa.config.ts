import { defineConfig } from '@playwright/test'
import base from './base.js'

export default defineConfig({
	...base,
	fullyParallel: false,
	testIgnore: [],
	testMatch: ['pwa.e2e.ts', 'pwa-cold-start.e2e.ts'],
	workers: 1,
	timeout: 60_000,
	expect: { timeout: 15_000 },
	use: { ...base.use, baseURL: 'http://127.0.0.1:4173', serviceWorkers: 'allow' },
	webServer: {
		command: 'FINANCE_PREVIEW=true pnpm preview --host 0.0.0.0 --port 4173 --strictPort',
		url: 'http://127.0.0.1:4173',
		reuseExistingServer: false
	}
})
