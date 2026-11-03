import type { WorkspaceJournalEvent } from './journal.js'
import { assign, fromPromise, setup, stateIn, type ActorLogic, type Snapshot } from 'xstate'
import type {
	CreationBinding,
	CreationRequest as Request,
	CreationResult as Result,
	CreationRecord
} from './creation-owner.js'
import type { WorkspaceJournalResult, WorkspaceJournalInput } from './journal.js'
export type CreationPersistenceResult<Workspace> =
	| { outcome: 'succeeded'; settlement: 'locallyPersisted'; workspace: Workspace }
	| { outcome: 'profileUnavailable' | 'conflict'; settlement: 'notStarted' }
	| { outcome: 'failed'; settlement: 'notStarted' | 'unresolved'; error: unknown }
	| {
			outcome: 'cancelled' | 'closed'
			settlement: 'notStarted' | 'locallyPersisted' | 'unresolved'
	  }
/** absent is an observation only. notStarted requires host evidence that this exact attempt
 * never issued a write (or its write was conclusively rolled back/rejected). matching includes
 * exact content validation and local durability, not merely a query returning a row.
 */
export type CreationReconciliation<Workspace> =
	| { outcome: 'absent' | 'notStarted' | 'conflict' | 'profileUnavailable' }
	| { outcome: 'matching'; workspace: Workspace }
export type CreationEvent = { type: 'CANCEL' | 'SHUTDOWN' }
export type CreationChild<S extends Snapshot<unknown>, Input> = ActorLogic<S, CreationEvent, Input>
export type ReconciliationLogic<S extends Snapshot<unknown>, Input> = ActorLogic<
	S,
	{ type: 'CHECK' },
	Input
>
export type JournalLogic<S extends Snapshot<unknown>, Input> = ActorLogic<
	S,
	WorkspaceJournalEvent,
	Input
>
export type CreationJournalInput<Record> = WorkspaceJournalInput<Record>

export function createWorkspaceCreationOperation<
	Db,
	Workspace,
	Record extends CreationRecord,
	JournalSnapshot extends Snapshot<WorkspaceJournalResult<Record>>,
	ReconcileSnapshot extends Snapshot<CreationReconciliation<Workspace>>,
	PersistSnapshot extends Snapshot<CreationPersistenceResult<Workspace>>,
	Binding extends CreationBinding = CreationBinding
