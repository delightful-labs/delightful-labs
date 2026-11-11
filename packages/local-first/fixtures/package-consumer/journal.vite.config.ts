import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
export default defineConfig({
	build: {
		outDir: '.svelte-kit/journal-browser',
		lib: {
			entry: fileURLToPath(new URL('./journal-browser.ts', import.meta.url)),
			formats: ['iife'],
			name: 'DLFJournal',
			fileName: () => 'journal.js'
		}
	}
})
