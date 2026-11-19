import { projectedInspection } from '../diagnostics/inspection-projection.js'
import { workerSamplesView } from './worker-forms.js'
import { workerBankView, workerBankCommand, workerBankHistoryCommand } from './worker-banks.js'
import type { BankSource } from '../machines/bank-sync/types.js'
import { financeWebAuthnRequest } from './worker-webauthn.js'
import {
	financeImageEditorRequest,
	workerTransactionDetailsView,
	workerSavedImageView,
	workerTransactionImageCommand
} from './worker-images.js'
import { workerProfile, workerWorkspaceSettings } from './worker-identity.js'
export { workerProfile, workerWorkspaceSettings } from './worker-identity.js'
import type { TransferMutationGateway } from '../machines/transfers/internal-transfer-mutation-request.js'
import {
	workerTransferEditCommand,
	workerTransferEditView,
	workerTransferPair
} from './worker-transfers.js'
import { workerTransferCreationView } from './worker-forms.js'
import type { WorkerTransferRecord } from './worker-transfers.js'
import {
	workerAccountArchiveView,
	workerAccountAccessView,
	workerWorkspaceMember,
	workerAccountGrant
} from './worker-accounts.js'
import { workerSelection, workerSessionRevision as sessionRevision } from './worker-scope.js'
import {
	financeDownloadRequest,
	workerBackupView,
	workerWorkspaceRestoreView
} from './worker-backup.js'
import type { WorkspaceRestoreFile } from '../machines/workspaces/workspace-restore.js'
import type { WorkspaceNavigate } from './workspace-orchestration-contract.js'
import { z } from 'zod'
import type { AccountOrderStorage } from './worker-forms.js'
import { appAccountSchema, persistedAccountSchema } from '../validation/accounts.js'
import { appWorkspaceSchema, appProfileSchema } from '../validation/identity.js'
import type { SessionRuntimeConnection } from 'delightful-local-first/session/runtime'
import type { ArchiveObservation } from '../machines/accounts/account-archive-operation.js'
import { accountArchiveFeedback } from './account-archive-feedback.js'
import {
	workerFormCommand,
	workerAccountOrderCommand,
	workerAccountOrderView,
	workerAccountCreationView,
	workerProfileForms,
	workerWorkspaceFormView,
	workerWorkspaceCreationView,
	workerWorkspaceCreationCommand,
	classificationForm,
	workerClassificationForms,
	workerTransactionEntryView,
	workerTransactionCategory,
	workerTagRecord,
	type FinanceFormsObservation
} from './worker-forms.js'
import {
	transactionLedgerRecordSchema,
	transactionListRowSchema
} from '../validation/transactions.js'
import { PAYMENT_METHOD } from '../domain/payment-method.js'
import type { TransactionEntryObservation } from './transaction-entry-contract.js'
import { INCOME, EXPENSE } from '../domain/transaction-kind.js'
import type { createFinanceFormsMachine } from '../machines/runtime/worker-forms.js'

export { workerSelection } from './worker-scope.js'
export const workerAccount = appAccountSchema
	.pick({ name: true, kind: true, currency: true })
	.extend({ id: z.uuid() })
export const workerWorkspace = appWorkspaceSchema
	.pick({ name: true, defaultCurrency: true })
	.extend({ id: z.uuid() })
