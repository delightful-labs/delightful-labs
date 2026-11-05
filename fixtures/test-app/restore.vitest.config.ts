import { defineConfig } from 'vitest/config'
export default defineConfig({
	test: {
		include: ['fixtures/test-app/restore-browser.test.ts'],
		testTimeout: 30000,
		hookTimeout: 60000,
		allowOnly: !process.env.CI
	}
})
