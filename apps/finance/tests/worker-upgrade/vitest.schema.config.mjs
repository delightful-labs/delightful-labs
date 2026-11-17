import { defineConfig } from 'vitest/config'
import { svelte } from '@sveltejs/vite-plugin-svelte'

export default defineConfig({
	plugins: [svelte()],
	ssr: { noExternal: ['jazz-tools', 'delightful-local-first'] },
	test: {
		include: [
			'src/lib/permissions.test.ts',
			'src/lib/schema-upgrade.test.ts',
			'src/lib/bank-sync-log-permissions.test.ts',
			'src/lib/bank-sync-log-retention-permissions.test.ts'
		],
		environment: 'node',
		expect: { requireAssertions: true }
	}
})
