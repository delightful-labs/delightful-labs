import type { EventPayload } from '../../contracts/machine-events.js'
import { deferred } from '../../../../tests/helpers/deferred.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
	createActor,
	setup,
	toPromise,
	waitFor,
	type InspectionEvent,
	type SnapshotFrom,
	createAsyncLogic,
	types
} from 'xstate'
import {
	createWorkspaceCreationOwner,
	type CreationRequest,
	type CreationResult
} from './creation-owner.js'
import {
	createWorkspaceCreationOperation,
	type CreationJournalInput,
	type CreationPersistenceResult,
	type CreationReconciliation
} from './creation-operation.js'
import { createWorkspacePersistence } from './creation-persistence.js'
import { createWorkspaceInitialization } from './initialization.js'
import type { WorkspaceJournalResult, WorkspaceJournalEvent } from './journal.js'

type Record = { key: string; attempt: { notebookId: string; member: string } }
type Workspace = { notebookId: string }
type Result = CreationResult<Record, Workspace>
type Persistence = CreationPersistenceResult<Workspace>
const binding = { key: 'notebook/member-a' }
const record: Record = { key: binding.key, attempt: { notebookId: 'stable-attempt', member: 'a' } }
const workspace: Workspace = { notebookId: record.attempt.notebookId }
const actors = new Set<{ stop(): void }>()
afterEach(() => {
	for (const actor of actors) actor.stop()
	actors.clear()
})
function tracked<T extends { stop(): void }>(actor: T): T {
	actors.add(actor)
	return actor
}
function observeCommands(events: string[], id: string) {
	return (inspection: InspectionEvent) => {
		if (
			inspection.type === '@xstate.transition' &&
			'id' in inspection.actorRef &&
			inspection.actorRef.id === id &&
			(inspection.event.type === 'CANCEL' || inspection.event.type === 'SHUTDOWN')
		)
			events.push(inspection.event.type)
	}
}
// A controlled child owns its pending leaf until completion; interruption is observed without exiting.
function child<T extends object, Input extends object>(run: (input: Input) => Promise<T>) {
	const settle = createAsyncLogic<T, { input: Input }>({ run: ({ input }) => run(input.input) })
	return setup({
		schemas: {
			context: types<{ work: { input: Input; result: { value: T } | undefined } }>(),
			events: { CANCEL: types<{}>(), SHUTDOWN: types<{}>() },
			input: types<Input>()
		},
		actors: { settle }
	}).createMachine({
		context: ({ input }) => ({ work: { input, result: undefined } }),
		initial: 'pending',
		output: ({ context }): T => {
			if (context.work.result === undefined) throw new Error('Missing child result')
			return context.work.result.value
		},
		states: {
			pending: {
				invoke: {
					src: 'settle',
					input: ({ context }) => ({ input: context.work.input }),
					onDone: (args) => {
						return {
							target: 'done',
							context: { work: { ...args.context.work, result: { value: args.event.output } } }
						}
					},
					onError: (args, enq) => {
						enq(() => {
							throw args.event.error
						})
					}
				}
			},
			done: { type: 'final' }
		}
	})
}
function journalChild<T extends object, Input extends object>(run: (input: Input) => Promise<T>) {
	const settle = createAsyncLogic<T, { input: Input }>({ run: ({ input }) => run(input.input) })
	return setup({
		schemas: {
			context: types<{ work: { input: Input; result: { value: T } | undefined } }>(),
			events: {
				OPENED: types<EventPayload<WorkspaceJournalEvent, 'OPENED'>>(),
				CLOSED: types<EventPayload<WorkspaceJournalEvent, 'CLOSED'>>(),
				ACQUIRED: types<EventPayload<WorkspaceJournalEvent, 'ACQUIRED'>>(),
				OPEN_FAILED: types<EventPayload<WorkspaceJournalEvent, 'OPEN_FAILED'>>(),
				ACQUIRE_FAILED: types<EventPayload<WorkspaceJournalEvent, 'ACQUIRE_FAILED'>>(),
				CLOSE_FAILED: types<EventPayload<WorkspaceJournalEvent, 'CLOSE_FAILED'>>(),
				CANCEL: types<EventPayload<WorkspaceJournalEvent, 'CANCEL'>>(),
				SHUTDOWN: types<EventPayload<WorkspaceJournalEvent, 'SHUTDOWN'>>(),
				TX_COMPLETE: types<EventPayload<WorkspaceJournalEvent, 'TX_COMPLETE'>>(),
				TX_ABORTED: types<EventPayload<WorkspaceJournalEvent, 'TX_ABORTED'>>(),
				RECORD: types<EventPayload<WorkspaceJournalEvent, 'RECORD'>>(),
				TX_FAILED: types<EventPayload<WorkspaceJournalEvent, 'TX_FAILED'>>()
			},
			input: types<Input>()
		},
		actors: { settle }
	}).createMachine({
		context: ({ input }) => ({ work: { input, result: undefined } }),
		initial: 'pending',
		output: ({ context }): T => {
			if (context.work.result === undefined) throw new Error('Missing child result')
			return context.work.result.value
		},
		states: {
			pending: {
				invoke: {
					src: 'settle',
					input: ({ context }) => ({ input: context.work.input }),
					onDone: (args) => {
						return {
							target: 'done',
							context: { work: { ...args.context.work, result: { value: args.event.output } } }
						}
					},
					onError: (args, enq) => {
						enq(() => {
							throw args.event.error
						})
					}
				}
			},
			done: { type: 'final' }
		}
	})
}
function checkChild<T extends object, Input extends object>(run: (input: Input) => Promise<T>) {
	const settle = createAsyncLogic<T, { input: Input }>({ run: ({ input }) => run(input.input) })
	return setup({
		schemas: {
			context: types<{ work: { input: Input; result: { value: T } | undefined } }>(),
			events: { CHECK: types<{}>() },
			input: types<Input>()
		},
		actors: { settle }
	}).createMachine({
		context: ({ input }) => ({ work: { input, result: undefined } }),
		initial: 'pending',
		output: ({ context }): T => {
			if (context.work.result === undefined) throw new Error('Missing child result')
			return context.work.result.value
		},
		states: {
			pending: {
				invoke: {
					src: 'settle',
					input: ({ context }) => ({ input: context.work.input }),
					onDone: (args) => {
						return {
							target: 'done',
							context: { work: { ...args.context.work, result: { value: args.event.output } } }
						}
					},
					onError: (args, enq) => {
						enq(() => {
							throw args.event.error
						})
					}
				}
			},
			done: { type: 'final' }
		}
	})
}
function operationFixture(
	options: {
		read?: () => Promise<WorkspaceJournalResult<Record>>
		reconciliation?: () => Promise<CreationReconciliation<Workspace>>
		persistence?: () => Promise<Persistence>
		prepare?: () => Promise<Record>
	} = {}
) {
	const journalRead = vi.fn<() => Promise<WorkspaceJournalResult<Record>>>(
		options.read ?? (() => Promise.resolve({ outcome: 'succeeded', record }))
	)
	const journal = journalChild<WorkspaceJournalResult<Record>, CreationJournalInput<Record>>(
		(input) => {
			if (input.mode === 'read') return journalRead()
			return Promise.resolve<WorkspaceJournalResult<Record>>({
				outcome: 'succeeded',
				record: input.mode === 'write' ? input.record : undefined
			})
		}
	)
	const reconcile = checkChild<
		CreationReconciliation<Workspace>,
		{ db: object; attempt: Record['attempt'] }
	>(() => options.reconciliation?.() ?? Promise.resolve({ outcome: 'absent' }))
	const persistCall = vi.fn(
		(_input: { attempt: Record['attempt'] }) =>
			options.persistence?.() ??
			Promise.resolve<Persistence>({
				outcome: 'succeeded',
				settlement: 'locallyPersisted',
				workspace
			})
	)
	const transaction = child(persistCall)
	const persist = createWorkspacePersistence<
		object,
		Record['attempt'],
		Workspace,
		SnapshotFrom<typeof reconcile>,
		SnapshotFrom<typeof transaction>
	>({ db: {}, validate: (attempt) => Promise.resolve(attempt), reconcile, transaction })
	const machine = createWorkspaceCreationOperation<
		object,
		Workspace,
		Record,
		SnapshotFrom<typeof journal>,
		SnapshotFrom<typeof reconcile>,
		SnapshotFrom<typeof persist>
	>({
		db: {},
		journal,
		reconcile,
		persist,
		validate: (name) => Promise.resolve(name.trim()),
		prepare: options.prepare ?? (() => Promise.resolve(record)),
		matchesBinding: (candidate) => candidate.attempt.member === 'a',
		attemptId: (candidate) => candidate.attempt.notebookId
	})
	const start = (request: CreationRequest<Record>, inspect?: (event: InspectionEvent) => void) =>
		tracked(
			createActor(machine, { input: { binding, request }, ...(inspect ? { inspect } : {}) })
		).start()
	return { start, persistCall, journalRead }
}
function persistenceFixture(
	reconcileRead: () => Promise<CreationReconciliation<Workspace>>,
	commit: () => Promise<Persistence> = () =>
		Promise.resolve({ outcome: 'succeeded', settlement: 'locallyPersisted', workspace })
) {
	const reconcile = checkChild<
		CreationReconciliation<Workspace>,
		{ db: object; attempt: Record['attempt'] }
	>(reconcileRead)
	const commitCall = vi.fn(commit),
		events: string[] = []
	const transaction = child<Persistence, { attempt: Record['attempt'] }>(commitCall)
	const machine = createWorkspacePersistence<
		object,
		Record['attempt'],
		Workspace,
		SnapshotFrom<typeof reconcile>,
		SnapshotFrom<typeof transaction>
	>({ db: {}, validate: (attempt) => Promise.resolve(attempt), reconcile, transaction })
	const start = (issuance: 'new' | 'unknown') =>
		tracked(
			createActor(machine, {
				input: { attempt: record.attempt, issuance },
				inspect: observeCommands(events, 'transaction')
			})
		).start()
	return { start, commitCall, events }
}

