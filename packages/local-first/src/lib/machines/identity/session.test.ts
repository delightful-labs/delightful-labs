import type { EventPayload } from '../../contracts/machine-events.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createActor, createCallbackLogic, setup, waitFor, types } from 'xstate'
import type { EventObject } from 'xstate'
import type {
	SessionOwnerReply,
	SessionOpenCapability,
	SessionScope,
	SessionStartupReport
} from '../../contracts/session.js'
import { createSessionAcquisitionMachine, selectAcquiredSession } from './session-acquisition.js'
import type { SessionOwnerEvent } from './session-acquisition.js'
import { createSessionStartupMachine } from './session-startup.js'

type Session = { id: string; close: () => Promise<void>; logout: () => Promise<void> }
const actors = new Set<{ stop: () => void }>()
function tracked<Actor extends { stop: () => void }>(actor: Actor): Actor {
	actors.add(actor)
	return actor
}
function deferred<Value>() {
	let resolve = (_value: Value): void => {
		throw new Error('Deferred not initialized')
	}
	let reject = (_error: Error): void => {
		throw new Error('Deferred not initialized')
	}
	const promise = new Promise<Value>((done, fail) => {
		resolve = done
		reject = fail
	})
	return { promise, resolve, reject }
}
function recipient<Event extends EventObject>() {
	const events: Event[] = []
	const actor = tracked(
		createActor(
			createCallbackLogic<Event, undefined>(({ receive }) =>
				receive((event) => events.push(event))
			),
			{ input: undefined }
		).start()
	)
	return { actor, events }
}
function resource(): Session {
	return { id: 'synthetic session', close: vi.fn(async () => {}), logout: vi.fn(async () => {}) }
}
function scope(binding: object, attachment = {}, generation = 0): SessionScope {
	return { binding, attachment, generation }
}
function owner(
	open?: () => Promise<Session>,
	existing?: Session,
	availability?: SessionOpenCapability<Session>['availability']
) {
	const binding = {}
	const session = resource()
	const acquire = vi.fn(open ?? (async () => session))
	const input = {
		binding,
		capability: { open: acquire, ...(availability ? { availability } : {}) },
		...(existing ? { existing } : {})
	}
	const actor = tracked(createActor(createSessionAcquisitionMachine<Session>(), { input }).start())
	return { actor, binding, session, acquire }
}
function unavailableOwner() {
	const busy = new Error('Synthetic storage contention')
	const opening = deferred<Session>()
	const availability = deferred<void>()
	const wait = vi.fn((_key: string, _signal: AbortSignal) => availability.promise)
	const acquire = vi
		.fn<() => Promise<Session>>()
		.mockRejectedValueOnce(busy)
		.mockImplementation(() => opening.promise)
	const source = owner(acquire, undefined, {
		classify: (error) => (error === busy ? { resourceKey: 'shared-test-storage' } : undefined),
		wait
	})
	return { ...source, opening, availability, wait }
}
function attachment() {
	const reports = recipient<SessionStartupReport<Session>>()
	const actor = tracked(
		createActor(createSessionStartupMachine<Session>(), {
			input: { reportTo: reports.actor }
		}).start()
	)
	return { actor, reports: reports.events }
}
function start(app: ReturnType<typeof attachment>, source: ReturnType<typeof owner>) {
	const captured = scope(source.binding)
	app.actor.send({ type: 'START', owner: source.actor, scope: captured })
	return captured
}
function controlled() {
	return recipient<SessionOwnerEvent<Session>>()
}
async function attached(app: ReturnType<typeof attachment>) {
	await waitFor(app.actor, (s) => s.matches({ bound: 'attached' }))
}
async function failed(app: ReturnType<typeof attachment>) {
	await waitFor(app.actor, (s) => s.matches({ bound: 'failed' }))
}
async function closed(app: ReturnType<typeof attachment>) {
	expect((await waitFor(app.actor, (s) => s.status === 'done')).output).toEqual({
		outcome: 'closed'
	})
	expect(app.actor.getSnapshot().context.owner).toBeUndefined()
	expect(app.actor.getSnapshot().context.acquisition.session).toBeUndefined()
	expect(app.actor.getSnapshot().context.scope).toBeUndefined()
}
afterEach(() => {
	for (const actor of actors) actor.stop()
	actors.clear()
})

