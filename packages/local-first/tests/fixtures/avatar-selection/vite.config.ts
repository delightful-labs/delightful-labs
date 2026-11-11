import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import svg from '@poppanator/sveltekit-svg'
export default defineConfig({
	plugins: [svelte(), svg()],
	build: {
		outDir: '.svelte-kit/avatar-selection-browser',
		lib: {
			entry: fileURLToPath(new URL('./browser.ts', import.meta.url)),
			formats: ['iife'],
			name: 'DLFAvatarSelection',
			fileName: () => 'avatar-selection.js'
		}
	}
})
