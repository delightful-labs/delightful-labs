import {
	createJazzClient as createSession,
	type JazzClientConfig,
	type JazzClient
} from 'jazz-tools/client'
import { createDb, type DbConfig } from 'jazz-tools'
const loadLocalFirst = () => import('jazz-tools/local-first')
async function openLocalFirstSession({
	appId,
	...config
}: Omit<JazzClientConfig, 'appId'> & { appId?: string }) {
	const session = await createSession({
		...config,
		...(appId ? { scope: appId } : {}),
		client: loadLocalFirst
	})
	try {
		await session.getSnapshot().client?.db.upgradeToLocalFirst(loadLocalFirst)
		return session
	} catch (error) {
		await session.close()
		throw error
	}
}
async function openAccountClient(config: DbConfig): Promise<JazzClient> {
	const db = await createDb(config)
	return {
		db,
		get session() {
			return db.getAuthState().session ?? null
		},
		shutdown: (options) => db.shutdown(options)
	}
}

import { app as isolationApp } from '../../src/lib/schema.js'

// Test-only SDK bindings. The host test owns every operation and resource lifetime.
const probe = {
	openLocalFirstSession,
	openAccountClient,
	app: isolationApp
}
declare global {
	interface Window {
		financeRestoreIsolation: typeof probe
	}
}
if (typeof window !== 'undefined') window.financeRestoreIsolation = probe

import {
	createFinanceRestoreSession,
	createFinanceWorkspaceRestore,
	createWorkspaceRestoreController,
	prepareWorkspaceRestoreFile,
	bindWorkspaceRestoreFile,
	selectWorkspaceRestoreReport,
	createFinanceRestoreAdapter,
	readRecovery,
	recoveryQueries,
	type FinanceRestoreDb
} from '../../src/lib/machines/workspaces/workspace-restore.js'
import { setup, types, createActor, toPromise, waitFor, createAsyncLogic } from 'xstate'
import type { Transaction, WriteHandle } from 'jazz-tools'
import {
	createRestoreMachine,
	createRestoreJournalStepMachine
} from 'delightful-local-first/backup/restore/workflow'
import {
	type RestoreDestinationInput,
	type RestoreDestinationResult,
	type RestoreEvent,
	type RestoreTransactionWriter
} from 'delightful-local-first/backup/restore'
import { sameBackupBinding } from 'delightful-local-first/backup/binding'
import {
	parseRestoreJournalRecord,
	type RestoreJournalIntent
} from 'delightful-local-first/backup/restore/journal'
import { parseArchivePayload } from 'delightful-local-first/backup/archive'
import type { IntegrityCheckedArchive } from 'delightful-local-first/backup/envelope'
import { prepareArchiveOpen } from 'delightful-local-first/backup/envelope'
import { createArchiveEnvelopeMachine } from 'delightful-local-first/backup/envelope/workflow'
import { financeBackupProfile } from '../../src/lib/backup/workspace.js'
import { financeBackupReader } from '../../src/lib/machines/workspaces/workspace-backup.js'
import { prepareJazzArchiveExport } from 'delightful-local-first/backend/jazz/backup'
import { createJazzArchiveExportMachine } from 'delightful-local-first/backup/export/workflow'
import {
	canonicalRecovery,
	financeGraphRows,
	type FinanceRestoreGraph,
	financeRestorePlanningMachine,
	prepareFinanceRestorePlan,
	restorePartBytes
} from '../../src/lib/machines/workspaces/workspace-restore-plan.js'
export { canonicalRecovery }
export type RecoveryGraph = FinanceRestoreGraph
export type RecoverySample = {
	file: number[]
	intent: RestoreJournalIntent
	graph: RecoveryGraph
	databaseName: string
}
type RecoveryInput = RestoreDestinationInput<Transaction<'mergeable'>>
/** Instrumentation only: the application owns every native read, comparison and transaction. */
export function createRecoveryProbe(
	db: FinanceRestoreDb,
	sample: RecoverySample,
	archive: IntegrityCheckedArchive,
	heldWriteId?: string,
	retain?: RestoreTransactionWriter<Transaction<'mergeable'>, WriteHandle>['retainDetached']
) {
	const detached: Parameters<
		RestoreTransactionWriter<Transaction<'mergeable'>, WriteHandle>['retainDetached']
	>[0][] = []
	const adapter = createFinanceRestoreAdapter(
		db,
		sample,
		archive,
		retain ?? ((receipt) => detached.push(receipt))
	)
	const commits: string[] = []
	const commit = adapter.writer.commit
	adapter.writer.commit = (tx) => {
		const write = commit(tx)
		void Promise.resolve(write)
			.then((value) => adapter.writer.transactionId(value))
			.then(
				(id) => commits.push(id),
				() => {}
			)
		return write
	}
	const actors = {
		native: adapter.destination,
		pause: createAsyncLogic({ run: () => window.pauseRecoveryReplies() })
	}
	type ProbeContext = {
		input: RecoveryInput
		result: RestoreDestinationResult
		interruption: 'cancelled' | 'closed' | 'invalidated' | undefined
	}
	const guarded = setup({
		schemas: {
			context: types<ProbeContext>(),
			input: types<RecoveryInput>(),
			output: types<RestoreDestinationResult>(),
			events: {
				CANCEL: types(),
				SHUTDOWN: types(),
				INVALIDATE: types<{ binding: RecoveryInput['binding'] }>()
			},
			children: { native: types<import('xstate').ActorRefFrom<typeof actors.native>>() }
		},
		actors
	})
	const latch = ({ context, event }: { context: ProbeContext; event: RestoreEvent }) =>
		({
			interruption:
				event.type === 'SHUTDOWN'
					? 'closed'
					: (context.interruption ?? (event.type === 'CANCEL' ? 'cancelled' : 'invalidated'))
		}) satisfies Pick<ProbeContext, 'interruption'>

	const wire = guarded.createMachine({
		context: ({ input }) => ({ input, result: 'unavailable', interruption: undefined }),
		initial: 'checking',
		output: ({ context }) => context.interruption ?? context.result,
		on: {
			CANCEL: (args) => ({ context: latch(args) }),
			SHUTDOWN: (args) => ({ context: latch(args) }),
			INVALIDATE: (args) => {
				if (sameBackupBinding(args.context.input.binding, args.event.binding))
					return { context: latch(args) }
			}
		},
		states: {
			checking: {
				on: {
					CANCEL: (args, enq) => {
						enq.sendTo('native', args.event)
						return { context: latch(args) }
					},
					SHUTDOWN: (args, enq) => {
						enq.sendTo('native', args.event)
						return { context: latch(args) }
					},
					INVALIDATE: (args, enq) => {
						if (!sameBackupBinding(args.context.input.binding, args.event.binding)) return
						enq.sendTo('native', args.event)
						return { context: latch(args) }
					}
				},
				invoke: {
					id: 'native',
					src: 'native',
					input: ({ context }) => context.input,
					onDone: (args) => {
						const { context, event } = args
						if (
							!context.interruption &&
							event.output === 'allowed' &&
							context.input.operation === 'authority' &&
							context.input.step.writeId === heldWriteId
						) {
							return { target: 'holding' }
						}
						return { target: 'complete', context: { result: event.output } }
					},
					onError: { target: 'complete' }
				}
			},
			holding: {
				invoke: {
					src: 'pause',
					onDone: () => {
						return { target: 'complete', context: { result: 'allowed' } }
					},
					onError: { target: 'complete' }
				}
			},
			complete: { type: 'final' }
		}
	})
	const machine = createRestoreMachine(adapter.writer, wire)
	return {
		...adapter,
		machine,
		operation: {
			input: (input: import('xstate').InputFrom<typeof machine>) => input,
			result: (output: import('xstate').OutputFrom<typeof machine>) => output,
			recipient: (actor: import('xstate').ActorRefFrom<typeof machine>) => actor
		},
		commits,
		detached
	}
}