describe('session acquisition owner', () => {
	it('reuses a supplied reference and never closes/logs out the host resource', async () => {
		const existing = resource()
		const f = owner(undefined, existing)
		const app = attachment()
		start(app, f)
		await attached(app)
		expect(selectAcquiredSession(f.actor.getSnapshot())).toBe(existing)
		app.actor.send({ type: 'SHUTDOWN' })
		await closed(app)
		expect(f.acquire).not.toHaveBeenCalled()
		expect(existing.close).not.toHaveBeenCalled()
		expect(existing.logout).not.toHaveBeenCalled()
	})

	it('shares one pending invocation across attachments and duplicate starts/retries', async () => {
		const pending = deferred<Session>()
		const f = owner(() => pending.promise)
		const first = attachment(),
			second = attachment()
		const captured = start(first, f)
		start(second, f)
		first.actor.send({ type: 'START', owner: f.actor, scope: captured })
		first.actor.send({ type: 'RETRY' })
		expect(f.acquire).toHaveBeenCalledOnce()
		pending.resolve(f.session)
		await attached(first)
		await attached(second)
		expect(first.reports.filter((event) => event.type === 'SESSION_ACQUIRED')).toEqual([
			{ type: 'SESSION_ACQUIRED', scope: captured, session: f.session }
		])
		const third = attachment()
		start(third, f)
		await attached(third)
		expect(first.reports.filter((event) => event.type === 'SESSION_ACQUIRED')).toHaveLength(1)
		expect(f.acquire).toHaveBeenCalledOnce()
	})

	it.each([false, true])(
		'retains late SDK settlement after the last release (reject: %s)',
		async (reject) => {
			const pending = deferred<Session>()
			const f = owner(() => pending.promise)
			const app = attachment()
			start(app, f)
			app.actor.send({ type: 'SHUTDOWN' })
			await closed(app)
			if (reject) pending.reject(new Error('private SDK error'))
			else pending.resolve(f.session)
			await waitFor(f.actor, (s) => s.matches(reject ? 'failed' : 'acquired'))
			const replacement = attachment()
			start(replacement, f)
			if (reject) await failed(replacement)
			else await attached(replacement)
			expect(f.acquire).toHaveBeenCalledOnce()
			expect(app.reports.some((event) => event.type === 'SESSION_ACQUIRED')).toBe(false)
			expect(f.session.close).not.toHaveBeenCalled()
			expect(f.session.logout).not.toHaveBeenCalled()
		}
	)

	it('lets a remount join the original open before it settles', async () => {
		const pending = deferred<Session>()
		const f = owner(() => pending.promise)
		const first = attachment()
		start(first, f)
		first.actor.send({ type: 'SHUTDOWN' })
		await closed(first)
		const second = attachment()
		start(second, f)
		pending.resolve(f.session)
		await attached(second)
		expect(f.acquire).toHaveBeenCalledOnce()
	})

	it('remembers failure across remount and retries only on explicit new generations', async () => {
		const f = owner()
		f.acquire
			.mockRejectedValueOnce(new Error('private first failure'))
			.mockRejectedValueOnce(new Error('private retry failure'))
		const first = attachment()
		start(first, f)
		await failed(first)
		first.actor.send({ type: 'SHUTDOWN' })
		await closed(first)
		const second = attachment()
		start(second, f)
		await failed(second)
		expect(f.acquire).toHaveBeenCalledTimes(1)
		second.actor.send({ type: 'RETRY' })
		await failed(second)
		second.actor.send({ type: 'RETRY' })
		await attached(second)
		expect(f.acquire).toHaveBeenCalledTimes(3)
		expect(
			second.reports
				.filter((event) => event.type === 'SESSION_STARTING')
				.map((event) => event.scope.generation)
		).toEqual([0, 1, 2])
		expect(
			second.reports
				.filter((event) => event.type === 'SESSION_STARTUP_FAILED')
				.every((event) => event.reason === 'openFailed')
		).toBe(true)
	})

	it('does not let another attachment retry silently reactivate a failed attachment', async () => {
		const f = owner()
		f.acquire.mockRejectedValueOnce(new Error('private'))
		const first = attachment()
		start(first, f)
		await failed(first)
		const second = attachment()
		start(second, f)
		await failed(second)
		second.actor.send({ type: 'RETRY' })
		await attached(second)
		expect(first.actor.getSnapshot().matches({ bound: 'failed' })).toBe(true)
		first.actor.send({ type: 'RETRY' })
		await attached(first)
		expect(f.acquire).toHaveBeenCalledTimes(2)
	})

	it.each([-1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1])(
		'rejects invalid generation %s without acquiring',
		(generation) => {
			const f = owner(),
				replies = recipient<SessionOwnerReply<Session>>()
			const captured = scope(f.binding, {}, generation)
			f.actor.send({ type: 'ACQUIRE', scope: captured, replyTo: replies.actor })
			expect(replies.events).toEqual([
				{ type: 'ACQUISITION_FAILED', scope: captured, reason: 'invalidRequest' }
			])
			expect(f.acquire).not.toHaveBeenCalled()
		}
	)

	it('rejects foreign bindings and another recipient reusing a live token', async () => {
		const pending = deferred<Session>(),
			f = owner(() => pending.promise)
		const first = recipient<SessionOwnerReply<Session>>(),
			other = recipient<SessionOwnerReply<Session>>()
		const captured = scope(f.binding)
		f.actor.send({ type: 'ACQUIRE', scope: { ...captured, binding: {} }, replyTo: other.actor })
		f.actor.send({ type: 'ACQUIRE', scope: captured, replyTo: first.actor })
		f.actor.send({ type: 'ACQUIRE', scope: captured, replyTo: other.actor })
		expect(other.events.map((event) => event.type)).toEqual([
			'ACQUISITION_FAILED',
			'ACQUISITION_FAILED'
		])
		pending.resolve(f.session)
		await waitFor(f.actor, (s) => s.matches('acquired'))
		expect(first.events.some((event) => event.type === 'ACQUIRED')).toBe(true)
		expect(other.events.some((event) => event.type === 'ACQUIRED')).toBe(false)
	})

	it('ignores old release/requests after a newer generation and permanently retires a released token', async () => {
		const pending = deferred<Session>(),
			f = owner(() => pending.promise)
		const replies = recipient<SessionOwnerReply<Session>>()
		const old = scope(f.binding),
			current = { ...old, generation: 1 }
		f.actor.send({ type: 'ACQUIRE', scope: old, replyTo: replies.actor })
		f.actor.send({ type: 'RETRY_ACQUIRE', scope: current, replyTo: replies.actor })
		f.actor.send({ type: 'RELEASE', scope: old, replyTo: replies.actor })
		f.actor.send({ type: 'ACQUIRE', scope: old, replyTo: replies.actor })
		pending.resolve(f.session)
		await waitFor(f.actor, (s) => s.matches('acquired'))
		expect(replies.events.filter((event) => event.type === 'ACQUIRED')).toEqual([
			{ type: 'ACQUIRED', scope: current, session: f.session }
		])
		f.actor.send({ type: 'RELEASE', scope: current, replyTo: replies.actor })
		f.actor.send({ type: 'ACQUIRE', scope: { ...current, generation: 2 }, replyTo: replies.actor })
		expect(replies.events.at(-1)).toEqual({
			type: 'ACQUISITION_FAILED',
			scope: { ...current, generation: 2 },
			reason: 'invalidRequest'
		})
		expect(f.acquire).toHaveBeenCalledOnce()
	})

	it('deduplicates retry while opening and rejects its replay after failure', async () => {
		const retry = deferred<Session>(),
			f = owner()
		f.acquire.mockRejectedValueOnce(new Error('first')).mockImplementationOnce(() => retry.promise)
		const replies = recipient<SessionOwnerReply<Session>>(),
			initial = scope(f.binding)
		f.actor.send({ type: 'ACQUIRE', scope: initial, replyTo: replies.actor })
		await waitFor(f.actor, (s) => s.matches('failed'))
		const captured = { ...initial, generation: 1 }
		f.actor.send({ type: 'RETRY_ACQUIRE', scope: captured, replyTo: replies.actor })
		f.actor.send({ type: 'RETRY_ACQUIRE', scope: captured, replyTo: replies.actor })
		expect(f.acquire).toHaveBeenCalledTimes(2)
		retry.reject(new Error('retry'))
		await waitFor(f.actor, (s) => s.matches('failed'))
		f.actor.send({ type: 'RETRY_ACQUIRE', scope: captured, replyTo: replies.actor })
		expect(f.acquire).toHaveBeenCalledTimes(2)
	})

	it('honors a release received before acquisition without opening later for that token', () => {
		const f = owner(),
			replies = recipient<SessionOwnerReply<Session>>(),
			captured = scope(f.binding)
		f.actor.send({ type: 'RELEASE', scope: captured, replyTo: replies.actor })
		f.actor.send({ type: 'ACQUIRE', scope: captured, replyTo: replies.actor })
		expect(replies.events.map((event) => event.type)).toEqual(['RELEASED', 'ACQUISITION_FAILED'])
		expect(f.acquire).not.toHaveBeenCalled()
	})
})

