import { afterEach, describe, expect, it, vi } from 'vitest'
import {
	createActor,
	createAsyncLogic,
	createStepLogic,
	setup,
	toPromise,
	types,
	waitFor,
	type SnapshotFrom
} from 'xstate'
import * as fc from 'fast-check'
import { createWorkspaceStartupOwner } from './startup.js'
import type { WorkspaceInitializationReport } from '../../contracts/workspace-startup.js'
import { deferred } from '../../../../tests/helpers/deferred.js'

type Input = { userId: string }
type Result =
	| { outcome: 'ready'; identityId: string; workspaceId: string }
	| { outcome: 'unavailable'; reason: 'authorityUnavailable' }
	| { outcome: 'failed'; settlement: 'notStarted' | 'rejected' | 'unresolved' }
	| {
			outcome: 'closed'
			settlement:
				| 'notStarted'
				| 'locallyPersisted'
				| 'authorityAccepted'
				| 'rejected'
				| 'unresolved'
	  }
type Report = WorkspaceInitializationReport<Result>
const actors = new Set<{ stop(): void }>()
afterEach(() => {
	for (const actor of actors) actor.stop()
	actors.clear()
})

function fixture() {
	const completion = deferred<Result>()
	const initialize = vi.fn((_input: Input) => completion.promise)
	const shutdown = vi.fn()
	const work = createAsyncLogic({ run: ({ input }: { input: Input }) => initialize(input) })
	const child = setup({
		schemas: {
			input: types<Input>(),
			context: types<{ input: Input; result: Result }>(),
			events: { CANCEL: types(), SHUTDOWN: types() },
			output: types<Result>()
		},
		actors: { work }
	}).createMachine({
		context: ({ input }) => ({ input, result: { outcome: 'closed', settlement: 'notStarted' } }),
		initial: 'working',
		output: ({ context }) => context.result,
		states: {
			working: {
				on: { SHUTDOWN: (_, enq) => enq(() => shutdown()) },
				invoke: {
					src: 'work',
					input: ({ context }) => context.input,
					onDone: ({ event }) => ({ target: 'done', context: { result: event.output } })
				}
			},
			done: { type: 'final' }
		}
	})
	const provenance = vi.fn((result: Result) =>
		result.outcome === 'ready'
			? { identityId: result.identityId, initialWorkspaceId: result.workspaceId }
			: undefined
	)
	const recipient = createActor(
		createStepLogic({
			context: (): Report[] => [],
			run: ({ context, event }: { context: Report[]; event: Report }) => ({
				context: event.type === 'WORKSPACE_INITIALIZATION_RESULT' ? [...context, event] : context
			})
		})
	).start()
	const binding = Object.freeze({})
	const owner = createWorkspaceStartupOwner<Input, Result, SnapshotFrom<typeof child>>({
		initialize: child,
		provenance
	})
	const actor = createActor(owner, {
		input: { binding, initialization: { userId: 'user' }, recipient }
	}).start()
	actors.add(actor)
	actors.add(recipient)
	return {
		actor,
		recipient,
		binding,
		initialize,
		shutdown,
		completion,
		provenance,
		reports: () => recipient.getSnapshot().context
	}
}

