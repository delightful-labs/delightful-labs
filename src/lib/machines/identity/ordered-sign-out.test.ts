import { expect, it, vi } from 'vitest'
import { createActor, SimulatedClock, toPromise, waitFor } from 'xstate'
import { createOrderedSignOutMachine } from './ordered-sign-out.js'

it.each(['signed-out', 'replaced', 'unavailable'] as const)(
	'observes %s after provider success without mutating a replacement identity',
	async (status) => {
		const provider = vi.fn(async () => {}),
			session = vi.fn(async () => {}),
			observeSession = vi.fn(() => status)
		const actor = createActor(createOrderedSignOutMachine(), {
			input: { provider, session, observeSession }
		}).start()
		expect(await toPromise(actor)).toEqual(
			status === 'signed-out' ? { outcome: 'completed' } : { outcome: 'failed', stage: 'session' }
		)
		expect(provider).toHaveBeenCalledOnce()
		expect(observeSession).toHaveBeenCalledOnce()
		expect(session).not.toHaveBeenCalled()
	}
)
it('selects native logout only after observing the original identity', async () => {
	const calls: string[] = []
	const actor = createActor(createOrderedSignOutMachine(), {
		input: {
			provider: async () => {
				calls.push('provider')
			},
			observeSession: () => {
				calls.push('observe')
				return 'current'
			},
			session: async () => {
				calls.push('session')
			}
		}
	}).start()
	expect(await toPromise(actor)).toEqual({ outcome: 'completed' })
	expect(calls).toEqual(['provider', 'observe', 'session'])
})

it('skips an absent provider and returns a sanitized native rejection', async () => {
	const session = vi.fn(async () => {
		throw new Error('private native details')
	})
	const actor = createActor(createOrderedSignOutMachine(), { input: { session } }).start()
	expect(await toPromise(actor)).toEqual({ outcome: 'failed', stage: 'session' })
	expect(session).toHaveBeenCalledOnce()
	expect(actor.getSnapshot().context.input).toBeUndefined()
})
it.each(['provider', 'session'] as const)(
	'retains the original %s call through overdue feedback and repeated shutdown',
	async (stage) => {
		const original = deferred(),
			clock = new SimulatedClock(),
			onOverdue = vi.fn()
		const provider = vi.fn(() => (stage === 'provider' ? original.promise : Promise.resolve()))
		const session = vi.fn(() => (stage === 'session' ? original.promise : Promise.resolve()))
		const actor = createActor(createOrderedSignOutMachine(), {
			clock,
			input: { provider, session, providerDeadlineMs: 5, sessionDeadlineMs: 5, onOverdue }
		}).start()
		try {
			await waitFor(actor, (snapshot) => snapshot.matches({ [stage]: 'waiting' }))
			const native = actor.getSnapshot().children[stage]
			clock.increment(5)
			actor.send({ type: 'SHUTDOWN' })
			actor.send({ type: 'SHUTDOWN' })
			expect(actor.getSnapshot().status).toBe('active')
			expect(actor.getSnapshot().children[stage]).toBe(native)
			expect(onOverdue).toHaveBeenCalledExactlyOnceWith(stage)
			if (stage === 'provider') expect(session).not.toHaveBeenCalled()
			original.resolve()
			expect(await toPromise(actor)).toEqual({ outcome: 'completed' })
			expect(provider).toHaveBeenCalledOnce()
			expect(session).toHaveBeenCalledOnce()
		} finally {
			original.resolve()
			actor.stop()
		}
	}
)
it('refuses native logout after a late provider failure', async () => {
	const original = deferred(),
		clock = new SimulatedClock(),
		session = vi.fn(async () => {})
	const actor = createActor(createOrderedSignOutMachine(), {
		clock,
		input: { provider: () => original.promise, session, providerDeadlineMs: 5 }
	}).start()
	clock.increment(5)
	original.reject(new Error('private provider failure'))
	expect(await toPromise(actor)).toEqual({ outcome: 'failed', stage: 'provider' })
	expect(session).not.toHaveBeenCalled()
})
it('does not surrender a pending effect when an overdue observer throws', async () => {
	const original = deferred(),
		clock = new SimulatedClock(),
		session = vi.fn(async () => {})
	const actor = createActor(createOrderedSignOutMachine(), {
		clock,
		input: {
			provider: () => original.promise,
			session,
			providerDeadlineMs: 5,
			onOverdue: () => {
				throw new Error('observer failed')
			}
		}
	}).start()
	clock.increment(5)
	expect(actor.getSnapshot().matches({ provider: 'overdue' })).toBe(true)
	expect(session).not.toHaveBeenCalled()
	original.resolve()
	expect(await toPromise(actor)).toEqual({ outcome: 'completed' })
})
it('rejects invalid deadline configuration before issuing an identity effect', async () => {
	const provider = vi.fn(async () => {}),
		session = vi.fn(async () => {})
	const actor = createActor(createOrderedSignOutMachine(), {
		input: { provider, session, providerDeadlineMs: Infinity }
	}).start()
	expect(await toPromise(actor)).toEqual({ outcome: 'failed', stage: 'configuration' })
	expect(provider).not.toHaveBeenCalled()
	expect(session).not.toHaveBeenCalled()
})
it('forced disposal cannot emit a successful result or start native logout after a late provider reply', async () => {
	const original = deferred(),
		session = vi.fn(async () => {}),
		completed = vi.fn()
	const actor = createActor(createOrderedSignOutMachine(), {
		input: { provider: () => original.promise, session }
	}).start()
	actor.subscribe({ complete: () => completed(actor.getSnapshot().output) })
	actor.stop()
	original.resolve()
	await Promise.resolve()
	await Promise.resolve()
	expect(actor.getSnapshot().output).toBeUndefined()
	expect(completed).toHaveBeenCalledExactlyOnceWith(undefined)
	expect(session).not.toHaveBeenCalled()
})

function deferred() {
	let resolve!: () => void, reject!: (error: Error) => void
	const promise = new Promise<void>((accept, refuse) => {
		resolve = accept
		reject = refuse
	})
	return { promise, resolve, reject }
}
