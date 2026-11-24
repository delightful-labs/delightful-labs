import type { BankSource } from '../bank-sync/types.js'
import type { WorkerTransferRecord } from '../../contracts/worker-transfers.js'
import type { workerWorkspaceMember, workerAccountGrant } from '../../contracts/worker-accounts.js'
import { setup, types, type SnapshotFrom } from 'xstate'
import type {
	WorkerSelection,
	WorkerWorkspace,
	WorkerAccountRecord,
	WorkerLedgerRecord
} from '../../contracts/worker-application.js'
import type { TransactionEntryObservation } from '../../contracts/transaction-entry-contract.js'
import type { z } from 'zod'
import type { Category, Tag } from '../../queries.js'
import type { ArchiveObservation } from '../accounts/account-archive-operation.js'

import {
	observeFinanceQuery as observeQuery,
	type FinanceWorkerReady
} from './worker-query-observation.js'
import {
	financeWorkspaceAccessMachine,
	selectFinanceWorkspaceAccessFacts,
	type WorkspaceAccessRows
} from './worker-workspace-access.js'
export type { FinanceWorkerReady } from './worker-query-observation.js'
type Input = {
	ready: FinanceWorkerReady
	initialWorkspaces: WorkerWorkspace[] | null
	initialProfile?: WorkspaceAccessRows['profile']
	transactionId: string | null
	selection: WorkerSelection
	binding: object
	reportDisposalFailure: () => void
}
const empty = {
	bankConnections: null,
	bankLinks: null,
	transfers: null,
	workspaceMembers: null,
	accountGrants: null,
	profile: undefined,
	workspace: undefined,
	workspaces: null,
	accounts: null,
	membership: undefined,
	grants: null,
	categories: null,
	tags: null,
	transaction: undefined,
	transactions: null
}
type Rows = WorkspaceAccessRows & {
	bankConnections: BankSource['connections'] | null
	bankLinks: BankSource['links'] | null
	transfers: WorkerTransferRecord[] | null
	workspaceMembers: z.output<typeof workerWorkspaceMember>[] | null
	accountGrants: z.output<typeof workerAccountGrant>[] | null
	accounts: WorkerAccountRecord[] | null
	grants: ArchiveObservation['grants'] | null
	categories: Category[] | null
	tags: Tag[] | null
	transaction: TransactionEntryObservation['transaction']
	transactions: WorkerLedgerRecord[] | null
}
export type FinanceQueryFacts = Rows & { binding: object; status: 'loading' | 'ready' | 'failed' }

const bankConnections = observeQuery<Rows['bankConnections']>('BANK_CONNECTIONS')
const bankLinks = observeQuery<Rows['bankLinks']>('BANK_LINKS')
const transfers = observeQuery<Rows['transfers']>('TRANSFERS')
const workspaceMembers = observeQuery<Rows['workspaceMembers']>('WORKSPACE_MEMBERS')
const accountGrants = observeQuery<Rows['accountGrants']>('ACCOUNT_GRANTS')
const accounts = observeQuery<WorkerAccountRecord[]>('ACCOUNTS')
const grants = observeQuery<ArchiveObservation['grants']>('GRANTS')
const categories = observeQuery<Category[]>('CATEGORIES')
const tags = observeQuery<Tag[]>('TAGS')
const transaction = observeQuery<TransactionEntryObservation['transaction']>('TRANSACTION')
const transactions = observeQuery<WorkerLedgerRecord[]>('TRANSACTIONS')

