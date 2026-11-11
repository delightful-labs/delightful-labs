import { defineConfig } from '@playwright/test'
import base from './tests/config/base.js'

export default defineConfig({
	...base,
	projects: [
		{
			name: 'application',
			testIgnore: [
				...(Array.isArray(base.testIgnore) ? base.testIgnore : []),
				'**/authentication.e2e.ts',
				'**/permissions.e2e.ts',
				'**/features/**/*.e2e.ts'
			]
		},
		{ name: 'authentication', testMatch: 'authentication.e2e.ts', timeout: 60_000, workers: 1 },
		{ name: 'permissions', testMatch: 'permissions.e2e.ts' },
		{ name: 'workspace', testMatch: 'features/**/*.e2e.ts' }
	]
})
