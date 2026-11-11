import { defineConfig, devices } from '@playwright/test'

const externalServer = process.env.DUI_STORYBOOK_URL

export default defineConfig({
	testDir: 'tests/storybook',
	outputDir: 'test-results/storybook',
	use: { baseURL: externalServer ?? 'http://127.0.0.1:6007' },
	projects: [
		{ name: 'chromium', use: { ...devices['Desktop Chrome'] } },
		{
			name: 'webkit-mobile',
			testMatch: ['**/tag-input.spec.js', '**/swipe-actions.spec.js'],
			use: { ...devices['iPhone 13'] }
		},
		{
			name: 'chromium-mobile',
			testMatch: '**/swipe-actions.spec.js',
			use: { ...devices['Pixel 7'], browserName: 'chromium' }
		}
	],
	webServer: externalServer
		? undefined
		: {
				command:
					'pnpm exec vite preview --config .storybook/vite.config.js --outDir storybook-test-static --host 127.0.0.1 --port 6007 --strictPort',
				url: 'http://127.0.0.1:6007',
				reuseExistingServer: false
			}
})
