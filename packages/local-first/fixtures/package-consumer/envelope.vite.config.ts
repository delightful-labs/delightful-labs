import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
export default defineConfig({
	build: {
		outDir: '.svelte-kit/envelope-browser',
		lib: {
			entry: fileURLToPath(new URL('./envelope-browser.ts', import.meta.url)),
			formats: ['iife'],
			name: 'DLFBackup',
			fileName: () => 'envelope.js'
		}
	}
})
