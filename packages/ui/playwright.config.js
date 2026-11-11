import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
	testDir: 'tests',
	outputDir: 'test-results/app',
	testIgnore: '**/storybook/**',
	use: { baseURL: 'http://127.0.0.1:4174' },
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
	webServer: {
		command: 'pnpm preview --host 127.0.0.1 --port 4174 --strictPort',
		url: 'http://127.0.0.1:4174',
		reuseExistingServer: false
	}
})
