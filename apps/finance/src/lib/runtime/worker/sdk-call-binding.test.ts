import { expect, it, vi } from 'vitest'
import type {
	BrokerHostOperation,
	BrokerHostResult
} from 'delightful-local-first/backend/jazz/worker-broker'
import { prepareFinanceSdkCall } from './sdk-call-binding.js'

const origin = 'https://finance.example'
const url = `${origin}/assets/broker.js`
const name = 'jazz-runtime:independent:root:generation-2'
const key = 'jazz:shared-worker-generation:jazz-runtime:exact:storage'
const identity = {
	runtimeId: '11111111-1111-4111-8111-111111111111',
	requestId: '22222222-2222-4222-8222-222222222222'
}
function prepare(operation: BrokerHostOperation) {
	const recipient = vi.fn<(result: BrokerHostResult) => void>()
	return {
		prepared: prepareFinanceSdkCall({ identity, operation, origin, onBrokerResult: recipient }),
		recipient
	}
}

it('binds an OPEN to its canonical same-origin URL and exact full SDK name', () => {
	const { prepared, recipient } = prepare({
		type: 'OPEN',
		url: 'HTTPS://FINANCE.EXAMPLE:443/a/../assets/broker.js',
		name
	})
	expect(prepared.identity).toEqual(identity)
	expect(prepared.identity).not.toBe(identity)
	expect(prepared.descriptor).toEqual({ kind: 'broker', url, name })
	expect(prepared.call.request).toEqual({ type: 'OPEN', url, name })
	expect(prepared.call.requestId).toBe(identity.requestId)
	expect(prepared.call.effect).toBe('effect')
	expect(recipient).not.toHaveBeenCalled()
})

it.each(['READ', 'WRITE'] satisfies Array<'READ' | 'WRITE'>)(
	'preserves the independent generation key for %s',
	(type) => {
		const operation: BrokerHostOperation =
			type === 'READ' ? { type, key } : { type, key, value: '9007199254740991' }
		const { prepared, recipient } = prepare(operation)
		expect(prepared.descriptor).toEqual({ kind: 'generation', key })
		expect(prepared.call.request).toEqual(operation)
		expect(prepared.call.effect).toBe(type === 'READ' ? 'query' : 'effect')
		expect(recipient).not.toHaveBeenCalled()
	}
)

it('captures identity, operation and recipient before the caller changes them', () => {
	const first = vi.fn<(result: BrokerHostResult) => void>(),
		replacement = vi.fn()
	const operation: Extract<BrokerHostOperation, { type: 'WRITE' }> = {
		type: 'WRITE',
		key,
		value: '2'
	}
	const source = { identity: { ...identity }, operation, origin, onBrokerResult: first }
	const prepared = prepareFinanceSdkCall(source)
	source.identity.runtimeId = '33333333-3333-4333-8333-333333333333'
	source.identity.requestId = '44444444-4444-4444-8444-444444444444'
	operation.key += ':replacement'
	operation.value = '3'
	source.onBrokerResult = replacement
	expect(prepared.identity).toEqual(identity)
	expect(prepared.descriptor).toEqual({ kind: 'generation', key })
	expect(prepared.call.request).toEqual({ type: 'WRITE', key, value: '2' })
	const result: BrokerHostResult = {
		kind: 'refused',
		scope: identity.runtimeId,
		requestId: identity.requestId,
		reason: 'closed',
		effectOutcome: 'not-issued'
	}
	prepared.call.settle(result)
	expect(first).toHaveBeenCalledExactlyOnceWith(result)
	expect(replacement).not.toHaveBeenCalled()
})

it('counts canonical UTF-8 JSON bytes including Unicode and escaping rather than string length', () => {
	const unicodeKey = 'jazz:shared-worker-generation:jazz-runtime:é🙂"\\\n'
	const { prepared } = prepare({ type: 'READ', key: unicodeKey })
	// READ punctuation/type/key wrapper is 24 ASCII bytes; prefix is 43,
	// é is 2, emoji 4, and quote/backslash/newline each require 2 JSON bytes.
	expect(prepared.payloadBytes).toBe(24 + 43 + 2 + 4 + 6)
	expect(prepared.payloadBytes).toBeGreaterThan(JSON.stringify(prepared.call.request).length)
	const open = prepare({ type: 'OPEN', url: `${origin}/é`, name }).prepared
	expect(open.call.request).toEqual({ type: 'OPEN', url: `${origin}/%C3%A9`, name })
	expect(open.payloadBytes).toBe(
		Buffer.byteLength(`{"type":"OPEN","url":"${origin}/%C3%A9","name":"${name}"}`, 'utf8')
	)
})

it('rejects canonical URL expansion past the actual wire bound before notifying a recipient', () => {
	const recipient = vi.fn()
	const expanded = `${origin}/` + 'é'.repeat(1400)
	expect(expanded.length).toBeLessThan(8192)
	expect(new URL(expanded).href.length).toBeGreaterThan(8192)
	expect(() =>
		prepareFinanceSdkCall({
			identity,
			origin,
			operation: { type: 'OPEN', url: expanded, name },
			onBrokerResult: recipient
		})
	).toThrow('Broker host unavailable')
	expect(recipient).not.toHaveBeenCalled()
})

it.each([
	{ type: 'OPEN', url: 'https://other.example/broker.js', name },
	{ type: 'OPEN', url: 'https://secret@finance.example/broker.js', name },
	{ type: 'OPEN', url: 'ftp://finance.example/broker.js', name },
	{ type: 'OPEN', url, name: 'jazz-runtime:root:generation-9007199254740992' },
	{ type: 'OPEN', url, name: 'jazz-runtime:root:generation--1' },
	{ type: 'OPEN', url, name, ...{ key } },
	{ type: 'READ', key: 'unrelated' },
	{ type: 'READ', key, ...{ value: '2' } },
	{ type: 'WRITE', key, value: '-1' },
	{ type: 'WRITE', key, value: '1.5' },
	{ type: 'WRITE', key, value: '9007199254740992' },
	{ type: 'WRITE', key, value: '1'.repeat(17) }
] satisfies BrokerHostOperation[])(
	'rejects invalid SDK operations before callback delivery %#',
	(operation) => {
		const recipient = vi.fn()
		expect(() =>
			prepareFinanceSdkCall({ identity, origin, operation, onBrokerResult: recipient })
		).toThrow()
		expect(recipient).not.toHaveBeenCalled()
	}
)

it.each([{ runtimeId: 'invalid' }, { requestId: 'invalid' }])(
	'rejects invalid callback identity %j',
	(change) => {
		const recipient = vi.fn()
		expect(() =>
			prepareFinanceSdkCall({
				identity: { ...identity, ...change },
				origin,
				operation: { type: 'READ', key },
				onBrokerResult: recipient
			})
		).toThrow()
		expect(recipient).not.toHaveBeenCalled()
	}
)

it('preserves public reply acceptance rules for the prepared canonical operation', () => {
	const read = prepare({ type: 'READ', key }).prepared
	expect(read.call.accept({ type: 'RESULT', value: '2' })).toBe(true)
	const write = prepare({ type: 'WRITE', key, value: '2' }).prepared
	expect(write.call.accept({ type: 'RESULT', value: '2' })).toBe(false)
	expect(write.call.accept({ type: 'RESULT', value: null })).toBe(true)
})
