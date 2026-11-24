import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		include: ['tests/worker-handover/native.test.ts'],
		testTimeout: 30000,
		hookTimeout: 60000,
		fileParallelism: false,
		allowOnly: false
	}
})
