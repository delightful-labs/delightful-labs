import { createActor, createCallbackLogic, waitFor } from 'xstate'
import { describe, expect, it, vi } from 'vitest'
import { sessionRuntimeMachine, selectSessionRuntimeObservation } from './session-runtime.js'
import type {
	SessionRuntimeInput,
	SessionRuntimeObservation,
	SessionRuntimeResource,
	SessionRuntimeSignOutReport,
	SessionRuntimeSignOutRequest
} from '../../contracts/session-runtime.js'

function fixture() {
	let publish: (value: SessionRuntimeObservation) => void = () => {}
	let fail = () => {}
	const unsubscribe = vi.fn(() => {})
	const close = vi.fn(async () => {})
	const signOut = vi.fn<SessionRuntimeResource['signOut']>(async () => 'completed')
	const observe = vi.fn<SessionRuntimeResource['observe']>((notify, failed) => {
		publish = notify
		fail = failed
		notify({ status: 'signed-out' })
		return unsubscribe
	})
	const resource: SessionRuntimeResource = { observe, close, signOut }
	const open = vi.fn(async () => resource)
	const input: SessionRuntimeInput = { binding: {}, capability: { open } }
	const actor = createActor(sessionRuntimeMachine, { input })
	return {
		actor,
		input,
		open,
		resource,
		observe,
		close,
		signOut,
		unsubscribe,
		publish: (value: SessionRuntimeObservation) => publish(value),
		fail: () => fail()
	}
}

function signOutCaller(f: ReturnType<typeof fixture>, identityBinding: object) {
	const reports: SessionRuntimeSignOutReport[] = []
	const caller = createActor(
		createCallbackLogic<SessionRuntimeSignOutReport>(({ receive }) => {
			receive((event) => reports.push(event))
		})
	).start()
	const request: SessionRuntimeSignOutRequest = {
		scope: { binding: f.input.binding, attempt: 1 },
		identityBinding,
		replyTo: caller
	}
	return { caller, reports, request }
}

async function readyForSignOut(f: ReturnType<typeof fixture>, identityBinding: object) {
	f.actor.start()
	await waitFor(f.actor, (snapshot) => !!selectSessionRuntimeObservation(snapshot))
	f.publish({
		status: 'ready',
		binding: identityBinding,
		identityId: 'original',
		identityKind: 'device',
		localFirst: true,
		capabilities: undefined
	})
}

