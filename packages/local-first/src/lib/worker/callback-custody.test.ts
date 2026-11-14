import { afterEach, expect, it, vi } from 'vitest'
import type { WorkerChannelResult } from '../contracts/worker-channel.js'
import type { WorkerRequestIdentity } from '../contracts/worker-request.js'
import { createWorkerCallbackCustody, type WorkerCallbackStopResult } from './callback-custody.js'

type Response = { port: MessagePort }
const ports = new Set<MessagePort>()
afterEach(() => {
	for (const port of ports) port.close()
	ports.clear()
})
function resource(): Response {
	const pair = new MessageChannel()
	ports.add(pair.port1)
	ports.add(pair.port2)
	return { port: pair.port1 }
}
function identity(requestId = 'request-1'): WorkerRequestIdentity {
	return { scope: 'runtime-1', requestId, sequence: 1 }
}
function refused(id: WorkerRequestIdentity): WorkerCallbackStopResult<Response> {
	return {
		kind: 'refused',
		scope: id.scope,
		requestId: id.requestId,
		reason: 'closed',
		effectOutcome: 'not-issued'
	}
}
function succeeded(id: WorkerRequestIdentity, response: Response): WorkerChannelResult<Response> {
	return { kind: 'succeeded', identity: id, response }
}
function fixture(dispose: (response: Response) => void = (response) => response.port.close()) {
	const discard = vi.fn(dispose)
	const custody = createWorkerCallbackCustody<WorkerRequestIdentity, Response>({
		sameIdentity: (a, b) =>
			a.scope === b.scope && a.requestId === b.requestId && a.sequence === b.sequence,
		discard
	})
	function register(id = identity()) {
		const settle = vi.fn<(result: WorkerChannelResult<Response>) => void>()
		custody.register({ identity: id, settle, stopped: refused(id) })
		return settle
	}
	function capture(response: Response) {
		const token = custody.capture(response)
		if (!token) throw new Error('Fixture keeper unexpectedly stopped')
		return token
	}
	return { custody, discard, register, capture }
}

it('constructs and registers without native effects or settling a callback', () => {
	const f = fixture(),
		settle = f.register()
	expect(settle).not.toHaveBeenCalled()
	expect(f.discard).not.toHaveBeenCalled()
	f.custody.stop()
	expect(settle).toHaveBeenCalledExactlyOnceWith(refused(identity()))
})

it('captures callback fields and its selected stop envelope', () => {
	const f = fixture(),
		first = vi.fn(),
		replacement = vi.fn(),
		id = identity()
	const stopped: Extract<WorkerCallbackStopResult<Response>, { kind: 'refused' }> = {
		kind: 'refused',
		scope: id.scope,
		requestId: id.requestId,
		reason: 'closed',
		effectOutcome: 'not-issued'
	}
	const observer = { identity: id, settle: first, stopped }
	f.custody.register(observer)
	observer.settle = replacement
	stopped.reason = 'rejected'
	f.custody.stop()
	expect(first).toHaveBeenCalledExactlyOnceWith(refused(id))
	expect(replacement).not.toHaveBeenCalled()
})

it('rejects a duplicate registration without replacing the original observer', () => {
	const f = fixture(),
		first = f.register(),
		other = vi.fn()
	expect(() =>
		f.custody.register({ identity: identity(), settle: other, stopped: refused(identity()) })
	).toThrow('Duplicate worker callback registration')
	f.custody.stop()
	expect(first).toHaveBeenCalledOnce()
	expect(other).not.toHaveBeenCalled()
})

