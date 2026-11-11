import { defineConfig } from 'vitest/config'
export default defineConfig({
	tsconfig: './tsconfig.json',
	test: { include: ['*.test.ts'], environment: 'node', expect: { requireAssertions: true } }
})
