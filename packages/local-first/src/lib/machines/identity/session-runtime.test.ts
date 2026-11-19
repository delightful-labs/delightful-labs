import { createActor, createCallbackLogic, waitFor } from 'xstate'
import { describe, expect, it, vi } from 'vitest'
import {
	sessionRuntimeMachine,
	selectSessionRuntimeObservation,
	createSessionRuntimeConnection
} from './session-runtime.js'
import { createSessionChangeMachine } from './session-change.js'
import { sessionCloseMachine } from './session-close.js'
import type {
	SessionRuntimeChangeInput,
	SessionRuntimeInput,
	SessionRuntimeObservation,
	SessionRuntimeResource,
	SessionRuntimeChangeReport,
	SessionRuntimeChangeRequest,
	SessionRuntimeIdentityChange,
	SessionRuntimeIdentity
} from '../../contracts/session-runtime.js'

function fixture() {
	let publish: (value: SessionRuntimeObservation) => void = () => {}
	let fail = () => {}
	const signedOut: Extract<SessionRuntimeObservation, { status: 'signed-out' }> = {
		status: 'signed-out',
		binding: {}
	}
	const unsubscribe = vi.fn(() => {})
	const close = vi.fn(async () => {})
	const changeIdentity = vi.fn<SessionRuntimeResource['changeIdentity']>(async () => 'completed')
	const observe = vi.fn<SessionRuntimeResource['observe']>((notify, failed) => {
		publish = notify
		fail = failed
		notify(signedOut)
		return unsubscribe
	})
	const resource: SessionRuntimeResource = { observe, close, changeIdentity }
	const open = vi.fn(async () => resource)
	const input: SessionRuntimeInput = { binding: {}, capability: { open } }
	const actor = createActor(sessionRuntimeMachine, { input })
	return {
		actor,
		signedOut,
		input,
		open,
		resource,
		observe,
		close,
		changeIdentity,
		unsubscribe,
		publish: (value: SessionRuntimeObservation) => publish(value),
		fail: () => fail()
	}
}

function changeCaller(f: ReturnType<typeof fixture>, change: SessionRuntimeIdentityChange) {
	const reports: SessionRuntimeChangeReport[] = []
	const caller = createActor(
		createCallbackLogic<SessionRuntimeChangeReport>(({ receive }) => {
			receive((event) => reports.push(event))
		})
	).start()
	const request: SessionRuntimeChangeRequest = {
		scope: { binding: f.input.binding, attempt: 1 },
		change,
		replyTo: caller
	}
	return { caller, reports, request }
}
function signOutCaller(f: ReturnType<typeof fixture>, binding: object) {
	return changeCaller(f, { operation: 'signOut', before: { status: 'ready', binding } })
}

