import { setImmediate } from 'node:timers/promises'
import { afterEach, expect, it, vi } from 'vitest'
import { waitFor } from 'xstate'
import { sdkCallFixture, sdkKey, sdkOpen } from './worker-sdk-call-owner.test-support.js'
import { grantFixture } from './worker-grant-owner.test-support.js'

const cleanups = new Set<() => void>()
afterEach(() => {
	try {
		for (const cleanup of cleanups) cleanup()
	} finally {
		cleanups.clear()
	}
})
function fixture(options: Parameters<typeof sdkCallFixture>[0] = {}) {
	const f = sdkCallFixture(options)
	cleanups.add(() => f.dispose())
	return f
}
async function flush() {
	await Promise.resolve()
	await setImmediate()
}
function delivered(f: ReturnType<typeof fixture>) {
	return f.reports.filter((r) => r.type === 'SDK_CALL_DELIVERED')
}

it('captures construction input without registering, dispatching or settling native work', () => {
	const f = fixture({ start: false })
	expect(f.order).toEqual([])
	expect(f.recipient).not.toHaveBeenCalled()
	expect(f.recordStopResult).not.toHaveBeenCalled()
	f.actor.start()
	expect(f.requests).toHaveLength(0)
})

it.each([
	{ operation: sdkOpen, effectOutcome: 'unknown' },
	{ operation: { type: 'WRITE', key: sdkKey, value: '2' }, effectOutcome: 'unknown' },
	{ operation: { type: 'READ', key: sdkKey }, effectOutcome: 'not-issued' }
] satisfies Array<{
	operation: import('delightful-local-first/backend/jazz/worker-broker').BrokerHostOperation
	effectOutcome: string
}>)(
	'records the conservative $effectOutcome stop result before dispatching $operation.type once',
	({ operation, effectOutcome }) => {
		const f = fixture({ operation })
		f.available()
		f.available()
		expect(f.order).toEqual(['record-stop', 'request'])
		expect(f.recordStopResult).toHaveBeenCalledExactlyOnceWith(f.identity, {
			kind: 'interrupted',
			reason: 'closed',
			effectOutcome
		})
		expect(f.requests).toHaveLength(1)
		expect(f.requests[0]?.request).toEqual(operation)
	}
)

it.each(['runtimeId', 'grantId', 'acquisitionId'] satisfies Array<
	keyof ReturnType<typeof fixture>['grant']
>)('rejects a foreign %s grant availability', (field) => {
	const f = fixture()
	f.actor.send({ type: 'GRANT_AVAILABLE', identity: { ...f.grant, [field]: crypto.randomUUID() } })
	expect(f.requests).toHaveLength(0)
	expect(f.recordStopResult).not.toHaveBeenCalled()
})

it('refuses availability from a stopped grant without issuing an operation', async () => {
	const f = fixture()
	f.endpoint.stop()
	f.available()
	await flush()
	expect(f.requests).toHaveLength(0)
	expect(f.sdkResults).toEqual([
		{ kind: 'interrupted', reason: 'unavailable', effectOutcome: 'not-issued' }
	])
	expect(f.actor.getSnapshot().output?.evidence).toBe('definitive-result')
})

it.each(['closed', 'unavailable'] satisfies Array<'closed' | 'unavailable'>)(
	'cancels a waiting callback as not issued after admission is %s',
	async (reason) => {
		const f = fixture()
		f.gate.send({ type: 'CLOSE_ADMISSION' })
		f.actor.send({ type: 'CANCEL_WAITING', identity: f.identity, reason })
		await flush()
		expect(f.sdkResults).toEqual([{ kind: 'interrupted', reason, effectOutcome: 'not-issued' }])
		expect(f.requests).toHaveLength(0)
		expect(f.actor.getSnapshot().output?.evidence).toBe('definitive-result')
	}
)

it('does not cancel or relabel an issued call', async () => {
	const f = fixture()
	f.available()
	f.actor.send({ type: 'CANCEL_WAITING', identity: f.identity, reason: 'closed' })
	expect(f.recipient).not.toHaveBeenCalled()
	f.success()
	await flush()
	expect(f.sdkResults[0]?.kind).toBe('succeeded')
	expect(f.requests).toHaveLength(1)
	expect(f.actor.getSnapshot().status).toBe('done')
})

