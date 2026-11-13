import { defineConfig } from 'vitest/config'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { fileURLToPath } from 'node:url'

export default defineConfig({
	root: fileURLToPath(new URL('.', import.meta.url)),
	plugins: [svelte({ configFile: false })],
	resolve: { conditions: ['browser'] },
	test: {
		include: ['src/lib/**/*.svelte.test.ts'],
		environment: 'jsdom'
	}
})
