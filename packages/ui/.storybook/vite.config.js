import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'
import svg from '@poppanator/sveltekit-svg'

export default defineConfig({ plugins: [svelte(), svg()] })