export const workerTransactionKind = z.enum([INCOME, EXPENSE])
export const workerContextCommand = z.strictObject({
	type: z.literal('SELECT_CONTEXT'),
	selection: workerSelection,
	kind: workerTransactionKind,
	transactionId: z.uuid().nullable().optional()
})
export const workerLedgerFilters = z.strictObject({
	start: z.string(),
	end: z.string(),
	categoryId: z.string(),
	currency: z.string(),
	query: z.string()
})
export const workerLedgerView = z.strictObject({
	filters: workerLedgerFilters,
	noAccountsSelected: z.boolean(),
	rangeValid: z.boolean(),
	page: z.number().int().positive().safe(),
	requestedPage: z.number().int().positive().safe(),
	pageCount: z.number().int().positive().safe(),
	groups: z.array(
		z.strictObject({
			bookedOn: z.string(),
			transactions: z.array(transactionListRowSchema),
			totals: z.array(z.tuple([z.string(), z.bigint()]))
		})
	),
	categories: z.array(z.tuple([z.string(), z.string()])),
	tags: z.array(z.tuple([z.string(), z.array(z.string())])),
	filterCategories: z.array(z.tuple([z.string(), z.string().nullable()])),
	currencies: z.array(z.string())
})
export const workerTransferListView = z.strictObject({
	page: workerLedgerView.shape.page,
	pageCount: workerLedgerView.shape.pageCount,
	requestedPage: workerLedgerView.shape.requestedPage,
	noAccountsSelected: z.boolean(),
	groups: z.array(
		z.strictObject({
			bookedOn: z.string(),
			transactions: z.array(transactionLedgerRecordSchema),
			totals: z.array(z.tuple([z.string(), z.bigint()]))
		})
	),
	pairs: z.array(workerTransferPair),
	selected: workerTransferPair.nullable(),
	accounts: z.array(workerAccount)
})
export type WorkerTransferListView = z.output<typeof workerTransferListView>
export const workerOverviewView = z.strictObject({
	rangeValid: z.boolean(),
	currencies: z.array(z.string()),
	currency: z.string(),
	slices: z.array(
		z.strictObject({ key: z.uuid(), value: z.bigint(), name: z.string().nullable() })
	),
	activeCategory: z.uuid().nullable(),
	hasExpenses: z.boolean(),
	categoryIds: z.array(z.uuid()),
	categories: workerLedgerView.shape.categories,
	tags: workerLedgerView.shape.tags,
	total: z.bigint(),
	page: workerLedgerView.shape.page,
	pageCount: workerLedgerView.shape.pageCount,
	requestedPage: workerLedgerView.shape.requestedPage,
	groups: workerLedgerView.shape.groups
})
export type WorkerOverviewView = z.output<typeof workerOverviewView>
export type WorkerLedgerRecord = z.output<typeof transactionLedgerRecordSchema>
export type WorkerLedgerView = z.output<typeof workerLedgerView>
export const financeWorkerCommand = z.discriminatedUnion('type', [
	z.strictObject({
		type: z.literal('ADD_SAMPLES'),
		kind: workerTransactionKind,
		sessionRevision,
		selection: workerSelection
	}),
	z.strictObject({
		type: z.enum(['RETRY_INITIALIZATION', 'RETRY_INTEGRITY', 'DISMISS_MUTATION_NOTICE']),
		sessionRevision,
		selection: workerSelection
	}),
	z.strictObject({ type: z.literal('RETRY_SESSION') }),
	z.strictObject({
		type: z.literal('BANK'),
		command: workerBankCommand,
		sessionRevision,
		selection: workerSelection
	}),
	z.strictObject({
		type: z.literal('BANK_HISTORY'),
		command: workerBankHistoryCommand,
		sessionRevision,
		selection: workerSelection
	}),
	z.strictObject({
		type: z.literal('TRANSACTION_IMAGE'),
		command: workerTransactionImageCommand,
		sessionRevision,
		selection: workerSelection
	}),
	z.strictObject({
		type: z.literal('TRANSFER_ENTRY'),
		command: workerFormCommand,
		sessionRevision,
		selection: workerSelection
	}),
	z.strictObject({
		type: z.literal('TRANSFER_EDIT'),
		command: workerTransferEditCommand,
		sessionRevision,
		selection: workerSelection
	}),
	z.strictObject({
		type: z.literal('SET_OVERVIEW_FILTERS'),
		filters: workerLedgerFilters,
		sessionRevision,
		selection: workerSelection
	}),
	z.strictObject({
		type: z.literal('SET_ACCOUNT_DELETE_GRANT'),
		accountId: z.uuid(),
		userId: z.uuid(),
		canDelete: z.boolean(),
		sessionRevision,
		selection: workerSelection
	}),
	z.strictObject({
		type: z.literal('BACKUP_COMMAND'),
		command: z.enum(['CANCEL', 'RELOAD']),
		sessionRevision,
		selection: workerSelection
	}),
	z.strictObject({
		type: z.literal('WORKSPACE_RESTORE_COMMAND'),
		command: z.enum(['CONFIRM', 'CANCEL', 'DRAIN', 'RETRY_RELEASE', 'DISMISS', 'OPEN', 'RELOAD']),
		sessionRevision,
		selection: workerSelection
	}),
	z.strictObject({
		type: z.literal('WORKSPACE_CREATION'),
		command: workerWorkspaceCreationCommand,
		sessionRevision,
		selection: workerSelection
	}),
	z.strictObject({
		type: z.literal('PROFILE'),
		form: z.enum(['name', 'avatar']),
		command: workerFormCommand,
		sessionRevision,
		selection: workerSelection
	}),
	z.strictObject({
		type: z.literal('WORKSPACE_SETTINGS'),
		command: workerFormCommand,
		sessionRevision,
		selection: workerSelection
	}),
	z.strictObject({
		type: z.literal('CLASSIFICATION'),
		form: classificationForm,
		command: workerFormCommand,
		sessionRevision,
		selection: workerSelection
	}),
	z.strictObject({
		type: z.literal('ACCOUNT_ORDER'),
		command: workerAccountOrderCommand,
		sessionRevision,
		selection: workerSelection
	}),
	workerContextCommand,
	z.strictObject({
		type: z.literal('OBSERVE_ROUTE'),
		pathname: z.string().max(8192),
		search: z.string().max(8192),
		hash: z.string().max(8192),
		revision: z.number().int().positive().safe()
	}),
	z.strictObject({
		type: z.literal('NAVIGATE_WORKSPACE'),
		workspaceId: z.uuid(),
		sessionRevision,
		selection: workerSelection
	}),
	z.strictObject({
		type: z.literal('RETRY_WORKSPACE_NAVIGATION'),
		sessionRevision,
		selection: workerSelection
	}),
	z.strictObject({
		type: z.literal('OPEN_TRANSACTION'),
		transactionId: z.uuid().nullable(),
		sessionRevision,
		selection: workerSelection
	}),
	z.strictObject({
		type: z.literal('SET_ACCOUNT_SELECTED'),
		accountId: z.uuid(),
		checked: z.boolean(),
		sessionRevision,
		selection: workerSelection
	}),
	z.strictObject({
		type: z.literal('SET_ALL_ACCOUNTS_SELECTED'),
		checked: z.boolean(),
		sessionRevision,
		selection: workerSelection
	}),
	z.strictObject({ type: z.literal('OBSERVE_LOCATION'), href: z.string().max(8192) }),
	z.strictObject({ type: z.literal('OBSERVE_NETWORK'), offline: z.boolean() }),
	z.strictObject({
		type: z.literal('ARCHIVE_ACCOUNT'),
		sessionRevision,
		selection: workerSelection,
		accountId: z.uuid()
	}),
	z.strictObject({
		type: z.literal('ACCOUNT_CREATION'),
		sessionRevision,
		selection: workerSelection,
		command: workerFormCommand
	}),
	z.strictObject({
		type: z.literal('TRANSACTION_ENTRY'),
		sessionRevision,
		selection: workerSelection,
		command: workerFormCommand
	}),
	z.strictObject({
		type: z.literal('TRANSACTION_EDIT'),
		sessionRevision,
		selection: workerSelection,
		command: workerFormCommand
	}),
	z.strictObject({
		type: z.literal('SET_LEDGER_PAGE'),
		sessionRevision,
		selection: workerSelection,
		page: z.number().int().positive().safe()
	}),
	z.strictObject({
		type: z.literal('SET_LEDGER_FILTERS'),
		sessionRevision,
		selection: workerSelection,
		filters: workerLedgerFilters
	}),
	z.strictObject({ type: z.literal('CLOSE') })
])
export const financeRecoveryRead = z.strictObject({
	type: z.literal('READ_RECOVERY_PHRASE'),
	sessionRevision
})
export const financeRecoveryReply = z.discriminatedUnion('outcome', [
	z.strictObject({ outcome: z.literal('ready'), phrase: z.string().min(1).max(8192) }),
	z.strictObject({ outcome: z.literal('unavailable') })
])
export const financeWorkerOpen = z.strictObject({
	type: z.literal('OPEN'),
	hostId: z.uuid(),
	serverUrl: z.url().max(8192),
	scope: z.string().trim().min(1).max(8192),
	environment: z.string().min(1).max(8192)
})
export const workerTransactionEntry = z.strictObject({
	kind: workerTransactionKind,
	form: workerTransactionEntryView,
	accounts: z.array(persistedAccountSchema),
	categories: z.array(workerTransactionCategory),
	tagSuggestions: z.array(z.string()),
	defaultAccountId: z.uuid().nullable(),
	defaultCategoryId: z.uuid().nullable()
})
export const workerTransactionInitial = transactionLedgerRecordSchema
	.pick({
		accountId: true,
		categoryId: true,
		amountMinor: true,
		currency: true,
		bookedOn: true,
		description: true,
		memo: true
	})
	.extend({
		accountName: z.string().optional(),
		categoryName: z.string().optional(),
		paymentMethod: z.enum(PAYMENT_METHOD).nullable(),
		checkId: z.uuid().nullable(),
		check: z.object({ checkNumber: z.string(), checkDate: z.string() }).optional(),
		tags: z.array(z.string())
	})