it('waits for the actual SDK receipt after the keeper delivery has returned', async () => {
	const f = fixture({ autoSdkReceipt: false })
	f.available()
	f.success()
	await flush()
	expect(f.promiseOutcome()).toBe('resolved')
	expect(f.deliver).toHaveBeenCalledOnce()
	expect(delivered(f)).toHaveLength(0)
	expect(f.actor.getSnapshot().output).toBeUndefined()
	f.sdkReceipt()
	await flush()
	expect(delivered(f)).toHaveLength(1)
	expect(f.actor.getSnapshot().output?.evidence).toBe('definitive-result')
})

it('does not use early or foreign SDK receipts as evidence for a later delivery', async () => {
	const f = fixture({ autoSdkReceipt: false })
	f.sdkReceipt()
	f.available()
	f.success()
	await flush()
	f.actor.send({
		type: 'SDK_CALLBACK_SETTLED',
		identity: { ...f.identity, runtimeId: crypto.randomUUID() }
	})
	f.actor.send({
		type: 'SDK_CALLBACK_SETTLED',
		identity: { ...f.identity, requestId: crypto.randomUUID() }
	})
	await flush()
	expect(delivered(f)).toHaveLength(0)
	f.sdkReceipt()
	await flush()
	expect(f.actor.getSnapshot().status).toBe('done')
})

it('closes native admission before failure reaches a caller that attempts a fallback open', async () => {
	const f = fixture({ autoFaultAck: false })
	const fallback = f.observedPromise.then(() => f.gate.send({ type: 'ATTEMPT_NATIVE_OPEN' }))
	f.available()
	f.failure()
	await flush()
	expect(f.gate.getSnapshot().matches('faulted')).toBe(true)
	expect(f.recipient).not.toHaveBeenCalled()
	f.ackFault()
	await fallback
	await flush()
	expect(f.order.indexOf('admission-closed')).toBeLessThan(f.order.indexOf('sdk-settled'))
	expect(f.promiseOutcome()).toBe('rejected')
	expect(f.nativePosts).not.toHaveBeenCalled()
	expect(f.actor.getSnapshot().output).toBeUndefined()
	f.closed()
	await flush()
	expect(f.actor.getSnapshot().output?.evidence).toBe('grant-closed')
})

it('does not reuse early or foreign fault acknowledgements', async () => {
	const f = fixture({ autoFaultAck: false })
	f.actor.send({ type: 'ADMISSION_FAULTED', identity: f.identity })
	f.available()
	f.failure()
	await flush()
	f.actor.send({
		type: 'ADMISSION_FAULTED',
		identity: { ...f.identity, runtimeId: crypto.randomUUID() }
	})
	f.actor.send({
		type: 'ADMISSION_FAULTED',
		identity: { ...f.identity, requestId: crypto.randomUUID() }
	})
	expect(f.recipient).not.toHaveBeenCalled()
	f.ackFault()
	await flush()
	expect(f.recipient).toHaveBeenCalledOnce()
})

it.each([
	{ operation: { type: 'WRITE', key: sdkKey, value: '2' }, effectOutcome: 'unknown' },
	{ operation: { type: 'READ', key: sdkKey }, effectOutcome: 'not-issued' }
] satisfies Array<{
	operation: import('delightful-local-first/backend/jazz/worker-broker').BrokerHostOperation
	effectOutcome: 'unknown' | 'not-issued'
}>)(
	'retains a failed $operation.type reservation after SDK settlement until genuine closure',
	async ({ operation, effectOutcome }) => {
		const f = fixture({ operation })
		f.available()
		f.failure(effectOutcome)
		await flush()
		expect(f.promiseOutcome()).toBe('rejected')
		expect(delivered(f)[0]?.reservation).toBe('retained-until-close')
		expect(f.actor.getSnapshot().output).toBeUndefined()
		for (const field of ['runtimeId', 'grantId', 'acquisitionId'] satisfies Array<
			keyof typeof f.grant
		>)
			f.actor.send({
				type: 'GRANT_CLOSED',
				identity: { ...f.grant, [field]: crypto.randomUUID() },
				receipt: f.close
			})
		for (const field of ['scope', 'requestId'] satisfies Array<keyof typeof f.close>)
			f.actor.send({
				type: 'GRANT_CLOSED',
				identity: f.grant,
				receipt: { ...f.close, [field]: crypto.randomUUID() }
			})
		expect(f.actor.getSnapshot().output).toBeUndefined()
		f.closed()
		await flush()
		expect(f.actor.getSnapshot().output?.evidence).toBe('grant-closed')
	}
)

