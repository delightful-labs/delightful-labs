import { defineConfig } from '@playwright/test'
import base from './base.js'

// These standalone component documents import source modules through Vite.
// Real Finance routes use the production host configured in base.ts.
export default defineConfig({
	...base,
	testIgnore: [],
	testMatch: ['component-presentation.e2e.ts'],
	webServer: {
		...base.webServer,
		command: `pnpm exec vite dev --config vite.e2e.config.ts --host 0.0.0.0 --port ${process.env.FINANCE_E2E_PORT ?? '5180'} --strictPort`
	}
})
