import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

export default defineConfig({
	build: {
		outDir: '.svelte-kit/test-app-browser',
		lib: {
			entry: fileURLToPath(new URL('./test-app-browser.ts', import.meta.url)),
			formats: ['iife'],
			name: 'DLFTestApp',
			fileName: () => 'test-app.js'
		}
	}
})