describe('fixed-binding workspace startup', () => {
	it('publishes one correlated result and neutral provenance without acknowledging shutdown', async () => {
		const f = fixture()
		const result: Result = { outcome: 'ready', identityId: 'profile', workspaceId: 'workspace' }
		expect(f.initialize).toHaveBeenCalledExactlyOnceWith({ userId: 'user' })
		expect(f.reports()).toEqual([])
		f.completion.resolve(result)
		await waitFor(f.recipient, (snapshot) => snapshot.context.length === 1)
		expect(f.reports()).toEqual([
			{
				type: 'WORKSPACE_INITIALIZATION_RESULT',
				binding: f.binding,
				initialization: result,
				provenance: { identityId: 'profile', initialWorkspaceId: 'workspace' }
			}
		])
		expect(f.reports()[0]?.binding).toBe(f.binding)
		expect(f.provenance).toHaveBeenCalledExactlyOnceWith(result)
		expect(f.actor.getSnapshot().status).toBe('active')
		f.actor.send({ type: 'SHUTDOWN' })
		expect(await toPromise(f.actor)).toEqual({
			outcome: 'closed',
			initialization: result,
			provenance: { identityId: 'profile', initialWorkspaceId: 'workspace' }
		})
		expect(f.reports()).toHaveLength(1)
		expect(f.shutdown).not.toHaveBeenCalled()
	})

	it.each<Result>([
		{ outcome: 'unavailable', reason: 'authorityUnavailable' },
		{ outcome: 'failed', settlement: 'notStarted' },
		{ outcome: 'failed', settlement: 'rejected' },
		{ outcome: 'closed', settlement: 'authorityAccepted' }
	])('retains $outcome independently of workspace usability', async (result) => {
		const f = fixture()
		f.completion.resolve(result)
		await waitFor(f.recipient, (snapshot) => snapshot.context.length === 1)
		expect(f.reports()[0]?.initialization).toEqual(result)
		expect(f.reports()[0]?.provenance).toBeUndefined()
		expect(f.actor.getSnapshot().status).toBe('active')
		f.actor.send({ type: 'SHUTDOWN' })
		expect(await toPromise(f.actor)).toEqual({
			outcome: 'closed',
			initialization: result,
			provenance: undefined
		})
	})

	it('drains once and suppresses a late ready report after shutdown', async () => {
		const f = fixture()
		f.actor.send({ type: 'SHUTDOWN' })
		f.actor.send({ type: 'SHUTDOWN' })
		expect(f.shutdown).toHaveBeenCalledOnce()
		expect(f.actor.getSnapshot().status).toBe('active')
		expect(f.reports()).toEqual([])
		const result: Result = { outcome: 'ready', identityId: 'old-profile', workspaceId: 'old-root' }
		f.completion.resolve(result)
		expect(await toPromise(f.actor)).toEqual({
			outcome: 'closed',
			initialization: result,
			provenance: undefined
		})
		expect(f.reports()).toEqual([])
		expect(f.provenance).not.toHaveBeenCalled()
	})

	it.each([false, true])(
		'refuses safe release for unresolved settlement with early shutdown=%s',
		async (early) => {
			const f = fixture()
			const result: Result = { outcome: 'failed', settlement: 'unresolved' }
			if (early) f.actor.send({ type: 'SHUTDOWN' })
			f.completion.resolve(result)
			if (!early) {
				await waitFor(f.recipient, (snapshot) => snapshot.context.length === 1)
				f.actor.send({ type: 'SHUTDOWN' })
			}
			expect(await toPromise(f.actor)).toEqual({
				outcome: 'unresolved',
				initialization: result,
				provenance: undefined
			})
			expect(f.reports()).toHaveLength(early ? 0 : 1)
		}
	)

	it.each([false, true])(
		'classifies child failure as unresolved with early shutdown=%s',
		async (early) => {
			const f = fixture()
			if (early) f.actor.send({ type: 'SHUTDOWN' })
			f.completion.reject(new Error('Initialization failed'))
			expect(await toPromise(f.actor)).toEqual({
				outcome: 'unresolved',
				initialization: undefined,
				provenance: undefined
			})
			expect(f.reports()).toEqual([])
		}
	)

	it('retains original binding ownership while another startup completes', async () => {
		const original = fixture()
		const replacement = fixture()
		original.actor.send({ type: 'SHUTDOWN' })
		replacement.completion.resolve({ outcome: 'ready', identityId: 'new', workspaceId: 'new-root' })
		await waitFor(replacement.recipient, (snapshot) => snapshot.context.length === 1)
		original.completion.resolve({ outcome: 'ready', identityId: 'old', workspaceId: 'old-root' })
		expect((await toPromise(original.actor)).outcome).toBe('closed')
		expect(original.reports()).toEqual([])
		expect(replacement.reports()[0]?.binding).toBe(replacement.binding)
		expect(replacement.reports()[0]?.provenance?.initialWorkspaceId).toBe('new-root')
		replacement.actor.send({ type: 'SHUTDOWN' })
		expect((await toPromise(replacement.actor)).outcome).toBe('closed')
	})

	it('preserves settlement across generated completion/shutdown schedules', async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.boolean(),
				fc.boolean(),
				fc.integer({ min: 1, max: 5 }),
				async (early, unknown, repeats) => {
					const f = fixture()
					try {
						const result: Result = {
							outcome: 'closed',
							settlement: unknown ? 'unresolved' : 'locallyPersisted'
						}
						if (early)
							for (let index = 0; index < repeats; index++) f.actor.send({ type: 'SHUTDOWN' })
						f.completion.resolve(result)
						if (!early) {
							await waitFor(f.recipient, (snapshot) => snapshot.context.length === 1)
							f.actor.send({ type: 'SHUTDOWN' })
						}
						expect((await toPromise(f.actor)).outcome).toBe(unknown ? 'unresolved' : 'closed')
						expect(f.reports()).toHaveLength(early ? 0 : 1)
						expect(f.initialize).toHaveBeenCalledOnce()
						expect(f.shutdown).toHaveBeenCalledTimes(early ? 1 : 0)
					} finally {
						f.actor.stop()
						f.recipient.stop()
						actors.delete(f.actor)
						actors.delete(f.recipient)
					}
				}
			),
			{ seed: 20261124, numRuns: 100 }
		)
	})
})
