import { bindWorkspaceRestoreFile } from '../../src/lib/runtime/jazz-session-binding.js'
import {
	createJazzClient as createSession,
	type JazzClientConfig,
	type JazzClient
} from 'jazz-tools/client'
import { createDb, exportLocalFirstSecret, type DbConfig } from 'jazz-tools'
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
	exportLocalFirstSecret,
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
	selectWorkspaceRestoreReport,
	readRecovery,
	recoveryQueries
} from '../../src/lib/machines/workspaces/workspace-restore.js'
import { createActor, toPromise, waitFor } from 'xstate'
import { createRestoreJournalStepMachine } from 'delightful-local-first/backup/restore/workflow'
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
import { createRecoveryProbe, type RecoveryInput } from '../../tests/helpers/restore-probe.js'

const recovery = {
	bindWorkspaceRestoreFile,
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
		financeRecoveryOwner: Awaited<ReturnType<typeof openLocalFirstSession>>
		financeRestoreCatalog: { published: Promise<void>; close(): void }
		financeRestoreSessionRuntime: {
			actor: import('xstate').ActorRefFrom<ReturnType<typeof createFinanceRestoreSession>>
			stats: {
				releases: number
				releaseAttempts: number
				transactions: number
				rollbackAttempts: number
			}
			transactionOpened: Promise<void>
			commits(): string[]
			releaseTransaction(): void
			finishReplacement?: () => Promise<void>
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
