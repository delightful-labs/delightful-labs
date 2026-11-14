import { afterEach, expect, it, vi } from 'vitest'
import { brokerHostCall } from 'delightful-local-first/backend/jazz/worker-broker'
import { createFinanceGrantOwner } from './worker-grant-owner.js'
import { grantFixture, key, url, name } from './worker-grant-owner.test-support.js'

const active = new Set<ReturnType<typeof grantFixture>>()
function fixture(options: Parameters<typeof grantFixture>[0] = {}) {
	const f = grantFixture(options)
	active.add(f)
	return f
}
afterEach(() => {
	for (const f of active) f.dispose()
	active.clear()
	vi.restoreAllMocks()
})
function available(f: ReturnType<typeof fixture>) {
	return f.reports().filter((report) => report.type === 'GRANT_AVAILABLE')
}

it('constructs logic without creating native listeners, generating identities or posting', () => {
	const f = fixture({ start: false })
	const effects = [
		vi.spyOn(crypto, 'randomUUID'),
		vi.spyOn(f.data.port2, 'addEventListener'),
		vi.spyOn(f.control.port2, 'addEventListener')
	]
	createFinanceGrantOwner()
	for (const effect of effects) expect(effect).not.toHaveBeenCalled()
	expect(f.postAcquire).not.toHaveBeenCalled()
})

it('refuses an invalid acquisition identity before native posting', () => {
	const f = fixture({
		configure: (input) => {
			input.request.runtimeId = 'invalid'
		}
	})
	expect(f.parent.getSnapshot().context.errors).toBe(1)
	expect(f.postAcquire).not.toHaveBeenCalled()
	expect(f.parent.getSnapshot().output).toBeUndefined()
})

it('handles a grant delivered synchronously during posting without issuing acquisition twice', () => {
	const f = fixture({ start: false })
	f.postAcquire.mockImplementation(() => {
		f.bind()
		return { kind: 'posted' }
	})
	f.parent.start()
	expect(f.reports().map((report) => report.type)).toEqual(['GRANT_ACQUIRED', 'GRANT_AVAILABLE'])
	expect(f.postAcquire).toHaveBeenCalledOnce()
})

it.each([
	{ field: 'acquisitionTimeoutMs', value: 0 },
	{ field: 'requestTimeoutMs', value: 1.5 },
	{ field: 'closeTimeoutMs', value: 2_147_483_648 }
] satisfies {
	field: 'acquisitionTimeoutMs' | 'requestTimeoutMs' | 'closeTimeoutMs'
	value: number
}[])('refuses invalid $field before native posting', ({ field, value }) => {
	const f = fixture({
		configure: (input) => {
			input[field] = value
		}
	})
	expect(f.parent.getSnapshot().context.errors).toBe(1)
	expect(f.postAcquire).not.toHaveBeenCalled()
})

it.each(['invalid', 'ftp://finance.example', 'https://secret@finance.example'])(
	'refuses invalid origin %s without issuing acquisition',
	(origin) => {
		const f = fixture({
			configure: (input) => {
				input.origin = origin
			}
		})
		expect(f.parent.getSnapshot().context.errors).toBe(1)
		expect(f.postAcquire).not.toHaveBeenCalled()
	}
)

it('captures identity, descriptor and deadline budgets before caller mutation', async () => {
	const f = fixture({ manual: true })
	f.configuration.request.runtimeId = crypto.randomUUID()
	if (f.configuration.request.descriptor.kind === 'generation')
		f.configuration.request.descriptor.key += ':changed'
	f.configuration.acquisitionTimeoutMs = 1
	f.configuration.closeTimeoutMs = 1
	expect(f.postAcquire.mock.calls[0]?.[0]).toMatchObject({
		...f.identity,
		descriptor: { kind: 'generation', key }
	})
	f.clock.increment(9)
	expect(f.issues()).toEqual([])
	f.bind()
	expect(available(f)).toHaveLength(1)
	f.retire()
	await vi.waitFor(() => expect(f.commands).toHaveLength(1))
	f.clock.increment(6)
	expect(f.issues()).toEqual([])
	f.ack()
	await vi.waitFor(() =>
		expect(f.parent.getSnapshot().output).toMatchObject({
			kind: 'closed',
			identity: f.identity,
			receipt: f.close
		})
	)
})

