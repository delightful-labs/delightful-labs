import type { ActorFromLogic } from 'xstate'
import { type AccountHandle, type JazzClient } from 'jazz-tools/client'
import { createDb, type Db, type DbConfig, type Transaction, type WriteHandle } from 'jazz-tools'
import { sameBackupBinding, type BackupBinding } from 'delightful-local-first/backup/binding'
import type {
	RestoreEvent,
	RestoreInput,
	RestoreResult,
	RestoreTransactionWriter
} from 'delightful-local-first/backup/restore'
import {
	createRestoreJournalStepMachine,
	createRestoreMachine
} from 'delightful-local-first/backup/restore/workflow'
import {
	createRestoreJournalRecord,
	parseRestoreJournalRecord,
	type RestoreJournalIntent,
	type RestoreJournalRecord
} from 'delightful-local-first/backup/restore/journal'

import { PersistedWriteRejectedError } from 'jazz-tools'
import {
	restoreTransactionAccess,
	type RestoreDestinationInput,
	type RestoreDestinationResult
} from 'delightful-local-first/backup/restore'
import {
	prepareArchiveOpen,
	type ArchiveEnvelopeRequest,
	type ArchiveEnvelopeResult,
	type IntegrityCheckedArchive
} from 'delightful-local-first/backup/envelope'
import { createArchiveEnvelopeMachine } from 'delightful-local-first/backup/envelope/workflow'
import { payloadLimits } from 'delightful-local-first/backup/archive'
import type { JazzSession } from 'jazz-tools/client'
import { stableUuid } from '../../domain/stable-uuid.js'
import { app } from '../../schema.js'
import { validateFinanceBackup } from '../../backup/workspace.js'
import {
	canonicalRecovery,
	digestRecovery,
	financeGraphRows,
	restorePartBytes,
	type FinanceRestoreGraph,
	type FinanceRestorePlan,
	type FinanceRestorePlanRequest
} from './workspace-restore-plan.js'
import {
	prepareFinanceRestorePlan,
	financeRestorePlanningMachine
} from './workspace-restore-plan.js'
import { createCallbackLogic, setup, types, createAsyncLogic, isMachineSnapshot } from 'xstate'
import type { ActorRefFrom, SnapshotFrom, ActorLogic, EventObject, Snapshot } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'

type RestoreClient = Pick<JazzClient, 'db' | 'shutdown'>
/** One account-bound acquisition; the restore chart retains and drains its lifetime. */
async function openRestoreClient(config: DbConfig): Promise<RestoreClient> {
	const db = await createDb(config)
	return { db, shutdown: (options) => db.shutdown(options) }
}
export type FinanceRestoreDb = Pick<Db, 'all' | 'getAuthState' | 'getConfig' | 'beginTransaction'>
export type FinanceRestoreComparisonInput = {
	binding: BackupBinding
	databaseName: string
	record: RestoreJournalRecord
}
type Writer = RestoreTransactionWriter<Transaction<'mergeable'>, WriteHandle>
type Custody = Parameters<Writer['retainDetached']>[0]
type RestoreOperationAdapter<Logic extends import('xstate').AnyActorLogic, Input, Output> = {
	input: (input: Input) => import('xstate').InputFrom<Logic>
	result: (output: import('xstate').OutputFrom<Logic>) => Output
	recipient: (actor: import('xstate').ActorRefFrom<Logic>) => {
		send: (event: RestoreEvent) => void
	}
}
export type FinanceRestoreSessionAdapter<
	WriteLogic extends import('xstate').AnyActorLogic,
	ComparisonLogic extends import('xstate').AnyActorLogic
> = {
	machine: WriteLogic
	comparison: ComparisonLogic
	writer: Writer
	operation: RestoreOperationAdapter<WriteLogic, RestoreInput, RestoreResult | undefined>
	comparisonOperation: RestoreOperationAdapter<
		ComparisonLogic,
		FinanceRestoreComparisonInput,
		RestoreJournalRecord | undefined
	>
}
export type FinanceRestoreSessionResult = {
	outcome: 'complete' | 'incomplete' | 'conflict' | 'cancelled' | 'closed' | 'invalidated'
	record: RestoreJournalRecord | undefined
}
type Context = FinanceRestoreSessionResult & {
	interruption: 'cancelled' | 'closed' | 'invalidated' | undefined
	transactionId: string | undefined
}
const restoreInterruption = (previous: Context['interruption'], event: { type: string }) =>
	previous === 'closed' || event.type === 'SHUTDOWN'
		? 'closed'
		: previous === 'invalidated' || event.type === 'INVALIDATE'
			? 'invalidated'
			: 'cancelled'
type Options = {
	account: AccountHandle
	serverUrl: string
	binding: BackupBinding
	intent: RestoreJournalIntent
	databaseName: string
	mode: 'new' | 'resume'
	/** Ownership transfer: called only after the restore client has safely closed. */
	releaseArtifacts(): void
}
const required = <Value>(value: Value | undefined): Value => {
	if (value === undefined) throw new Error('Missing restore resource')
	return value
}
/** The caller transfers artifact custody to the returned operation; start and drain it before stop. */
export function createFinanceWorkspaceRestore(
	issued: Omit<Options, 'intent' | 'releaseArtifacts'> & {
		archive: IntegrityCheckedArchive
		plan: FinanceRestorePlanRequest
		releaseFile(): void
	},
	acquireClient: (config: DbConfig) => Promise<RestoreClient> = openRestoreClient
) {
	const { archive, plan: planning, releaseFile, ...options } = issued
	const plan = planning.read()
	return createFinanceRestoreSession(
		{
			...options,
			intent: plan.intent,
			releaseArtifacts: () => {
				planning.release()
				archive.release()
				releaseFile()
			}
		},
		(db, retain) => createFinanceRestoreAdapter(db, plan, archive, retain),
		acquireClient
	)
}
/** One factory per operation owner. Send SHUTDOWN and await output before stopping its actor. */
export function createFinanceRestoreSession<
	WriteLogic extends import('xstate').AnyActorLogic,
	ComparisonLogic extends import('xstate').AnyActorLogic
