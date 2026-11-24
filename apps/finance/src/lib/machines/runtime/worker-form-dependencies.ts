import type { FinanceContentCapabilities, FinanceContentFacts } from './worker-queries.js'
import type { WorkspaceLease } from 'delightful-local-first/workspace/contracts'
import type { Db as JazzDb } from 'jazz-tools'
import type { TransferMutationGateway } from '../transfers/internal-transfer-mutation-request.js'
import { type createAccountDeleteGrantMachine } from '../accounts/account-delete-grants.js'
import { type createWorkspaceBackupMachine } from '../workspaces/workspace-backup.js'
import { type createWorkspaceRestoreController } from '../workspaces/workspace-restore.js'
import type { createProfileFormOptions } from '../identity/profile.js'
import type { createWorkspaceRenameFormOptions } from '../workspaces/workspace-rename.js'
import { createClassificationOwner } from '../management/classification-forms.js'
import type { AccountOrderStorage } from '../../contracts/worker-forms.js'
import type { createWorkspaceNavigationMachine } from '../workspaces/workspace-navigation.js'
import { type InputFrom } from 'xstate'
import { workspaceInitialization } from '../workspaces/workspace-initialization.js'
import { createAccountCreationFormOptions } from '../accounts/account-creation-access.js'
import { createTransactionEntryFormOptions } from '../transactions/transaction-entry.js'
import { type FinanceFormsObservation } from '../../contracts/worker-forms.js'

export type FinanceFormsDependencies = Omit<
	Parameters<typeof createAccountCreationFormOptions>[0],
	'observe'
> & {
	content: FinanceContentCapabilities
	contentObserved: (lease: WorkspaceLease, facts: FinanceContentFacts) => void
	reportDisposalFailure: () => void
	accountOrderStorage: AccountOrderStorage
	transferDispatch: TransferMutationGateway['send']
	creationKey: string
	accountAccess: ReturnType<typeof createAccountDeleteGrantMachine>
	backup: ReturnType<typeof createWorkspaceBackupMachine>
	restore: ReturnType<typeof createWorkspaceRestoreController>
	reload: () => void
	navigate?: Parameters<typeof createTransactionEntryFormOptions>[0]['navigate']
	profile: ReturnType<typeof createProfileFormOptions>
	workspace: ReturnType<typeof createWorkspaceRenameFormOptions<() => Promise<void>>>
	classification: Parameters<typeof createClassificationOwner>[0]
	navigation: ReturnType<typeof createWorkspaceNavigationMachine>
	archive: (accountId: string) => Promise<unknown>
	initialization: InputFrom<typeof workspaceInitialization>
	observe: () => FinanceFormsObservation
	db: Pick<
		JazzDb,
		| 'all'
		| 'one'
		| 'subscribe'
		| 'insert'
		| 'insertStreaming'
		| 'update'
		| 'delete'
		| 'beginTransaction'
		| 'beginSerializableTransaction'
		| 'transaction'
		| 'getConfig'
		| 'getAuthState'
		| 'onMutationError'
	>
}

export type FinanceIdentityDependencies = Pick<
	FinanceFormsDependencies,
	| 'binding'
	| 'db'
	| 'creationKey'
	| 'profile'
	| 'navigation'
	| 'initialization'
	| 'content'
	| 'contentObserved'
	| 'reportDisposalFailure'
>
export type FinanceFinancialDependencies = Omit<
	FinanceFormsDependencies,
	| 'creationKey'
	| 'profile'
	| 'navigation'
	| 'initialization'
	| 'content'
	| 'contentObserved'
	| 'reportDisposalFailure'
>
