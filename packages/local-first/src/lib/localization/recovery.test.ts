import { afterEach, describe, expect, it, vi } from 'vitest'
import * as runtime from '../paraglide/runtime.js'
import { createRecoveryMessages } from './recovery.js'

afterEach(() => vi.restoreAllMocks())

describe('recovery messages', () => {
	it('resolves shared nouns and action templates into complete English text', () => {
		const messages = createRecoveryMessages('en')
		expect(messages.heading).toBe('Account recovery')
		expect(messages.show).toBe('Show Recovery phrase')
		expect(messages.close).toBe('Close')
		expect(Object.values(messages).every((value) => value.trim().length > 0)).toBe(true)
	})

	it('does not consult ambient locale or change host locale', () => {
		const ambient = vi.spyOn(runtime, 'getLocale').mockImplementation(() => {
			throw new Error('Ambient locale must not be used')
		})
		const setLocale = vi.spyOn(runtime, 'setLocale')
		expect(createRecoveryMessages('en').heading).toBe('Account recovery')
		expect(ambient).not.toHaveBeenCalled()
		expect(setLocale).not.toHaveBeenCalled()
	})

	it('keeps overrides local to each message object', () => {
		const first = createRecoveryMessages('en', { close: 'Dismiss first', warning: 'First warning' })
		const second = createRecoveryMessages('en', { close: 'Dismiss second' })
		const defaults = createRecoveryMessages('en')
		expect(first.close).toBe('Dismiss first')
		expect(second.close).toBe('Dismiss second')
		expect(defaults.close).toBe('Close')
		expect(second.warning).toBe(defaults.warning)
		expect(first.warning).toBe('First warning')
	})

	it('does not mutate consumer overrides', () => {
		const overrides = Object.freeze({ close: 'Dismiss' })
		const messages = createRecoveryMessages('en', overrides)
		expect(overrides).toEqual({ close: 'Dismiss' })
		expect(messages.close).toBe('Dismiss')
		expect(messages.warning).toBe(createRecoveryMessages('en').warning)
	})

	it('rejects unsupported locales at the JavaScript boundary', () => {
		expect(() => Reflect.apply(createRecoveryMessages, undefined, ['de'])).toThrow(RangeError)
	})
})