async function observeReady(f: ReturnType<typeof fixture>, identityBinding: object) {
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
		f.changeIdentity.mockImplementation(async () => {
			f.publish(f.signedOut)
			return 'completed'
		})
		await observeReady(f, binding)
		try {
			f.actor.send({ type: 'CHANGE_IDENTITY', ...c.request })
			await vi.waitFor(() =>
				expect(c.reports).toEqual([
					{
						type: 'SESSION_CHANGE_SETTLED',
						operation: 'signOut',
						scope: c.request.scope,
						outcome: 'completed'
					}
				])
			)
			expect(f.changeIdentity).toHaveBeenCalledExactlyOnceWith(c.request.change)
			expect(selectSessionRuntimeObservation(f.actor.getSnapshot())).toEqual(f.signedOut)
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
		await observeReady(f, binding)
		if (fault === 'availability') f.publish({ status: 'transitioning' })
		const request = {
			...c.request,
			scope: {
				binding: fault === 'session' ? {} : f.input.binding,
				attempt: fault === 'attempt' ? -1 : 1
			},
			change: {
				operation: 'signOut',
				before: { status: 'ready', binding: fault === 'identity' ? {} : binding }
			} satisfies SessionRuntimeChangeRequest['change']
		}
		try {
			f.actor.send({ type: 'CHANGE_IDENTITY', ...request })
			expect(c.reports).toEqual([
				{ type: 'SESSION_CHANGE_SETTLED', operation: 'signOut', scope: request.scope, outcome }
			])
			expect(f.changeIdentity).not.toHaveBeenCalled()
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
			f.changeIdentity.mockImplementation(async () => {
				await pending.promise
				if (outcome === 'failed') throw new Error('Synthetic sign-out rejection')
				f.publish(f.signedOut)
				return 'completed'
			})
			await observeReady(f, binding)
			try {
				f.actor.send({ type: 'CHANGE_IDENTITY', ...c.request })
				const child = f.actor.getSnapshot().children.changeIdentity
				expect(selectSessionRuntimeObservation(f.actor.getSnapshot())).toBeUndefined()
				f.actor.send({
					type: 'CHANGE_IDENTITY',
					...c.request,
					scope: { ...c.request.scope, attempt: 2 }
				})
				expect(c.reports).toEqual([
					{
						type: 'SESSION_CHANGE_SETTLED',
						operation: 'signOut',
						scope: { ...c.request.scope, attempt: 2 },
						outcome: 'busy'
					}
				])
				f.actor.send({ type: 'CLOSE' })
				expect(f.actor.getSnapshot().children.changeIdentity).toBe(child)
				expect(f.unsubscribe).not.toHaveBeenCalled()
				expect(f.close).not.toHaveBeenCalled()
				pending.resolve()
				await waitFor(f.actor, (snapshot) => snapshot.status === 'done')
				expect(c.reports).toHaveLength(2)
				expect(c.reports[1]).toEqual({
					type: 'SESSION_CHANGE_SETTLED',
					operation: 'signOut',
					scope: c.request.scope,
					outcome
				})
				expect(f.changeIdentity).toHaveBeenCalledOnce()
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
		f.changeIdentity.mockResolvedValueOnce('bindingChanged')
		await observeReady(f, binding)
		try {
			f.actor.send({ type: 'CHANGE_IDENTITY', ...c.request })
			await vi.waitFor(() =>
				expect(c.reports).toEqual([
					{
						type: 'SESSION_CHANGE_SETTLED',
						operation: 'signOut',
						scope: c.request.scope,
						outcome: 'bindingChanged'
					}
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
		f.changeIdentity.mockImplementation(async () => {
			await pending.promise
			return 'completed'
		})
		await observeReady(f, binding)
		try {
			f.actor.send({ type: 'CHANGE_IDENTITY', ...c.request })
			const child = f.actor.getSnapshot().children.changeIdentity
			f.fail()
			f.actor.send({ type: 'CLOSE' })
			expect(f.actor.getSnapshot().children.changeIdentity).toBe(child)
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

describe('session identity changes', () => {
	it.each([
		{ operation: 'create', ready: false, reject: false },
		{ operation: 'restore', ready: false, reject: false },
		{ operation: 'restore', ready: true, reject: false },
		{ operation: 'restore', ready: true, reject: true }
	])(
		'drains $operation (ready: $ready, reject: $reject) without retaining credentials in the session',
		async ({ operation, ready, reject }) => {
			const f = fixture(),
				binding = {}
			if (ready) await observeReady(f, binding)
			else {
				f.actor.start()
				await waitFor(f.actor, (s) => !!selectSessionRuntimeObservation(s))
			}
			const before = ready
				? ({ status: 'ready', binding } satisfies SessionRuntimeIdentity)
				: f.signedOut
			if (before.status !== 'ready' && before.status !== 'signed-out')
				throw new Error('Fixture identity unavailable')
			const change: SessionRuntimeIdentityChange =
				operation === 'create'
					? { operation: 'create', before: f.signedOut }
					: { operation: 'restore', before, credential: 'synthetic-private-credential' }
			const c = changeCaller(f, change),
				pending = Promise.withResolvers<'completed'>()
			f.changeIdentity.mockImplementation(() => pending.promise)
			try {
				f.actor.send({ type: 'CHANGE_IDENTITY', ...c.request })
				expect(f.changeIdentity).toHaveBeenCalledExactlyOnceWith(change)
				expect(
					Object.values(f.actor.getSnapshot().getInputs()).some(
						(input) =>
							input !== null &&
							typeof input === 'object' &&
							('credential' in input || 'change' in input)
					)
				).toBe(false)
				expect(selectSessionRuntimeObservation(f.actor.getSnapshot())).toBeUndefined()
				const issued = f.actor.getSnapshot().children.changeIdentity
				f.actor.send({ type: 'CLOSE' })
				expect(f.actor.getSnapshot().children.changeIdentity).toBe(issued)
				expect(f.close).not.toHaveBeenCalled()
				if (reject) pending.reject(new Error('Synthetic identity rejection'))
				else pending.resolve('completed')
				await waitFor(f.actor, (s) => s.status === 'done')
				expect(c.reports).toEqual([
					{
						type: 'SESSION_CHANGE_SETTLED',
						scope: c.request.scope,
						operation: change.operation,
						outcome: reject ? 'failed' : 'completed'
					}
				])
				expect(f.unsubscribe).toHaveBeenCalledOnce()
				expect(f.close).toHaveBeenCalledOnce()
			} finally {
				pending.resolve('completed')
				f.actor.stop()
				c.caller.stop()
			}
		}
	)
	it('refuses a retired signed-out binding before creating an identity', async () => {
		const f = fixture(),
			c = changeCaller(f, { operation: 'create', before: { status: 'signed-out', binding: {} } })
		f.actor.start()
		try {
			await waitFor(f.actor, (s) => !!selectSessionRuntimeObservation(s))
			f.actor.send({ type: 'CHANGE_IDENTITY', ...c.request })
			expect(f.changeIdentity).not.toHaveBeenCalled()
			expect(c.reports).toEqual([
				{
					type: 'SESSION_CHANGE_SETTLED',
					scope: c.request.scope,
					operation: 'create',
					outcome: 'bindingChanged'
				}
			])
			f.actor.send({ type: 'CLOSE' })
			await waitFor(f.actor, (s) => s.status === 'done')
		} finally {
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

describe('workflow connection to the session owner', () => {
	const changeMachine = createSessionChangeMachine<SessionRuntimeChangeInput>((input) => input)
	function command(f: ReturnType<typeof fixture>, change: SessionRuntimeIdentityChange) {
		return createActor(changeMachine, {
			input: {
				session: createSessionRuntimeConnection(f.actor, f.input.binding),
				scope: { binding: f.input.binding, attempt: 1 },
				change
			}
		}).start()
	}
	it('releases the command payload while retaining an issued identity change through shutdown', async () => {
		const f = fixture(),
			held = Promise.withResolvers<void>()
		f.changeIdentity.mockImplementation(async () => {
			await held.promise
			return 'completed'
		})
		f.actor.start()
		await waitFor(f.actor, (s) => !!selectSessionRuntimeObservation(s))
		const caller = command(f, {
			operation: 'restore',
			before: f.signedOut,
			credential: 'fixture-only'
		})
		try {
			expect(caller.getSnapshot().context.request).toBeUndefined()
			caller.send({ type: 'SHUTDOWN' })
			expect(caller.getSnapshot().status).toBe('active')
			caller.send({
				type: 'SESSION_CHANGE_SETTLED',
				scope: { binding: {}, attempt: 1 },
				operation: 'restore',
				outcome: 'completed'
			})
			expect(caller.getSnapshot().status).toBe('active')
			held.resolve()
			await waitFor(caller, (s) => s.status === 'done')
			expect(caller.getSnapshot().output).toEqual({ outcome: 'completed' })
			expect(f.changeIdentity).toHaveBeenCalledOnce()
		} finally {
			held.resolve()
			caller.stop()
			f.actor.stop()
		}
	})
	it('settles a waiting workflow as failed when its session owner is forcibly stopped', async () => {
		const f = fixture(),
			held = Promise.withResolvers<void>()
		f.changeIdentity.mockImplementation(async () => {
			await held.promise
			return 'completed'
		})
		f.actor.start()
		await waitFor(f.actor, (s) => !!selectSessionRuntimeObservation(s))
		const caller = command(f, { operation: 'create', before: f.signedOut })
		try {
			f.actor.stop()
			await waitFor(caller, (s) => s.status === 'done')
			expect(caller.getSnapshot().output).toEqual({ outcome: 'failed' })
			expect(f.close).not.toHaveBeenCalled()
		} finally {
			held.resolve()
			caller.stop()
			f.actor.stop()
		}
	})
	it.each(['native', 'acquisition', 'observation'])(
		'routes %s retry to its actual owner',
		async (kind) => {
			const f = fixture()
			if (kind === 'acquisition') f.open.mockRejectedValueOnce(new Error('Synthetic open failure'))
			f.actor.start()
			if (kind === 'acquisition') await waitFor(f.actor, (s) => s.matches('openFailed'))
			else {
				await waitFor(f.actor, (s) => !!selectSessionRuntimeObservation(s))
				if (kind === 'observation') {
					f.fail()
					await waitFor(f.actor, (s) => s.matches({ bound: 'observerFailed' }))
				}
			}
			const caller = command(f, { operation: 'retry' })
			try {
				await waitFor(caller, (s) => s.status === 'done')
				expect(caller.getSnapshot().output).toEqual({ outcome: 'completed' })
				expect(f.open).toHaveBeenCalledTimes(kind === 'acquisition' ? 2 : 1)
				expect(f.observe).toHaveBeenCalledTimes(kind === 'observation' ? 2 : 1)
				expect(f.changeIdentity).toHaveBeenCalledTimes(kind === 'native' ? 1 : 0)
				if (kind === 'native') expect(f.changeIdentity).toHaveBeenCalledWith({ operation: 'retry' })
			} finally {
				caller.stop()
				f.actor.stop()
			}
		}
	)
	it('settles a failed typed acquisition retry instead of stranding its workflow', async () => {
		const f = fixture()
		f.open.mockRejectedValue(new Error('Synthetic open failure'))
		f.actor.start()
		await waitFor(f.actor, (s) => s.matches('openFailed'))
		const caller = command(f, { operation: 'retry' })
		try {
			await waitFor(caller, (s) => s.status === 'done')
			expect(caller.getSnapshot().output).toEqual({ outcome: 'failed' })
			expect(f.open).toHaveBeenCalledTimes(2)
		} finally {
			caller.stop()
			f.actor.stop()
		}
	})
	it('waits for late acquisition and actual native close before returning a clean receipt', async () => {
		const f = fixture(),
			acquisition = Promise.withResolvers<SessionRuntimeResource>(),
			closing = Promise.withResolvers<void>()
		f.open.mockImplementation(() => acquisition.promise)
		f.close.mockImplementation(() => closing.promise)
		f.actor.start()
		const close = createActor(sessionCloseMachine, {
			input: createSessionRuntimeConnection(f.actor, f.input.binding)
		}).start()
		try {
			expect(close.getSnapshot().context.stage).toBe('acquisition')
			acquisition.resolve(f.resource)
			await vi.waitFor(() => expect(f.close).toHaveBeenCalledOnce())
			expect(close.getSnapshot().status).toBe('active')
			expect(f.observe).not.toHaveBeenCalled()
			closing.resolve()
			await waitFor(close, (s) => s.status === 'done')
			expect(close.getSnapshot().output).toEqual({ outcome: 'closed' })
		} finally {
			acquisition.resolve(f.resource)
			closing.resolve()
			close.stop()
			f.actor.stop()
		}
	})
	it.each(['native failure', 'forced stop'])('refuses a clean receipt after %s', async (fault) => {
		const f = fixture()
		f.actor.start()
		await waitFor(f.actor, (s) => !!selectSessionRuntimeObservation(s))
		if (fault === 'forced stop') f.actor.stop()
		else f.close.mockRejectedValue(new Error('Synthetic close failure'))
		const close = createActor(sessionCloseMachine, {
			input: createSessionRuntimeConnection(f.actor, f.input.binding)
		}).start()
		try {
			await waitFor(close, (s) => s.status === 'done')
			expect(close.getSnapshot().output).toEqual({ outcome: 'failed' })
			expect(f.close).toHaveBeenCalledTimes(fault === 'forced stop' ? 0 : 1)
		} finally {
			close.stop()
			f.actor.stop()
		}
	})
})
