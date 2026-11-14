import svg from '@poppanator/sveltekit-svg'
import { defineConfig } from 'vitest/config'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { fileURLToPath } from 'node:url'

export default defineConfig({
	plugins: [svelte(), svg()],
	ssr: { noExternal: ['tdesign-icons-svg'] },
	// Unit tests run before packaging; consumer/browser suites separately exercise built exports.
	resolve: {
		alias: {
			'delightful-local-first/backup/archive': fileURLToPath(
				new URL('./src/lib/backup/archive.ts', import.meta.url)
			),
			'delightful-local-first/backup/restore/journal': fileURLToPath(
				new URL('./src/lib/backup/restore-journal.ts', import.meta.url)
			)
		}
	},
	test: {
		environment: 'node',
		include: [
			'fixtures/test-app/restore-plan.test.ts',
			'src/lib/machines/**/*.test.ts',
			'src/lib/worker/**/*.test.ts',
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
