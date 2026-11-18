import { z } from 'zod'
import { appAccountSchema, persistedAccountSchema } from '../validation/accounts.js'
import { appWorkspaceSchema } from '../validation/identity.js'
import type { SessionRuntimeConnection } from 'delightful-local-first/session/runtime'
import type { ArchiveObservation } from '../machines/accounts/account-archive-operation.js'
import { accountArchiveFeedback } from './account-archive-feedback.js'
import {
	workerAccountCreationCommand,
	workerAccountCreationView,
	workerTransactionEntryView,
	workerTransactionEntryCommand,
	workerTransactionCategory,
	workerTagRecord,
	type FinanceFormsObservation
} from './worker-forms.js'
import {
	transactionLedgerRecordSchema,
	transactionListRowSchema
} from '../validation/transactions.js'
import { INCOME, EXPENSE } from '../domain/transaction-kind.js'
import type { createFinanceFormsMachine } from '../machines/runtime/worker-forms.js'

export const workerSelection = z.strictObject({
	workspaceId: z.uuid().nullable(),
	revision: z.number().int().nonnegative().safe()
})
const sessionRevision = z.number().int().nonnegative().safe()
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
	kind: workerTransactionKind
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
	rangeValid: z.boolean(),
	page: z.number().int().positive().safe(),
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
export type WorkerLedgerRecord = z.output<typeof transactionLedgerRecordSchema>
export type WorkerLedgerView = z.output<typeof workerLedgerView>
export const financeWorkerCommand = z.discriminatedUnion('type', [
	workerContextCommand,
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
		command: workerAccountCreationCommand
	}),
	z.strictObject({
		type: z.literal('TRANSACTION_ENTRY'),
		sessionRevision,
		selection: workerSelection,
		command: workerTransactionEntryCommand
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
export const financeWorkerOpen = z.strictObject({
	type: z.literal('OPEN'),
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
export const financeWorkerView = z.strictObject({
	type: z.literal('VIEW'),
	sessionRevision,
	transactionKind: workerTransactionKind,
	selection: workerSelection,
	status: z.enum(['starting', 'signed-out', 'loading', 'ready', 'failed', 'closing', 'closed']),
	identityId: z.uuid().nullable(),
	workspaces: z.array(workerWorkspace).nullable(),
	accounts: z.array(
		workerAccount.extend({
			archiveAction: z.enum(['available', 'archiving', 'disabled', 'unavailable']),
			balanceMinor: z.bigint().nullable()
		})
	),
	archiveFeedback: accountArchiveFeedback.nullable(),
	accountCreation: workerAccountCreationView.nullable(),
	transactionEntry: workerTransactionEntry.nullable(),
	ledger: workerLedgerView.nullable()
})
export const financeWorkerReply = z.discriminatedUnion('type', [
	financeWorkerView,
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
export type FinanceWorkerCapabilities = {
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
	archiveAccount(accountId: string): Promise<unknown>
	createForms(observe: () => FinanceFormsObservation): ReturnType<typeof createFinanceFormsMachine>
}
export type FinanceWorkerSession = SessionRuntimeConnection<FinanceWorkerCapabilities>