it.each([{ scope: 'other' }, { requestId: 'other' }, { sequence: 2 }])(
	'does not deliver or relinquish custody for a foreign identity %j',
	(change) => {
		const f = fixture(),
			settle = f.register(),
			response = resource(),
			token = f.capture(response)
		f.custody.deliver({ ...identity(), ...change }, succeeded(identity(), response), token)
		expect(settle).not.toHaveBeenCalled()
		expect(f.discard).not.toHaveBeenCalled()
		f.custody.stop()
		expect(settle).toHaveBeenCalledExactlyOnceWith(refused(identity()))
		expect(f.discard).toHaveBeenCalledOnce()
		expect(f.discard.mock.calls[0]?.[0]).toBe(response)
	}
)

it('records the chart-selected unknown effect result before dispatch and captures its envelope', () => {
	const f = fixture(),
		settle = f.register(),
		id = identity()
	const stopped: Extract<WorkerCallbackStopResult<Response>, { kind: 'failed' }> = {
		kind: 'failed',
		identity: id,
		reason: 'closed',
		effectOutcome: 'unknown'
	}
	f.custody.recordStopResult(id, stopped)
	stopped.reason = 'unavailable'
	f.custody.stop()
	expect(settle).toHaveBeenCalledExactlyOnceWith({
		kind: 'failed',
		identity: id,
		reason: 'closed',
		effectOutcome: 'unknown'
	})
})

it('does not change a stop result for a foreign registration', () => {
	const f = fixture(),
		settle = f.register()
	f.custody.recordStopResult(identity('other'), refused(identity('other')))
	f.custody.stop()
	expect(settle).toHaveBeenCalledExactlyOnceWith(refused(identity()))
})

it('delivers an accepted response once and preserves its port through keeper stop', async () => {
	const pair = new MessageChannel()
	ports.add(pair.port1)
	ports.add(pair.port2)
	const f = fixture(),
		settle = f.register(),
		response = { port: pair.port1 },
		token = f.capture(response)
	const result = succeeded(identity(), response)
	f.custody.deliver(identity(), result, token)
	f.custody.deliver(identity(), result, token)
	f.custody.discard(token)
	f.custody.stop()
	expect(settle).toHaveBeenCalledExactlyOnceWith(result)
	expect(f.discard).not.toHaveBeenCalled()
	const received = new Promise<unknown>((resolve) => {
		pair.port2.onmessage = (event) => resolve(event.data)
	})
	pair.port1.postMessage('SDK still owns this port')
	expect(await received).toBe('SDK still owns this port')
})

it('discards a declined response before delivering the selected failure', () => {
	const order: string[] = [],
		response = resource(),
		f = fixture(() => {
			order.push('discard')
		})
	f.custody.register({
		identity: identity(),
		settle: () => {
			order.push('settle')
		},
		stopped: refused(identity())
	})
	f.custody.deliver(identity(), refused(identity()), f.capture(response))
	expect(order).toEqual(['discard', 'settle'])
	f.custody.stop()
	expect(f.discard).toHaveBeenCalledOnce()
	expect(f.discard.mock.calls[0]?.[0]).toBe(response)
})

it('disposes an unaccepted response when its observer throws', () => {
	const f = fixture(),
		response = resource(),
		settle = vi.fn(() => {
			throw new Error('observer failed')
		})
	f.custody.register({ identity: identity(), settle, stopped: refused(identity()) })
	f.custody.deliver(identity(), succeeded(identity(), response), f.capture(response))
	f.custody.stop()
	expect(settle).toHaveBeenCalledOnce()
	expect(f.discard).toHaveBeenCalledOnce()
	expect(f.discard.mock.calls[0]?.[0]).toBe(response)
})

it('detaches accepted custody before a reentrant observer stops the keeper', () => {
	const f = fixture(),
		response = resource(),
		second = f.register(identity('second'))
	const first = vi.fn(() => f.custody.stop())
	f.custody.register({ identity: identity(), settle: first, stopped: refused(identity()) })
	f.custody.deliver(identity(), succeeded(identity(), response), f.capture(response))
	expect(first).toHaveBeenCalledOnce()
	expect(second).toHaveBeenCalledExactlyOnceWith(refused(identity('second')))
	expect(f.discard).not.toHaveBeenCalled()
})