it('releases a broker refusal only after the fault gate and SDK receipt', async () => {
	const f = fixture({ autoFaultAck: false })
	f.available()
	f.result({
		kind: 'refused',
		scope: f.grant.grantId,
		requestId: f.identity.requestId,
		reason: 'rejected',
		effectOutcome: 'not-issued'
	})
	await flush()
	expect(f.recipient).not.toHaveBeenCalled()
	f.ackFault()
	await flush()
	expect(f.actor.getSnapshot().output?.evidence).toBe('definitive-result')
})

it.each([false, true])(
	'retains an actual close received %s before SDK settlement',
	async (beforeDelivery) => {
		const f = fixture({ autoFaultAck: false, autoSdkReceipt: false })
		f.available()
		f.failure()
		if (beforeDelivery) f.closed()
		f.ackFault()
		await flush()
		if (!beforeDelivery) f.closed()
		expect(f.actor.getSnapshot().output).toBeUndefined()
		f.sdkReceipt()
		await flush()
		expect(f.actor.getSnapshot().output?.evidence).toBe('grant-closed')
	}
)

it.each([false, true])(
	'interrupts closure before a broker result without inventing wire identity (issued %s)',
	async (issued) => {
		const f = fixture()
		if (issued) f.available()
		f.closed()
		await flush()
		expect(f.sdkResults).toEqual([
			{
				kind: 'interrupted',
				reason: issued ? 'closed' : 'unavailable',
				effectOutcome: issued ? 'unknown' : 'not-issued'
			}
		])
		expect(f.actor.getSnapshot().output?.evidence).toBe(
			issued ? 'grant-closed' : 'definitive-result'
		)
	}
)

it.each(['scope', 'requestId'] satisfies Array<'scope' | 'requestId'>)(
	'ignores a broker result with a foreign wire %s',
	async (field) => {
		const f = fixture()
		f.available()
		f.result({
			kind: 'succeeded',
			identity: { ...f.wire, [field]: crypto.randomUUID() },
			response: { type: 'RESULT', value: null }
		})
		await flush()
		expect(f.recipient).not.toHaveBeenCalled()
		f.success()
		await flush()
		expect(f.actor.getSnapshot().status).toBe('done')
	}
)

it.each(['runtimeId', 'requestId'] satisfies Array<'runtimeId' | 'requestId'>)(
	'ignores a result for another callback %s',
	async (field) => {
		const f = fixture()
		f.available()
		f.actor.send({
			type: 'BROKER_RESULT',
			identity: { ...f.identity, [field]: crypto.randomUUID() },
			result: { kind: 'succeeded', identity: f.wire, response: { type: 'RESULT', value: null } },
			token: undefined
		})
		await flush()
		expect(f.recipient).not.toHaveBeenCalled()
	}
)

it.each([{ register: false }, { throwRecipient: true }])(
	'cannot infer SDK settlement from a missing or throwing observer %j',
	async (options) => {
		const f = fixture({ ...options, operation: sdkOpen })
		f.available()
		const pair = f.pair()
		f.success({ type: 'OPENED', port: pair.port1 })
		await flush()
		expect(delivered(f)).toHaveLength(0)
		expect(f.actor.getSnapshot().output).toBeUndefined()
		expect(f.promiseOutcome()).toBeUndefined()
		if (options.throwRecipient) {
			expect(f.discard).toHaveBeenCalledOnce()
			expect(f.discard.mock.calls[0]?.[0].type).toBe('OPENED')
		}
	}
)

it('waits for native delivery completion even when SDK settlement was already reported', async () => {
	const f = fixture({ operation: sdkOpen })
	f.deliver.mockImplementation((identity, result, token) => {
		f.custody.deliver(identity, result, token)
		throw new Error('Native delivery failed after SDK settlement')
	})
	f.available()
	const pair = f.pair()
	f.success({ type: 'OPENED', port: pair.port1 })
	await flush()
	expect(f.promiseOutcome()).toBe('resolved')
	expect(delivered(f)).toHaveLength(0)
	expect(f.reports.filter((r) => r.type === 'SDK_CALL_BLOCKED')).toHaveLength(1)
	expect(f.actor.getSnapshot().output).toBeUndefined()
	f.custody.stop()
	expect(f.discard).not.toHaveBeenCalled()
	const echo = new Promise<unknown>((resolve) => {
		pair.port2.onmessage = (event) => resolve(event.data)
	})
	pair.port1.postMessage('accepted SDK port survives error')
	expect(await echo).toBe('accepted SDK port survives error')
})