describe('creation owner retains recovery through drain', () => {
	it.each(['replace', 'shutdown'])(
		'retains unresolved child completion during %s',
		async (mode) => {
			const gate = deferred<Result>(),
				events: string[] = []
			const started = vi.fn(
				(_input: { binding: { key: string }; request: CreationRequest<Record> }) => gate.promise
			)
			const operation = child<
				Result,
				{ binding: { key: string }; request: CreationRequest<Record> }
			>(started)
			const owner = tracked(
				createActor(
					createWorkspaceCreationOwner<Record, Workspace, SnapshotFrom<typeof operation>>(
						operation
					),
					{ input: { binding }, inspect: observeCommands(events, 'operation') }
				)
			).start()
			await vi.waitFor(() => expect(started).toHaveBeenCalledOnce())
			const original = owner.getSnapshot().children.operation
			if (mode === 'replace')
				owner.send({ type: 'OBSERVED', binding: { key: 'notebook/member-b' } })
			else owner.send({ type: 'SHUTDOWN' })
			expect(events).toEqual(['SHUTDOWN'])
			expect(owner.getSnapshot().children.operation).toBe(original)
			gate.resolve({ outcome: 'closed', record, settlement: 'unresolved' })
			await waitFor(owner, (snapshot) => snapshot.matches('unresolved'))
			expect(owner.getSnapshot().context).toMatchObject({
				operation: binding,
				record,
				result: { settlement: 'unresolved' }
			})
			owner.send({ type: 'OBSERVED', binding: { key: 'notebook/member-c' } })
			owner.send({ type: 'SHUTDOWN' })
			owner.send({ type: 'RETRY' })
			expect(owner.getSnapshot().matches('unresolved')).toBe(true)
			expect(started).toHaveBeenCalledOnce()
			owner.send({ type: 'OBSERVED', binding })
			owner.send({ type: 'RETRY' })
			await vi.waitFor(() => expect(started).toHaveBeenCalledTimes(2))
			expect(started.mock.calls[1]?.[0]).toEqual({
				binding,
				request: { mode: 'retry', record, settlement: 'unresolved' }
			})
		}
	)
	it.each(['replace', 'shutdown'])(
		'retains a child crash during %s and can reload its original journal',
		async (mode) => {
			const gate = deferred<Result>(),
				error = new Error('child crashed')
			const started = vi.fn(
				(_input: { binding: { key: string }; request: CreationRequest<Record> }) => gate.promise
			)
			const operation = child<
				Result,
				{ binding: { key: string }; request: CreationRequest<Record> }
			>(started)
			const owner = tracked(
				createActor(
					createWorkspaceCreationOwner<Record, Workspace, SnapshotFrom<typeof operation>>(
						operation
					),
					{ input: { binding } }
				)
			).start()
			await vi.waitFor(() => expect(started).toHaveBeenCalledOnce())
			if (mode === 'replace') owner.send({ type: 'OBSERVED', binding: { key: 'other' } })
			else owner.send({ type: 'SHUTDOWN' })
			gate.reject(error)
			await waitFor(owner, (snapshot) => snapshot.matches('unresolved'))
			expect(owner.getSnapshot().context.result).toMatchObject({
				outcome: 'unresolved',
				settlement: 'unresolved',
				error
			})
			expect(owner.getSnapshot().context.bindingState.operation).toEqual(binding)
			owner.send({ type: 'OBSERVED', binding })
			owner.send({ type: 'RETRY' })
			await vi.waitFor(() => expect(started).toHaveBeenCalledTimes(2))
			expect(started.mock.calls[1]?.[0]).toEqual({ binding, request: { mode: 'load' } })
		}
	)
	it('reports a known completed write on shutdown without losing its binding', async () => {
		const gate = deferred<Result>(),
			started = vi.fn(() => gate.promise)
		const operation = child<Result, { binding: { key: string }; request: CreationRequest<Record> }>(
			started
		)
		const owner = tracked(
			createActor(
				createWorkspaceCreationOwner<Record, Workspace, SnapshotFrom<typeof operation>>(operation),
				{ input: { binding } }
			)
		).start()
		await vi.waitFor(() => expect(started).toHaveBeenCalledOnce())
		owner.send({ type: 'SHUTDOWN' })
		gate.resolve({ outcome: 'complete', record, workspace, settlement: 'locallyPersisted' })
		expect(await toPromise(owner)).toMatchObject({
			binding,
			result: { outcome: 'complete', record, workspace, settlement: 'locallyPersisted' }
		})
	})
	it('starts the replacement binding after a known settlement', async () => {
		const first = deferred<Result>(),
			next = deferred<Result>()
		const replacement = { key: 'notebook/member-b' }
		const started = vi.fn((input: { binding: { key: string }; request: CreationRequest<Record> }) =>
			input.binding.key === binding.key ? first.promise : next.promise
		)
		const operation = child(started)
		const owner = tracked(
			createActor(
				createWorkspaceCreationOwner<Record, Workspace, SnapshotFrom<typeof operation>>(operation),
				{ input: { binding } }
			)
		).start()
		await vi.waitFor(() => expect(started).toHaveBeenCalledOnce())
		owner.send({ type: 'OBSERVED', binding: replacement })
		first.resolve({ outcome: 'closed', record, settlement: 'locallyPersisted' })
		await vi.waitFor(() => expect(started).toHaveBeenCalledTimes(2))
		expect(started.mock.calls[1]?.[0]).toEqual({ binding: replacement, request: { mode: 'load' } })
		next.resolve({ outcome: 'editing', record: undefined, settlement: 'notStarted' })
		await waitFor(owner, (snapshot) => snapshot.matches('editing'))
	})
	it('retries a known not-started attempt with its evidence and stable record', async () => {
		const started = vi.fn(
			(_input: { binding: { key: string }; request: CreationRequest<Record> }) =>
				Promise.resolve<Result>({ outcome: 'recovered', record, settlement: 'notStarted' })
		)
		const operation = child(started)
		const owner = tracked(
			createActor(
				createWorkspaceCreationOwner<Record, Workspace, SnapshotFrom<typeof operation>>(operation),
				{ input: { binding } }
			)
		).start()
		await waitFor(owner, (snapshot) => snapshot.matches('recovered'))
		owner.send({ type: 'RETRY' })
		await vi.waitFor(() => expect(started).toHaveBeenCalledTimes(2))
		expect(started.mock.calls[1]?.[0].request).toEqual({
			mode: 'retry',
			record,
			settlement: 'notStarted'
		})
	})
})

