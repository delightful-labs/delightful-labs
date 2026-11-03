import { assign, fromPromise, sendTo, setup, type Snapshot } from 'xstate'
import type {
	CreationChild,
	ReconciliationLogic,
	CreationEvent,
	CreationReconciliation,
	CreationPersistenceResult
} from './creation-operation.js'
export function createWorkspacePersistence<
	Db,
	Attempt,
	Workspace,
	RS extends Snapshot<CreationReconciliation<Workspace>>,
	TS extends Snapshot<CreationPersistenceResult<Workspace>>
>(options: {
	db: Db
	validate: (attempt: Attempt) => Promise<Attempt>
	reconcile: ReconciliationLogic<RS, { db: Db; attempt: Attempt }>
	transaction: CreationChild<TS, { attempt: Attempt }>
}) {
	type WorkspacePersistenceEvent = CreationEvent
	type WorkspacePersistenceResult = CreationPersistenceResult<Workspace>
	type Input = { attempt: Attempt; issuance: 'new' | 'unknown' }
	type Context = Input & { db: Db; result: WorkspacePersistenceResult | undefined }
	const db = options.db
	const transaction = options.transaction
	const validate = fromPromise<Attempt, { attempt: Attempt }>(({ input }) =>
		options.validate(input.attempt)
	)
	return setup<
		Context,
		WorkspacePersistenceEvent,
		{
			validate: typeof validate
			reconcile: typeof options.reconcile
			transaction: typeof transaction
		},
		{},
		{},
		{},
		never,
		string,
		Input,
		WorkspacePersistenceResult
	>({
		actors: {
			validate,
			reconcile: options.reconcile,
			transaction
		}
	}).createMachine({
		id: 'workspace-creation-persistence',
		context: ({ input }) => ({ ...input, db, result: undefined }),
		initial: 'validating',
		output: ({ context }) => {
			if (!context.result) throw new Error('Missing workspace persistence outcome')
			return context.result
		},
		on: { CANCEL: '.cancelling', SHUTDOWN: '.closing' },
		states: {
			validating: {
				invoke: {
					src: 'validate',
					input: ({ context }) => ({ attempt: context.attempt }),
					onDone: {
						target: 'reconciling',
						actions: assign({ attempt: ({ event }) => event.output })
					},
					onError: {
						target: 'settling',
						actions: assign({
							result: ({ event }): WorkspacePersistenceResult => ({
								outcome: 'failed',
								settlement: 'notStarted',
								error: event.error
							})
						})
					}
				}
			},
			reconciling: {
				invoke: {
					src: 'reconcile',
					input: ({ context }) => context,
					onDone: [
						{
							guard: ({ context, event }) =>
								event.output?.outcome === 'notStarted' ||
								(event.output?.outcome === 'absent' && context.issuance === 'new'),
							target: 'transacting',
							actions: assign({ issuance: 'new' })
						},
						{
							guard: ({ event }) => event.output?.outcome === 'absent',
							target: 'settling',
							actions: assign({
								result: (): WorkspacePersistenceResult => ({
									outcome: 'failed',
									settlement: 'unresolved',
									error: new Error('Prior creation issuance is unknown')
								})
							})
						},
						{
							guard: ({ event }) => event.output?.outcome === 'matching',
							target: 'settling',
							actions: assign({
								result: ({ event }): WorkspacePersistenceResult => {
									if (event.output?.outcome !== 'matching')
										throw new Error('Expected matched workspace')
									return {
										outcome: 'succeeded',
										settlement: 'locallyPersisted',
										workspace: event.output?.workspace
									}
								}
							})
						},
						{
							guard: ({ event }) => event.output?.outcome === 'profileUnavailable',
							target: 'settling',
							actions: assign({
								result: { outcome: 'profileUnavailable', settlement: 'notStarted' }
							})
						},
						{
							target: 'settling',
							actions: assign({ result: { outcome: 'conflict', settlement: 'notStarted' } })
						}
					],
					onError: {
						target: 'settling',
						actions: assign({
							result: ({ event }): WorkspacePersistenceResult => ({
								outcome: 'failed',
								settlement: 'notStarted',
								error: event.error
							})
						})
					}
				}
			},
			transacting: {
				// Forward interruption without exiting: the resource owner rolls back or drains its commit.
				on: {
					CANCEL: { actions: sendTo('transaction', { type: 'CANCEL' }) },
					SHUTDOWN: { actions: sendTo('transaction', { type: 'SHUTDOWN' }) }
				},
				invoke: {
					id: 'transaction',
					src: 'transaction',
					input: ({ context }) => context,
					onDone: { target: 'settling', actions: assign({ result: ({ event }) => event.output }) },
					onError: {
						target: 'settling',
						actions: assign({
							result: ({ event }): WorkspacePersistenceResult => ({
								outcome: 'failed',
								settlement: 'unresolved',
								error: event.error
							})
						})
					}
				}
			},
			cancelling: {
				always: 'settling',
				entry: assign({
					result: (): WorkspacePersistenceResult => ({
						outcome: 'cancelled',
						settlement: 'notStarted'
					})
				})
			},
			closing: {
				always: 'settling',
				entry: assign({
					result: (): WorkspacePersistenceResult => ({
						outcome: 'closed',
						settlement: 'notStarted'
					})
				})
			},
			settling: {
				always: [
					{
						guard: ({ context }) =>
							context.issuance === 'unknown' && context.result?.settlement === 'notStarted',
						target: 'unresolvedSettlement'
					},
					{ guard: ({ context }) => context.result?.outcome === 'closed', target: 'closed' },
					{ guard: ({ context }) => context.result?.outcome === 'cancelled', target: 'cancelled' },
					{ guard: ({ context }) => context.result?.outcome === 'failed', target: 'failed' },
					{ target: 'completed' }
				]
			},
			unresolvedSettlement: {
				always: [
					{
						guard: ({ context }) => context.result?.outcome === 'closed',
						target: 'closed',
						actions: assign({
							result: (): WorkspacePersistenceResult => ({
								outcome: 'closed',
								settlement: 'unresolved'
							})
						})
					},
					{
						guard: ({ context }) => context.result?.outcome === 'cancelled',
						target: 'cancelled',
						actions: assign({
							result: (): WorkspacePersistenceResult => ({
								outcome: 'cancelled',
								settlement: 'unresolved'
							})
						})
					},
					{
						target: 'failed',
						actions: assign({
							result: (): WorkspacePersistenceResult => ({
								outcome: 'failed',
								settlement: 'unresolved',
								error: new Error('Prior creation issuance is unknown')
							})
						})
					}
				]
			},
			closed: { type: 'final' },
			cancelled: { type: 'final' },
			completed: { type: 'final' },
			failed: { type: 'final' }
		}
	})
}
