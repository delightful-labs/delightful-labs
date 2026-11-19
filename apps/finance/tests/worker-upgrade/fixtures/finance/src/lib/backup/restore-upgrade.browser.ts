import { createJazzClient } from 'jazz-tools/client'
import { createActor, waitFor, toPromise, type ActorRefFrom } from 'xstate'
import { createRecoveryProbe } from '../../../tests/helpers/restore-probe.js'
import { prepareArchiveOpen } from 'delightful-local-first/backup/envelope'
import { createArchiveEnvelopeMachine } from 'delightful-local-first/backup/envelope/workflow'
import { createRestoreJournalStepMachine } from 'delightful-local-first/backup/restore/workflow'
import type { BackupBinding } from 'delightful-local-first/backup/binding'
import {
	prepareFinanceRestorePlan,
	financeRestorePlanningMachine,
	type FinanceRestorePlan
} from '../machines/workspaces/workspace-restore-plan.js'
import {
	createWorkspaceRestoreController,
	prepareWorkspaceRestoreFile,
	selectWorkspaceRestoreReport,
	createFinanceWorkspaceRestore,
	createFinanceRestoreSession
} from '../machines/workspaces/workspace-restore.js'
import { bindWorkspaceRestoreFile } from '../runtime/jazz-session-binding.js'
import { app } from '../queries.js'

const api = {
	open: (serverUrl: string, scope?: string) =>
		createJazzClient({
			serverUrl,
			...(scope ? { scope } : {}),
			initial: 'device',
			driver: { type: 'memory' },
			client: () => import('jazz-tools/local-first'),
			localFirst: 'now'
		}),
	createRestoreJournalStepMachine,
	toPromise,
	createRecoveryProbe,
	prepareArchiveOpen,
	createArchiveEnvelopeMachine,
	prepareFinanceRestorePlan,
	financeRestorePlanningMachine,
	createFinanceRestoreSession,
	createActor,
	waitFor,
	app,
	createWorkspaceRestoreController,
	prepareWorkspaceRestoreFile,
	bindWorkspaceRestoreFile,
	selectWorkspaceRestoreReport,
	createFinanceWorkspaceRestore
}
declare global {
	interface Window {
		financeRestoreUpgrade: typeof api
		financeRestoreUpgradeSession: Awaited<ReturnType<typeof api.open>>
		financeRestoreDrain: {
			actor: ActorRefFrom<ReturnType<typeof createFinanceRestoreSession>>
			binding: BackupBinding
			plan: FinanceRestorePlan
			commits: string[]
			stats: { releases: number; releaseAttempts: number }
			finishReplacement?: () => Promise<void>
		}
	}
}
window.financeRestoreUpgrade = api