it('blocks missing port custody and invalid reply types without delivering them', async () => {
	const f = fixture({ operation: sdkOpen })
	f.available()
	const pair = f.pair()
	f.actor.send({
		type: 'BROKER_RESULT',
		identity: f.identity,
		result: { kind: 'succeeded', identity: f.wire, response: { type: 'OPENED', port: pair.port1 } },
		token: undefined
	})
	await flush()
	expect(f.recipient).not.toHaveBeenCalled()
	expect(f.reports.at(-1)?.type).toBe('SDK_CALL_BLOCKED')
	const other = fixture()
	other.available()
	other.success({ type: 'RESULT', value: 'unexpected WRITE result' })
	await flush()
	expect(other.recipient).not.toHaveBeenCalled()
	expect(other.actor.getSnapshot().output).toBeUndefined()
})

it('surfaces stop-record errors without forwarding a request or claiming release', async () => {
	const f = fixture()
	f.recordStopResult.mockImplementation(() => {
		throw new Error('Native bookkeeping failed')
	})
	f.available()
	await flush()
	expect(f.requests).toHaveLength(0)
	expect(f.reports.at(-1)?.type).toBe('SDK_CALL_BLOCKED')
	expect(f.actor.getSnapshot().output).toBeUndefined()
})

it('retains failed native disposal even when its SDK failure recipient settled', async () => {
	const f = fixture()
	f.available()
	const pair = f.pair()
	const token = f.custody.capture({ type: 'OPENED', port: pair.port1 })
	f.discard.mockImplementation(() => {
		throw new Error('Native disposer failed')
	})
	f.actor.send({
		type: 'BROKER_RESULT',
		identity: f.identity,
		result: { kind: 'failed', identity: f.wire, reason: 'unavailable', effectOutcome: 'unknown' },
		token
	})
	await flush()
	expect(f.promiseOutcome()).toBe('rejected')
	expect(delivered(f)).toHaveLength(0)
	expect(f.actor.getSnapshot().output).toBeUndefined()
	expect(f.reports.at(-1)?.type).toBe('SDK_CALL_BLOCKED')
	f.discard.mockImplementation((response) => {
		if (response.type === 'OPENED') response.port.close()
	})
	f.gate.send({ type: 'CLOSE_ADMISSION' })
	f.actor.stop()
	f.custody.stop()
	expect(f.discard).toHaveBeenCalledTimes(2)
})

it('captures configuration and native methods before the caller replaces them', async () => {
	const f = fixture({ start: false }),
		grant = { ...f.grant },
		bad = vi.fn()
	f.configuration.origin = 'https://other.example'
	f.configuration.grant = { ...f.grant, grantId: crypto.randomUUID() }
	f.configuration.prepared = { ...f.prepared, payloadBytes: -1 }
	f.configuration.custody = { recordStopResult: bad, deliver: bad }
	f.actor.start()
	f.actor.send({ type: 'GRANT_AVAILABLE', identity: grant })
	f.success()
	await flush()
	expect(bad).not.toHaveBeenCalled()
	expect(f.recordStopResult).toHaveBeenCalledOnce()
	expect(f.actor.getSnapshot().output?.grant).toEqual(grant)
})

it('clears completed payload/capabilities and preserves the SDK accepted port through root teardown', async () => {
	const f = fixture({ operation: sdkOpen })
	f.available()
	const pair = f.pair()
	f.success({ type: 'OPENED', port: pair.port1 })
	await flush()
	expect(f.actor.getSnapshot().output).toEqual({
		kind: 'released',
		identity: f.identity,
		grant: f.grant,
		evidence: 'definitive-result'
	})
	const r = f.actor.getSnapshot().context.record
	expect([r.configuration, r.result, r.token, r.receipt]).toEqual([
		undefined,
		undefined,
		undefined,
		undefined
	])
	f.custody.stop()
	expect(f.discard).not.toHaveBeenCalled()
	const echo = new Promise<unknown>((resolve) => {
		pair.port2.onmessage = (event) => resolve(event.data)
	})
	pair.port1.postMessage('SDK owns this port')
	expect(await echo).toBe('SDK owns this port')
})