>(
	issued: Options,
	createAdapter: (
		db: FinanceRestoreDb,
		retain: Writer['retainDetached']
	) => FinanceRestoreSessionAdapter<WriteLogic, ComparisonLogic>,
	acquireClient: (config: DbConfig) => Promise<RestoreClient> = openRestoreClient
) {
	const options = Object.freeze({ ...issued })
	const binding = Object.freeze({ ...options.binding }),
		intent = createRestoreJournalRecord(options.intent).intent
	let client: RestoreClient | undefined,
		transaction: Transaction<'mergeable'> | undefined,
		write: WriteHandle | undefined
	const custody: Custody[] = []
	const db: FinanceRestoreDb = {
		all: (query, settings) => required(client).db.all(query, settings),
		getAuthState: () => required(client).db.getAuthState(),
		getConfig: () => required(client).db.getConfig(),
		beginTransaction: () => required(client).db.beginTransaction()
	}
	const adapter = createAdapter(db, (receipt) => custody.push(receipt))
	const checkpointWrite = (record: RestoreJournalRecord | undefined) => {
		const checkpoint = record?.checkpoint
		return checkpoint?.kind === 'writing' || checkpoint?.kind === 'activating'
			? checkpoint.current.writeId
			: intent.plan.preparation.writeId
	}
	const journalInput = { binding, databaseName: options.databaseName }
	const actors = {
		validate: createAsyncLogic<void>({
			run: () =>
				Promise.resolve().then(() => {
					if (
						options.account.id !== binding.identityId ||
						intent.operation.identityId !== binding.identityId ||
						intent.operation.applicationId !== binding.applicationId ||
						intent.operation.environment !== binding.environment ||
						intent.operation.operationId !== binding.operationId ||
						intent.operation.destinationWorkspaceId !== binding.workspaceId
					)
						throw new Error('Restore session scope mismatch')
				})
		}),
		journal: createRestoreJournalStepMachine(),
		acquire: createAsyncLogic<void>({
			run: () =>
				acquireClient({
					appId: binding.applicationId,
					serverUrl: options.serverUrl,
					account: options.account,
					driver: { type: 'persistent', dbName: 'restore-' + binding.operationId }
				}).then((acquired) => {
					client = acquired
				})
		}),
		restore: adapter.machine,
		compare: adapter.comparison,
		acquisition: createAsyncLogic<void>({
			run: () =>
				required(custody[0]).acquisition.then((acquired) => {
					transaction = acquired
				})
		}),
		pending: createAsyncLogic<unknown>({
			run: () => Promise.resolve(required(custody[0]).pending)
		}),
		commit: createAsyncLogic<void>({
			run: () =>
				required(required(custody[0]).commit).then((committed) => {
					write = committed
				})
		}),
		identify: createAsyncLogic<string>({
			run: () => adapter.writer.transactionId(required(write))
		}),
		settle: createAsyncLogic<void>({ run: () => adapter.writer.acceptRemote(required(write)) }),
		rollback: createAsyncLogic<boolean>({
			run: () => adapter.writer.rollback(required(transaction))
		}),
		close: createAsyncLogic<void>({ run: () => required(client).shutdown({ waitForSync: true }) }),
		release: createAsyncLogic<void>({
			run: () => Promise.resolve().then(() => options.releaseArtifacts())
		}),
		forgetReceipt: createAsyncLogic<void>({
			run: () =>
				Promise.resolve().then(() => {
					custody.shift()
					transaction = undefined
					write = undefined
				})
		})
	}
	const patchRememberWrite = (
		args: { context: Context },
		params: RestoreResult | undefined
	): Partial<Context> => ({
		record: ((_args, result: RestoreResult | undefined) => result?.record)(args, params),
		outcome: ((_args, result: RestoreResult | undefined): Context['outcome'] =>
			result?.outcome === 'complete'
				? 'complete'
				: result?.outcome === 'conflict'
					? 'conflict'
					: 'incomplete')(args, params)
	})
	const events3 = {
		CANCEL: types<EventPayload<RestoreEvent | { type: 'RETRY_RELEASE' }, 'CANCEL'>>(),
		SHUTDOWN: types<EventPayload<RestoreEvent | { type: 'RETRY_RELEASE' }, 'SHUTDOWN'>>(),
		INVALIDATE: types<EventPayload<RestoreEvent | { type: 'RETRY_RELEASE' }, 'INVALIDATE'>>(),
		RETRY_RELEASE: types<EventPayload<RestoreEvent | { type: 'RETRY_RELEASE' }, 'RETRY_RELEASE'>>()
	}
	type NativeEvent3 =
		| import('xstate').InferEvents<typeof events3>
		| import('xstate').DoneActorEvent<
				| import('xstate').OutputFrom<(typeof actors)['validate']>
				| import('xstate').OutputFrom<(typeof actors)['journal']>
				| import('xstate').OutputFrom<(typeof actors)['acquire']>
				| import('xstate').OutputFrom<(typeof actors)['restore']>
				| import('xstate').OutputFrom<(typeof actors)['compare']>
				| import('xstate').OutputFrom<(typeof actors)['acquisition']>
				| import('xstate').OutputFrom<(typeof actors)['pending']>
				| import('xstate').OutputFrom<(typeof actors)['commit']>
				| import('xstate').OutputFrom<(typeof actors)['identify']>
				| import('xstate').OutputFrom<(typeof actors)['settle']>
				| import('xstate').OutputFrom<(typeof actors)['rollback']>
				| import('xstate').OutputFrom<(typeof actors)['close']>
				| import('xstate').OutputFrom<(typeof actors)['release']>
				| import('xstate').OutputFrom<(typeof actors)['compare']>
		  >
		| import('xstate').ErrorActorEvent
	const model = setup({
		schemas: {
			context: types<Context>(),
			events: events3,
			input: types<undefined>(),
			output: types<FinanceRestoreSessionResult>(),
			children: {
				validate: types<import('xstate').ActorFromLogic<(typeof actors)['validate']>>(),
				journal: types<import('xstate').ActorFromLogic<(typeof actors)['journal']>>(),
				acquire: types<import('xstate').ActorFromLogic<(typeof actors)['acquire']>>(),
				restore: types<import('xstate').ActorRefFrom<WriteLogic>>(),
				compare: types<import('xstate').ActorRefFrom<ComparisonLogic>>(),
				acquisition: types<import('xstate').ActorFromLogic<(typeof actors)['acquisition']>>(),
				pending: types<import('xstate').ActorFromLogic<(typeof actors)['pending']>>(),
				commit: types<import('xstate').ActorFromLogic<(typeof actors)['commit']>>(),
				identify: types<import('xstate').ActorFromLogic<(typeof actors)['identify']>>(),
				settle: types<import('xstate').ActorFromLogic<(typeof actors)['settle']>>(),
				rollback: types<import('xstate').ActorFromLogic<(typeof actors)['rollback']>>(),
				close: types<import('xstate').ActorFromLogic<(typeof actors)['close']>>(),
				release: types<import('xstate').ActorFromLogic<(typeof actors)['release']>>(),
				operation: types<import('xstate').ActorRefFrom<ComparisonLogic>>(),
				forgetReceipt: types<import('xstate').ActorFromLogic<typeof actors.forgetReceipt>>()
			}
		},
		actors,
		guards: {
			interrupted: ({ context }: { context: Context }) => context.interruption !== undefined,
			retained: () => custody.length > 0,
			clientAcquired: () => client !== undefined,
			moreReceipts: () => custody.length > 1,
			remoteRejected: ({ context, event }: { context: Context; event: NativeEvent3 }) =>
				'error' in event &&
				context.transactionId !== undefined &&
				adapter.writer.isRemoteRejection(event.error, context.transactionId),
			rollbackConfirmed: ({ event }: { event: NativeEvent3 }) =>
				'output' in event && event.output === true
		},
		actions: {}
	})
	const afterPending = [
		{ guard: () => custody[0]?.commit !== undefined, target: 'waitingForCommit' },
		{ target: 'rollingBack' }
	]
	return model.createMachine({
		context: {
			outcome: 'incomplete',
			record: undefined,
			interruption: undefined,
			transactionId: undefined
		},
		initial: 'validating',
		output: ({ context }) => ({
			outcome: context.interruption ?? context.outcome,
			record: context.record
		}),
		on: {
			CANCEL: (args) => {
				return {
					context: (({ context, event }) => ({
						interruption: restoreInterruption(context.interruption, event)
					}))(args)
				}
			},
			SHUTDOWN: (args) => {
				return {
					context: (({ context, event }) => ({
						interruption: restoreInterruption(context.interruption, event)
					}))(args)
				}
			},
			INVALIDATE: (args) => {
				if (!sameBackupBinding(binding, args.event.binding)) return
				return {
					context: (({ context, event }) => ({
						interruption: restoreInterruption(context.interruption, event)
					}))(args)
				}
			}
		},
		states: {
			validating: {
				invoke: model.createInvoke({
					id: 'validate',
					src: actors.validate,
					onDone: (args) => {
						if (args.guards.interrupted(args) && args.guards.retained()) {
							return { target: 'waitingForTransaction' }
						}
						if (args.guards.interrupted(args) && args.guards.clientAcquired()) {
							return { target: 'closingClient' }
						}
						if (args.guards.interrupted(args)) {
							return { target: 'releasingArtifacts' }
						}
						return { target: 'initializingJournal' }
					},
					onError: (args) => {
						if (args.guards.retained()) {
							return { target: 'waitingForTransaction' }
						}
						if (args.guards.clientAcquired()) {
							return { target: 'closingClient' }
						}
						return { target: 'releasingArtifacts' }
					}
				})
			},
			initializingJournal: {
				invoke: model.createInvoke({
					id: 'journal',
					src: actors.journal,
					input: { ...journalInput, command: { mode: 'initialize' } },
					onDone: (args) => {
						if (!args.context.interruption && args.event.output?.outcome === 'initialized') {
							return { target: 'loadingJournal' }
						}
						if (args.guards.retained()) {
							return { target: 'waitingForTransaction' }
						}
						if (args.guards.clientAcquired()) {
							return { target: 'closingClient' }
						}
						return { target: 'releasingArtifacts' }
					},
					onError: (args) => {
						if (args.guards.retained()) {
							return { target: 'waitingForTransaction' }
						}
						if (args.guards.clientAcquired()) {
							return { target: 'closingClient' }
						}
						return { target: 'releasingArtifacts' }
					}
				})
			},
			loadingJournal: {
				invoke: model.createInvoke({
					id: 'journal',
					src: actors.journal,
					input: { ...journalInput, command: { mode: 'load', intent } },
					onDone: (args) => {
						const { context, event } = args
						if (
							!context.interruption &&
							event.output?.outcome === 'loaded' &&
							event.output?.record?.checkpoint.kind === 'complete'
						) {
							return {
								target: 'releasingArtifacts',
								context: ((args) => ({
									outcome: 'complete',
									record: (({ event }) => event.output?.record)(args)
								}))(args)
							}
						}
						if (
							event.output?.outcome === 'conflict' ||
							event.output?.record?.checkpoint.kind === 'conflict'
						) {
							return {
								target: 'releasingArtifacts',
								context: ((args) => ({
									outcome: 'conflict',
									record: (({ event }) => event.output?.record)(args)
								}))(args)
							}
						}
						if (
							!context.interruption &&
							((event.output?.outcome === 'loaded' && event.output?.record !== undefined) ||
								(event.output?.outcome === 'missing' && options.mode === 'new'))
						) {
							return {
								target: 'acquiringClient',
								context: ((args) => ({ record: (({ event }) => event.output?.record)(args) }))(args)
							}
						}
						if (args.guards.retained()) {
							return { target: 'waitingForTransaction' }
						}
						if (args.guards.clientAcquired()) {
							return { target: 'closingClient' }
						}
						return { target: 'releasingArtifacts' }
					},
					onError: (args) => {
						if (args.guards.retained()) {
							return { target: 'waitingForTransaction' }
						}
						if (args.guards.clientAcquired()) {
							return { target: 'closingClient' }
						}
						return { target: 'releasingArtifacts' }
					}
				})
			},
			acquiringClient: {
				invoke: model.createInvoke({
					id: 'acquire',
					src: actors.acquire,
					onDone: (args) => {
						if (args.guards.interrupted(args) && args.guards.retained()) {
							return { target: 'waitingForTransaction' }
						}
						if (args.guards.interrupted(args) && args.guards.clientAcquired()) {
							return { target: 'closingClient' }
						}
						if (args.guards.interrupted(args)) {
							return { target: 'releasingArtifacts' }
						}
						if (
							db.getAuthState().session?.user !== binding.identityId ||
							db.getConfig().appId !== binding.applicationId
						) {
							return {
								target: 'closingClient',
								context: { interruption: 'invalidated' } satisfies Partial<Context>
							}
						}
						if (args.context.record?.checkpoint.kind === 'comparing') {
							return { target: 'comparing' }
						}
						return { target: 'writing' }
					},
					onError: (args) => {
						if (args.guards.retained()) {
							return { target: 'waitingForTransaction' }
						}
						if (args.guards.clientAcquired()) {
							return { target: 'closingClient' }
						}
						return { target: 'releasingArtifacts' }
					}
				})
			},
			writing: {
				on: {
					CANCEL: ({ context, event, children }, enq) => {
						const child = children.restore
						if (child) enq.sendTo(adapter.operation.recipient(child), { type: 'CANCEL' })
						return { context: { interruption: restoreInterruption(context.interruption, event) } }
					},
					SHUTDOWN: ({ context, event, children }, enq) => {
						const child = children.restore
						if (child) enq.sendTo(adapter.operation.recipient(child), { type: 'SHUTDOWN' })
						return { context: { interruption: restoreInterruption(context.interruption, event) } }
					},
					INVALIDATE: ({ context, event, children }, enq) => {
						if (!sameBackupBinding(binding, event.binding)) return {}
						const child = children.restore
						if (child)
							enq.sendTo(adapter.operation.recipient(child), {
								type: 'INVALIDATE',
								binding: event.binding
							})
						return { context: { interruption: restoreInterruption(context.interruption, event) } }
					}
				},
				invoke: model.createInvoke({
					id: 'restore',
					src: actors.restore,
					input: ({ context }) =>
						adapter.operation.input({
							...journalInput,
							intent,
							writeId: checkpointWrite(context.record)
						}),
					onDone: (args) => {
						const projectedOutput = adapter.operation.result(args.event.output)
						const result = projectedOutput
						const patch = patchRememberWrite(args, result)
						if (args.guards.interrupted(args)) {
							if (args.guards.retained()) return { target: 'waitingForTransaction', context: patch }
							if (args.guards.clientAcquired()) return { target: 'closingClient', context: patch }
							return { target: 'releasingArtifacts', context: patch }
						}
						if (
							(result?.outcome === 'prepared' || result?.outcome === 'batchWritten') &&
							result.record?.checkpoint.kind === 'comparing'
						)
							return { target: 'comparing', context: { record: result.record } }
						if (
							(result?.outcome === 'prepared' || result?.outcome === 'batchWritten') &&
							result.record?.checkpoint.kind === 'writing'
						)
							return { target: 'writing', reenter: true, context: { record: result.record } }
						if (args.guards.retained()) return { target: 'waitingForTransaction', context: patch }
						if (args.guards.clientAcquired()) return { target: 'closingClient', context: patch }
						return { target: 'releasingArtifacts', context: patch }
					},
					onError: (args) => {
						if (args.guards.retained()) {
							return { target: 'waitingForTransaction' }
						}
						if (args.guards.clientAcquired()) {
							return { target: 'closingClient' }
						}
						return { target: 'releasingArtifacts' }
					}
				})
			},
			comparing: {
				on: {
					CANCEL: ({ context, event, children }, enq) => {
						const child = children.compare
						if (child) enq.sendTo(adapter.comparisonOperation.recipient(child), { type: 'CANCEL' })
						return { context: { interruption: restoreInterruption(context.interruption, event) } }
					},
					SHUTDOWN: ({ context, event, children }, enq) => {
						const child = children.compare
						if (child)
							enq.sendTo(adapter.comparisonOperation.recipient(child), { type: 'SHUTDOWN' })
						return { context: { interruption: restoreInterruption(context.interruption, event) } }
					},
					INVALIDATE: ({ context, event, children }, enq) => {
						if (!sameBackupBinding(binding, event.binding)) return {}
						const child = children.compare
						if (child)
							enq.sendTo(adapter.comparisonOperation.recipient(child), {
								type: 'INVALIDATE',
								binding: event.binding
							})
						return { context: { interruption: restoreInterruption(context.interruption, event) } }
					}
				},
				invoke: model.createInvoke({
					id: 'compare',
					src: actors.compare,
					input: (args) =>
						adapter.comparisonOperation.input({
							...journalInput,
							record: required(args.context.record)
						}),
					onDone: (args) => {
						const projectedOutput = adapter.comparisonOperation.result(args.event.output)
						const { event } = args
						if (!args.context.interruption && projectedOutput?.checkpoint.kind === 'activating') {
							return {
								target: 'writing',
								context: ((args) => ({ record: (({ event }) => projectedOutput)(args) }))(args)
							}
						}
						if (args.guards.retained()) {
							return { target: 'waitingForTransaction' }
						}
						if (args.guards.clientAcquired()) {
							return { target: 'closingClient' }
						}
						return { target: 'releasingArtifacts' }
					},
					onError: (args) => {
						if (args.guards.retained()) {
							return { target: 'waitingForTransaction' }
						}
						if (args.guards.clientAcquired()) {
							return { target: 'closingClient' }
						}
						return { target: 'releasingArtifacts' }
					}
				})
			},
			waitingForTransaction: {
				invoke: model.createInvoke({
					id: 'acquisition',
					src: actors.acquisition,
					onDone: { target: 'waitingForPending' },
					onError: { target: 'restartRequired' }
				})
			},
			waitingForPending: {
				invoke: model.createInvoke({
					id: 'pending',
					src: actors.pending,
					onDone: () => {
						if (custody[0]?.commit !== undefined) {
							return { target: 'waitingForCommit' }
						}
						return { target: 'rollingBack' }
					},
					onError: () => {
						if (custody[0]?.commit !== undefined) {
							return { target: 'waitingForCommit' }
						}
						return { target: 'rollingBack' }
					}
				})
			},
			waitingForCommit: {
				invoke: model.createInvoke({
					id: 'commit',
					src: actors.commit,
					onDone: { target: 'identifyingCommit' },
					onError: { target: 'restartRequired' }
				})
			},
			identifyingCommit: {
				invoke: model.createInvoke({
					id: 'identify',
					src: actors.identify,
					onDone: ({ event }) => ({
						target: 'settlingCommit',
						context: { transactionId: event.output }
					}),
					onError: { target: 'identificationBlocked' }
				})
			},
			settlingCommit: {
				invoke: model.createInvoke({
					id: 'settle',
					src: actors.settle,
					onDone: { target: 'forgettingReceipt' },
					onError: (args) =>
						args.guards.remoteRejected(args)
							? { target: 'forgettingReceipt' }
							: { target: 'settlementBlocked' }
				})
			},
			rollingBack: {
				invoke: model.createInvoke({
					id: 'rollback',
					src: actors.rollback,
					onDone: (args) =>
						args.guards.rollbackConfirmed(args)
							? { target: 'forgettingReceipt' }
							: { target: 'rollbackBlocked' },
					onError: { target: 'rollbackBlocked' }
				})
			},
			closingClient: {
				invoke: model.createInvoke({
					id: 'close',
					src: actors.close,
					onDone: (args, enq) => {
						enq(() => {
							client = undefined
						})
						return { target: 'releasingArtifacts' }
					},
					onError: { target: 'clientBlocked' }
				})
			},
			releasingArtifacts: {
				invoke: model.createInvoke({
					id: 'release',
					src: actors.release,
					onDone: { target: 'complete' },
					onError: { target: 'artifactsBlocked' }
				})
			},
			restartRequired: { tags: ['restore-restart-required'] },
			identificationBlocked: {
				tags: ['restore-release-blocked'],
				on: { RETRY_RELEASE: { target: 'identifyingCommit' } }
			},
			settlementBlocked: {
				tags: ['restore-release-blocked'],
				on: { RETRY_RELEASE: { target: 'settlingCommit' } }
			},
			rollbackBlocked: {
				tags: ['restore-release-blocked'],
				on: { RETRY_RELEASE: { target: 'rollingBack' } }
			},
			clientBlocked: {
				tags: ['restore-release-blocked'],
				on: { RETRY_RELEASE: { target: 'closingClient' } }
			},
			artifactsBlocked: {
				tags: ['restore-release-blocked'],
				on: { RETRY_RELEASE: { target: 'releasingArtifacts' } }
			},
			complete: { type: 'final' },
			forgettingReceipt: {
				invoke: model.createInvoke({
					id: 'forgetReceipt',
					src: actors.forgetReceipt,
					onDone: (args) => {
						if (args.guards.retained())
							return { target: 'waitingForTransaction', context: { transactionId: undefined } }
						if (args.guards.clientAcquired())
							return { target: 'closingClient', context: { transactionId: undefined } }
						return { target: 'releasingArtifacts', context: { transactionId: undefined } }
					},
					onError: { target: 'settlementBlocked' }
				})
			}
		}
	})
}