describe('startup attachment lifecycle', () => {
	it('waits without an owner, open, subscription, or report until browser START', async () => {
		const app = attachment()
		app.actor.send({ type: 'RETRY' })
		expect(app.reports).toEqual([])
		expect(app.actor.getSnapshot().matches('waiting')).toBe(true)
		app.actor.send({ type: 'SHUTDOWN' })
		await closed(app)
	})

	it('ignores unrelated replies and waits for the matching release acknowledgement', async () => {
		const source = controlled(),
			app = attachment(),
			captured = scope({})
		app.actor.send({ type: 'START', owner: source.actor, scope: captured })
		for (const wrong of [
			{ ...captured, binding: {} },
			{ ...captured, attachment: {} },
			{ ...captured, generation: 1 }
		]) {
			app.actor.send({ type: 'ACQUIRED', scope: wrong, session: resource() })
			app.actor.send({ type: 'ACQUISITION_FAILED', scope: wrong, reason: 'openFailed' })
		}
		expect(app.reports.map((event) => event.type)).toEqual(['SESSION_STARTING'])
		app.actor.send({ type: 'SHUTDOWN' })
		expect(source.events.map((event) => event.type)).toEqual(['ACQUIRE', 'RELEASE'])
		app.actor.send({ type: 'ACQUIRED', scope: captured, session: resource() })
		app.actor.send({ type: 'ACQUISITION_FAILED', scope: captured, reason: 'openFailed' })
		app.actor.send({ type: 'RETRY' })
		app.actor.send({ type: 'SHUTDOWN' })
		app.actor.send({ type: 'RELEASED', scope: { ...captured, generation: 1 } })
		expect(app.actor.getSnapshot().status).toBe('active')
		app.actor.send({ type: 'RELEASED', scope: captured })
		await closed(app)
		expect(app.reports.map((event) => event.type)).toEqual(['SESSION_STARTING'])
	})

	it('rejects a prior generation result after retry and cannot rebind through another START', async () => {
		const source = controlled(),
			app = attachment(),
			captured = scope({})
		app.actor.send({ type: 'START', owner: source.actor, scope: captured })
		app.actor.send({ type: 'ACQUISITION_FAILED', scope: captured, reason: 'openFailed' })
		app.actor.send({ type: 'RETRY' })
		app.actor.send({ type: 'START', owner: controlled().actor, scope: scope({}) })
		app.actor.send({ type: 'ACQUIRED', scope: captured, session: resource() })
		expect(app.reports.filter((event) => event.type === 'SESSION_ACQUIRED')).toHaveLength(0)
		const current = { ...captured, generation: 1 },
			session = resource()
		app.actor.send({ type: 'ACQUIRED', scope: current, session })
		await attached(app)
		expect(app.reports.at(-1)).toEqual({ type: 'SESSION_ACQUIRED', scope: current, session })
		app.actor.send({ type: 'SHUTDOWN' })
		app.actor.send({ type: 'RELEASED', scope: current })
		await closed(app)
	})

	it.each(['beforeStart', 'requesting', 'attached', 'releasing'])(
		'does not await a stopped owner during %s',
		async (phase) => {
			const source = controlled(),
				app = attachment(),
				captured = scope({})
			if (phase === 'beforeStart') source.actor.stop()
			app.actor.send({ type: 'START', owner: source.actor, scope: captured })
			if (phase === 'attached')
				app.actor.send({ type: 'ACQUIRED', scope: captured, session: resource() })
			if (phase === 'releasing') app.actor.send({ type: 'SHUTDOWN' })
			if (phase !== 'beforeStart') source.actor.stop()
			if (phase !== 'releasing') {
				await waitFor(app.actor, (s) => s.matches('ownerFailed'))
				expect(app.reports.at(-1)).toEqual({
					type: 'SESSION_STARTUP_FAILED',
					scope: captured,
					reason: 'ownerFailed'
				})
				app.actor.send({ type: 'SHUTDOWN' })
			}
			await closed(app)
		}
	)

	it('sanitizes an owner actor crash instead of restarting it', async () => {
		const source = tracked(
			createActor(
				setup({
					schemas: {
						context: types<{}>(),
						events: {
							ACQUIRE:
								types<EventPayload<SessionOwnerEvent<Session> | { type: 'CRASH' }, 'ACQUIRE'>>(),
							RETRY_ACQUIRE:
								types<
									EventPayload<SessionOwnerEvent<Session> | { type: 'CRASH' }, 'RETRY_ACQUIRE'>
								>(),
							RELEASE:
								types<EventPayload<SessionOwnerEvent<Session> | { type: 'CRASH' }, 'RELEASE'>>(),
							CRASH: types<EventPayload<SessionOwnerEvent<Session> | { type: 'CRASH' }, 'CRASH'>>()
						}
					}
				}).createMachine({
					context: {},
					initial: 'active',
					states: {
						active: {
							on: {
								CRASH: (args, enq) => {
									enq(() => {
										throw new Error('private owner crash')
									})
								}
							}
						}
					}
				})
			).start()
		)
		source.subscribe({ error: () => {} })
		const app = attachment(),
			captured = scope({})
		app.actor.send({ type: 'START', owner: source, scope: captured })
		source.send({ type: 'CRASH' })
		await waitFor(app.actor, (s) => s.matches('ownerFailed'))
		expect(app.reports.at(-1)).toEqual({
			type: 'SESSION_STARTUP_FAILED',
			scope: captured,
			reason: 'ownerFailed'
		})
		app.actor.send({ type: 'RETRY' })
		expect(source.getSnapshot().status).toBe('error')
		app.actor.send({ type: 'SHUTDOWN' })
		await closed(app)
	})

	it.each(['subscribe', 'getSnapshot'] satisfies ('subscribe' | 'getSnapshot')[])(
		'releases a live owner request if lifecycle %s fails',
		async (method) => {
			const source = controlled(),
				app = attachment(),
				captured = scope({})
			vi.spyOn(source.actor, method).mockImplementationOnce(() => {
				throw new Error('private subscription failure')
			})
			app.actor.send({ type: 'START', owner: source.actor, scope: captured })
			await waitFor(app.actor, (s) => s.matches('ownerFailed'))
			expect(source.events.map((event) => event.type)).toEqual(['ACQUIRE', 'RELEASE'])
			expect(app.reports.at(-1)).toEqual({
				type: 'SESSION_STARTUP_FAILED',
				scope: captured,
				reason: 'ownerFailed'
			})
			app.actor.send({ type: 'SHUTDOWN' })
			await closed(app)
		}
	)

	it('unsubscribes from owner lifecycle after a normal release', async () => {
		const f = owner(undefined, resource()),
			app = attachment()
		const subscribe = f.actor.subscribe.bind(f.actor),
			unsubscribe = vi.fn()
		vi.spyOn(f.actor, 'subscribe').mockImplementation((...args) => {
			const subscription = subscribe(...args)
			return {
				unsubscribe: () => {
					unsubscribe()
					subscription.unsubscribe()
				}
			}
		})
		start(app, f)
		await attached(app)
		app.actor.send({ type: 'SHUTDOWN' })
		await closed(app)
		expect(unsubscribe).toHaveBeenCalledOnce()
	})
})