export const workerTransactionEdit = workerTransactionEntry.extend({
	transactionId: z.uuid(),
	initialTransaction: workerTransactionInitial.nullable()
})
/** Private host input: excluded from ordinary commands and inspected application events. */
export const financeIdentityRestore = z.strictObject({
	type: z.literal('RESTORE_IDENTITY'),
	origin: z.string().max(8192),
	sessionRevision,
	phrase: z.string().max(8192)
})
export const financeRecoveryRetry = z.strictObject({
	type: z.literal('RETRY_RECOVERY_NAVIGATION'),
	sessionRevision
})
export const financeNavigationRequest = z.strictObject({
	type: z.literal('NAVIGATE'),
	destination: z
		.string()
		.max(8192)
		.refine((value) => value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')),
	origin: z.string().max(8192),
	replace: z.boolean()
})
export const financeNavigationReply = z.strictObject({ outcome: z.enum(['completed', 'failed']) })
export const workerClassificationView = z.strictObject({
	forms: workerClassificationForms,
	countsLoading: z.boolean(),
	categories: z.array(workerTransactionCategory),
	tags: z.array(workerTagRecord),
	categoryOptions: z.array(workerTransactionCategory),
	counts: z.array(
		z.tuple([
			z.uuid(),
			z.strictObject({
				transactions: z.number().int().nonnegative(),
				tags: z.number().int().nonnegative()
			})
		])
	),
	archivableCategoryIds: z.array(z.uuid()),
	archivableTagIds: z.array(z.uuid())
})
export const financeWorkerView = z.strictObject({
	type: z.literal('VIEW'),
	sessionRevision,
	transactionKind: workerTransactionKind,
	transactionId: z.uuid().nullable(),
	selection: workerSelection,
	status: z.enum(['starting', 'signed-out', 'loading', 'ready', 'failed', 'closing', 'closed']),
	identityId: z.uuid().nullable(),
	selectedAccountIds: z.array(z.uuid()).nullable(),
	recoveryAvailable: z.boolean(),
	workspaceNavigation: z
		.strictObject({
			status: z.enum([
				'waiting',
				'updating',
				'directory',
				'global',
				'scoped',
				'unavailable',
				'failed'
			]),
			showContent: z.boolean(),
			notice: z.strictObject({ active: z.boolean(), loading: z.boolean(), failed: z.boolean() }),
			canRetry: z.boolean()
		})
		.nullable(),
	identityRestore: z.strictObject({
		canSubmit: z.boolean(),
		busy: z.boolean(),
		navigationOnly: z.boolean(),
		navigationError: z.boolean(),
		canRetryNavigation: z.boolean(),
		error: z.boolean(),
		draftRevision: z.number().int().nonnegative()
	}),
	workspaces: z.array(workerWorkspace).nullable(),
	accounts: z.array(
		workerAccount.extend({
			archiveAction: z.enum(['available', 'archiving', 'disabled', 'unavailable']),
			balanceMinor: z.bigint().nullable()
		})
	),
	archiveFeedback: accountArchiveFeedback.nullable(),
	workspaceStartup: z.enum(['checking', 'ready', 'unavailable', 'failed', 'closed']).nullable(),
	accountCreation: workerAccountCreationView.nullable(),
	accountArchive: workerAccountArchiveView.nullable(),
	accountAccess: workerAccountAccessView.nullable(),
	accountOrder: workerAccountOrderView.nullable(),
	classification: workerClassificationView.nullable(),
	profile: z.strictObject({ row: workerProfile.nullable(), forms: workerProfileForms }).nullable(),
	workspaceCreation: workerWorkspaceCreationView.nullable(),
	backup: workerBackupView.nullable(),
	workspaceRestore: workerWorkspaceRestoreView.nullable(),
	workspace: z
		.strictObject({ row: workerWorkspaceSettings.nullable(), form: workerWorkspaceFormView })
		.nullable(),
	transactionEntry: workerTransactionEntry.nullable(),
	transactionEdit: workerTransactionEdit.nullable(),
	samples: workerSamplesView.nullable(),
	canRetrySession: z.boolean(),
	canRetryInitialization: z.boolean(),
	mutationRejected: z.boolean(),
	workspaceIntegrity: z
		.strictObject({
			mode: z.enum(['waiting', 'working', 'complete', 'partial', 'conflict', 'failed']),
			canRetry: z.boolean()
		})
		.nullable(),
	bank: workerBankView.nullable(),
	transactionDetails: workerTransactionDetailsView
		.extend({
			editor: workerSavedImageView.nullable(),
			removingIds: z.array(z.uuid()),
			failedIds: z.array(z.uuid())
		})
		.nullable(),
	transferEdit: workerTransferEditView.nullable(),
	transfers: workerTransferListView.nullable(),
	transferCreation: z
		.strictObject({ form: workerTransferCreationView, accounts: z.array(workerAccount) })
		.nullable(),
	ledger: workerLedgerView.nullable(),
	overview: workerOverviewView.nullable()
})
export const financeWorkerReply = z.discriminatedUnion('type', [
	financeWorkerView,
	z.strictObject({ type: z.literal('INSPECTION'), event: projectedInspection }),
	financeNavigationRequest,
	financeImageEditorRequest,
	financeWebAuthnRequest,
	financeDownloadRequest,
	z.strictObject({ type: z.literal('RELOAD_PAGE') }),
	z.strictObject({ type: z.literal('CLOSED') }),
	z.strictObject({ type: z.literal('FAILED') })
])
export type WorkerAccount = z.infer<typeof workerAccount>
export type WorkerAccountRecord = z.output<typeof persistedAccountSchema>
export type WorkerWorkspace = z.infer<typeof workerWorkspace>
export type WorkerSelection = z.infer<typeof workerSelection>
export type FinanceWorkerView = z.infer<typeof financeWorkerView>
export type WorkerCommandScope = Pick<FinanceWorkerView, 'sessionRevision' | 'selection'>
export type FinanceWorkerCommand = z.infer<typeof financeWorkerCommand>
export type FinanceWorkerOpen = z.infer<typeof financeWorkerOpen>
export type FinanceWorkerConfiguration = Omit<FinanceWorkerOpen, 'type' | 'hostId'>
export type FinanceWorkerCapabilities = {
	observeBankConnections(
		workspaceId: string,
		publish: (rows: BankSource['connections']) => void,
		failed: () => void
	): () => void
	observeBankLinks(
		workspaceId: string,
		publish: (rows: BankSource['links']) => void,
		failed: () => void
	): () => void
	observeTransfers(
		workspaceId: string,
		publish: (rows: WorkerTransferRecord[]) => void,
		failed: () => void
	): () => void
	observeWorkspaceMembers(
		workspaceId: string,
		publish: (rows: z.output<typeof workerWorkspaceMember>[]) => void,
		failed: () => void
	): () => void
	observeAccountGrants(
		workspaceId: string,
		publish: (rows: z.output<typeof workerAccountGrant>[]) => void,
		failed: () => void
	): () => void
	prepareWorkspaceRestore(file: File, password: string): WorkspaceRestoreFile
	observeProfile(
		publish: (row: z.output<typeof workerProfile> | null) => void,
		failed: () => void
	): () => void
	observeWorkspace(
		workspaceId: string,
		publish: (row: z.output<typeof workerWorkspaceSettings> | null) => void,
		failed: () => void
	): () => void
	observeWorkspaces(publish: (rows: WorkerWorkspace[]) => void, failed: () => void): () => void
	observeAccounts(
		workspaceId: string,
		publish: (rows: WorkerAccountRecord[]) => void,
		failed: () => void
	): () => void
	observeMembership(
		workspaceId: string,
		publish: (row: ArchiveObservation['membership']) => void,
		failed: () => void
	): () => void
	observeGrants(
		workspaceId: string,
		publish: (rows: ArchiveObservation['grants']) => void,
		failed: () => void
	): () => void
	observeCategories(
		workspaceId: string,
		publish: (rows: z.output<typeof workerTransactionCategory>[]) => void,
		failed: () => void
	): () => void
	observeTags(
		workspaceId: string,
		publish: (rows: z.output<typeof workerTagRecord>[]) => void,
		failed: () => void
	): () => void
	observeTransactions(
		workspaceId: string,
		publish: (rows: WorkerLedgerRecord[]) => void,
		failed: () => void
	): () => void
	observeTransaction(
		workspaceId: string,
		transactionId: string,
		publish: (row: TransactionEntryObservation['transaction']) => void,
		failed: () => void
	): () => void
	readRecoveryPhrase(): Promise<string>
	archiveAccount(accountId: string): Promise<unknown>
	createForms(
		observe: () => FinanceFormsObservation,
		archive: FinanceWorkerCapabilities['archiveAccount'],
		navigate: WorkspaceNavigate,
		accountOrderStorage: AccountOrderStorage,
		transferDispatch: TransferMutationGateway['send'],
		routeObserved: boolean
	): ReturnType<typeof createFinanceFormsMachine>
}
export type FinanceWorkerSession = SessionRuntimeConnection<FinanceWorkerCapabilities>
