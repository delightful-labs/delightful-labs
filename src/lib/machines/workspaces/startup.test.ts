import { afterEach, describe, expect, it, vi } from 'vitest'
import { assign, createActor, fromPromise, fromTransition, setup, waitFor } from 'xstate'
import { createWorkspaceStartupMachine } from './startup.js'
import type {
	InitializationRequest,
	InitializationStatusEvent
} from '../../contracts/workspace-startup.js'
import { deferred } from '../../../../tests/helpers/deferred.js'

type Result =
	| { outcome: 'ready'; profileId: string; organizationId: string }
	| { outcome: 'failed' }
const actors = new Set<{ stop(): void }>()
afterEach(() => {
	for (const actor of actors) actor.stop()
	actors.clear()
})
function fixture(userId: string | undefined) {
	const db = {},
		initialized = deferred<Result>(),
		seeded = deferred<void>()
	const initialize = vi.fn((_input: { db: typeof db; userId: string }) => initialized.promise)
	const seed = vi.fn(
		(_input: { db: typeof db; userId: string; organizationId: string }) => seeded.promise
	)
	const ready = vi.fn((result: Result | undefined) =>
		result?.outcome === 'ready'
			? { profileId: result.profileId, organizationId: result.organizationId }
			: undefined
	)
	const recipient = createActor(
		fromTransition(
			(events: InitializationStatusEvent[], event: InitializationStatusEvent) => [...events, event],
			[]
		)
	).start()
	actors.add(recipient)
	const request: InitializationRequest = { status: 'ready', userId, generation: 1 }
	type Control = { type: 'CANCEL' } | { type: 'SHUTDOWN' }
	const initializeLeaf = fromPromise(({ input }: { input: Parameters<typeof initialize>[0] }) =>
		initialize(input)
	)
	const initializeMachine = setup<
		{ input: Parameters<typeof initialize>[0]; result: Result },
		Control,
		{ leaf: typeof initializeLeaf },
		{},
		{},
		{},
		never,
		string,
		Parameters<typeof initialize>[0],
		Result
	>({ actors: { leaf: initializeLeaf } }).createMachine({
		initial: 'pending',
		context: ({ input }) => ({ input, result: { outcome: 'failed' } }),
		output: ({ context }) => context.result,
		states: {
			pending: {
				invoke: {
					src: 'leaf',
					input: ({ context }) => context.input,
					onDone: { target: 'done', actions: assign({ result: ({ event }) => event.output }) }
				}
			},
			done: { type: 'final' }
		}
	})
	const seedLeaf = fromPromise(({ input }: { input: Parameters<typeof seed>[0] }) => seed(input))
	const seedMachine = setup<
		{ input: Parameters<typeof seed>[0] },
		Control,
		{ leaf: typeof seedLeaf },
		{},
		{},
		{},
		never,
		string,
		Parameters<typeof seed>[0],
		undefined
	>({ actors: { leaf: seedLeaf } }).createMachine({
		initial: 'pending',
		context: ({ input }) => ({ input }),
		output: () => undefined,
		states: {
			pending: { invoke: { src: 'leaf', input: ({ context }) => context.input, onDone: 'done' } },
			done: { type: 'final' }
		}
	})
	const machine = createWorkspaceStartupMachine({
		db,
		initialize: initializeMachine,
		seed: seedMachine,
		ready,
		initializationFailure: (): Result => ({ outcome: 'failed' }),
		seedFailure: () => undefined
	})
	const actor = createActor(machine, { input: { request, recipient } })
	actors.add(actor)
	return { actor, request, recipient, initialized, seeded, initialize, seed, ready }
}
describe('startup admission and captured provenance', () => {
	it.each([undefined, ''])(
		'waits without invoking initialization for identity %s',
		async (identity) => {
			const f = fixture(identity)
			f.actor.start()
			expect(f.actor.getSnapshot().matches('waitingForSession')).toBe(true)
			expect(f.initialize).not.toHaveBeenCalled()
			expect(f.seed).not.toHaveBeenCalled()
		}
	)
	it('captures the ready projection once for reporting and seeding', async () => {
		const f = fixture('member')
		f.actor.start()
		f.initialized.resolve({ outcome: 'ready', profileId: 'profile', organizationId: 'workspace' })
		await vi.waitFor(() => expect(f.seed).toHaveBeenCalledOnce())
		expect(f.ready).toHaveBeenCalledOnce()
		expect(f.seed.mock.calls[0]?.[0]).toMatchObject({
			userId: 'member',
			organizationId: 'workspace'
		})
		expect(f.recipient.getSnapshot().context.at(-1)?.report.status).toEqual({
			kind: 'ready',
			profileId: 'profile'
		})
		f.seeded.resolve()
		await waitFor(f.actor, (s) => s.matches({ ready: 'settled' }))
	})
	it('reports failed instead of seeding missing initialization provenance', async () => {
		const f = fixture('member')
		f.actor.start()
		f.initialized.resolve({ outcome: 'ready', profileId: 'profile', organizationId: '' })
		await waitFor(f.actor, (s) => s.matches('failed'))
		expect(f.actor.getSnapshot().status).toBe('active')
		expect(f.seed).not.toHaveBeenCalled()
		expect(f.recipient.getSnapshot().context.at(-1)?.report.status).toEqual({ kind: 'failed' })
	})
	it('drains optional seeding before shutdown completes', async () => {
		const f = fixture('member')
		f.actor.start()
		f.initialized.resolve({ outcome: 'ready', profileId: 'profile', organizationId: 'workspace' })
		await vi.waitFor(() => expect(f.seed).toHaveBeenCalledOnce())
		f.actor.send({ type: 'SHUTDOWN' })
		expect(f.actor.getSnapshot().status).toBe('active')
		f.seeded.resolve()
		await waitFor(f.actor, (s) => s.status === 'done')
		expect(f.recipient.getSnapshot().context.at(-1)?.report.status).toEqual({ kind: 'closed' })
	})
})
