import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const environment = vi.hoisted(() => ({ PUBLIC_DEBUG: 'false', dev: false }))
vi.mock('$app/env/public', () => environment)
vi.mock('$app/env', () => environment)

beforeEach(() => vi.resetModules())
afterEach(() => vi.restoreAllMocks())

it.each([
	{ flag: 'true', dev: false, enabled: true },
	{ flag: 'false', dev: true, enabled: false },
	{ flag: 'false', dev: false, enabled: false },
	{ flag: '', dev: true, enabled: false },
	{ flag: 'TRUE', dev: false, enabled: false }
])('uses only the explicit debug flag: $flag, dev=$dev', async ({ flag, dev, enabled }) => {
	environment.PUBLIC_DEBUG = flag
	environment.dev = dev
	const info = vi.spyOn(console, 'info').mockImplementation(() => {})
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
	const error = vi.spyOn(console, 'error').mockImplementation(() => {})
	const { createLogger, debugEnabled } = await import('./logger.js')
	const logger = createLogger('fixture')
	logger.info('started', { count: 2 })
	logger.warn('waiting')
	logger.error('failed', { reason: 'unauthorized' })
	expect(debugEnabled).toBe(enabled)
	if (enabled) {
		expect(info).toHaveBeenCalledWith('[fixture] started', { count: 2 })
		expect(warn).toHaveBeenCalledWith('[fixture] waiting', {})
		expect(error).toHaveBeenCalledWith('[fixture] failed', { reason: 'unauthorized' })
	} else {
		expect(info).not.toHaveBeenCalled()
		expect(warn).not.toHaveBeenCalled()
		expect(error).not.toHaveBeenCalled()
	}
})
