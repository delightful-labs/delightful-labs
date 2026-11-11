import { describe, expect, it, vi, beforeEach } from 'vitest'
import { ReadTier } from 'jazz-tools'
import { createQuerySubscription, createQuerySubscriptionOne } from './data.svelte.js'

// SDK constructors remain the lifecycle boundary. These stand-ins observe delegation only.
const native = vi.hoisted(() => ({
	many: vi.fn(function (_query: unknown, _options: unknown) {
		return { kind: 'native-many' }
	}),
	one: vi.fn(function (_query: unknown, _options: unknown) {
		return { kind: 'native-one' }
	})
}))
vi.mock('jazz-tools/svelte', () => ({
	QuerySubscription: native.many,
	QuerySubscriptionOne: native.one
}))
beforeEach(() => vi.clearAllMocks())

describe('Jazz subscription function boundary', () => {
	it.each([
		{ create: createQuerySubscription, constructor: native.many },
		{ create: createQuerySubscriptionOne, constructor: native.one }
	])('returns the SDK instance with lazy local-first options', ({ create, constructor }) => {
		const query = vi.fn(() => undefined)
		const subscription = create(query)
		expect(subscription).toBe(constructor.mock.results[0]?.value)
		expect(constructor).toHaveBeenCalledOnce()
		expect(constructor.mock.calls[0]?.[0]).toBe(query)
		expect(query).not.toHaveBeenCalled()
		const options = constructor.mock.calls[0]?.[1]
		if (typeof options !== 'function') throw new Error('Expected lazy native options')
		expect(options()).toEqual({ tier: ReadTier.LocalFirst })
	})
	it.each([
		{ create: createQuerySubscription, constructor: native.many },
		{ create: createQuerySubscriptionOne, constructor: native.one }
	])('preserves caller tiers and re-evaluates reactive options', ({ create, constructor }) => {
		let tier: 'local-first' | 'remote' = 'remote'
		const supplied = vi.fn(() => ({ tier }))
		create(undefined, supplied)
		expect(supplied).not.toHaveBeenCalled()
		const options = constructor.mock.calls[0]?.[1]
		if (typeof options !== 'function') throw new Error('Expected lazy native options')
		expect(options()).toEqual({ tier: 'remote' })
		tier = 'local-first'
		expect(options()).toEqual({ tier: 'local-first' })
		expect(supplied).toHaveBeenCalledTimes(2)
	})
	it('preserves explicit static options without mutating the caller object', () => {
		const supplied = Object.freeze({ tier: ReadTier.Remote })
		createQuerySubscription(undefined, supplied)
		const options = native.many.mock.calls[0]?.[1]
		if (typeof options !== 'function') throw new Error('Expected lazy native options')
		expect(options()).toEqual(supplied)
		expect(supplied).toEqual({ tier: ReadTier.Remote })
	})
})