it('returns a definitive non-allocation result only from a native not-issued receipt', async () => {
	const f = fixture({
		configure: (input) => {
			vi.mocked(input.postAcquire).mockReturnValue({ kind: 'not-issued', reason: 'unavailable' })
		}
	})
	await vi.waitFor(() =>
		expect(f.parent.getSnapshot().output).toEqual({
			kind: 'not-issued',
			identity: f.identity,
			reason: 'unavailable'
		})
	)
	expect(f.postAcquire).toHaveBeenCalledOnce()
	expect(f.issues()).toEqual(['acquisition-refused'])
	expect(available(f)).toEqual([])
})

it.each(['rejected', 'overloaded', 'unavailable'] satisfies Extract<
	import('../../runtime/worker/grant-protocol.js').FinanceGrantReply,
	{ type: 'GRANT_REFUSED' }
>['reason'][])('accepts definitive %s refusal, including after explicit retirement', (reason) => {
	const f = fixture()
	f.retire()
	f.parent.send({
		type: 'GRANT_REPLY',
		reply: { version: 1, ...f.identity, type: 'GRANT_REFUSED', reason }
	})
	expect(f.parent.getSnapshot().output).toEqual({
		kind: 'not-issued',
		identity: f.identity,
		reason
	})
	expect(f.commands).toEqual([])
})

it('keeps thrown post uncertainty until a late grant genuinely closes', async () => {
	const f = fixture({
		manual: true,
		configure: (input) => {
			vi.mocked(input.postAcquire).mockImplementation(() => {
				throw new Error('Unknown native post')
			})
		}
	})
	await vi.waitFor(() => expect(f.issues()).toEqual(['post-error']))
	expect(f.parent.getSnapshot().output).toBeUndefined()
	f.bind()
	await vi.waitFor(() => expect(f.commands).toHaveLength(1))
	expect(available(f)).toEqual([])
	expect(f.postAcquire).toHaveBeenCalledOnce()
	f.ack()
	await vi.waitFor(() =>
		expect(f.parent.getSnapshot().output).toMatchObject({ kind: 'closed', receipt: f.close })
	)
})

it.each(['retire', 'uncertain', 'overdue'])(
	'preserves acquisition custody after %s, never announces availability and waits past close deadline',
	async (mode) => {
		const f = fixture({ manual: true })
		f.clock.increment(4)
		if (mode === 'retire') {
			f.retire()
			f.retire()
		}
		if (mode === 'uncertain')
			f.parent.send({
				type: 'GRANT_REPLY',
				reply: { version: 1, ...f.identity, type: 'GRANT_UNCERTAIN', reason: 'unavailable' }
			})
		f.clock.increment(5)
		expect(f.issues()).not.toContain('acquisition-overdue')
		f.clock.increment(1)
		expect(f.issues().filter((kind) => kind === 'acquisition-overdue')).toHaveLength(1)
		f.bind()
		await vi.waitFor(() => expect(f.commands).toHaveLength(1))
		expect(available(f)).toEqual([])
		expect(f.reports().filter((report) => report.type === 'GRANT_ACQUIRED')).toHaveLength(1)
		expect(await f.call({ type: 'READ', key }).result).toMatchObject({
			kind: 'refused',
			reason: 'closed',
			effectOutcome: 'not-issued'
		})
		f.clock.increment(7)
		expect(f.issues()).toContain('channel-overdue')
		expect(f.parent.getSnapshot().output).toBeUndefined()
		f.retire()
		f.ack()
		await vi.waitFor(() =>
			expect(f.parent.getSnapshot().output).toEqual({
				kind: 'closed',
				identity: f.identity,
				receipt: f.close
			})
		)
		expect(f.commands).toHaveLength(1)
		expect(f.postAcquire).toHaveBeenCalledOnce()
	}
)