it('settles detached callbacks once when resource disposal reenters stop', () => {
	const f = fixture(() => f.custody.stop()),
		first = f.register(),
		second = f.register(identity('second'))
	f.capture(resource())
	f.custody.stop()
	f.custody.stop()
	expect(first).toHaveBeenCalledOnce()
	expect(second).toHaveBeenCalledOnce()
	expect(f.discard).toHaveBeenCalledOnce()
})

it('attempts all disposals, settles all callbacks and preserves the original failed stop', () => {
	const bad = resource(),
		good = resource()
	const f = fixture((response) => {
		if (response === bad) throw new Error('native discard failed')
		response.port.close()
	})
	const first = f.register(),
		second = f.register(identity('second'))
	const token = f.capture(bad)
	f.capture(good)
	expect(() => f.custody.stop()).toThrow('Worker callback resource disposal failed')
	expect(first).toHaveBeenCalledExactlyOnceWith(refused(identity()))
	expect(second).toHaveBeenCalledExactlyOnceWith(refused(identity('second')))
	expect(f.discard).toHaveBeenCalledTimes(2)
	expect(() => f.custody.stop()).toThrow('Worker callback resource disposal failed')
	expect(f.discard).toHaveBeenCalledTimes(2)
	f.discard.mockImplementation((response) => response.port.close())
	f.custody.discard(token)
	expect(f.discard.mock.lastCall?.[0]).toBe(bad)
	expect(f.discard).toHaveBeenCalledTimes(3)
	expect(() => f.custody.stop()).toThrow('Worker callback resource disposal failed')
})

it('delivers the selected failure even if discarding its retained response fails', () => {
	const f = fixture(() => {
			throw new Error('native failure')
		}),
		settle = f.register(),
		response = resource()
	const token = f.capture(response)
	expect(() => f.custody.deliver(identity(), refused(identity()), token)).toThrow(
		'Worker callback delivery failed'
	)
	expect(settle).toHaveBeenCalledExactlyOnceWith(refused(identity()))
	f.discard.mockImplementation((value) => value.port.close())
	f.custody.stop()
	expect(f.discard).toHaveBeenCalledTimes(2)
	expect(settle).toHaveBeenCalledOnce()
})

it('retains a rejected successful response when observer cleanup also fails', () => {
	const f = fixture(() => {
			throw new Error('native failure')
		}),
		response = resource()
	const settle = vi.fn(() => {
		throw new Error('observer failure')
	})
	f.custody.register({ identity: identity(), settle, stopped: refused(identity()) })
	expect(() =>
		f.custody.deliver(identity(), succeeded(identity(), response), f.capture(response))
	).toThrow('Worker callback delivery failed')
	f.discard.mockImplementation((value) => value.port.close())
	f.custody.stop()
	expect(f.discard).toHaveBeenCalledTimes(2)
	expect(settle).toHaveBeenCalledOnce()
})

it('disposes late responses and settles late registrations without reopening', () => {
	const f = fixture(),
		response = resource()
	f.custody.stop()
	expect(f.custody.capture(response)).toBeUndefined()
	expect(f.discard).toHaveBeenCalledOnce()
	expect(f.discard.mock.calls[0]?.[0]).toBe(response)
	const settle = f.register()
	expect(settle).toHaveBeenCalledExactlyOnceWith(refused(identity()))
	f.custody.stop()
	expect(settle).toHaveBeenCalledOnce()
})

it('settles other callbacks when one stopped observer throws', () => {
	const f = fixture(),
		first = vi.fn(() => {
			throw new Error('observer failure')
		}),
		second = f.register(identity('second'))
	f.custody.register({ identity: identity(), settle: first, stopped: refused(identity()) })
	f.custody.stop()
	expect(first).toHaveBeenCalledOnce()
	expect(second).toHaveBeenCalledOnce()
})