describe('operation settlement is reflected in state, context and output', () => {
	it.each(['load', 'retry'])('does not replay an absent %s attempt', async (mode) => {
		const fixture = operationFixture()
		const actor = fixture.start(
			mode === 'load' ? { mode } : { mode: 'retry', record, settlement: 'unresolved' }
		)
		const result = await toPromise(actor)
		expect(result).toMatchObject({ outcome: 'unresolved', record, settlement: 'unresolved' })
		expect(actor.getSnapshot().value).toBe('unresolved')
		expect(actor.getSnapshot().context.result).toEqual(result)
		expect(fixture.persistCall).not.toHaveBeenCalled()
	})
	it.each(['create', 'retry'])('passes fresh issuance for known not-started %s', async (mode) => {
		const fixture = operationFixture()
		const actor = fixture.start(
			mode === 'create'
				? { mode, name: 'notes' }
				: { mode: 'retry', record, settlement: 'notStarted' }
		)
		expect(await toPromise(actor)).toEqual({
			outcome: 'complete',
			record,
			workspace,
			settlement: 'locallyPersisted'
		})
		expect(fixture.persistCall).toHaveBeenCalledWith(
			expect.objectContaining({ attempt: record.attempt, issuance: 'new' })
		)
	})
	it('accepts conclusive notStarted recovery without issuing a write', async () => {
		const fixture = operationFixture({
			reconciliation: () => Promise.resolve({ outcome: 'notStarted' })
		})
		const actor = fixture.start({ mode: 'load' })
		expect(await toPromise(actor)).toEqual({
			outcome: 'recovered',
			record,
			settlement: 'notStarted'
		})
		expect(actor.getSnapshot().value).toBe('recovered')
		expect(fixture.persistCall).not.toHaveBeenCalled()
	})
	it.each(['CANCEL', 'SHUTDOWN'])('retains a matching completed read through %s', async (type) => {
		const gate = deferred<CreationReconciliation<Workspace>>()
		const fixture = operationFixture({ reconciliation: () => gate.promise })
		const actor = fixture.start({ mode: 'load' })
		await waitFor(actor, (snapshot) => snapshot.matches({ running: { work: 'reconciling' } }))
		actor.send({ type: type === 'CANCEL' ? 'CANCEL' : 'SHUTDOWN' })
		gate.resolve({ outcome: 'matching', workspace })
		const result = await toPromise(actor)
		expect(result).toEqual({
			outcome: type === 'CANCEL' ? 'cancelled' : 'closed',
			record,
			settlement: 'locallyPersisted'
		})
		expect(actor.getSnapshot().context.result).toEqual(result)
		expect(actor.getSnapshot().value).toBe(result.outcome)
		expect(fixture.persistCall).not.toHaveBeenCalled()
	})
	it.each(['CANCEL', 'SHUTDOWN'])(
		'retains a late recovered record and unknown fate through %s',
		async (type) => {
			const gate = deferred<WorkspaceJournalResult<Record>>()
			const fixture = operationFixture({ read: () => gate.promise })
			const actor = fixture.start({ mode: 'load' })
			await vi.waitFor(() => expect(fixture.journalRead).toHaveBeenCalledOnce())
			actor.send({ type: type === 'CANCEL' ? 'CANCEL' : 'SHUTDOWN' })
			gate.resolve({ outcome: 'succeeded', record })
			const result = await toPromise(actor)
			expect(result).toEqual({
				outcome: type === 'CANCEL' ? 'cancelled' : 'closed',
				record,
				settlement: 'unresolved'
			})
			expect(actor.getSnapshot().context.result).toEqual(result)
			expect(actor.getSnapshot().value).toBe(result.outcome)
		}
	)
	it('preserves a reconciliation failure rather than returning a notStarted failure after recovery', async () => {
		const error = new Error('offline read failed')
		const fixture = operationFixture({ reconciliation: () => Promise.reject(error) })
		const actor = fixture.start({ mode: 'load' })
		expect(await toPromise(actor)).toEqual({
			outcome: 'unresolved',
			record,
			settlement: 'unresolved',
			error
		})
		expect(actor.getSnapshot().context.result.outcome).toBe('unresolved')
	})
	it.each(['notStarted', 'locallyPersisted', 'unresolved'])(
		'keeps %s from a drained persistence child during cancellation',
		async (settlement) => {
			const gate = deferred<Persistence>()
			const fixture = operationFixture({ persistence: () => gate.promise })
			const actor = fixture.start({ mode: 'create', name: 'notes' })
			await vi.waitFor(() => expect(fixture.persistCall).toHaveBeenCalledOnce())
			const effect = actor.getSnapshot().children.effect
			actor.send({ type: 'CANCEL' })
			expect(actor.getSnapshot().status).toBe('active')
			expect(actor.getSnapshot().children.effect).toBe(effect)
			const reported =
				settlement === 'notStarted'
					? 'notStarted'
					: settlement === 'locallyPersisted'
						? 'locallyPersisted'
						: 'unresolved'
			gate.resolve({ outcome: 'cancelled', settlement: reported })
			const result = await toPromise(actor)
			expect(result).toEqual({ outcome: 'cancelled', record, settlement: reported })
			expect(actor.getSnapshot().context.result).toEqual(result)
			expect(actor.getSnapshot().value).toBe('cancelled')
			expect(fixture.persistCall).toHaveBeenCalledOnce()
		}
	)
	it('keeps a fresh attempt cancelled before issuance retryable', async () => {
		const gate = deferred<Record>()
		const fixture = operationFixture({ prepare: () => gate.promise })
		const actor = fixture.start({ mode: 'create', name: 'notes' })
		await waitFor(actor, (snapshot) => snapshot.matches({ running: { work: 'preparing' } }))
		actor.send({ type: 'CANCEL' })
		gate.resolve(record)
		expect(await toPromise(actor)).toEqual({
			outcome: 'cancelled',
			record,
			settlement: 'notStarted'
		})
		expect(fixture.persistCall).not.toHaveBeenCalled()
	})
})