export const financeQueriesMachine = setup({
	schemas: {
		input: types<Input>(),
		context: types<Input & Rows>(),
		events: {
			BANK_CONNECTIONS: types<{ binding: object; rows: Rows['bankConnections'] }>(),
			BANK_LINKS: types<{ binding: object; rows: Rows['bankLinks'] }>(),
			TRANSFERS: types<{ binding: object; rows: Rows['transfers'] }>(),
			WORKSPACE_MEMBERS: types<{ binding: object; rows: Rows['workspaceMembers'] }>(),
			ACCOUNT_GRANTS: types<{ binding: object; rows: Rows['accountGrants'] }>(),
			ACCOUNTS: types<{ binding: object; rows: WorkerAccountRecord[] }>(),
			GRANTS: types<{ binding: object; rows: ArchiveObservation['grants'] }>(),
			CATEGORIES: types<{ binding: object; rows: Category[] }>(),
			TAGS: types<{ binding: object; rows: Tag[] }>(),
			TRANSACTION: types<{ binding: object; rows: TransactionEntryObservation['transaction'] }>(),
			TRANSACTIONS: types<{ binding: object; rows: WorkerLedgerRecord[] }>(),
			READ_FAILED: types<{ binding: object }>()
		}
	},
	actors: {
		workspaceAccess: financeWorkspaceAccessMachine,
		bankConnections,
		bankLinks,
		transfers,
		workspaceMembers,
		accountGrants,
		accounts,
		grants,
		categories,
		tags,
		transactions,
		transaction
	}
}).createMachine({
	id: 'finance-queries',
	initial: 'running',
	context: ({ input }) => ({
		...input,
		...empty,
		workspaces: input.initialWorkspaces,
		profile: input.initialProfile
	}),
	states: {
		running: {
			invoke: [
				{
					id: 'workspaceAccess',
					src: 'workspaceAccess',
					input: ({ context }) => ({
						ready: context.ready,
						workspaceId: context.selection.workspaceId,
						binding: context.binding,
						initialWorkspaces: context.initialWorkspaces,
						initialProfile: context.initialProfile,
						reportDisposalFailure: context.reportDisposalFailure
					}),
					onSnapshot: ({ context, event }) => {
						const facts = selectFinanceWorkspaceAccessFacts(event.snapshot)
						if (facts.binding !== context.binding) return
						if (facts.status === 'failed') return { target: 'failed', context: empty }
						return {
							context: {
								profile: facts.profile,
								workspace: facts.workspace,
								workspaces: facts.workspaces,
								membership: facts.membership
							}
						}
					},
					onError: { target: 'failed', context: empty }
				},
				{
					src: 'bankConnections',
					input: ({ context }) => ({
						...context,
						observe: context.selection.workspaceId
							? context.ready.capabilities.observeBankConnections.bind(
									null,
									context.selection.workspaceId
								)
							: undefined
					}),
					onError: { target: 'failed', context: empty }
				},
				{
					src: 'bankLinks',
					input: ({ context }) => ({
						...context,
						observe: context.selection.workspaceId
							? context.ready.capabilities.observeBankLinks.bind(
									null,
									context.selection.workspaceId
								)
							: undefined
					}),
					onError: { target: 'failed', context: empty }
				},
				{
					src: 'transfers',
					input: ({ context }) => ({
						...context,
						observe: context.selection.workspaceId
							? context.ready.capabilities.observeTransfers.bind(
									null,
									context.selection.workspaceId
								)
							: undefined
					}),
					onError: { target: 'failed', context: empty }
				},
				{
					src: 'workspaceMembers',
					input: ({ context }) => ({
						...context,
						observe: context.selection.workspaceId
							? context.ready.capabilities.observeWorkspaceMembers.bind(
									null,
									context.selection.workspaceId
								)
							: undefined
					}),
					onError: { target: 'failed', context: empty }
				},
				{
					src: 'accountGrants',
					input: ({ context }) => ({
						...context,
						observe: context.selection.workspaceId
							? context.ready.capabilities.observeAccountGrants.bind(
									null,
									context.selection.workspaceId
								)
							: undefined
					}),
					onError: { target: 'failed', context: empty }
				},

				{
					src: 'accounts',
					input: ({ context }) => ({
						...context,
						observe: context.selection.workspaceId
							? context.ready.capabilities.observeAccounts.bind(null, context.selection.workspaceId)
							: undefined
					}),
					onError: { target: 'failed', context: empty }
				},

				{
					src: 'grants',
					input: ({ context }) => ({
						...context,
						observe: context.selection.workspaceId
							? context.ready.capabilities.observeGrants.bind(null, context.selection.workspaceId)
							: undefined
					}),
					onError: { target: 'failed', context: empty }
				},
				{
					src: 'categories',
					input: ({ context }) => ({
						...context,
						observe: context.selection.workspaceId
							? context.ready.capabilities.observeCategories.bind(
									null,
									context.selection.workspaceId
								)
							: undefined
					}),
					onError: { target: 'failed', context: empty }
				},
				{
					src: 'tags',
					input: ({ context }) => ({
						...context,
						observe: context.selection.workspaceId
							? context.ready.capabilities.observeTags.bind(null, context.selection.workspaceId)
							: undefined
					}),
					onError: { target: 'failed', context: empty }
				},
				{
					src: 'transaction',
					input: ({ context }) => ({
						...context,
						observe:
							context.selection.workspaceId && context.transactionId
								? context.ready.capabilities.observeTransaction.bind(
										null,
										context.selection.workspaceId,
										context.transactionId
									)
								: undefined
					}),
					onError: { target: 'failed', context: empty }
				},
				{
					src: 'transactions',
					input: ({ context }) => ({
						...context,
						observe: context.selection.workspaceId
							? context.ready.capabilities.observeTransactions.bind(
									null,
									context.selection.workspaceId
								)
							: undefined
					}),
					onError: { target: 'failed', context: empty }
				}
			],
			on: {
				BANK_CONNECTIONS: ({ context, event }) =>
					event.binding === context.binding
						? { context: { bankConnections: event.rows } }
						: undefined,
				BANK_LINKS: ({ context, event }) =>
					event.binding === context.binding ? { context: { bankLinks: event.rows } } : undefined,
				TRANSFERS: ({ context, event }) =>
					event.binding === context.binding ? { context: { transfers: event.rows } } : undefined,
				WORKSPACE_MEMBERS: ({ context, event }) =>
					event.binding === context.binding
						? { context: { workspaceMembers: event.rows } }
						: undefined,
				ACCOUNT_GRANTS: ({ context, event }) =>
					event.binding === context.binding
						? { context: { accountGrants: event.rows } }
						: undefined,

				ACCOUNTS: ({ context, event }) =>
					event.binding === context.binding ? { context: { accounts: event.rows } } : undefined,

				GRANTS: ({ context, event }) =>
					event.binding === context.binding ? { context: { grants: event.rows } } : undefined,
				CATEGORIES: ({ context, event }) =>
					event.binding === context.binding ? { context: { categories: event.rows } } : undefined,
				TAGS: ({ context, event }) =>
					event.binding === context.binding ? { context: { tags: event.rows } } : undefined,
				TRANSACTION: ({ context, event }) =>
					event.binding === context.binding ? { context: { transaction: event.rows } } : undefined,
				TRANSACTIONS: ({ context, event }) =>
					event.binding === context.binding ? { context: { transactions: event.rows } } : undefined,
				READ_FAILED: ({ context, event }) =>
					event.binding === context.binding ? { target: 'failed', context: empty } : undefined
			}
		},
		failed: {}
	}
})
export function selectFinanceQueryFacts(
	snapshot: SnapshotFrom<typeof financeQueriesMachine>
): FinanceQueryFacts {
	const { context } = snapshot
	const rows = snapshot.status !== 'active' || snapshot.matches('failed') ? empty : context
	return {
		binding: context.binding,
		status:
			snapshot.status !== 'active' || snapshot.matches('failed')
				? 'failed'
				: context.workspaces === null ||
					  (!!context.selection.workspaceId && context.accounts === null)
					? 'loading'
					: 'ready',
		bankConnections: rows.bankConnections,
		bankLinks: rows.bankLinks,
		transfers: rows.transfers,
		workspaceMembers: rows.workspaceMembers,
		accountGrants: rows.accountGrants,
		profile: rows.profile,
		workspace: rows.workspace,
		workspaces: rows.workspaces,
		accounts: rows.accounts,
		membership: rows.membership,
		grants: rows.grants,
		categories: rows.categories,
		tags: rows.tags,
		transaction: rows.transaction,
		transactions: rows.transactions
	}
}
