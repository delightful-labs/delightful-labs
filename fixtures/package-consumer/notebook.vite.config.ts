import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

export default defineConfig({
	build: {
		outDir: '.svelte-kit/notebook-browser',
		lib: {
			entry: fileURLToPath(new URL('./notebook-browser.ts', import.meta.url)),
			formats: ['iife'],
			name: 'DLFNotebook',
			fileName: () => 'notebook.js'
		}
	}
})