describe('persistence requires issuance evidence and drains the transaction', () => {
	it.each(['new', 'unknown'])('handles local absence with %s issuance', async (issuance) => {
		const fixture = persistenceFixture(() => Promise.resolve({ outcome: 'absent' }))
		const actor = fixture.start(issuance === 'new' ? 'new' : 'unknown')
		const result = await toPromise(actor)
		expect(result).toMatchObject(
			issuance === 'new'
				? { outcome: 'succeeded', settlement: 'locallyPersisted', workspace }
				: { outcome: 'failed', settlement: 'unresolved' }
		)
		expect(fixture.commitCall).toHaveBeenCalledTimes(issuance === 'new' ? 1 : 0)
		expect(actor.getSnapshot().context.result).toEqual(result)
	})
	it('allows a conclusive notStarted reconciliation to authorize one transaction', async () => {
		const fixture = persistenceFixture(() => Promise.resolve({ outcome: 'notStarted' }))
		expect(await toPromise(fixture.start('unknown'))).toEqual({
			outcome: 'succeeded',
			settlement: 'locallyPersisted',
			workspace
		})
		expect(fixture.commitCall).toHaveBeenCalledOnce()
	})
	it('returns a verified matching workspace without replay', async () => {
		const fixture = persistenceFixture(() => Promise.resolve({ outcome: 'matching', workspace }))
		expect(await toPromise(fixture.start('unknown'))).toEqual({
			outcome: 'succeeded',
			settlement: 'locallyPersisted',
			workspace
		})
		expect(fixture.commitCall).not.toHaveBeenCalled()
	})
	it.each(['CANCEL', 'SHUTDOWN'])(
		'keeps unknown issuance on %s before a transaction',
		async (type) => {
			const gate = deferred<CreationReconciliation<Workspace>>()
			const fixture = persistenceFixture(() => gate.promise)
			const actor = fixture.start('unknown')
			await waitFor(actor, (snapshot) => snapshot.matches('reconciling'))
			actor.send({ type: type === 'CANCEL' ? 'CANCEL' : 'SHUTDOWN' })
			const result = await toPromise(actor)
			expect(result).toEqual({
				outcome: type === 'CANCEL' ? 'cancelled' : 'closed',
				settlement: 'unresolved'
			})
			expect(actor.getSnapshot().context.result).toEqual(result)
			gate.resolve({ outcome: 'absent' })
			expect(fixture.commitCall).not.toHaveBeenCalled()
		}
	)
	it.each(['CANCEL', 'SHUTDOWN'])('drains the same issued transaction through %s', async (type) => {
		const gate = deferred<Persistence>()
		const fixture = persistenceFixture(
			() => Promise.resolve({ outcome: 'absent' }),
			() => gate.promise
		)
		const actor = fixture.start('new')
		await vi.waitFor(() => expect(fixture.commitCall).toHaveBeenCalledOnce())
		const transaction = actor.getSnapshot().children.transaction
		actor.send({ type: type === 'CANCEL' ? 'CANCEL' : 'SHUTDOWN' })
		expect(actor.getSnapshot().status).toBe('active')
		expect(actor.getSnapshot().children.transaction).toBe(transaction)
		expect(fixture.events).toEqual([type])
		gate.resolve({
			outcome: 'failed',
			settlement: 'unresolved',
			error: new Error('commit unknown')
		})
		expect(await toPromise(actor)).toMatchObject({ outcome: 'failed', settlement: 'unresolved' })
		expect(actor.getSnapshot().value).toBe('failed')
		expect(fixture.commitCall).toHaveBeenCalledOnce()
	})
	it('keeps read failure unresolved for an unknown prior write', async () => {
		const fixture = persistenceFixture(() => Promise.reject(new Error('read failed')))
		const actor = fixture.start('unknown')
		const result = await toPromise(actor)
		expect(result).toMatchObject({ outcome: 'failed', settlement: 'unresolved' })
		expect(actor.getSnapshot().context.result).toEqual(result)
		expect(fixture.commitCall).not.toHaveBeenCalled()
	})
})