const recovery = {
	financeBackupReader,
	financeBackupProfile,
	prepareJazzArchiveExport,
	createJazzArchiveExportMachine,
	createActor,
	toPromise,
	waitFor,
	createRestoreJournalStepMachine,
	parseRestoreJournalRecord,
	prepareArchiveOpen,
	createArchiveEnvelopeMachine,
	parseArchivePayload,
	createRecoveryProbe,
	createFinanceRestoreSession,
	createFinanceWorkspaceRestore,
	createWorkspaceRestoreController,
	prepareWorkspaceRestoreFile,
	bindWorkspaceRestoreFile,
	selectWorkspaceRestoreReport,
	readRecovery,
	recoveryQueries,
	canonicalRecovery,
	financeGraphRows,
	financeRestorePlanningMachine,
	prepareFinanceRestorePlan,
	restorePartBytes
}
declare global {
	interface Window {
		financeRestoreRecovery: typeof recovery
		pauseRecoveryReplies(): Promise<void>
		financeRecoveryOwner: Awaited<ReturnType<typeof openLocalFirstSession>>
		financeRestoreCatalog: { published: Promise<void>; close(): void }
		financeRestoreSessionRuntime: {
			actor: import('xstate').ActorRefFrom<ReturnType<typeof createFinanceRestoreSession>>
			stats: {
				acquisitions: number
				opened: number
				closeAttempts: number
				releases: number
				transactions: number
				rollbackAttempts: number
			}
			transactionOpened: Promise<void>
			commits(): string[]
			releaseAcquisition(): void
			releaseTransaction(): void
		}
		financeRecoveryRuntime: {
			client: Awaited<ReturnType<typeof openAccountClient>>
			sample: RecoverySample
			probe: ReturnType<typeof createRecoveryProbe>
			binding: RecoveryInput['binding']
			opened: import('delightful-local-first/backup/envelope').ArchiveEnvelopeRequest
			archive: IntegrityCheckedArchive
			actor:
				import('xstate').ActorRefFrom<ReturnType<typeof createRecoveryProbe>['machine']> | undefined
		}
	}
}
if (typeof window !== 'undefined') window.financeRestoreRecovery = recovery
