import { defineConfig } from 'vitest/config'
export default defineConfig({
	test: {
		include: ['src/lib/backend/jazz/*.test.ts', 'src/lib/reader/schema.test.ts'],
		testTimeout: 15000,
		hookTimeout: 15000
	}
})