describe('session sign-out protocol', () => {
	it('reports the scoped native result and publishes its settled identity facts', async () => {
		const f = fixture(),
			binding = {},
			c = signOutCaller(f, binding)
		f.signOut.mockImplementation(async () => {
			f.publish({ status: 'signed-out' })
			return 'completed'
		})
		await readyForSignOut(f, binding)
		try {
			f.actor.send({ type: 'SIGN_OUT', ...c.request })
			await vi.waitFor(() =>
				expect(c.reports).toEqual([
					{ type: 'SESSION_SIGN_OUT_SETTLED', scope: c.request.scope, outcome: 'completed' }
				])
			)
			expect(f.signOut).toHaveBeenCalledExactlyOnceWith(binding)
			expect(selectSessionRuntimeObservation(f.actor.getSnapshot())).toEqual({
				status: 'signed-out'
			})
			expect(f.close).not.toHaveBeenCalled()
			f.actor.send({ type: 'CLOSE' })
			await waitFor(f.actor, (snapshot) => snapshot.status === 'done')
		} finally {
			f.actor.stop()
			c.caller.stop()
		}
	})
	it.each([
		{ fault: 'session', outcome: 'invalidRequest' },
		{ fault: 'attempt', outcome: 'invalidRequest' },
		{ fault: 'identity', outcome: 'bindingChanged' },
		{ fault: 'availability', outcome: 'unavailable' }
	])('refuses $fault before native sign-out', async ({ fault, outcome }) => {
		const f = fixture(),
			binding = {},
			c = signOutCaller(f, binding)
		await readyForSignOut(f, binding)
		if (fault === 'availability') f.publish({ status: 'signed-out' })
		const request = {
			...c.request,
			scope: {
				binding: fault === 'session' ? {} : f.input.binding,
				attempt: fault === 'attempt' ? -1 : 1
			},
			identityBinding: fault === 'identity' ? {} : binding
		}
		try {
			f.actor.send({ type: 'SIGN_OUT', ...request })
			expect(c.reports).toEqual([
				{ type: 'SESSION_SIGN_OUT_SETTLED', scope: request.scope, outcome }
			])
			expect(f.signOut).not.toHaveBeenCalled()
			f.actor.send({ type: 'CLOSE' })
			await waitFor(f.actor, (snapshot) => snapshot.status === 'done')
		} finally {
			f.actor.stop()
			c.caller.stop()
		}
	})
	it.each(['completed', 'failed'])(
		'drains %s native sign-out before close and refuses another operation while busy',
		async (outcome) => {
			const f = fixture(),
				binding = {},
				c = signOutCaller(f, binding)
			const pending = Promise.withResolvers<void>()
			f.signOut.mockImplementation(async () => {
				await pending.promise
				if (outcome === 'failed') throw new Error('Synthetic sign-out rejection')
				f.publish({ status: 'signed-out' })
				return 'completed'
			})
			await readyForSignOut(f, binding)
			try {
				f.actor.send({ type: 'SIGN_OUT', ...c.request })
				const child = f.actor.getSnapshot().children.signOut
				expect(selectSessionRuntimeObservation(f.actor.getSnapshot())).toBeUndefined()
				f.actor.send({ type: 'SIGN_OUT', ...c.request, scope: { ...c.request.scope, attempt: 2 } })
				expect(c.reports).toEqual([
					{
						type: 'SESSION_SIGN_OUT_SETTLED',
						scope: { ...c.request.scope, attempt: 2 },
						outcome: 'busy'
					}
				])
				f.actor.send({ type: 'CLOSE' })
				expect(f.actor.getSnapshot().children.signOut).toBe(child)
				expect(f.unsubscribe).not.toHaveBeenCalled()
				expect(f.close).not.toHaveBeenCalled()
				pending.resolve()
				await waitFor(f.actor, (snapshot) => snapshot.status === 'done')
				expect(c.reports).toHaveLength(2)
				expect(c.reports[1]).toEqual({
					type: 'SESSION_SIGN_OUT_SETTLED',
					scope: c.request.scope,
					outcome
				})
				expect(f.signOut).toHaveBeenCalledOnce()
				expect(f.unsubscribe).toHaveBeenCalledOnce()
				expect(f.close).toHaveBeenCalledOnce()
			} finally {
				pending.resolve()
				f.actor.stop()
				c.caller.stop()
			}
		}
	)
	it('passes through an adjacent native binding refusal without claiming mutation', async () => {
		const f = fixture(),
			binding = {},
			c = signOutCaller(f, binding)
		f.signOut.mockResolvedValueOnce('bindingChanged')
		await readyForSignOut(f, binding)
		try {
			f.actor.send({ type: 'SIGN_OUT', ...c.request })
			await vi.waitFor(() =>
				expect(c.reports).toEqual([
					{ type: 'SESSION_SIGN_OUT_SETTLED', scope: c.request.scope, outcome: 'bindingChanged' }
				])
			)
			expect(selectSessionRuntimeObservation(f.actor.getSnapshot())?.status).toBe('ready')
			f.actor.send({ type: 'CLOSE' })
			await waitFor(f.actor, (snapshot) => snapshot.status === 'done')
		} finally {
			f.actor.stop()
			c.caller.stop()
		}
	})
	it('retains sign-out after observation fails and still drains it before closing', async () => {
		const f = fixture(),
			binding = {},
			c = signOutCaller(f, binding)
		const pending = Promise.withResolvers<void>()
		f.signOut.mockImplementation(async () => {
			await pending.promise
			return 'completed'
		})
		await readyForSignOut(f, binding)
		try {
			f.actor.send({ type: 'SIGN_OUT', ...c.request })
			const child = f.actor.getSnapshot().children.signOut
			f.fail()
			f.actor.send({ type: 'CLOSE' })
			expect(f.actor.getSnapshot().children.signOut).toBe(child)
			expect(f.close).not.toHaveBeenCalled()
			pending.resolve()
			await waitFor(f.actor, (snapshot) => snapshot.status === 'done')
			expect(c.reports).toHaveLength(1)
			expect(f.close).toHaveBeenCalledOnce()
		} finally {
			pending.resolve()
			f.actor.stop()
			c.caller.stop()
		}
	})
})