describe('host-owned initialization projection', () => {
	it('bootstraps notebook-shaped attempts without Finance fields', async () => {
		const prepareInitial = vi.fn(() => Promise.resolve(record.attempt))
		const transaction = child<
			Persistence,
			{ db: object; attempt: Record['attempt']; purpose?: 'bootstrap' | 'additional' }
		>(() => Promise.resolve({ outcome: 'succeeded', settlement: 'locallyPersisted', workspace }))
		const discover = vi.fn(() =>
			Promise.resolve({ identities: [], workspaces: [], serverConfigured: true })
		)
		const machine = createWorkspaceInitialization<
			object,
			string,
			Record['attempt'],
			Persistence,
			SnapshotFrom<typeof transaction>
		>({
			tiers: { local: 'cache', authority: 'server' },
			discover,
			prepareInitial,
			transaction,
			selectReady: (attempt) => ({ identityId: attempt.member, workspaceId: attempt.notebookId })
		})
		const actor = tracked(createActor(machine, { input: { db: {}, userId: 'member' } })).start()
		expect(await toPromise(actor)).toEqual({
			outcome: 'ready',
			identityId: 'a',
			workspaceId: 'stable-attempt'
		})
		expect(prepareInitial).toHaveBeenCalledOnce()
		expect(discover.mock.calls).toHaveLength(2)
		expect(actor.getSnapshot().value).toBe('ready')
	})
})

it('drains the active journal on cancel/shutdown without sending repeated ignored commands', async () => {
	const pending = deferred<WorkspaceJournalResult<Record>>()
	const f = operationFixture({ read: () => pending.promise }),
		events: string[] = []
	const actor = f.start({ mode: 'load' }, observeCommands(events, 'effect'))
	await vi.waitFor(() => expect(f.journalRead).toHaveBeenCalledOnce())
	actor.send({ type: 'CANCEL' })
	actor.send({ type: 'CANCEL' })
	actor.send({ type: 'SHUTDOWN' })
	actor.send({ type: 'SHUTDOWN' })
	expect(events).toEqual(['CANCEL', 'SHUTDOWN'])
	expect(actor.getSnapshot().status).toBe('active')
	pending.resolve({ outcome: 'succeeded', record })
	expect((await toPromise(actor)).outcome).toBe('closed')
	expect(f.persistCall).not.toHaveBeenCalled()
})
