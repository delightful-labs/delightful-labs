import type { BankSource } from '../machines/bank-sync/types.js'
import type { InternalTransferEntryObservation } from './transfer-create-contract.js'
import type { WorkerTransferFacts } from './worker-transfers.js'
import type { DeleteGrantObservation } from '../machines/accounts/account-delete-grants.js'
import type { BackupObservation } from '../machines/workspaces/workspace-backup.js'
import { appWorkspaceSchema } from '../validation/identity.js'
import type { ProfileObservation } from './profile-contract.js'
import type { WorkspaceRenameObservation } from './workspace-rename-contract.js'
import type { WorkspaceNavigationFacts } from './workspace-orchestration-contract.js'
import { z } from 'zod'
import { createWorkerFormViewSchema } from 'delightful-local-first/forms/worker'
import { persistedAccountSchema } from '../validation/accounts.js'
import {
	TRANSACTION_ENTRY_REASON,
	type TransactionEntryObservation
} from './transaction-entry-contract.js'
import type { ArchiveObservation } from '../machines/accounts/account-archive-operation.js'
import type { AccountCreationObservation } from './account-creation-contract.js'
import { appTagSchema } from '../validation/tags.js'
import { appCategorySchema } from '../validation/categories.js'
import { ACCOUNT_CREATION_REASON } from './account-creation-contract.js'
import { MANAGEMENT_REASON, type ManagementObservation } from './management-contract.js'

export const workerAccountCreationView = createWorkerFormViewSchema(
	persistedAccountSchema,
	z.enum(ACCOUNT_CREATION_REASON)
)
export type WorkerAccountCreationView = z.output<typeof workerAccountCreationView>
export const workerFormCommand = z.discriminatedUnion('type', [
	z.strictObject({ type: z.enum(['OPEN', 'RESET', 'CANCEL', 'RETRY_READINESS']) }),
	z.strictObject({ type: z.enum(['SUBMIT', 'CHANGE']), values: z.record(z.string(), z.unknown()) })
])
export type WorkerFormCommand = z.output<typeof workerFormCommand>

export const workerTransactionEntryView = createWorkerFormViewSchema(
	z.undefined(),
	z.enum(TRANSACTION_ENTRY_REASON)
)
export type WorkerTransactionEntryView = z.output<typeof workerTransactionEntryView>
export const workerAccountOrderCommand = z.discriminatedUnion('type', [
	z.strictObject({ type: z.enum(['EDIT', 'DONE']) }),
	z.strictObject({ type: z.literal('MOVE'), id: z.uuid(), direction: z.enum(['up', 'down']) })
])
export type WorkerAccountOrderCommand = z.output<typeof workerAccountOrderCommand>
export const workerAccountOrderView = z.strictObject({
	ids: z.array(z.uuid()),
	editing: z.boolean(),
	canToggle: z.boolean(),
	moves: z.array(z.strictObject({ id: z.uuid(), up: z.boolean(), down: z.boolean() }))
})
export type FinanceFormsObservation = {
	workspaceLease?: import('delightful-local-first/workspace/contracts').WorkspaceLease | undefined
	sampleSelectedAccounts: readonly string[] | null
	bank: BankSource
	transferCreate: InternalTransferEntryObservation
	transfers: WorkerTransferFacts
	accountAccess: DeleteGrantObservation
	backup: BackupObservation
	profile: ProfileObservation
	workspace: WorkspaceRenameObservation
	classification: ManagementObservation
	order: AccountOrderObservation
	navigation: WorkspaceNavigationFacts
	archive: ArchiveObservation
	creation: AccountCreationObservation
	transaction: TransactionEntryObservation
	edit: TransactionEntryObservation
}
export const workerTransactionCategory = appCategorySchema.extend({ id: z.uuid() })

export const workerTagRecord = appTagSchema.extend({ id: z.uuid() })