type RecoveryInput = RestoreDestinationInput<Transaction<'mergeable'>>
export function recoveryQueries(graph: FinanceRestoreGraph, operationId: string) {
	const workspaceId = graph.workspace.id,
		files = graph.files.map((file) => file.id),
		transactions = graph.transactions.map((row) => row.id)
	return {
		operation: app.restoreOperations.where({ id: operationId }),
		accounts: app.accounts.where({ organizationId: workspaceId }).orderBy('id'),
		categories: app.categories.where({ organizationId: workspaceId }).orderBy('id'),
		tags: app.tags.where({ organizationId: workspaceId }).orderBy('id'),
		checks: app.checks.where({ organizationId: workspaceId }).orderBy('id'),
		batches: app.transactionBatches.where({ organizationId: workspaceId }).orderBy('id'),
		templates: app.batchTemplates.where({ organizationId: workspaceId }).orderBy('id'),
		transactions: app.transactions.where({ organizationId: workspaceId }).orderBy('id'),
		transactionTags: app.transactionTags.where({ organizationId: workspaceId }).orderBy('id'),
		transfers: app.internalTransfers.where({ organizationId: workspaceId }).orderBy('id'),
		files: app.files.where({ transactionId: { in: transactions } }).orderBy('id'),
		links: app.transactionAttachments.where({ transactionId: { in: transactions } }).orderBy('id'),
		parts: app.fileParts
			.where({ fileId: { in: files } })
			.orderBy('fileId')
			.orderBy('partIndex'),
		source: app.files.where({ id: graph.source.file.id }),
		sourceParts: app.fileParts.where({ fileId: graph.source.file.id }).orderBy('partIndex'),
		members: app.organizationMembers.where({ organizationId: workspaceId }).orderBy('id')
	}
}
export function readRecovery(
	db: Pick<Db, 'all'>,
	queries: ReturnType<typeof recoveryQueries>,
	tier: 'remote' | 'local-first'
) {
	return Promise.all([
		db.all(queries.operation, { tier }),
		db.all(queries.accounts, { tier }),
		db.all(queries.categories, { tier }),
		db.all(queries.tags, { tier }),
		db.all(queries.checks, { tier }),
		db.all(queries.batches, { tier }),
		db.all(queries.templates, { tier }),
		db.all(queries.transactions, { tier }),
		db.all(queries.transactionTags, { tier }),
		db.all(queries.transfers, { tier }),
		db.all(queries.files, { tier }),
		db.all(queries.links, { tier }),
		db.all(queries.parts, { tier }),
		db.all(queries.members, { tier }),
		db.all(queries.source, { tier }),
		db.all(queries.sourceParts, { tier })
	])
}
type RecoveryObservation = Awaited<ReturnType<typeof readRecovery>>
function stageRecovery(
	tx: Transaction<'mergeable'>,
	sample: FinanceRestorePlan,
	writeId: string,
	archive: IntegrityCheckedArchive
) {
	const { graph, intent } = sample
	if (writeId === intent.plan.preparation.writeId) {
		const { id, ...root } = graph.workspace
		tx.insert(
			app.organizations,
			{ ...root, restoreOperationId: intent.operation.operationId },
			{ id }
		)
		tx.insert(
			app.restoreOperations,
			{
				workspaceId: id,
				sourceFileId: graph.source.file.id,
				ownerId: root.ownerId,
				status: 'incomplete',
				payloadSha256: intent.archive.payloadSha256,
				graphSha256: intent.plan.expectedGraphSha256,
				workspaceName: root.name,
				workspaceKind: root.kind,
				workspaceCurrency: root.defaultCurrency
			},
			{ id: intent.operation.operationId }
		)
		const { id: sourceFileId, ...source } = graph.source.file
		tx.insert(app.files, source, { id: sourceFileId })
		const bytes = archive.copyPayloadBytes()
		try {
			for (const { id, ...part } of graph.source.parts)
				tx.insert(
					app.fileParts,
					{
						...part,
						data: bytes.slice(
							part.partIndex * restorePartBytes,
							part.partIndex * restorePartBytes + part.sizeBytes
						)
					},
					{ id }
				)
		} finally {
			bytes.fill(0)
		}
		return
	}
	if (writeId === intent.plan.activation.writeId) {
		tx.update(app.restoreOperations, intent.operation.operationId, { status: 'active' })
		const { id, ...member } = graph.member
		tx.insert(app.organizationMembers, member, { id })
		return
	}
	for (const { id, archivedAt, ...row } of graph.accounts)
		tx.insert(
			app.accounts,
			{ ...row, archivedAt: archivedAt === null ? null : new Date(archivedAt) },
			{ id }
		)
	for (const { id, archivedAt, ...row } of graph.categories)
		tx.insert(
			app.categories,
			{ ...row, archivedAt: archivedAt === null ? null : new Date(archivedAt) },
			{ id }
		)
	for (const { id, archivedAt, ...row } of graph.tags)
		tx.insert(
			app.tags,
			{ ...row, archivedAt: archivedAt === null ? null : new Date(archivedAt) },
			{ id }
		)
	for (const { id, ...row } of graph.checks) tx.insert(app.checks, row, { id })
	for (const { id, ...row } of graph.batches) tx.insert(app.transactionBatches, row, { id })
	for (const { id, ...row } of graph.templates) tx.insert(app.batchTemplates, row, { id })
	for (const { id, externalId, ...row } of graph.transactions)
		tx.insert(app.transactions, { ...row, ...(externalId === null ? {} : { externalId }) }, { id })
	for (const { id, ...row } of graph.transactionTags) tx.insert(app.transactionTags, row, { id })
	// Nullable transformed columns must be omitted on insertion to retain the null default.
	for (const {
		id,
		amountMinor,
		currency,
		expenseAmountMinor,
		expenseCurrency,
		incomeAmountMinor,
		incomeCurrency,
		...row
	} of graph.transfers)
		tx.insert(
			app.internalTransfers,
			{
				...row,
				...(amountMinor === null ? {} : { amountMinor }),
				...(currency === null ? {} : { currency }),
				...(expenseAmountMinor === null ? {} : { expenseAmountMinor }),
				...(expenseCurrency === null ? {} : { expenseCurrency }),
				...(incomeAmountMinor === null ? {} : { incomeAmountMinor }),
				...(incomeCurrency === null ? {} : { incomeCurrency })
			},
			{ id }
		)
	for (const { id, ...row } of graph.files) tx.insert(app.files, row, { id })
	for (const { id, ...row } of graph.links) tx.insert(app.transactionAttachments, row, { id })
	for (const { id, data, ...row } of graph.parts)
		tx.insert(app.fileParts, { ...row, data: new Uint8Array(data) }, { id })
}
/** Native Finance destination; DLF owns the journal, lock and transaction lifetime. */
export function createFinanceRestoreAdapter(
	db: FinanceRestoreDb,
	sample: FinanceRestorePlan,
	archive: IntegrityCheckedArchive,
	retain: RestoreTransactionWriter<Transaction<'mergeable'>, WriteHandle>['retainDetached']
) {
	const payload = archive.readPayload(),
		{ intent, graph } = sample
	if (intent.plan.batches.length > 1)
		throw new Error('Restore adapter supports one financial batch')
	if (
		!validateFinanceBackup(payload) ||
		archive.payloadDigest() !== intent.archive.payloadSha256 ||
		payload.archiveId !== intent.archive.archiveId ||
		canonicalRecovery(payload.profile) !== canonicalRecovery(intent.archive.profile) ||
		canonicalRecovery(payload.source) !== canonicalRecovery(intent.archive.source)
	)
		throw new Error('Recovery archive binding mismatch')
	const queries = recoveryQueries(graph, intent.operation.operationId)
	const control = {
		id: intent.operation.operationId,
		workspaceId: graph.workspace.id,
		sourceFileId: graph.source.file.id,
		ownerId: graph.workspace.ownerId,
		payloadSha256: intent.archive.payloadSha256,
		graphSha256: intent.plan.expectedGraphSha256,
		workspaceName: graph.workspace.name,
		workspaceKind: graph.workspace.kind,
		workspaceCurrency: graph.workspace.defaultCurrency
	}
	const expectedRows = financeGraphRows(graph)
	const matchesScope = (observed: RecoveryObservation) => {
		const row = observed[0][0]
		if (!row || observed[0].length !== 1) return false
		const { status: _status, ...rest } = row
		return canonicalRecovery(rest) === canonicalRecovery(control)
	}
	const sourceDigests = new WeakMap<RecoveryObservation, string>()
	const sourceLayout = (observed: RecoveryObservation | undefined) =>
		observed !== undefined &&
		canonicalRecovery(observed[14]) === canonicalRecovery([graph.source.file]) &&
		canonicalRecovery(observed[15].map(({ data: _data, ...part }) => part)) ===
			canonicalRecovery(graph.source.parts) &&
		observed[15].every((part) => part.data?.byteLength === part.sizeBytes)
	const matchesGraph = (observed: RecoveryObservation) =>
		canonicalRecovery(observed.slice(1, 13)) === canonicalRecovery(expectedRows) &&
		sourceLayout(observed) &&
		sourceDigests.get(observed) === intent.archive.payloadSha256
	const noFinancialRows = (observed: RecoveryObservation) =>
		observed.slice(1, 13).every((rows) => rows.length === 0)
	const presence = (
		observed: RecoveryObservation,
		input: RecoveryInput
	): RestoreDestinationResult => {
		const phase = observed[0][0]?.status
		if (input.step.writeId === intent.plan.preparation.writeId)
			return matchesScope(observed) &&
				sourceLayout(observed) &&
				sourceDigests.get(observed) === intent.archive.payloadSha256 &&
				(intent.plan.batches.length > 0 || matchesGraph(observed))
				? 'match'
				: observed.every((rows) => rows.length === 0)
					? 'missingOrHidden'
					: 'conflict'
		if (!matchesScope(observed)) return 'conflict'
		if (input.step.writeId === intent.plan.activation.writeId) {
			if (!matchesGraph(observed)) return 'conflict'
			if (
				phase === 'active' &&
				canonicalRecovery(observed[13]) === canonicalRecovery([graph.member])
			)
				return 'match'
			return phase === 'incomplete' && observed[13].length === 0 ? 'missingOrHidden' : 'conflict'
		}
		return matchesGraph(observed)
			? 'match'
			: phase === 'incomplete' &&
				  noFinancialRows(observed) &&
				  sourceLayout(observed) &&
				  sourceDigests.get(observed) === intent.archive.payloadSha256
				? 'missingOrHidden'
				: 'conflict'
	}
	const authority = (observed: RecoveryObservation | undefined, input: RecoveryInput) =>
		observed !== undefined &&
		(input.step.writeId === intent.plan.preparation.writeId
			? observed.every((rows) => rows.length === 0)
			: observed[0][0]?.status === 'incomplete' && presence(observed, input) === 'missingOrHidden')
	type Handle = { toJSON(): { kind: 'financeRecoveryObservation' } }
	const observations = new WeakMap<Handle, RecoveryObservation | undefined>()

	type Context = {
		input: RecoveryInput
		handle: Handle
		interruption: 'cancelled' | 'closed' | 'invalidated' | undefined
		result: RestoreDestinationResult
	}
	type LeafInput = Pick<Context, 'input' | 'handle'>
	const actors = {
		fingerprint: createAsyncLogic<boolean, RecoveryInput>({
			run: async () => {
				const { sha256, ...plan } = intent.plan
				const [graphHash, planHash] = await Promise.all([
					digestRecovery(graph),
					digestRecovery(plan)
				])
				return graphHash === intent.plan.expectedGraphSha256 && planHash === sha256
			}
		}),
		read: createAsyncLogic<void, LeafInput>({
			run: async ({ input: { input, handle } }) => {
				const observed =
					input.operation === 'read'
						? await restoreTransactionAccess(input).call((tx) =>
								readRecovery(tx, queries, 'local-first')
							)
						: await readRecovery(db, queries, 'remote')
				if (observations.has(handle)) observations.set(handle, observed)
			}
		}),
		stage: createAsyncLogic<void, RecoveryInput>({
			run: ({ input }) =>
				restoreTransactionAccess(input).call((tx) =>
					stageRecovery(tx, sample, input.step.writeId, archive)
				)
		}),
		hashSource: createAsyncLogic<void, LeafInput>({
			run: async ({ input: { handle } }) => {
				const observed = observations.get(handle)
				if (!observed) throw new Error('Missing source snapshot')
				const bytes = new Uint8Array(graph.source.file.sizeBytes)
				try {
					for (const part of observed[15]) {
						if (!part.data) throw new Error('Missing source bytes')
						bytes.set(part.data, part.partIndex * restorePartBytes)
					}
					const digest = await crypto.subtle.digest('SHA-256', bytes)
					if (observations.get(handle) === observed)
						sourceDigests.set(
							observed,
							[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
						)
				} finally {
					bytes.fill(0)
				}
			}
		})
	}
	const patchClassify = (args: { context: Context }): Partial<Context> => ({
		result: (({ context }) => {
			const observed = observations.get(context.handle)
			return observed ? presence(observed, context.input) : 'unavailable'
		})(args)
	})
	const events2 = {
		CANCEL: types<EventPayload<RestoreEvent, 'CANCEL'>>(),
		SHUTDOWN: types<EventPayload<RestoreEvent, 'SHUTDOWN'>>(),
		INVALIDATE: types<EventPayload<RestoreEvent, 'INVALIDATE'>>()
	}
	type NativeEvent2 =
		| import('xstate').InferEvents<typeof events2>
		| import('xstate').DoneActorEvent<
				| import('xstate').OutputFrom<(typeof actors)['fingerprint']>
				| import('xstate').OutputFrom<(typeof actors)['read']>
				| import('xstate').OutputFrom<(typeof actors)['stage']>
				| import('xstate').OutputFrom<(typeof actors)['hashSource']>
		  >
		| import('xstate').ErrorActorEvent
	const model = setup({
		schemas: {
			context: types<Context>(),
			events: events2,
			input: types<RecoveryInput>(),
			output: types<RestoreDestinationResult>(),
			children: {
				fingerprint: types<import('xstate').ActorFromLogic<(typeof actors)['fingerprint']>>(),
				read: types<import('xstate').ActorFromLogic<(typeof actors)['read']>>(),
				stage: types<import('xstate').ActorFromLogic<(typeof actors)['stage']>>(),
				hashSource: types<import('xstate').ActorFromLogic<(typeof actors)['hashSource']>>()
			}
		},
		actors,
		actions: {}
	})
	const destination = model.createMachine({
		context: ({ input }) => {
			const handle: Handle = { toJSON: () => ({ kind: 'financeRecoveryObservation' }) }
			observations.set(handle, undefined)
			return { input, handle, result: 'unavailable', interruption: undefined }
		},
		initial: 'validating',
		output: ({ context }) => context.interruption ?? context.result,
		on: {
			CANCEL: (args) => {
				return {
					context: (({ context, event }) => ({
						interruption: restoreInterruption(context.interruption, event)
					}))(args)
				}
			},
			SHUTDOWN: (args) => {
				return {
					context: (({ context, event }) => ({
						interruption: restoreInterruption(context.interruption, event)
					}))(args)
				}
			},
			INVALIDATE: (args) => {
				if (!sameBackupBinding(args.context.input.binding, args.event.binding)) return
				return {
					context: (({ context, event }) => ({
						interruption: restoreInterruption(context.interruption, event)
					}))(args)
				}
			}
		},
		states: {
			validating: {
				invoke: {
					src: 'fingerprint',
					input: ({ context }) => context.input,
					onDone: (args) => {
						const { context } = args
						if (
							!args.event.output ||
							db.getAuthState().session?.user !== intent.operation.identityId ||
							canonicalRecovery(context.input.intent) !== canonicalRecovery(intent) ||
							db.getConfig().appId !== intent.operation.applicationId ||
							context.input.binding.workspaceId !== graph.workspace.id ||
							context.input.binding.operationId !== intent.operation.operationId
						) {
							return { target: 'complete' }
						}
						if (context.interruption !== undefined) {
							return { target: 'complete' }
						}
						if (context.input.operation === 'stage') {
							return { target: 'staging' }
						}
						return { target: 'reading' }
					},
					onError: { target: 'complete' }
				}
			},
			reading: {
				invoke: {
					src: 'read',
					input: ({ context }) => context,
					onDone: (args) => {
						const { context } = args
						if (!context.interruption && sourceLayout(observations.get(context.handle))) {
							return { target: 'hashingSource' }
						}
						if (context.interruption !== undefined) {
							return { target: 'complete' }
						}
						if (
							context.input.operation === 'authority' &&
							authority(observations.get(context.handle), context.input)
						) {
							return { target: 'allowed' }
						}
						return { target: 'complete', context: ((args) => patchClassify(args))(args) }
					},
					onError: { target: 'complete' }
				}
			},
			hashingSource: {
				invoke: {
					src: 'hashSource',
					input: ({ context }) => context,
					onDone: (args) => {
						const { context } = args
						if (context.interruption !== undefined) {
							return { target: 'complete' }
						}
						if (
							context.input.operation === 'authority' &&
							authority(observations.get(context.handle), context.input)
						) {
							return { target: 'allowed' }
						}
						return { target: 'complete', context: ((args) => patchClassify(args))(args) }
					},
					onError: { target: 'complete' }
				}
			},

			staging: {
				invoke: {
					src: 'stage',
					input: ({ context }) => context.input,
					onDone: (args) => {
						if (args.context.interruption !== undefined) {
							return { target: 'complete' }
						}
						return { target: 'complete', context: { result: 'staged' } }
					},
					onError: { target: 'complete' }
				}
			},
			allowed: {
				type: 'final',
				entry: (args, enq) => {
					let context = args.context
					let patch = {}
					patch = { ...patch, result: 'allowed' }
					context = { ...args.context, ...patch }
					enq(() => observations.delete(context.handle))
					return { context: patch }
				}
			},
			complete: {
				type: 'final',
				entry: ({ context }, enq) => {
					enq(() => {
						observations.delete(context.handle)
					})
				}
			}
		}
	})
	const writer: RestoreTransactionWriter<Transaction<'mergeable'>, WriteHandle> = {
		open: () => db.beginTransaction(),
		commit: (tx) => tx.commit(),
		transactionId: (write) => write.txId,
		persistLocal: (write) => write.wait({ tier: 'local' }),
		acceptRemote: (write) => write.wait({ tier: 'global' }),
		isRemoteRejection: (error, id) =>
			error instanceof PersistedWriteRejectedError && error.transactionId === id,
		rollback: (tx) => tx.rollback(),
		retainDetached: retain
	}
	type ComparisonInput = {
		record: import('delightful-local-first/backup/restore/journal').RestoreJournalRecord
		binding: RecoveryInput['binding']
		databaseName: string
	}
	const comparisonActors = { destination, journal: createRestoreJournalStepMachine() }
	const events1 = {
		CANCEL: types<EventPayload<RestoreEvent, 'CANCEL'>>(),
		SHUTDOWN: types<EventPayload<RestoreEvent, 'SHUTDOWN'>>(),
		INVALIDATE: types<EventPayload<RestoreEvent, 'INVALIDATE'>>()
	}
	type NativeEvent1 =
		| import('xstate').InferEvents<typeof events1>
		| import('xstate').DoneActorEvent<
				| import('xstate').OutputFrom<(typeof comparisonActors)['destination']>
				| import('xstate').OutputFrom<(typeof comparisonActors)['journal']>
				| import('xstate').OutputFrom<(typeof comparisonActors)['destination']>
		  >
		| import('xstate').ErrorActorEvent
	const comparisonModel = setup({
		schemas: {
			context: types<
				ComparisonInput & {
					candidate: ComparisonInput['record'] | undefined
					result: ComparisonInput['record'] | undefined
					interruption: 'cancelled' | 'closed' | 'invalidated' | undefined
				}
			>(),
			events: events1,
			input: types<ComparisonInput>(),
			output: types<ComparisonInput['record'] | undefined>()
		},
		actors: comparisonActors,
		actions: {}
	})
	const comparison = comparisonModel.createMachine({
		context: ({ input }) => ({
			...input,
			candidate: undefined,
			result: undefined,
			interruption: undefined
		}),
		initial: 'comparing',
		output: ({ context }) => (context.interruption ? undefined : context.result),
		on: {
			CANCEL: (args) => {
				return {
					context: (({ context, event }) => ({
						interruption: restoreInterruption(context.interruption, event)
					}))(args)
				}
			},
			SHUTDOWN: (args) => {
				return {
					context: (({ context, event }) => ({
						interruption: restoreInterruption(context.interruption, event)
					}))(args)
				}
			},
			INVALIDATE: (args) => {
				if (!sameBackupBinding(args.context.binding, args.event.binding)) return
				return {
					context: (({ context, event }) => ({
						interruption: restoreInterruption(context.interruption, event)
					}))(args)
				}
			}
		},
		states: {
			comparing: {
				on: {
					CANCEL: (args, enq) => {
						enq.sendTo('snapshot', args.event)
						return {
							context: (({ context, event }) => ({
								interruption: restoreInterruption(context.interruption, event)
							}))(args)
						}
					},
					SHUTDOWN: (args, enq) => {
						enq.sendTo('snapshot', args.event)
						return {
							context: (({ context, event }) => ({
								interruption: restoreInterruption(context.interruption, event)
							}))(args)
						}
					},
					INVALIDATE: (args, enq) => {
						if (!sameBackupBinding(args.context.binding, args.event.binding)) return
						enq.sendTo('snapshot', args.event)
						return {
							context: (({ context, event }) => ({
								interruption: restoreInterruption(context.interruption, event)
							}))(args)
						}
					}
				},
				invoke: {
					id: 'snapshot',
					src: 'destination',
					input: ({ context }) => ({
						binding: context.binding,
						databaseName: context.databaseName,
						intent,
						step: intent.plan.batches[0] ?? intent.plan.preparation,
						operation: 'remote'
					}),
					onDone: (args) => {
						const { context } = args
						if (
							!context.interruption &&
							args.event.output === 'match' &&
							context.record.checkpoint.kind === 'comparing'
						) {
							return {
								target: 'saving',
								context: {
									candidate: (({ context }) => {
										if (context.record.checkpoint.kind !== 'comparing')
											throw new Error('Comparison checkpoint required')
										return parseRestoreJournalRecord({
											...context.record,
											revision: context.record.revision + 1,
											checkpoint: {
												kind: 'activating',
												completed: context.record.checkpoint.completed,
												comparison: {
													payloadSha256: intent.archive.payloadSha256,
													graphSha256: intent.plan.expectedGraphSha256
												},
												current: {
													status: 'notIssued',
													writeId: intent.plan.activation.writeId,
													issuance: 0
												}
											}
										})
									})(args)
								}
							}
						}
						return { target: 'complete' }
					},
					onError: { target: 'complete' }
				}
			},
			saving: {
				invoke: {
					src: 'journal',
					input: ({ context }) => {
						if (!context.candidate) throw new Error('Missing comparison candidate')
						return {
							binding: context.binding,
							databaseName: context.databaseName,
							command: {
								mode: 'update',
								expectedRevision: context.record.revision,
								record: context.candidate
							}
						}
					},
					onDone: (args) => {
						const { event } = args
						return {
							target: 'complete',
							context: {
								result:
									event.output.outcome === 'updated' || event.output.outcome === 'existing'
										? event.output.record
										: undefined
							}
						}
					},
					onError: { target: 'complete' }
				}
			},
			complete: { type: 'final' }
		}
	})
	const machine = createRestoreMachine(writer, destination)
	const operation: RestoreOperationAdapter<
		typeof machine,
		RestoreInput,
		RestoreResult | undefined
	> = {
		input: (input) => input,
		result: (output) => output,
		recipient: (actor) => actor
	}
	const comparisonOperation: RestoreOperationAdapter<
		typeof comparison,
		FinanceRestoreComparisonInput,
		RestoreJournalRecord | undefined
	> = {
		input: (input) => input,
		result: (output) => output,
		recipient: (actor) => actor
	}
	return { machine, comparison, destination, writer, operation, comparisonOperation }
}

export type WorkspaceRestoreFile = { toJSON(): { kind: 'workspaceRestoreFile' }; release(): void }
export type WorkspaceRestoreConfiguration = {
	appId: string
	serverUrl: string
	environment: string
}
type RestoreScope = WorkspaceRestoreConfiguration & {
	session: JazzSession<JazzClient>
	account: AccountHandle
	client: JazzClient
}
type RestoreFileData = {
	file: File
	name?: string | undefined
	password: string | undefined
	scope?: RestoreScope | undefined
	bytes?: Uint8Array | undefined
	envelope?: ArchiveEnvelopeRequest | undefined
	archive?: IntegrityCheckedArchive | undefined
	plan?: FinanceRestorePlanRequest | undefined
	binding?: BackupBinding | undefined
	previous?: RestoreJournalRecord | undefined
	logic?: ReturnType<typeof createFinanceWorkspaceRestore> | undefined
}
const restoreFiles = new WeakMap<WorkspaceRestoreFile, RestoreFileData>()
export function prepareWorkspaceRestoreFile(file: File, password: string): WorkspaceRestoreFile {
	const request: WorkspaceRestoreFile = {
		toJSON: () => ({ kind: 'workspaceRestoreFile' }),
		release() {
			const value = restoreFiles.get(request)
			value?.bytes?.fill(0)
			value?.plan?.release()
			value?.archive?.release()
			value?.envelope?.release()
			restoreFiles.delete(request)
		}
	}
	restoreFiles.set(request, { file, password: password || undefined })
	return request
}
function restoreFile(request: WorkspaceRestoreFile | undefined) {
	return required(request && restoreFiles.get(request))
}
export function workspaceRestoreSessionReady(session: JazzSession<JazzClient> | undefined) {
	const state = session?.getSnapshot()
	return state?.status === 'ready' && state.account !== undefined && state.client !== undefined
}
export function workspaceRestoreFileAvailable(request: WorkspaceRestoreFile) {
	return restoreFiles.has(request) && restoreFiles.get(request)?.scope === undefined
}
function restoreScopeCurrent(scope: RestoreScope) {
	const state = scope.session.getSnapshot()
	return (
		state.status === 'ready' &&
		state.account?.id === scope.account.id &&
		state.client === scope.client
	)
}
export function bindWorkspaceRestoreFile(
	request: WorkspaceRestoreFile,
	session: JazzSession<JazzClient>,
	config: WorkspaceRestoreConfiguration
) {
	const state = session.getSnapshot()
	if (state.status !== 'ready' || !state.account || !state.client)
		throw new Error('Restore session unavailable')
	restoreFile(request).scope = { ...config, session, account: state.account, client: state.client }
}
const restoreJournalName = 'finance-workspace-restores'
export type WorkspaceRestoreCommand = {
	type: 'CONFIRM' | 'CANCEL' | 'DRAIN' | 'RETRY_RELEASE' | 'DISMISS' | 'OPEN' | 'RELOAD'
}
export type WorkspaceRestoreMessage =
	'preparing' | 'restoring' | 'done' | 'cancelled' | 'failed' | 'conflict' | undefined
export type WorkspaceRestoreView = {
	alert: boolean
	busy: boolean
	editable: boolean
	canConfirm: boolean
	confirmAction: 'create' | 'retry'
	canCancel: boolean
	canRetryRelease: boolean
	canReload: boolean
	canOpen: boolean
	visibleOutsideSettings: boolean
	message: WorkspaceRestoreMessage
	workspaceName: string | undefined
	workspaceId: string | undefined
	identityId: string | undefined
}
export const emptyWorkspaceRestoreView: WorkspaceRestoreView = {
	alert: false,
	busy: false,
	editable: true,
	canConfirm: false,
	confirmAction: 'create',
	canCancel: false,
	canRetryRelease: false,
	canReload: false,
	canOpen: false,
	visibleOutsideSettings: false,
	message: undefined,
	workspaceName: undefined,
	workspaceId: undefined,
	identityId: undefined
}
type RestoreControllerContext = {
	request: WorkspaceRestoreFile | undefined
	binding: BackupBinding | undefined
	previous: RestoreJournalRecord | undefined
	native: ActorFromLogic<ReturnType<typeof createFinanceWorkspaceRestore>> | undefined
	interruption: 'cancelled' | 'invalidated' | undefined
	result: 'done' | 'cancelled' | 'failed' | 'conflict' | undefined
	name: string | undefined
}
type RestoreControllerEvent =
	| WorkspaceRestoreCommand
	| { type: 'SUBMIT'; request: WorkspaceRestoreFile }
	| { type: 'SCOPE_CHANGED' }
	| {
			type: 'xstate.done.actor'
			output: FinanceRestoreSessionResult
			actorId: string
	  }
	| import('xstate').ErrorActorEvent
	| {
			type: 'xstate.snapshot.actor'
			actorId: 'nativeRestore'
			snapshot: SnapshotFrom<ReturnType<typeof createFinanceWorkspaceRestore>>
	  }
/** Root-lifetime controller. Dynamic native children own each checked operation's SDK resources. */
function controllerInterruption(
	previous: RestoreControllerContext['interruption'],
	type: string
): RestoreControllerContext['interruption'] {
	return type === 'CANCEL' ? (previous ?? 'cancelled') : 'invalidated'
}
export function createWorkspaceRestoreController(
	navigate: (destination: string) => Promise<void> = async () => {
		throw new Error('Navigation unavailable')
	},
	acquireClient: (config: DbConfig) => Promise<RestoreClient> = openRestoreClient
) {
	const actors = {
		observe: createCallbackLogic<RestoreControllerEvent, WorkspaceRestoreFile>(
			({ input, sendBack }) => {
				const scope = required(restoreFile(input).scope)
				const observe = () => {
					try {
						if (!restoreScopeCurrent(scope)) sendBack({ type: 'SCOPE_CHANGED' })
					} catch {
						sendBack({ type: 'SCOPE_CHANGED' })
					}
				}
				observe()
				return scope.session.subscribe(observe)
			}
		),
		readFile: createAsyncLogic<void, WorkspaceRestoreFile>({
			run: async ({ input }) => {
				const value = restoreFile(input)
				if (
					!Number.isSafeInteger(value.file.size) ||
					value.file.size <= 0 ||
					value.file.size > 64 * 1024 * 1024
				)
					throw new Error('Invalid restore file size')
				const bytes = new Uint8Array(await value.file.arrayBuffer())
				value.bytes = bytes
				if (bytes.length !== value.file.size) throw new Error('Restore file changed')
			}
		}),
		prepareEnvelope: createAsyncLogic<void, WorkspaceRestoreFile>({
			run: ({ input }) => {
				const value = restoreFile(input),
					bytes = required(value.bytes)
				value.envelope = prepareArchiveOpen(bytes, value.password)
				value.password = undefined
				bytes.fill(0)
				value.bytes = undefined
				return Promise.resolve()
			}
		}),
		open: createArchiveEnvelopeMachine(),
		validateFile: createAsyncLogic<string, WorkspaceRestoreFile>({
			run: ({ input }) => {
				const value = restoreFile(input),
					archive = required(value.archive),
					payload = archive.readPayload()
				if (!validateFinanceBackup(payload)) throw new Error('Unsupported Finance backup')
				const bytes = archive.copyPayloadBytes(),
					size = bytes.length
				bytes.fill(0)
				const ids = new Set(
						payload.records.filter((row) => row.type === 'files').map((row) => row.id)
					),
					files = payload.attachments.filter((file) => ids.has(file.id))
				if (
					size > payloadLimits.attachmentBytes ||
					size + files.reduce((sum, file) => sum + file.sizeBytes, 0) >
						payloadLimits.totalAttachmentBytes ||
					files.length + 1 > payloadLimits.attachments ||
					payload.records.length + 2 > payloadLimits.records
				)
					throw new Error('Restore exceeds backup capacity')
				const name = payload.records.find(
					(row) => row.type === 'organizations' && row.id === payload.source.workspaceId
				)?.fields.name
				if (name?.kind !== 'text') throw new Error('Missing workspace')
				value.name = name.value
				return Promise.resolve(name.value)
			}
		}),
		deriveBinding: createAsyncLogic<BackupBinding, WorkspaceRestoreFile>({
			run: async ({ input }) => {
				const value = restoreFile(input),
					archive = required(value.archive),
					scope = required(value.scope),
					payload = archive.readPayload()
				const operationId = await stableUuid(
						scope.account.id,
						JSON.stringify([scope.appId, scope.environment, archive.payloadDigest()])
					),
					workspaceId = await stableUuid(
						operationId,
						JSON.stringify(['record', 'organizations', payload.source.workspaceId])
					)
				const binding = {
					applicationId: scope.appId,
					environment: scope.environment,
					identityId: scope.account.id,
					operationId,
					workspaceId,
					generation: 0
				}
				value.binding = binding
				return binding
			}
		}),
		journal: createRestoreJournalStepMachine(),
		preparePlan: createAsyncLogic<
			void,
			{ request: WorkspaceRestoreFile; previous: RestoreJournalRecord | undefined }
		>({
			run: ({ input }) => {
				const value = restoreFile(input.request),
					binding = required(value.binding),
					archive = required(value.archive)
				value.previous = input.previous
				value.plan = prepareFinanceRestorePlan(
					archive,
					{ ...binding, workspaceId: archive.readPayload().source.workspaceId },
					input.previous?.intent
				)
				return Promise.resolve()
			}
		}),
		plan: financeRestorePlanningMachine,
		prepareNative: createAsyncLogic<void, WorkspaceRestoreFile>({
			run: ({ input }) => {
				const value = restoreFile(input),
					scope = required(value.scope)
				if (!restoreScopeCurrent(scope)) throw new Error('Restore scope changed')
				value.logic = createFinanceWorkspaceRestore(
					{
						account: scope.account,
						serverUrl: scope.serverUrl,
						binding: required(value.binding),
						databaseName: restoreJournalName,
						mode: value.previous ? 'resume' : 'new',
						archive: required(value.archive),
						plan: required(value.plan),
						releaseFile() {
							value.envelope?.release()
							value.envelope = undefined
							value.archive = undefined
							value.plan = undefined
						}
					},
					acquireClient
				)
				return Promise.resolve()
			}
		}),
		cleanup: createAsyncLogic<void, WorkspaceRestoreFile | undefined>({
			run: ({ input }) => {
				input?.release()
				return Promise.resolve()
			}
		}),
		navigate: createAsyncLogic<void, BackupBinding>({
			run: ({ input }) =>
				navigate('/settings/workspace?workspace=' + encodeURIComponent(input.workspaceId))
		})
	}
	const patchRememberBinding = ({
		context
	}: {
		context: RestoreControllerContext
	}): Partial<RestoreControllerContext> => ({
		binding: required(restoreFile(context.request).binding)
	})
	const patchRememberName = ({
		context
	}: {
		context: RestoreControllerContext
	}): Partial<RestoreControllerContext> => ({ name: restoreFile(context.request).name })
	const patchFail = (): Partial<RestoreControllerContext> => ({ result: 'failed' })
	const events0 = {
		CONFIRM: types<EventPayload<RestoreControllerEvent, 'CONFIRM'>>(),
		CANCEL: types<EventPayload<RestoreControllerEvent, 'CANCEL'>>(),
		DRAIN: types<EventPayload<RestoreControllerEvent, 'DRAIN'>>(),
		RETRY_RELEASE: types<EventPayload<RestoreControllerEvent, 'RETRY_RELEASE'>>(),
		DISMISS: types<EventPayload<RestoreControllerEvent, 'DISMISS'>>(),
		OPEN: types<EventPayload<RestoreControllerEvent, 'OPEN'>>(),
		RELOAD: types<EventPayload<RestoreControllerEvent, 'RELOAD'>>(),
		SUBMIT: types<EventPayload<RestoreControllerEvent, 'SUBMIT'>>(),
		SCOPE_CHANGED: types<EventPayload<RestoreControllerEvent, 'SCOPE_CHANGED'>>()
	}
	type NativeEvent0 =
		| import('xstate').InferEvents<typeof events0>
		| import('xstate').DoneActorEvent<
				| import('xstate').OutputFrom<(typeof actors)['observe']>
				| import('xstate').OutputFrom<(typeof actors)['readFile']>
				| import('xstate').OutputFrom<(typeof actors)['prepareEnvelope']>
				| import('xstate').OutputFrom<(typeof actors)['open']>
				| import('xstate').OutputFrom<(typeof actors)['validateFile']>
				| import('xstate').OutputFrom<(typeof actors)['deriveBinding']>
				| import('xstate').OutputFrom<(typeof actors)['journal']>
				| import('xstate').OutputFrom<(typeof actors)['preparePlan']>
				| import('xstate').OutputFrom<(typeof actors)['plan']>
				| import('xstate').OutputFrom<(typeof actors)['prepareNative']>
				| import('xstate').OutputFrom<(typeof actors)['cleanup']>
				| import('xstate').OutputFrom<(typeof actors)['navigate']>
				| import('xstate').OutputFrom<(typeof actors)['plan']>
		  >
		| import('xstate').ErrorActorEvent
	const model = setup({
		schemas: {
			context: types<RestoreControllerContext>(),
			events: events0,
			children: {
				observe: types<import('xstate').ActorFromLogic<(typeof actors)['observe']>>(),
				readFile: types<import('xstate').ActorFromLogic<(typeof actors)['readFile']>>(),
				prepareEnvelope:
					types<import('xstate').ActorFromLogic<(typeof actors)['prepareEnvelope']>>(),
				open: types<import('xstate').ActorFromLogic<(typeof actors)['open']>>(),
				validateFile: types<import('xstate').ActorFromLogic<(typeof actors)['validateFile']>>(),
				deriveBinding: types<import('xstate').ActorFromLogic<(typeof actors)['deriveBinding']>>(),
				journal: types<import('xstate').ActorFromLogic<(typeof actors)['journal']>>(),
				preparePlan: types<import('xstate').ActorFromLogic<(typeof actors)['preparePlan']>>(),
				plan: types<import('xstate').ActorFromLogic<(typeof actors)['plan']>>(),
				prepareNative: types<import('xstate').ActorFromLogic<(typeof actors)['prepareNative']>>(),
				cleanup: types<import('xstate').ActorFromLogic<(typeof actors)['cleanup']>>(),
				navigate: types<import('xstate').ActorFromLogic<(typeof actors)['navigate']>>(),
				planner: types<import('xstate').ActorFromLogic<(typeof actors)['plan']>>(),
				nativeRestore:
					types<import('xstate').ActorFromLogic<ReturnType<typeof createFinanceWorkspaceRestore>>>()
			}
		},
		actors,
		guards: {
			interrupted: ({ context }: { context: RestoreControllerContext }) =>
				context.interruption !== undefined
		},
		actions: {}
	})
	const input = ({ context }: { context: RestoreControllerContext }) => required(context.request)
	return model.createMachine({
		id: 'workspace-restore-controller',
		initial: 'idle',
		context: {
			request: undefined,
			binding: undefined,
			previous: undefined,
			native: undefined,
			interruption: undefined,
			result: undefined,
			name: undefined
		},
		on: {
			SUBMIT: (args, enq) => {
				enq(({ context, event }) => {
					if (context.request !== event.request) event.request.release()
				}, args)
			}
		},
		states: {
			idle: {
				on: {
					SUBMIT: (args) => {
						return {
							target: 'operation',
							context: {
								request: args.event.request,
								binding: undefined,
								previous: undefined,
								native: undefined,
								interruption: undefined,
								result: undefined,
								name: undefined
							}
						}
					},
					DRAIN: {},
					DISMISS: {}
				}
			},
			operation: {
				initial: 'reading',
				invoke: {
					src: 'observe',
					input,
					onError: (args, enq) => {
						enq.raise({ type: 'SCOPE_CHANGED' })
					}
				},
				states: {
					reading: {
						invoke: {
							src: 'readFile',
							input,
							onDone: (args) => ({
								target: args.guards.interrupted(args) ? 'cleaning' : 'preparingEnvelope'
							}),
							onError: { target: 'cleaning', context: { result: 'failed' } }
						}
					},
					preparingEnvelope: {
						invoke: {
							src: 'prepareEnvelope',
							input,
							onDone: (args) => ({
								target: args.guards.interrupted(args) ? 'cleaning' : 'opening'
							}),
							onError: { target: 'cleaning', context: { result: 'failed' } }
						}
					},
					opening: {
						on: {
							CANCEL: (args, enq) => {
								enq.sendTo('open', { type: 'CANCEL' })
								return {
									context: (({ context, event }) => ({
										interruption: controllerInterruption(context.interruption, event.type)
									}))(args)
								}
							},
							DRAIN: (args, enq) => {
								enq.sendTo('open', { type: 'SHUTDOWN' })
								return {
									context: (({ context, event }) => ({
										interruption: controllerInterruption(context.interruption, event.type)
									}))(args)
								}
							},
							SCOPE_CHANGED: (args, enq) => {
								enq.sendTo('open', { type: 'SHUTDOWN' })
								return {
									context: (({ context, event }) => ({
										interruption: controllerInterruption(context.interruption, event.type)
									}))(args)
								}
							}
						},
						invoke: {
							id: 'open',
							src: 'open',
							input: ({ context }) => ({
								request: required(restoreFile(context.request).envelope)
							}),
							onDone: (args, enq) => {
								const { context, event } = args
								if (!context.interruption && event.output.outcome === 'integrityChecked') {
									enq(({ context, event }) => {
										if (event.output.outcome === 'integrityChecked')
											restoreFile(context.request).archive = event.output.archive
									}, args)
									return { target: 'validating' }
								}
								enq(({ context, event }) => {
									if (event.output.outcome === 'integrityChecked')
										restoreFile(context.request).archive = event.output.archive
								}, args)
								return { target: 'cleaning', context: { result: 'failed' } }
							},
							onError: { target: 'cleaning', context: { result: 'failed' } }
						}
					},
					validating: {
						invoke: {
							src: 'validateFile',
							input,
							onDone: (args) => ({
								target: args.guards.interrupted(args) ? 'cleaning' : 'deriving',
								context: patchRememberName(args)
							}),
							onError: { target: 'cleaning', context: { result: 'failed' } }
						}
					},
					deriving: {
						invoke: {
							src: 'deriveBinding',
							input,
							onDone: (args) => ({
								target: args.guards.interrupted(args) ? 'cleaning' : 'initializingJournal',
								context: patchRememberBinding(args)
							}),
							onError: { target: 'cleaning', context: { result: 'failed' } }
						}
					},
					initializingJournal: {
						invoke: {
							src: 'journal',
							input: ({ context }) => ({
								binding: required(context.binding),
								databaseName: restoreJournalName,
								command: { mode: 'initialize' }
							}),
							onDone: ({ context, event }) => {
								if (context.interruption !== undefined) return { target: 'cleaning' }
								if (event.output.outcome === 'initialized') return { target: 'discovering' }
								return { target: 'cleaning', context: { result: 'failed' } }
							},
							onError: { target: 'cleaning', context: { result: 'failed' } }
						}
					},
					discovering: {
						invoke: {
							src: 'journal',
							input: ({ context }) => ({
								binding: required(context.binding),
								databaseName: restoreJournalName,
								command: { mode: 'discover' }
							}),
							onDone: ({ context, event }, enq) => {
								if (context.interruption !== undefined) return { target: 'cleaning' }
								const result = event.output
								if (
									result.outcome === 'loaded' &&
									result.record &&
									!matchesRestoreFile(required(context.request), result.record)
								)
									return { target: 'cleaning', context: { result: 'failed' } }
								if (result.outcome === 'loaded' && result.record?.checkpoint.kind === 'complete')
									return { target: 'cleaning', context: { result: 'done' } }
								if (
									result.outcome === 'conflict' ||
									(result.outcome === 'loaded' && result.record?.checkpoint.kind === 'conflict')
								)
									return { target: 'cleaning', context: { result: 'conflict' } }
								if (result.outcome === 'missing' || result.outcome === 'loaded') {
									return { target: 'preparingPlan', context: { previous: result.record } }
								}
								return { target: 'cleaning', context: { result: 'failed' } }
							},
							onError: { target: 'cleaning', context: { result: 'failed' } }
						}
					},
					preparingPlan: {
						invoke: {
							src: 'preparePlan',
							input: ({ context }) => ({
								request: required(context.request),
								previous: context.previous
							}),
							onDone: (args) => ({
								target: args.guards.interrupted(args) ? 'cleaning' : 'planning'
							}),
							onError: { target: 'cleaning', context: { result: 'failed' } }
						}
					},
					planning: {
						on: {
							CANCEL: (args, enq) => {
								enq.sendTo('planner', { type: 'CANCEL' })
								return {
									context: (({ context, event }) => ({
										interruption: controllerInterruption(context.interruption, event.type)
									}))(args)
								}
							},
							DRAIN: (args, enq) => {
								enq.sendTo('planner', { type: 'SHUTDOWN' })
								return {
									context: (({ context, event }) => ({
										interruption: controllerInterruption(context.interruption, event.type)
									}))(args)
								}
							},
							SCOPE_CHANGED: (args, enq) => {
								enq.sendTo('planner', { type: 'SHUTDOWN' })
								return {
									context: (({ context, event }) => ({
										interruption: controllerInterruption(context.interruption, event.type)
									}))(args)
								}
							}
						},
						invoke: {
							id: 'planner',
							src: 'plan',
							input: ({ context }) => ({ request: required(restoreFile(context.request).plan) }),
							onDone: ({ context, event }) =>
								!context.interruption && event.output.outcome === 'planned'
									? { target: 'review' }
									: { target: 'cleaning', context: { result: 'failed' } },
							onError: { target: 'cleaning', context: { result: 'failed' } }
						}
					},
					review: {
						on: {
							CONFIRM: { target: 'preparingNative' },
							CANCEL: (args) => {
								return {
									target: 'cleaning',
									context: (({ context, event }) => ({
										interruption: controllerInterruption(context.interruption, event.type)
									}))(args)
								}
							},
							DRAIN: (args) => {
								return {
									target: 'cleaning',
									context: (({ context, event }) => ({
										interruption: controllerInterruption(context.interruption, event.type)
									}))(args)
								}
							},
							SCOPE_CHANGED: (args) => {
								return {
									target: 'cleaning',
									context: (({ context, event }) => ({
										interruption: controllerInterruption(context.interruption, event.type)
									}))(args)
								}
							}
						}
					},
					preparingNative: {
						invoke: {
							src: 'prepareNative',
							input,
							onDone: (args, enq) => {
								const { context } = args
								if (context.interruption !== undefined) {
									return { target: 'cleaning' }
								}
								return {
									target: 'restoring',
									context: {
										native: (({ context, spawn }) =>
											spawn(required(restoreFile(context.request).logic), {
												id: 'nativeRestore',
												syncSnapshot: true
											}))({ ...args, spawn: enq.spawn })
									}
								}
							},
							onError: { target: 'cleaning', context: { result: 'failed' } }
						}
					},
					restoring: {
						on: {
							CANCEL: (args, enq) => {
								let context = args.context
								let patch = {}
								patch = {
									...patch,
									...(({ context, event }) => ({
										interruption: controllerInterruption(context.interruption, event.type)
									}))(args)
								}
								context = { ...args.context, ...patch }
								enq.sendTo(required(context.native), { type: 'CANCEL' })
								return { context: patch }
							},
							DRAIN: (args, enq) => {
								let context = args.context
								let patch = {}
								patch = {
									...patch,
									...(({ context, event }) => ({
										interruption: controllerInterruption(context.interruption, event.type)
									}))(args)
								}
								context = { ...args.context, ...patch }
								enq.sendTo(required(context.native), { type: 'SHUTDOWN' })
								return { context: patch }
							},
							SCOPE_CHANGED: (args, enq) => {
								let context = args.context
								let patch = {}
								patch = {
									...patch,
									...(({ context, event }) => ({
										interruption: controllerInterruption(context.interruption, event.type)
									}))(args)
								}
								context = { ...args.context, ...patch }
								enq.sendTo(required(context.native), { type: 'SHUTDOWN' })
								return { context: patch }
							}
						}
					},
					releaseBlocked: {
						on: {
							RETRY_RELEASE: (args, enq) => {
								enq.sendTo(required(args.context.native), {
									type: 'RETRY_RELEASE'
								})
								return { target: 'restoring' }
							},
							CANCEL: (args, enq) => {
								let context = args.context
								let patch = {}
								patch = {
									...patch,
									...(({ context, event }) => ({
										interruption: controllerInterruption(context.interruption, event.type)
									}))(args)
								}
								context = { ...args.context, ...patch }
								enq.sendTo(required(context.native), { type: 'CANCEL' })
								return { context: patch }
							},
							DRAIN: (args, enq) => {
								let context = args.context
								let patch = {}
								patch = {
									...patch,
									...(({ context, event }) => ({
										interruption: controllerInterruption(context.interruption, event.type)
									}))(args)
								}
								context = { ...args.context, ...patch }
								enq.sendTo(required(context.native), { type: 'SHUTDOWN' })
								return { context: patch }
							},
							SCOPE_CHANGED: (args, enq) => {
								let context = args.context
								let patch = {}
								patch = {
									...patch,
									...(({ context, event }) => ({
										interruption: controllerInterruption(context.interruption, event.type)
									}))(args)
								}
								context = { ...args.context, ...patch }
								enq.sendTo(required(context.native), { type: 'SHUTDOWN' })
								return { context: patch }
							}
						}
					},
					restartRequired: {},
					cleaning: {
						invoke: {
							src: 'cleanup',
							input: ({ context }) => context.request,
							onDone: { target: '#workspace-restore-controller.finished' },
							onError: { target: 'cleanupBlocked' }
						}
					},
					cleanupBlocked: { on: { RETRY_RELEASE: { target: 'cleaning' } } }
				},
				on: {
					CANCEL: (args) => {
						return {
							context: (({ context, event }) => ({
								interruption: controllerInterruption(context.interruption, event.type)
							}))(args)
						}
					},
					DRAIN: (args) => {
						return {
							context: (({ context, event }) => ({
								interruption: controllerInterruption(context.interruption, event.type)
							}))(args)
						}
					},
					SCOPE_CHANGED: (args) => {
						return {
							context: (({ context, event }) => ({
								interruption: controllerInterruption(context.interruption, event.type)
							}))(args)
						}
					},
					'xstate.snapshot.actor': (args, enq) => {
						return ((args) => {
							const { context, event } = args
							if (
								event.type === 'xstate.snapshot.actor' &&
								event.actorId === 'nativeRestore' &&
								isMachineSnapshot(event.snapshot) &&
								event.snapshot.hasTag('restore-restart-required')
							) {
								return { target: '.restartRequired', context: patchFail() }
							}
							if (
								event.type === 'xstate.snapshot.actor' &&
								event.actorId === 'nativeRestore' &&
								isMachineSnapshot(event.snapshot) &&
								event.snapshot.hasTag('restore-release-blocked')
							) {
								return { target: '.releaseBlocked' }
							}
						})(args)
					},
					'xstate.done.actor': (args, enq) => {
						return ((args, enq) => {
							const { context, event } = args
							if (!(event.actorId === 'nativeRestore')) return
							enq.stop(required(context.native))
							return {
								target: '.cleaning',
								context: {
									native: undefined,
									result:
										event.output.record?.checkpoint.kind === 'complete' ||
										event.output.outcome === 'complete'
											? 'done'
											: event.output.outcome === 'conflict'
												? 'conflict'
												: event.output.outcome === 'cancelled'
													? 'cancelled'
													: 'failed'
								}
							}
						})(args, enq)
					},
					'xstate.error.actor': (args, enq) => {
						return ((args) => {
							if (!(args.event.actorId === 'nativeRestore')) return
							return { target: '.restartRequired', context: { result: 'failed' } }
						})(args)
					}
				}
			},
			finished: {
				on: {
					SUBMIT: (args) => {
						return {
							target: 'operation',
							context: {
								request: args.event.request,
								binding: undefined,
								previous: undefined,
								native: undefined,
								interruption: undefined,
								result: undefined,
								name: undefined
							}
						}
					},
					DRAIN: () => {
						return {
							target: 'idle',
							context: { result: undefined, name: undefined, binding: undefined }
						}
					},
					DISMISS: () => {
						return {
							target: 'idle',
							context: { result: undefined, name: undefined, binding: undefined }
						}
					},
					OPEN: (args) => {
						const { context } = args
						if (!(context.result === 'done' && context.binding !== undefined)) return
						return { target: 'openingDestination' }
					}
				}
			},
			openingDestination: {
				invoke: {
					src: 'navigate',
					input: ({ context }) => required(context.binding),
					onDone: { target: 'finished' },
					onError: () => {
						return { target: 'finished', context: { result: 'failed' } }
					}
				},
				on: {
					DRAIN: (args) => {
						return {
							context: (({ context, event }) => ({
								interruption: controllerInterruption(context.interruption, event.type)
							}))(args)
						}
					},
					CANCEL: (args) => {
						return {
							context: (({ context, event }) => ({
								interruption: controllerInterruption(context.interruption, event.type)
							}))(args)
						}
					}
				}
			}
		}
	})
}
function matchesRestoreFile(request: WorkspaceRestoreFile, record: RestoreJournalRecord) {
	const archive = required(restoreFile(request).archive),
		payload = archive.readPayload(),
		intent = record.intent
	return (
		intent.archive.payloadSha256 === archive.payloadDigest() &&
		intent.archive.archiveId === payload.archiveId &&
		canonicalRecovery(intent.archive.profile) === canonicalRecovery(payload.profile) &&
		canonicalRecovery(intent.archive.source) === canonicalRecovery(payload.source)
	)
}
export function selectWorkspaceRestoreReport(
	snapshot: SnapshotFrom<ReturnType<typeof createWorkspaceRestoreController>>
) {
	const context = snapshot.context,
		busy = snapshot.matches('operation') || snapshot.matches('openingDestination'),
		review = snapshot.matches({ operation: 'review' }),
		blocked =
			snapshot.matches({ operation: 'releaseBlocked' }) ||
			snapshot.matches({ operation: 'cleanupBlocked' }),
		restartRequired = snapshot.matches({ operation: 'restartRequired' })
	const result =
		context.result === 'done' && context.interruption !== 'invalidated'
			? 'done'
			: context.interruption === 'cancelled'
				? 'cancelled'
				: context.interruption === 'invalidated'
					? undefined
					: context.result
	const view: WorkspaceRestoreView = {
		...emptyWorkspaceRestoreView,
		busy,
		editable: !busy,
		canConfirm: review,
		confirmAction: context.previous ? 'retry' : 'create',
		canCancel:
			busy &&
			!blocked &&
			!restartRequired &&
			!snapshot.matches({ operation: 'cleaning' }) &&
			!snapshot.matches('openingDestination'),
		canRetryRelease: blocked,
		canReload: restartRequired,
		canOpen: !busy && result === 'done' && context.binding !== undefined,
		visibleOutsideSettings: busy || result !== undefined,
		message: busy
			? review
				? undefined
				: blocked || restartRequired
					? 'failed'
					: snapshot.matches({ operation: 'restoring' })
						? 'restoring'
						: 'preparing'
			: result,
		workspaceName: context.name,
		workspaceId: context.binding?.workspaceId,
		identityId: context.binding?.identityId
	}
	view.alert = view.message === 'failed' || view.message === 'conflict'
	return { request: context.request, view }
}