>(options: {
	db: Db
	validate: (name: string) => Promise<string>
	prepare: (input: { binding: Binding; name: string }) => Promise<Record>
	journal: JournalLogic<JournalSnapshot, CreationJournalInput<Record>>
	reconcile: ReconciliationLogic<ReconcileSnapshot, { db: Db; attempt: Record['attempt'] }>
	persist: CreationChild<
		PersistSnapshot,
		{ attempt: Record['attempt']; issuance: 'new' | 'unknown' }
	>
	matchesBinding: (record: Record, binding: Binding) => boolean
	attemptId: (record: Record) => string
}) {
	type WorkspaceJournalRecord = Record
	type CreationRequest = Request<Record>
	type CreationResult = Result<Record, Workspace>
	type JournalResult = WorkspaceJournalResult<Record>
	type ReconciliationResult = CreationReconciliation<Workspace>
	type WorkspacePersistenceResult = CreationPersistenceResult<Workspace>
	type Input = { binding: Binding; request: CreationRequest }
	type Event = CreationEvent
	const db = options.db
	const validate = fromPromise(async ({ input }: { input: string }) => options.validate(input))
	const prepare = fromPromise(async ({ input }: { input: { binding: Binding; name: string } }) =>
		options.prepare(input)
	)
	const actors = {
		validate,
		prepare,
		journal: options.journal,
		reconcile: options.reconcile,
		persist: options.persist
	}
	type Context = Input & {
		db: Db
		name: string
		record: WorkspaceJournalRecord | undefined
		journal: JournalResult | undefined
		reconciliation: ReconciliationResult | undefined
		persistence: WorkspacePersistenceResult | undefined
		result: CreationResult
	}
	function required<T>(value: T | undefined): T {
		if (value === undefined) throw new Error('Missing creation operation value')
		return value
	}
	const model = setup<
		Context,
		Event,
		typeof actors,
		{},
		{},
		{ closing: undefined; cancelling: undefined },
		never,
		string,
		Input,
		CreationResult
	>({
		actors,
		guards: {
			closing: stateIn({ running: { control: 'closing' } }),
			cancelling: stateIn({ running: { control: 'cancelling' } })
		}
	})
	const forward = (type: Event['type']) =>
		model.enqueueActions(({ self, enqueue }) => {
			const effect = self.getSnapshot().children.effect
			if (effect?.getSnapshot().status === 'active') enqueue.sendTo(effect, { type })
		})
	const checkpoint = (
		target: string
	): ({ guard: 'closing' | 'cancelling'; target: string } | { target: string })[] => [
		{ guard: 'closing', target: 'finishing' },
		{ guard: 'cancelling', target: 'finishing' },
		{ target }
	]
	return model.createMachine({
		id: 'workspace-creation-operation',
		initial: 'running',
		context: ({ input }) => ({
			...input,
			db,
			name: '',
			record: 'record' in input.request ? input.request.record : undefined,
			journal: undefined,
			reconciliation: undefined,
			persistence: undefined,
			result: { outcome: 'editing', record: undefined, settlement: 'notStarted' }
		}),
		output: ({ context }): CreationResult => {
			const recovering =
				(context.request.mode === 'load' ||
					(context.request.mode === 'retry' && context.request.settlement === 'unresolved')) &&
				context.record !== undefined
			if (
				recovering &&
				context.result.settlement === 'notStarted' &&
				context.reconciliation?.outcome !== 'notStarted' &&
				context.persistence?.settlement !== 'notStarted'
			) {
				if (context.result.outcome === 'cancelled' || context.result.outcome === 'closed') {
					return { ...context.result, record: context.record, settlement: 'unresolved' }
				}
				return {
					outcome: 'unresolved',
					record: context.record,
					settlement: 'unresolved',
					error:
						context.result.outcome === 'failed'
							? context.result.error
							: new Error('Prior creation issuance is unknown')
				}
			}
			return context.result
		},
		states: {
			running: {
				type: 'parallel',
				states: {
					control: {
						initial: 'active',
						states: {
							active: {
								on: {
									CANCEL: { target: 'cancelling', actions: forward('CANCEL') },
									SHUTDOWN: { target: 'closing', actions: forward('SHUTDOWN') }
								}
							},
							cancelling: {
								on: { CANCEL: {}, SHUTDOWN: { target: 'closing', actions: forward('SHUTDOWN') } }
							},
							closing: { on: { CANCEL: {}, SHUTDOWN: {} } }
						}
					},
					work: {
						initial: 'dispatching',
						states: {
							dispatching: {
								always: [
									{
										guard: ({ context }) => context.request.mode === 'load',
										target: 'readingJournal'
									},
									{
										guard: ({ context }) => context.request.mode === 'clear',
										target: 'clearingJournal'
									},
									{
										guard: ({ context }) => context.request.mode === 'retry',
										target: 'checkingBinding'
									},
									{ target: 'validating' }
								]
							},
							validating: {
								invoke: {
									src: 'validate',
									input: ({ context }) =>
										context.request.mode === 'create' ? context.request.name : '',
									onDone: {
										target: 'checkingName',
										actions: assign({ name: ({ event }) => event.output })
									},
									onError: {
										target: 'finishing',
										actions: assign({
											result: { outcome: 'invalid', record: undefined, settlement: 'notStarted' }
										})
									}
								}
							},
							checkingName: { always: checkpoint('preparing') },
							preparing: {
								invoke: {
									src: 'prepare',
									input: ({ context }) => ({ binding: context.binding, name: context.name }),
									onDone: {
										target: 'checkingBinding',
										actions: assign({ record: ({ event }) => event.output })
									},
									onError: {
										target: 'finishing',
										actions: assign({
											result: ({ context, event }): CreationResult => ({
												record: context.record,
												settlement: 'notStarted',
												outcome: 'failed',
												error: event.error
											})
										})
									}
								}
							},
							checkingBinding: {
								always: [
									{ guard: 'closing', target: 'finishing' },
									{ guard: 'cancelling', target: 'finishing' },
									{
										guard: ({ context }) =>
											context.record?.key === context.binding.key &&
											options.matchesBinding(context.record, context.binding),
										target: 'recordingJournal'
									},
									{
										target: 'finishing',
										actions: assign({
											result: ({ context }): CreationResult => ({
												outcome: 'conflict',
												record: context.record,
												settlement: 'notStarted'
											})
										})
									}
								]
							},
							readingJournal: {
								invoke: {
									id: 'effect',
									src: 'journal',
									input: ({ context }) => ({ key: context.binding.key, mode: 'read' }),
									onDone: {
										target: 'checkingLoadedJournal',
										actions: assign({
											journal: ({ event }) => event.output,
											record: ({ context, event }) =>
												event.output?.outcome === 'succeeded' ? event.output.record : context.record
										})
									},
									onError: {
										target: 'finishing',
										actions: assign({
											result: ({ context, event }): CreationResult => ({
												record: context.record,
												settlement: 'notStarted',
												outcome: 'failed',
												error: event.error
											})
										})
									}
								}
							},
							checkingLoadedJournal: {
								always: [
									{ guard: 'closing', target: 'finishing' },
									{ guard: 'cancelling', target: 'finishing' },
									{
										guard: ({ context }) =>
											context.journal?.outcome === 'succeeded' &&
											context.journal.record === undefined,
										target: 'finishing'
									},
									{
										guard: ({ context }) =>
											context.journal?.outcome === 'succeeded' &&
											context.journal.record !== undefined,
										target: 'checkingLoadedBinding',
										actions: assign({
											record: ({ context }) =>
												context.journal?.outcome === 'succeeded'
													? context.journal.record
													: undefined
										})
									},
									{ target: 'journalFailure' }
								]
							},
							checkingLoadedBinding: {
								always: [
									{
										guard: ({ context }) =>
											context.record?.key === context.binding.key &&
											options.matchesBinding(context.record, context.binding),
										target: 'reconciling'
									},
									{
										target: 'finishing',
										actions: assign({
											result: ({ context }): CreationResult => ({
												outcome: 'conflict',
												record: context.record,
												settlement: 'notStarted'
											})
										})
									}
								]
							},
							recordingJournal: {
								invoke: {
									id: 'effect',
									src: 'journal',
									input: ({ context }) => ({
										key: context.binding.key,
										mode: 'write',
										record: required(context.record)
									}),
									onDone: {
										target: 'checkingRecordedJournal',
										actions: assign({ journal: ({ event }) => event.output })
									},
									onError: {
										target: 'finishing',
										actions: assign({
											result: ({ context, event }): CreationResult => ({
												record: context.record,
												settlement: 'notStarted',
												outcome: 'failed',
												error: event.error
											})
										})
									}
								}
							},
							checkingRecordedJournal: {
								always: checkpoint('checkingRecordedOutcome')
							},
							checkingRecordedOutcome: {
								always: [
									{
										guard: ({ context }) => context.journal?.outcome === 'succeeded',
										target: 'persisting'
									},
									{ target: 'journalFailure' }
								]
							},
							clearingJournal: {
								invoke: {
									id: 'effect',
									src: 'journal',
									input: ({ context }) => ({
										key: context.binding.key,
										mode: 'clear',
										attemptId: options.attemptId(required(context.record))
									}),
									onDone: {
										target: 'checkingClearedJournal',
										actions: assign({ journal: ({ event }) => event.output })
									},
									onError: {
										target: 'finishing',
										actions: assign({
											result: ({ context, event }): CreationResult => ({
												record: context.record,
												settlement: 'notStarted',
												outcome: 'failed',
												error: event.error
											})
										})
									}
								}
							},
							checkingClearedJournal: {
								always: [
									{ guard: 'closing', target: 'finishing' },
									{ guard: 'cancelling', target: 'finishing' },
									{
										guard: ({ context }) => context.journal?.outcome === 'succeeded',
										target: 'finishing',
										actions: assign({ record: undefined })
									},
									{ target: 'journalFailure' }
								]
							},
							journalFailure: {
								always: [
									{
										guard: ({ context }) => context.journal?.outcome === 'conflict',
										target: 'finishing',
										actions: assign({
											result: ({ context }): CreationResult => ({
												outcome: 'conflict',
												record: context.record,
												settlement: 'notStarted'
											})
										})
									},
									{
										target: 'finishing',
										actions: assign({
											result: ({ context }): CreationResult => ({
												record: context.record,
												settlement: 'notStarted',
												outcome: 'failed',
												error:
													context.journal?.outcome === 'failed'
														? context.journal.error
														: new Error('Journal was interrupted')
											})
										})
									}
								]
							},
							reconciling: {
								invoke: {
									src: 'reconcile',
									input: ({ context }) => ({
										db: context.db,
										attempt: required(context.record).attempt
									}),
									onDone: {
										target: 'checkingReconciliation',
										actions: assign({ reconciliation: ({ event }) => event.output })
									},
									onError: {
										target: 'finishing',
										actions: assign({
											result: ({ context, event }): CreationResult => ({
												record: context.record,
												settlement: 'notStarted',
												outcome: 'failed',
												error: event.error
											})
										})
									}
								}
							},
							checkingReconciliation: {
								always: [
									{ guard: 'closing', target: 'finishing' },
									{ guard: 'cancelling', target: 'finishing' },
									{
										guard: ({ context }) => context.reconciliation?.outcome === 'matching',
										target: 'finishing',
										actions: assign({
											result: ({ context }): CreationResult => {
												const result = required(context.reconciliation)
												if (result.outcome !== 'matching')
													throw new Error('Expected completed creation')
												return {
													outcome: 'complete',
													record: required(context.record),
													workspace: result.workspace,
													settlement: 'locallyPersisted'
												}
											}
										})
									},
									{
										guard: ({ context }) => context.reconciliation?.outcome === 'notStarted',
										target: 'finishing',
										actions: assign({
											result: ({ context }): CreationResult => ({
												outcome: 'recovered',
												record: required(context.record),
												settlement: 'notStarted'
											})
										})
									},
									{
										target: 'finishing',
										actions: assign({
											result: ({ context }): CreationResult => ({
												outcome: 'unresolved',
												record: context.record,
												settlement: 'unresolved',
												error: new Error('Prior creation issuance is unknown')
											})
										})
									}
								]
							},
							persisting: {
								invoke: {
									id: 'effect',
									src: 'persist',
									input: ({ context }) => ({
										attempt: required(context.record).attempt,
										issuance:
											context.request.mode === 'create' ||
											(context.request.mode === 'retry' &&
												context.request.settlement === 'notStarted')
												? 'new'
												: 'unknown'
									}),
									onDone: {
										target: 'checkingPersistence',
										actions: assign({ persistence: ({ event }) => event.output })
									},
									onError: {
										target: 'finishing',
										actions: assign({
											result: ({ context, event }): CreationResult => ({
												record: context.record,
												outcome: 'unresolved',
												settlement: 'unresolved',
												error: event.error
											})
										})
									}
								}
							},
							checkingPersistence: {
								always: [
									{
										guard: ({ context }) => context.persistence?.outcome === 'succeeded',
										target: 'finishing',
										actions: assign({
											result: ({ context }): CreationResult => {
												const result = required(context.persistence)
												if (result.outcome !== 'succeeded')
													throw new Error('Expected completed creation')
												return {
													outcome: 'complete',
													record: required(context.record),
													workspace: result.workspace,
													settlement: 'locallyPersisted'
												}
											}
										})
									},
									{
										guard: ({ context }) => context.persistence?.settlement === 'unresolved',
										target: 'finishing',
										actions: assign({
											result: ({ context }): CreationResult => ({
												outcome: 'unresolved',
												record: context.record,
												settlement: 'unresolved',
												error:
													context.persistence?.outcome === 'failed'
														? context.persistence.error
														: new Error('Workspace persistence settlement is unresolved')
											})
										})
									},
									{
										guard: ({ context }) =>
											context.persistence?.outcome === 'conflict' ||
											context.persistence?.outcome === 'profileUnavailable',
										target: 'finishing',
										actions: assign({
											result: ({ context }): CreationResult => ({
												outcome: 'conflict',
												record: context.record,
												settlement: 'notStarted'
											})
										})
									},
									{
										target: 'finishing',
										actions: assign({
											result: ({ context }): CreationResult => ({
												record: context.record,
												settlement: 'notStarted',
												outcome: 'failed',
												error:
													context.persistence?.outcome === 'failed'
														? context.persistence.error
														: new Error('Workspace persistence was interrupted')
											})
										})
									}
								]
							},
							finishing: {
								always: [
									{ guard: 'closing', target: '#workspace-creation-operation.closed' },
									{ guard: 'cancelling', target: '#workspace-creation-operation.cancelled' },
									{
										guard: ({ context }) => context.result.outcome === 'complete',
										target: '#workspace-creation-operation.complete'
									},
									{
										guard: ({ context }) => context.result.outcome === 'editing',
										target: '#workspace-creation-operation.editing'
									},
									{
										guard: ({ context }) => context.result.outcome === 'invalid',
										target: '#workspace-creation-operation.invalid'
									},
									{
										guard: ({ context }) => context.result.outcome === 'recovered',
										target: '#workspace-creation-operation.recovered'
									},
									{
										guard: ({ context }) => context.result.outcome === 'conflict',
										target: '#workspace-creation-operation.conflict'
									},
									{
										guard: ({ context }) => context.result.outcome === 'unresolved',
										target: '#workspace-creation-operation.unresolved'
									},
									{ target: '#workspace-creation-operation.failed' }
								]
							}
						}
					}
				}
			},
			complete: { type: 'final' },
			editing: { type: 'final' },
			invalid: { type: 'final' },
			recovered: { type: 'final' },
			conflict: { type: 'final' },
			unresolved: { type: 'final' },
			failed: { type: 'final' },
			closed: {
				type: 'final',
				entry: assign({
					result: ({ context }): CreationResult => ({
						outcome: 'closed',
						record: context.record,
						settlement: context.persistence?.settlement ?? context.result.settlement
					})
				})
			},
			cancelled: {
				type: 'final',
				entry: assign({
					result: ({ context }): CreationResult => ({
						outcome: 'cancelled',
						record: context.record,
						settlement: context.persistence?.settlement ?? context.result.settlement
					})
				})
			}
		}
	})
}
