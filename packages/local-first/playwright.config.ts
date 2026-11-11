import { defineConfig, devices } from '@playwright/test'

const port = Number(process.env.PLAYWRIGHT_PORT ?? 6008)
if (!Number.isInteger(port) || port < 1 || port > 65535) {
	throw new Error('PLAYWRIGHT_PORT must be a valid local port')
}
const baseURL = `http://127.0.0.1:${port}`

export default defineConfig({
	testDir: 'tests/storybook',
	outputDir: 'test-results/storybook',
	forbidOnly: Boolean(process.env.CI),
	retries: 0,
	use: { baseURL },
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
	webServer: {
		command: `pnpm exec vite preview --config .storybook/vite.config.js --outDir storybook-static --host 127.0.0.1 --port ${port} --strictPort`,
		url: baseURL,
		reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === '1'
	}
})
