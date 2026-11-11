import { defineConfig } from '@playwright/test'
import base from './base.js'

// Run in an isolated checkout: this suite generates a production build.
export default defineConfig({
	...base,
	fullyParallel: false,
	testIgnore: [],
	tsconfig: '../tsconfig.json',
	testMatch: 'startup-stalled-remote.e2e.ts',
	workers: 1,
	timeout: 120_000,
	expect: { timeout: 15_000 },
	use: { ...base.use, baseURL: 'http://127.0.0.1:4185', serviceWorkers: 'allow' },
	webServer: {
		command: 'pnpm build && pnpm preview --host 0.0.0.0 --port 4185 --strictPort',
		url: 'http://127.0.0.1:4185',
		reuseExistingServer: false,
		timeout: 180_000,
		env: {
			FINANCE_PREVIEW: 'true',
			PUBLIC_FAKE_DATA: 'false',
			PUBLIC_DEBUG: 'false',
			PUBLIC_JAZZ_SERVER_URL: 'http://127.0.0.1:6193',
			PUBLIC_JAZZ_APP_ID: '77777777-7777-4777-8777-777777777777'
		}
	}
})
