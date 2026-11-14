import { defineConfig } from 'vitest/config'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { fileURLToPath } from 'node:url'
import svg from '@poppanator/sveltekit-svg'

export default defineConfig({
	root: fileURLToPath(new URL('.', import.meta.url)),
	plugins: [svelte({ configFile: false }), svg()],
	resolve: {
		conditions: ['browser'],
		alias: {
			'$app/state': fileURLToPath(
				new URL('./src/lib/integrations/fixtures/page.ts', import.meta.url)
			)
		}
	},
	test: {
		include: ['src/lib/**/*.svelte.test.ts'],
		environment: 'jsdom',
		server: { deps: { inline: ['delightful-ui', 'tdesign-icons-svg'] } }
	}
})
