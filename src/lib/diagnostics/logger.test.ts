import { afterEach, expect, it, vi } from 'vitest'
import { createLogger } from './logger.js'
import type { LogSink } from './logger.js'

afterEach(() => vi.restoreAllMocks())
function output() {
	return {
		info: vi.fn<LogSink['info']>(),
		warn: vi.fn<LogSink['warn']>(),
		error: vi.fn<LogSink['error']>()
	}
}

it('defaults every level to silent and has no construction effects', () => {
	const info = vi.spyOn(console, 'info').mockImplementation(() => {})
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
	const error = vi.spyOn(console, 'error').mockImplementation(() => {})
	const logger = createLogger('default')
	logger.info('started')
	logger.warn('waiting')
	logger.error('failed')
	expect(info).not.toHaveBeenCalled()
	expect(warn).not.toHaveBeenCalled()
	expect(error).not.toHaveBeenCalled()
})
it('preserves the console prefix and details for all explicitly enabled levels', () => {
	const info = vi.spyOn(console, 'info').mockImplementation(() => {})
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
	const error = vi.spyOn(console, 'error').mockImplementation(() => {})
	const logger = createLogger('fixture', { enabled: true })
	const details = { count: 2, nested: { available: true } }
	logger.info('started', details)
	logger.warn('waiting')
	logger.error('failed', { reason: 'unavailable' })
	expect(info).toHaveBeenCalledExactlyOnceWith('[fixture] started', details)
	expect(info.mock.calls[0]?.[1]).toBe(details)
	expect(warn).toHaveBeenCalledExactlyOnceWith('[fixture] waiting', {})
	expect(error).toHaveBeenCalledExactlyOnceWith('[fixture] failed', { reason: 'unavailable' })
})
it('keeps logger enablement and scopes independent', () => {
	const sink = output()
	const enabled = createLogger('first', { enabled: true, sink })
	const disabled = createLogger('second', { enabled: false, sink })
	disabled.info('hidden')
	disabled.warn('hidden')
	disabled.error('hidden')
	enabled.info('visible')
	expect(sink.info).toHaveBeenCalledExactlyOnceWith('[first] visible', {})
	expect(sink.warn).not.toHaveBeenCalled()
	expect(sink.error).not.toHaveBeenCalled()
})
it('captures options so caller mutation cannot enable an existing disabled logger', () => {
	const original = output(),
		replacement = output()
	const options = { enabled: false, sink: original }
	const logger = createLogger('captured', options)
	options.enabled = true
	options.sink = replacement
	logger.error('hidden')
	expect(original.error).not.toHaveBeenCalled()
	expect(replacement.error).not.toHaveBeenCalled()
})
it('delegates to the injected sink with its receiver and without console output', () => {
	const info = vi.spyOn(console, 'info').mockImplementation(() => {})
	const received: string[] = []
	const sink = {
		label: 'receiver',
		info(message: string) {
			received.push(`${this.label}: ${message}`)
		},
		warn(message: string) {
			received.push(`${this.label}: ${message}`)
		},
		error(message: string) {
			received.push(`${this.label}: ${message}`)
		}
	}
	const logger = createLogger('sink', { enabled: true, sink })
	logger.info('started')
	logger.warn('waiting')
	logger.error('failed')
	expect(received).toEqual([
		'receiver: [sink] started',
		'receiver: [sink] waiting',
		'receiver: [sink] failed'
	])
	expect(info).not.toHaveBeenCalled()
})
it('does not invoke a disabled throwing sink and propagates enabled sink failures', () => {
	const sink = output(),
		failure = new Error('synthetic sink failure')
	sink.error.mockImplementation(() => {
		throw failure
	})
	expect(() => createLogger('disabled', { enabled: false, sink }).error('ignored')).not.toThrow()
	expect(() => createLogger('enabled', { enabled: true, sink }).error('failed')).toThrow(failure)
})