export type AccountOrderObservation = { key: string | null; ids: readonly string[] }
export type AccountOrderStorage = {
	read: (key: string) => Promise<readonly string[]>
	write: (key: string, ids: readonly string[]) => Promise<void>
}

export const classificationForm = z.enum([
	'createCategory',
	'archiveCategory',
	'createTag',
	'archiveTag'
])
export type ClassificationForm = z.output<typeof classificationForm>
export const workerCategoryFormView = createWorkerFormViewSchema(
	workerTransactionCategory,
	z.enum(MANAGEMENT_REASON)
)
export const workerTagFormView = createWorkerFormViewSchema(
	workerTagRecord,
	z.enum(MANAGEMENT_REASON)
)
export const workerClassificationArchiveView = createWorkerFormViewSchema(
	z.string(),
	z.enum(MANAGEMENT_REASON)
)
export const workerClassificationForms = z.strictObject({
	createCategory: workerCategoryFormView,
	archiveCategory: workerClassificationArchiveView,
	createTag: workerTagFormView,
	archiveTag: workerClassificationArchiveView
})
export type WorkerClassificationForms = z.output<typeof workerClassificationForms>

export const workerProfileFormView = createWorkerFormViewSchema(
	z.undefined(),
	z.enum(['sessionUnavailable', 'loadFailed', 'loading', 'profileUnavailable'])
)
export const workerProfileForms = z.strictObject({
	name: workerProfileFormView,
	avatar: workerProfileFormView
})
export type WorkerProfileForms = z.output<typeof workerProfileForms>
export const workerWorkspaceFormView = createWorkerFormViewSchema(
	z.undefined(),
	z.enum([
		'sessionUnavailable',
		'selectWorkspace',
		'loadFailed',
		'loading',
		'workspaceUnavailable',
		'readOnly'
	])
)
export type WorkerWorkspaceFormView = z.output<typeof workerWorkspaceFormView>

export const workerWorkspaceCreationView = z
	.strictObject({
		draftRevision: z.number().int().nonnegative(),
		mode: z.enum([
			'unavailable',
			'working',
			'editing',
			'invalid',
			'recovered',
			'complete',
			'conflict',
			'failed',
			'unresolved'
		]),
		name: z.string(),
		// Native inserted rows also carry Jazz metadata and write methods.
		// Project only the declared row fields into the worker reply.
		workspace: appWorkspaceSchema.extend({ id: z.uuid() }).strip().optional(),
		canSubmit: z.boolean(),
		canRetry: z.boolean(),
		canCreateAnother: z.boolean()
	})
	.transform((view) => ({ ...view, workspace: view.workspace }))
export type WorkerWorkspaceCreationView = z.output<typeof workerWorkspaceCreationView>
export const workerWorkspaceCreationCommand = z.discriminatedUnion('type', [
	z.strictObject({ type: z.literal('SUBMIT'), name: z.string() }),
	z.strictObject({ type: z.enum(['RETRY', 'NEW', 'CANCEL']) })
])

export type WorkerWorkspaceCreationCommand = z.output<typeof workerWorkspaceCreationCommand>

export const workerTransferCreationView = createWorkerFormViewSchema(
	z.strictObject({
		transferId: z.uuid(),
		expenseTransactionId: z.uuid(),
		incomeTransactionId: z.uuid()
	}),
	z.enum([
		'sessionUnavailable',
		'selectWorkspace',
		'loadFailed',
		'loading',
		'readOnly',
		'noAccounts',
		'insufficientAccounts',
		'noCategories',
		'permissionChanged',
		'incompatible',
		'unavailable'
	])
)
export type WorkerTransferCreationView = z.output<typeof workerTransferCreationView>

export const workerSampleView = z.strictObject({
	busy: z.boolean(),
	saved: z.number().int().nonnegative(),
	failed: z.boolean()
})
export const workerSamplesView = z.strictObject({
	income: workerSampleView,
	expense: workerSampleView
})