describe('session runtime ownership', () => {
	it('publishes native facts and awaits actual SDK close after observer removal', async () => {
		const f = fixture()
		const pending = Promise.withResolvers<void>()
		f.close.mockImplementation(async () => {
			expect(f.unsubscribe).toHaveBeenCalledOnce()
			await pending.promise
		})
		f.actor.start()
		try {
			await waitFor(
				f.actor,
				(snapshot) => selectSessionRuntimeObservation(snapshot)?.status === 'signed-out'
			)
			f.publish({
				status: 'ready',
				binding: {},
				identityId: 'device',
				identityKind: 'device',
				localFirst: true,
				capabilities: undefined
			})
			expect(selectSessionRuntimeObservation(f.actor.getSnapshot())?.status).toBe('ready')
			f.actor.send({ type: 'CLOSE' })
			expect(selectSessionRuntimeObservation(f.actor.getSnapshot())).toBeUndefined()
			await waitFor(f.actor, (snapshot) => snapshot.matches('closing'))
			expect(f.actor.getSnapshot().status).toBe('active')
			f.publish({
				status: 'ready',
				binding: {},
				identityId: 'late',
				identityKind: 'device',
				localFirst: true,
				capabilities: undefined
			})
			expect(selectSessionRuntimeObservation(f.actor.getSnapshot())).toBeUndefined()
			pending.resolve()
			const done = await waitFor(f.actor, (snapshot) => snapshot.status === 'done')
			expect(done.output).toEqual({ outcome: 'closed' })
			expect(done.context.resource).toBeUndefined()
			expect(f.open).toHaveBeenCalledOnce()
			expect(f.close).toHaveBeenCalledOnce()
		} finally {
			pending.resolve()
			f.actor.stop()
		}
	})
	it('retains an issued open after CLOSE and closes its late resource without observing it', async () => {
		const f = fixture(),
			opening = Promise.withResolvers<SessionRuntimeResource>()
		f.open.mockImplementation(() => opening.promise)
		f.actor.start()
		try {
			f.actor.send({ type: 'CLOSE' })
			expect(f.actor.getSnapshot().status).toBe('active')
			expect(f.close).not.toHaveBeenCalled()
			opening.resolve(f.resource)
			await waitFor(f.actor, (snapshot) => snapshot.status === 'done')
			expect(f.observe).not.toHaveBeenCalled()
			expect(f.close).toHaveBeenCalledOnce()
		} finally {
			opening.resolve(f.resource)
			f.actor.stop()
		}
	})
	it('retries opening through the retained acquisition owner exactly once', async () => {
		const f = fixture()
		f.open.mockRejectedValueOnce(new Error('Synthetic startup failure'))
		f.actor.start()
		try {
			await waitFor(f.actor, (snapshot) => snapshot.matches('openFailed'))
			f.actor.send({ type: 'RETRY' })
			await waitFor(
				f.actor,
				(snapshot) => selectSessionRuntimeObservation(snapshot)?.status === 'signed-out'
			)
			expect(f.open).toHaveBeenCalledTimes(2)
			f.actor.send({ type: 'CLOSE' })
			await waitFor(f.actor, (snapshot) => snapshot.status === 'done')
		} finally {
			f.actor.stop()
		}
	})
	it.each(['before-close', 'after-close'])(
		'cancels a storage wait entered %s without abandoning an issued open',
		async (timing) => {
			const f = fixture(),
				rejected = Promise.withResolvers<SessionRuntimeResource>()
			const waiting = Promise.withResolvers<void>()
			const busy = new Error('Synthetic contention')
			let signal: AbortSignal | undefined
			const wait = vi.fn((_key: string, observed: AbortSignal) => {
				signal = observed
				return waiting.promise
			})
			f.open.mockImplementation(() => rejected.promise)
			const actor = createActor(sessionRuntimeMachine, {
				input: {
					...f.input,
					capability: {
						open: f.open,
						availability: {
							classify: (error) => (error === busy ? { resourceKey: 'native-store' } : undefined),
							wait
						}
					}
				}
			}).start()
			try {
				if (timing === 'before-close') {
					rejected.reject(busy)
					await vi.waitFor(() => expect(wait).toHaveBeenCalledOnce())
				}
				actor.send({ type: 'CLOSE' })
				if (timing === 'after-close') rejected.reject(busy)
				await waitFor(actor, (snapshot) => snapshot.status === 'done')
				expect(signal?.aborted).toBe(true)
				expect(f.open).toHaveBeenCalledOnce()
				expect(f.observe).not.toHaveBeenCalled()
				expect(f.close).not.toHaveBeenCalled()
				waiting.resolve()
			} finally {
				waiting.resolve()
				actor.stop()
			}
		}
	)
	it('retains failed observer removal and retries it before calling SDK close', async () => {
		const f = fixture()
		f.unsubscribe.mockImplementationOnce(() => {
			throw new Error('Synthetic unsubscribe failure')
		})
		f.actor.start()
		try {
			await waitFor(f.actor, (snapshot) => !!selectSessionRuntimeObservation(snapshot))
			f.actor.send({ type: 'CLOSE' })
			await waitFor(f.actor, (snapshot) => snapshot.matches({ bound: 'closeFailed' }))
			expect(f.close).not.toHaveBeenCalled()
			f.actor.send({ type: 'CLOSE' })
			await waitFor(f.actor, (snapshot) => snapshot.status === 'done')
			expect(f.unsubscribe).toHaveBeenCalledTimes(2)
			expect(f.close).toHaveBeenCalledOnce()
		} finally {
			f.actor.stop()
		}
	})
	it('retains a failed native close for explicit retry without restoring availability', async () => {
		const f = fixture()
		f.close.mockRejectedValueOnce(new Error('Synthetic close failure'))
		f.actor.start()
		try {
			await waitFor(f.actor, (snapshot) => !!selectSessionRuntimeObservation(snapshot))
			f.actor.send({ type: 'CLOSE' })
			await waitFor(f.actor, (snapshot) => snapshot.matches('closeFailed'))
			expect(selectSessionRuntimeObservation(f.actor.getSnapshot())).toBeUndefined()
			f.actor.send({ type: 'CLOSE' })
			await waitFor(f.actor, (snapshot) => snapshot.status === 'done')
			expect(f.unsubscribe).toHaveBeenCalledOnce()
			expect(f.close).toHaveBeenCalledTimes(2)
		} finally {
			f.actor.stop()
		}
	})
	it('withdraws failed native observation and can still close the actual resource', async () => {
		const f = fixture()
		f.actor.start()
		try {
			await waitFor(f.actor, (snapshot) => !!selectSessionRuntimeObservation(snapshot))
			f.fail()
			await waitFor(f.actor, (snapshot) => snapshot.matches({ bound: 'observerFailed' }))
			expect(selectSessionRuntimeObservation(f.actor.getSnapshot())).toBeUndefined()
			f.actor.send({ type: 'CLOSE' })
			await waitFor(f.actor, (snapshot) => snapshot.status === 'done')
			expect(f.close).toHaveBeenCalledOnce()
		} finally {
			f.actor.stop()
		}
	})
	it('reobserves after a failure without reopening or retrying the SDK', async () => {
		const f = fixture()
		f.actor.start()
		try {
			await waitFor(f.actor, (snapshot) => !!selectSessionRuntimeObservation(snapshot))
			f.fail()
			await waitFor(f.actor, (snapshot) => snapshot.matches({ bound: 'observerFailed' }))
			f.actor.send({ type: 'RETRY' })
			await waitFor(f.actor, (snapshot) => !!selectSessionRuntimeObservation(snapshot))
			expect(f.unsubscribe).toHaveBeenCalledOnce()
			expect(f.observe).toHaveBeenCalledTimes(2)
			expect(f.open).toHaveBeenCalledOnce()
			expect(f.close).not.toHaveBeenCalled()
			f.actor.send({ type: 'CLOSE' })
			await waitFor(f.actor, (snapshot) => snapshot.status === 'done')
			expect(f.unsubscribe).toHaveBeenCalledTimes(2)
			expect(f.close).toHaveBeenCalledOnce()
		} finally {
			f.actor.stop()
		}
	})
	it('does not turn forced actor stop into a native close receipt', async () => {
		const f = fixture()
		f.actor.start()
		await waitFor(f.actor, (snapshot) => !!selectSessionRuntimeObservation(snapshot))
		f.actor.stop()
		expect(f.unsubscribe).toHaveBeenCalledOnce()
		expect(f.close).not.toHaveBeenCalled()
		expect(f.actor.getSnapshot().output).toBeUndefined()
	})
	it('rejects queued reports from an observer retired before reobservation', async () => {
		const f = fixture()
		f.actor.start()
		try {
			await waitFor(f.actor, (snapshot) => !!selectSessionRuntimeObservation(snapshot))
			const binding = f.actor.getSnapshot().context.observationBinding
			if (!binding) throw new Error('Missing test observer binding')
			f.fail()
			f.actor.send({ type: 'RETRY' })
			await waitFor(f.actor, (snapshot) => !!selectSessionRuntimeObservation(snapshot))
			const current = selectSessionRuntimeObservation(f.actor.getSnapshot())
			f.actor.send({ type: 'OBSERVED', binding, observation: { status: 'error' } })
			f.actor.send({ type: 'OBSERVATION_FAILED', binding })
			expect(selectSessionRuntimeObservation(f.actor.getSnapshot())).toBe(current)
			f.actor.send({ type: 'CLOSE' })
			await waitFor(f.actor, (snapshot) => snapshot.status === 'done')
		} finally {
			f.actor.stop()
		}
	})
	it('closes its acquired SDK resource when subscription acquisition fails', async () => {
		const f = fixture()
		f.observe.mockImplementationOnce(() => {
			throw new Error('Synthetic observation failure')
		})
		f.actor.start()
		try {
			await waitFor(f.actor, (snapshot) => snapshot.matches({ bound: 'observerFailed' }))
			expect(selectSessionRuntimeObservation(f.actor.getSnapshot())).toBeUndefined()
			f.actor.send({ type: 'CLOSE' })
			await waitFor(f.actor, (snapshot) => snapshot.status === 'done')
			expect(f.close).toHaveBeenCalledOnce()
			expect(f.unsubscribe).not.toHaveBeenCalled()
		} finally {
			f.actor.stop()
		}
	})
	it('reports an unexpected acquisition-owner failure without claiming native closure', async () => {
		const f = fixture()
		f.open.mockRejectedValueOnce(new Error('Synthetic open failure'))
		const actor = createActor(sessionRuntimeMachine, {
			input: {
				...f.input,
				capability: {
					open: f.open,
					availability: {
						classify: () => {
							throw new Error('Synthetic owner fault')
						},
						wait: async () => {}
					}
				}
			}
		}).start()
		try {
			await waitFor(actor, (snapshot) => snapshot.matches('ownerFailed'))
			expect(selectSessionRuntimeObservation(actor.getSnapshot())).toBeUndefined()
			expect(actor.getSnapshot().output).toBeUndefined()
			expect(actor.getSnapshot().can({ type: 'CLOSE' })).toBe(false)
			expect(f.close).not.toHaveBeenCalled()
		} finally {
			actor.stop()
		}
	})
})