it.each([false, true])(
	'forced stop settles native custody truthfully and emits no successful output (issued %s)',
	async (issued) => {
		const f = fixture()
		if (issued) f.available()
		f.gate.send({ type: 'CLOSE_ADMISSION' })
		f.actor.stop()
		f.custody.stop()
		await flush()
		expect(f.sdkResults).toEqual([
			{ kind: 'interrupted', reason: 'closed', effectOutcome: issued ? 'unknown' : 'not-issued' }
		])
		expect(f.actor.getSnapshot().output).toBeUndefined()
		expect(delivered(f)).toHaveLength(0)
	}
)

it.each(['payload', 'binding', 'scope', 'origin', 'close'])(
	'rejects invalid %s initialization before effects',
	(field) => {
		const f = fixture({
			configure(input) {
				if (field === 'payload')
					input.prepared = { ...input.prepared, payloadBytes: input.prepared.payloadBytes + 1 }
				if (field === 'binding')
					input.prepared = {
						...input.prepared,
						descriptor: { kind: 'generation', key: sdkKey + ':other' }
					}
				if (field === 'scope') input.grant = { ...input.grant, runtimeId: crypto.randomUUID() }
				if (field === 'origin') input.origin = 'https://secret@finance.example'
				if (field === 'close') input.closeRequestId = 'invalid'
			}
		})
		expect(f.errors).toHaveLength(1)
		expect(f.requests).toHaveLength(0)
		expect(f.deliver).not.toHaveBeenCalled()
	}
)

it('uses the real grant/channel and native generation host through SDK delivery and host close', async () => {
	const g = grantFixture({ descriptor: { kind: 'generation', key: sdkKey } })
	cleanups.add(() => g.dispose())
	const grantTo = g.parent.getSnapshot().children.grant
	if (!grantTo) throw new Error('Missing real grant owner')
	const f = fixture({
		grantTo,
		grant: g.identity,
		closeRequestId: g.close.requestId,
		operation: { type: 'READ', key: sdkKey }
	})
	g.bind()
	await vi.waitFor(() => expect(g.reports().some((r) => r.type === 'GRANT_AVAILABLE')).toBe(true))
	f.available()
	await waitFor(f.actor, (s) => s.status === 'done')
	expect(f.sdkResults[0]?.kind).toBe('succeeded')
	expect(g.native.storage.getItem).toHaveBeenCalledExactlyOnceWith(sdkKey)
	g.retire()
	await waitFor(g.parent, (s) => s.status === 'done')
	expect(g.parent.getSnapshot().output).toMatchObject({ kind: 'closed', receipt: g.close })
})

it('retains a real timed-out WRITE through SDK rejection and a matching late host close', async () => {
	const g = grantFixture({ manual: true, descriptor: { kind: 'generation', key: sdkKey } })
	cleanups.add(() => g.dispose())
	const grantTo = g.parent.getSnapshot().children.grant
	if (!grantTo) throw new Error('Missing real grant owner')
	const f = fixture({ grantTo, grant: g.identity, closeRequestId: g.close.requestId })
	g.bind()
	await flush()
	f.available()
	await vi.waitFor(() => expect(g.dataCommands).toHaveLength(1))
	g.clock.increment(5)
	await flush()
	expect(f.promiseOutcome()).toBe('rejected')
	expect(f.actor.getSnapshot().output).toBeUndefined()
	await vi.waitFor(() => expect(g.commands).toHaveLength(1))
	g.clock.increment(7)
	await flush()
	expect(g.parent.getSnapshot().output).toBeUndefined()
	g.ack()
	await waitFor(g.parent, (s) => s.status === 'done')
	const output = g.parent.getSnapshot().output
	if (output?.kind !== 'closed') throw new Error('Missing genuine grant closure')
	f.actor.send({ type: 'GRANT_CLOSED', identity: output.identity, receipt: output.receipt })
	await flush()
	expect(f.actor.getSnapshot().output?.evidence).toBe('grant-closed')
})
