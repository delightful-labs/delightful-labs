import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		include: [
			'fixtures/native-capture/experiment.test.ts',
			'fixtures/native-capture/export-browser.test.ts'
		],
		testTimeout: 15000,
		hookTimeout: 30000,
		allowOnly: false
	}
})
