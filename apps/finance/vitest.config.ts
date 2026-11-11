import { defineConfig } from 'vitest/config'
import { sveltekit } from '@sveltejs/kit/vite'
import svg from '@poppanator/sveltekit-svg'

export default defineConfig(({ mode }) => ({
	plugins: [sveltekit(), svg()],
	ssr: { noExternal: ['delightful-local-first', 'delightful-ui', 'tdesign-icons-svg'] },
	define: { 'import.meta.env.PUBLIC_SIMPLEFIN_DEMO': JSON.stringify('false') },
	test: {
		expect: { requireAssertions: true },
		include:
			mode === 'restore-experiment'
				? ['tests/workspace-restore.experiment.test.ts']
				: ['src/**/*.{test,spec}.{js,ts}'],
		...(mode === 'restore-experiment' ? { testTimeout: 30_000, hookTimeout: 30_000 } : {}),
		exclude: ['src/**/*.svelte.{test,spec}.{js,ts}'],
		server: { deps: { inline: ['delightful-local-first', 'delightful-ui'] } },
		environment: 'node'
	}
}))
