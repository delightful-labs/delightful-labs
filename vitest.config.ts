import svg from '@poppanator/sveltekit-svg'
import { defineConfig } from 'vitest/config'
import { svelte } from '@sveltejs/vite-plugin-svelte'

export default defineConfig({
	plugins: [svelte(), svg()],
	ssr: { noExternal: ['tdesign-icons-svg'] },
	test: {
		environment: 'node',
		include: [
			'src/lib/machines/**/*.test.ts',
			'src/lib/presentation/**/*.test.ts',
			'src/lib/localization/**/*.test.ts',
			'src/lib/diagnostics/**/*.test.ts',
			'src/lib/backup/**/*.test.ts',
			'src/lib/backend/**/*.test.ts',
			'src/lib/integrations/**/*.test.ts'
		],
		allowOnly: !process.env.CI
	}
})