describe('session acquisition availability boundary', () => {
	it('waits for storage admission before one re-open without reporting startup failure', async () => {
		const source = unavailableOwner()
		const app = attachment()
		start(app, source)
		await waitFor(source.actor, (snapshot) => snapshot.matches('waitingForAvailability'))
		expect(source.acquire).toHaveBeenCalledTimes(1)
		expect(source.wait.mock.calls[0]?.[0]).toBe('shared-test-storage')
		expect(app.reports.some((event) => event.type === 'SESSION_STARTUP_FAILED')).toBe(false)
		source.availability.resolve(undefined)
		source.opening.resolve(source.session)
		await attached(app)
		expect(source.acquire).toHaveBeenCalledTimes(2)
		expect(selectAcquiredSession(source.actor.getSnapshot())).toBe(source.session)
	})

	it('shares one resource wait and preserves a remaining attachment after another releases', async () => {
		const source = unavailableOwner()
		const first = attachment()
		const second = attachment()
		const captured = start(first, source)
		await waitFor(source.actor, (snapshot) => snapshot.matches('waitingForAvailability'))
		start(second, source)
		source.actor.send({ type: 'RETRY_ACQUIRE', scope: captured, replyTo: first.actor })
		first.actor.send({ type: 'SHUTDOWN' })
		await closed(first)
		expect(source.wait).toHaveBeenCalledTimes(1)
		expect(source.wait.mock.calls[0]?.[1].aborted).toBe(false)
		source.availability.resolve(undefined)
		source.opening.resolve(source.session)
		await attached(second)
		expect(source.acquire).toHaveBeenCalledTimes(2)
		expect(first.reports.some((event) => event.type === 'SESSION_ACQUIRED')).toBe(false)
	})

	it('cancels the waiter after the final release and ignores its late completion', async () => {
		const source = unavailableOwner()
		const app = attachment()
		start(app, source)
		await waitFor(source.actor, (snapshot) => snapshot.matches('waitingForAvailability'))
		app.actor.send({ type: 'SHUTDOWN' })
		await closed(app)
		expect(source.wait.mock.calls[0]?.[1].aborted).toBe(true)
		source.availability.resolve(undefined)
		await source.availability.promise
		// Let the canceled invocation's queued completion reach the actor boundary.
		await new Promise<void>((resolve) => setTimeout(resolve, 0))
		expect(source.actor.getSnapshot().matches('idle')).toBe(true)
		expect(source.acquire).toHaveBeenCalledTimes(1)
		expect(selectAcquiredSession(source.actor.getSnapshot())).toBeUndefined()
	})

	it('reports wait failure without retrying the SDK or exposing the storage error', async () => {
		const source = unavailableOwner()
		const app = attachment()
		start(app, source)
		await waitFor(source.actor, (snapshot) => snapshot.matches('waitingForAvailability'))
		source.availability.reject(new Error('Synthetic private storage error'))
		await failed(app)
		expect(app.reports.at(-1)).toMatchObject({
			type: 'SESSION_STARTUP_FAILED',
			reason: 'openFailed'
		})
		expect(source.acquire).toHaveBeenCalledTimes(1)
		expect(source.actor.getSnapshot().context.availability).toBeUndefined()
	})

	it('keeps unclassified errors on the existing explicit failure path', async () => {
		const wait = vi.fn(async (_key: string, _signal: AbortSignal) => {})
		const source = owner(
			async () => {
				throw new Error('Synthetic ordinary open failure')
			},
			undefined,
			{
				classify: () => undefined,
				wait
			}
		)
		const app = attachment()
		start(app, source)
		await failed(app)
		expect(wait).not.toHaveBeenCalled()
		expect(source.acquire).toHaveBeenCalledTimes(1)
	})

	it('does not let an invalid release cancel another attachment admission', async () => {
		const source = unavailableOwner()
		const app = attachment()
		const captured = start(app, source)
		await waitFor(source.actor, (snapshot) => snapshot.matches('waitingForAvailability'))
		const other = recipient<SessionOwnerReply<Session>>()
		source.actor.send({
			type: 'RELEASE',
			scope: { ...captured, binding: {} },
			replyTo: other.actor
		})
		expect(source.wait.mock.calls[0]?.[1].aborted).toBe(false)
		expect(source.actor.getSnapshot().matches('waitingForAvailability')).toBe(true)
		source.availability.resolve(undefined)
		source.opening.resolve(source.session)
		await attached(app)
		expect(selectAcquiredSession(source.actor.getSnapshot())).toBe(source.session)
	})

	it('aborts the state-owned availability waiter when its host owner stops', async () => {
		const source = unavailableOwner()
		start(attachment(), source)
		await waitFor(source.actor, (snapshot) => snapshot.matches('waitingForAvailability'))
		source.actor.stop()
		expect(source.wait.mock.calls[0]?.[1].aborted).toBe(true)
		expect(source.acquire).toHaveBeenCalledTimes(1)
	})
})