it('reports new uncertainty after overdue once and keeps the original acquisition', () => {
	const f = fixture({ manual: true })
	f.clock.increment(10)
	const event = {
		type: 'GRANT_REPLY',
		reply: { version: 1, ...f.identity, type: 'GRANT_UNCERTAIN', reason: 'unavailable' }
	} satisfies Parameters<typeof f.parent.send>[0]
	f.parent.send(event)
	f.parent.send(event)
	f.clock.increment(50)
	expect(f.issues()).toEqual(['acquisition-overdue', 'acquisition-uncertain'])
	expect(f.parent.getSnapshot().output).toBeUndefined()
	expect(f.postAcquire).toHaveBeenCalledOnce()
})

it.each([
	'runtimeId',
	'grantId',
	'acquisitionId'
] satisfies (keyof import('../../runtime/worker/grant-protocol.js').FinanceGrantIdentity)[])(
	'returns a foreign %s reply to the parent without taking or closing its ports',
	(field) => {
		const f = fixture()
		const closed = vi.spyOn(f.data.port2, 'close')
		const reply = { ...f.ready, [field]: crypto.randomUUID() }
		f.parent.send({ type: 'GRANT_REPLY', reply })
		expect(f.reports()).toEqual([{ type: 'GRANT_REPLY_REJECTED', identity: f.identity, reply }])
		expect(closed).not.toHaveBeenCalled()
		f.bind()
		expect(f.reports().map((report) => report.type)).toEqual([
			'GRANT_REPLY_REJECTED',
			'GRANT_ACQUIRED',
			'GRANT_AVAILABLE'
		])
	}
)

it('returns an aliased grant and duplicate accepted reply to the parent for explicit disposition', () => {
	const f = fixture()
	f.parent.send({ type: 'GRANT_REPLY', reply: { ...f.ready, controlPort: f.ready.dataPort } })
	expect(f.reports()[0]?.type).toBe('GRANT_REPLY_REJECTED')
	f.bind()
	const closed = vi.spyOn(f.data.port2, 'close')
	f.bind()
	expect(f.reports().at(-1)?.type).toBe('GRANT_REPLY_REJECTED')
	expect(available(f)).toHaveLength(1)
	expect(closed).not.toHaveBeenCalled()
})

it('refuses early calls, then uses the real shared channel for exact-key reads/writes without FIFO gaps', async () => {
	const f = fixture()
	expect(await f.call({ type: 'READ', key }).result).toMatchObject({
		kind: 'refused',
		reason: 'unavailable',
		effectOutcome: 'not-issued'
	})
	f.bind()
	for (const operation of [
		{ type: 'READ', key: key + ':foreign' },
		{ type: 'OPEN', url, name }
	] satisfies import('delightful-local-first/backend/jazz/worker-broker').BrokerHostOperation[])
		expect(await f.call(operation).result).toMatchObject({ kind: 'refused', reason: 'rejected' })
	expect(f.native.storage.getItem).not.toHaveBeenCalled()
	expect(f.native.openBroker).not.toHaveBeenCalled()
	expect(await f.call({ type: 'READ', key }).result).toMatchObject({
		kind: 'succeeded',
		response: { value: 'raw generation' }
	})
	expect(await f.call({ type: 'WRITE', key, value: '3' }).result).toMatchObject({
		kind: 'succeeded'
	})
	expect(f.native.storage.setItem).toHaveBeenCalledExactlyOnceWith(key, '3')
	f.retire()
	await vi.waitFor(() =>
		expect(f.parent.getSnapshot().output).toEqual({
			kind: 'closed',
			identity: f.identity,
			receipt: f.close
		})
	)
	expect(f.dataCommands).toHaveLength(2)
})

