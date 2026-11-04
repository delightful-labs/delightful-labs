import { defineConfig } from 'vitest/config'
export default defineConfig({
	test: {
		include: ['fixtures/backup-notebook/restore-browser.test.ts'],
		testTimeout: 30000,
		hookTimeout: 60000,
		allowOnly: !process.env.CI
	}
})
