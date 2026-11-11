import svg from '@poppanator/sveltekit-svg'
import { fileURLToPath } from 'node:url'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'

export default defineConfig({
	plugins: [svelte(), svg()],
	build: {
		outDir: '.svelte-kit/package-consumer',
		lib: {
			entry: fileURLToPath(new URL('./view.ts', import.meta.url)),
			formats: ['es'],
			fileName: 'recovery-view'
		}
	}
})