it('keeps an accepted SDK port usable after exact broker grant closure', async () => {
	const f = fixture({ descriptor: { kind: 'broker', url, name } })
	f.bind()
	expect(await f.call({ type: 'READ', key }).result).toMatchObject({
		kind: 'refused',
		reason: 'rejected'
	})
	expect(
		await f.call({ type: 'OPEN', url, name: name.replace('generation-2', 'generation-3') }).result
	).toMatchObject({ kind: 'refused', reason: 'rejected' })
	const result = await f.call({
		type: 'OPEN',
		url: 'https://FINANCE.example:443/assets/broker.js',
		name
	}).result
	if (result.kind !== 'succeeded' || result.response.type !== 'OPENED')
		throw new Error('Missing SDK port')
	const port = result.response.port
	try {
		f.retire()
		await vi.waitFor(() => expect(f.parent.getSnapshot().status).toBe('done'))
		const echo = Promise.withResolvers<unknown>()
		port.onmessage = ({ data }) => echo.resolve(data)
		port.postMessage('SDK-owned after grant close')
		expect(await echo.promise).toBe('SDK-owned after grant close')
	} finally {
		port.close()
	}
	expect(f.native.openBroker).toHaveBeenCalledExactlyOnceWith(url, name)
})

it('keeps native close failure and overdue separate from a genuine late receipt', async () => {
	const f = fixture({ manual: true })
	f.bind()
	f.retire()
	await vi.waitFor(() => expect(f.commands).toHaveLength(1))
	f.control.port1.postMessage({
		version: 1,
		...f.close,
		type: 'HOST_CLOSE_FAILED',
		stage: 'dispose'
	})
	await vi.waitFor(() => expect(f.issues()).toEqual(['native-close-failed']))
	f.clock.increment(7)
	expect(f.issues()).toEqual(['native-close-failed', 'channel-overdue'])
	expect(f.parent.getSnapshot().output).toBeUndefined()
	f.ack()
	await vi.waitFor(() =>
		expect(f.parent.getSnapshot().output).toMatchObject({ kind: 'closed', receipt: f.close })
	)
	expect(f.commands).toHaveLength(1)
})

it('parent stop during acquisition or after binding never produces a release output', async () => {
	for (const bound of [false, true]) {
		const f = fixture({ manual: true })
		if (bound) f.bind()
		f.parent.stop()
		f.clock.increment(100)
		expect(f.outputs).toEqual([undefined])
		expect(f.parent.getSnapshot().status).toBe('stopped')
		expect(f.parent.getSnapshot().output).toBeUndefined()
		expect(f.commands).toEqual([])
	}
})

it('a throwing refusal observer reaches the parent error boundary and cannot acknowledge closure', () => {
	const f = fixture()
	f.parent.send({
		type: 'REQUEST',
		call: brokerHostCall(crypto.randomUUID(), { type: 'READ', key }, () => {
			throw new Error('Observer failed')
		})
	})
	expect(f.parent.getSnapshot().context.errors).toBe(1)
	expect(f.parent.getSnapshot().output).toBeUndefined()
})

it('does not complete on a local not-issued post fact after native uncertainty was already observed', async () => {
	const f = fixture({ start: false, manual: true })
	f.postAcquire.mockImplementation(() => {
		f.parent.send({
			type: 'GRANT_REPLY',
			reply: { version: 1, ...f.identity, type: 'GRANT_UNCERTAIN', reason: 'unavailable' }
		})
		return { kind: 'not-issued', reason: 'unavailable' }
	})
	f.parent.start()
	await vi.waitFor(() => expect(f.issues()).toEqual(['acquisition-uncertain']))
	await new Promise<void>((resolve) => queueMicrotask(resolve))
	expect(f.parent.getSnapshot().status).toBe('active')
	expect(f.parent.getSnapshot().output).toBeUndefined()
	f.bind()
	await vi.waitFor(() => expect(f.commands).toHaveLength(1))
	f.ack()
	await vi.waitFor(() => expect(f.parent.getSnapshot().output?.kind).toBe('closed'))
})

