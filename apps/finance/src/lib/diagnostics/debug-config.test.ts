import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import config from '../../../vite.config.js'
import type { ConfigPluginContext } from 'vite'

let directory: string
beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), 'finance-debug-config-'))
	vi.stubEnv('PUBLIC_DEBUG', undefined)
})
afterEach(() => {
	vi.unstubAllEnvs()
	rmSync(directory, { recursive: true, force: true })
})

async function configure(command: 'serve' | 'build', mode: string) {
	const plugin = config.plugins?.find(
		(plugin) =>
			plugin &&
			typeof plugin === 'object' &&
			'name' in plugin &&
			plugin.name === 'finance-debug-default'
	)
	if (
		!plugin ||
		typeof plugin !== 'object' ||
		!('config' in plugin) ||
		typeof plugin.config !== 'function'
	)
		throw new Error('Missing debug configuration hook')
	const context: ConfigPluginContext = {
		meta: { rollupVersion: '4', rolldownVersion: '1', viteVersion: '8' },
		error: () => {
			throw new Error('Vite configuration failed')
		},
		warn: vi.fn(),
		info: vi.fn(),
		debug: vi.fn()
	}
	await plugin.config.call(context, { envDir: directory }, { command, mode })
}

it.each([
	{ command: 'serve', mode: 'development', expected: 'true' },
	{ command: 'serve', mode: 'staging', expected: 'false' },
	{ command: 'build', mode: 'production', expected: 'false' },
	{ command: 'build', mode: 'development', expected: 'false' }
] satisfies { command: 'serve' | 'build'; mode: string; expected: string }[])(
	'defaults $command/$mode to $expected',
	async ({ command, mode, expected }) => {
		await configure(command, mode)
		expect(process.env.PUBLIC_DEBUG).toBe(expected)
	}
)

it('honors a local false override in development', async () => {
	writeFileSync(join(directory, '.env.local'), 'PUBLIC_DEBUG=false\n')
	await configure('serve', 'development')
	expect(process.env.PUBLIC_DEBUG).toBe('false')
})

it('honors a mode-specific deployed opt-in', async () => {
	writeFileSync(join(directory, '.env'), 'PUBLIC_DEBUG=false\n')
	writeFileSync(join(directory, '.env.staging.local'), 'PUBLIC_DEBUG=true\n')
	await configure('build', 'staging')
	expect(process.env.PUBLIC_DEBUG).toBe('true')
})

it('gives the shell priority over env files', async () => {
	vi.stubEnv('PUBLIC_DEBUG', 'false')
	writeFileSync(join(directory, '.env.local'), 'PUBLIC_DEBUG=true\n')
	await configure('serve', 'development')
	expect(process.env.PUBLIC_DEBUG).toBe('false')
})
