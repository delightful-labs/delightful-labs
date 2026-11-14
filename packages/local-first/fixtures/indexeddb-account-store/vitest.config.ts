import { defineConfig } from 'vitest/config'
export default defineConfig({
	test: {
		include: ['fixtures/indexeddb-account-store/browser.test.ts'],
		testTimeout: 20_000,
		hookTimeout: 30_000,
		fileParallelism: false,
		allowOnly: false
	}
})
