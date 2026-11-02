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
	Attempt extends { profileId: string; organizationId: string; workspace: { ownerId: string } },
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
	type Input = { attempt: Attempt }
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
		on: { CANCEL: '.cancelled', SHUTDOWN: '.closed' },
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
						target: 'failed',
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
						{ guard: ({ event }) => event.output?.outcome === 'absent', target: 'transacting' },
						{
							guard: ({ event }) => event.output?.outcome === 'matching',
							target: 'completed',
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
							target: 'completed',
							actions: assign({
								result: { outcome: 'profileUnavailable', settlement: 'notStarted' }
							})
						},
						{
							target: 'completed',
							actions: assign({ result: { outcome: 'conflict', settlement: 'notStarted' } })
						}
					],
					onError: {
						target: 'failed',
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
					onDone: { target: 'completed', actions: assign({ result: ({ event }) => event.output }) },
					onError: {
						target: 'failed',
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
			cancelled: {
				type: 'final',
				entry: assign({
					result: (): WorkspacePersistenceResult => ({
						outcome: 'cancelled',
						settlement: 'notStarted'
					})
				})
			},
			closed: {
				type: 'final',
				entry: assign({
					result: (): WorkspacePersistenceResult => ({
						outcome: 'closed',
						settlement: 'notStarted'
					})
				})
			},
			completed: { type: 'final' },
			failed: { type: 'final' }
		}
	})
}