it('reentrant parent retirement on availability closes the same invoked channel', async () => {
	const f = fixture({
		manual: true,
		start: false,
		onReport: (report) => {
			if (report.type === 'GRANT_AVAILABLE') f.retire()
		}
	})
	f.parent.start()
	f.bind()
	await vi.waitFor(() => expect(f.commands).toHaveLength(1))
	f.ack()
	await vi.waitFor(() =>
		expect(f.parent.getSnapshot().output).toMatchObject({ kind: 'closed', receipt: f.close })
	)
	expect(f.postAcquire).toHaveBeenCalledOnce()
})

it('retains the original unknown write result across automatic channel close and a late receipt', async () => {
	const f = fixture({ manual: true })
	f.bind()
	const call = f.call({ type: 'WRITE', key, value: '4' })
	await vi.waitFor(() => expect(f.dataCommands).toHaveLength(1))
	f.clock.increment(5)
	expect(await call.result).toMatchObject({
		kind: 'failed',
		reason: 'timeout',
		effectOutcome: 'unknown'
	})
	await vi.waitFor(() => expect(f.commands).toHaveLength(1))
	f.control.port1.postMessage({
		version: 1,
		type: 'HOST_CLOSED',
		scope: f.close.scope,
		requestId: crypto.randomUUID()
	})
	f.ack()
	await vi.waitFor(() =>
		expect(f.parent.getSnapshot().output).toMatchObject({ kind: 'closed', receipt: f.close })
	)
	expect(f.issues()).toEqual(['channel-closed'])
	expect(call.settle).toHaveBeenCalledOnce()
	expect(f.dataCommands).toHaveLength(1)
})

it('an unexpected shared-channel error blocks cleanup and never turns parent retirement into closure', async () => {
	const f = fixture()
	f.bind()
	const settle = vi.fn()
	f.parent.send({
		type: 'REQUEST',
		call: {
			...brokerHostCall(crypto.randomUUID(), { type: 'READ', key }, settle),
			accept: () => {
				throw new Error('Unexpected response predicate failure')
			}
		}
	})
	await vi.waitFor(() => expect(f.issues()).toContain('channel-blocked'))
	f.retire()
	f.clock.increment(100)
	expect(f.parent.getSnapshot().output).toBeUndefined()
	expect(settle).toHaveBeenCalledOnce()
	expect(f.commands).toEqual([])
})

it('parent stop settles an issued write once with unknown outcome and no host receipt', async () => {
	const f = fixture({ manual: true })
	f.bind()
	const call = f.call({ type: 'WRITE', key, value: '4' })
	await vi.waitFor(() => expect(f.dataCommands).toHaveLength(1))
	f.parent.stop()
	expect(await call.result).toMatchObject({ kind: 'failed', effectOutcome: 'unknown' })
	expect(call.settle).toHaveBeenCalledOnce()
	expect(f.parent.getSnapshot().output).toBeUndefined()
	expect(f.commands).toEqual([])
})

it('can() validates a grant transition without taking custody, listening or posting', () => {
	const f = fixture({ manual: true })
	const child = f.parent.getSnapshot().children.grant
	if (!child) throw new Error('Missing fixture grant child')
	const effects = [
		vi.spyOn(f.data.port2, 'addEventListener'),
		vi.spyOn(f.control.port2, 'start'),
		vi.spyOn(f.control.port2, 'postMessage')
	]
	const before = child.getSnapshot()
	expect(before.can({ type: 'GRANT_REPLY', reply: f.ready })).toBe(true)
	expect(before.can({ type: 'GRANT_REPLY', reply: f.ready })).toBe(true)
	for (const effect of effects) expect(effect).not.toHaveBeenCalled()
	expect(f.reports()).toEqual([])
	expect(child.getSnapshot()).toBe(before)
})
