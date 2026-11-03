import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		include: ['fixtures/private-creation/*.test.ts'],
		testTimeout: 15000,
		hookTimeout: 60000,
		allowOnly: !process.env.CI
	}
})
