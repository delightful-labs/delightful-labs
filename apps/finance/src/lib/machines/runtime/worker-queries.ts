import type { ObservationReleaseOutcome } from 'delightful-local-first/data/observation-workflow'
import type { BankSource } from '../bank-sync/types.js'
import type { WorkerTransferRecord } from '../../contracts/worker-transfers.js'
import type { workerWorkspaceMember, workerAccountGrant } from '../../contracts/worker-accounts.js'
import { setup, types, matchesState, type SnapshotFrom } from 'xstate'
import type {
	WorkerSelection,
	WorkerAccountRecord,
	WorkerLedgerRecord
} from '../../contracts/worker-application.js'
import type { TransactionEntryObservation } from '../../contracts/transaction-entry-contract.js'
import type { z } from 'zod'
import type { Category, Tag } from '../../queries.js'
import type { ArchiveObservation } from '../accounts/account-archive-operation.js'

import {
	observeFinanceQuery as observeQuery,
	type FinanceContentSource
} from './worker-query-observation.js'
import type { WorkspaceAccessRows, WorkspaceAccessFacts } from './worker-workspace-access.js'
export type { FinanceWorkerReady } from './worker-query-observation.js'
export type FinanceContentCapabilities = Pick<
	import('../../contracts/worker-application.js').FinanceWorkerCapabilities,
	| 'observeBankConnections'
	| 'observeBankLinks'
	| 'observeTransfers'
	| 'observeWorkspaceMembers'
	| 'observeAccountGrants'
	| 'observeAccounts'
	| 'observeGrants'
	| 'observeCategories'
	| 'observeTags'
	| 'observeTransaction'
	| 'observeTransactions'
>
type Input = {
	ready: { capabilities: FinanceContentCapabilities }
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
	accounts: null,
	grants: null,
	categories: null,
	tags: null,
	transaction: undefined,
	transactions: null
}
type Rows = {
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
export type FinanceContentFacts = Rows & { binding: object; status: 'loading' | 'ready' | 'failed' }
export type FinanceQueryFacts = FinanceContentFacts & WorkspaceAccessRows

const bankConnections = observeQuery<Rows['bankConnections']>('BANK_CONNECTIONS', 'bankConnections')
const bankLinks = observeQuery<Rows['bankLinks']>('BANK_LINKS', 'bankLinks')
const transfers = observeQuery<Rows['transfers']>('TRANSFERS', 'transfers')
const workspaceMembers = observeQuery<Rows['workspaceMembers']>(
	'WORKSPACE_MEMBERS',
	'workspaceMembers'
)
const accountGrants = observeQuery<Rows['accountGrants']>('ACCOUNT_GRANTS', 'accountGrants')
const accounts = observeQuery<WorkerAccountRecord[]>('ACCOUNTS', 'accounts')
const grants = observeQuery<ArchiveObservation['grants']>('GRANTS', 'grants')
const categories = observeQuery<Category[]>('CATEGORIES', 'categories')
const tags = observeQuery<Tag[]>('TAGS', 'tags')
const transaction = observeQuery<TransactionEntryObservation['transaction']>(
	'TRANSACTION',
	'transaction'
)
const transactions = observeQuery<WorkerLedgerRecord[]>('TRANSACTIONS', 'transactions')

const contentSources: readonly FinanceContentSource[] = [
	'bankConnections',
	'bankLinks',
	'transfers',
	'workspaceMembers',
	'accountGrants',
	'accounts',
	'grants',
	'categories',
	'tags',
	'transaction',
	'transactions'
]

export const financeQueriesMachine = setup({
	schemas: {
		input: types<Input>(),
		context: types<
			Input &
				Rows & {
					receipts: readonly { source: FinanceContentSource; outcome: ObservationReleaseOutcome }[]
				}
		>(),
		output: types<{ outcome: 'released' }>(),
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
			READ_FAILED: types<{ binding: object }>(),
			SHUTDOWN: types(),
			OBSERVATION_RELEASED: types<{
				binding: object
				source: FinanceContentSource
				outcome: ObservationReleaseOutcome
			}>()
		}
	},
	actors: {
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
	context: ({ input }) => ({ ...input, ...empty, receipts: [] }),
	output: () => ({ outcome: 'released' }),
	on: {
		SHUTDOWN: { target: '.releasingClose', context: empty },
		OBSERVATION_RELEASED: ({ context, event, value }) => {
			if (
				(!matchesState('releasingFailure', value) && !matchesState('releasingClose', value)) ||
				event.binding !== context.binding ||
				!contentSources.includes(event.source) ||
				context.receipts.some((receipt) => receipt.source === event.source)
			)
				return
			return {
				context: {
					receipts: [...context.receipts, { source: event.source, outcome: event.outcome }]
				}
			}
		}
	},

	invoke: [
		{
			id: 'bankConnections',
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
			onError: { target: '.unresolved', context: empty }
		},
		{
			id: 'bankLinks',
			src: 'bankLinks',
			input: ({ context }) => ({
				...context,
				observe: context.selection.workspaceId
					? context.ready.capabilities.observeBankLinks.bind(null, context.selection.workspaceId)
					: undefined
			}),
			onError: { target: '.unresolved', context: empty }
		},
		{
			id: 'transfers',
			src: 'transfers',
			input: ({ context }) => ({
				...context,
				observe: context.selection.workspaceId
					? context.ready.capabilities.observeTransfers.bind(null, context.selection.workspaceId)
					: undefined
			}),
			onError: { target: '.unresolved', context: empty }
		},
		{
			id: 'workspaceMembers',
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
			onError: { target: '.unresolved', context: empty }
		},
		{
			id: 'accountGrants',
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
			onError: { target: '.unresolved', context: empty }
		},

		{
			id: 'accounts',
			src: 'accounts',
			input: ({ context }) => ({
				...context,
				observe: context.selection.workspaceId
					? context.ready.capabilities.observeAccounts.bind(null, context.selection.workspaceId)
					: undefined
			}),
			onError: { target: '.unresolved', context: empty }
		},

		{
			id: 'grants',
			src: 'grants',
			input: ({ context }) => ({
				...context,
				observe: context.selection.workspaceId
					? context.ready.capabilities.observeGrants.bind(null, context.selection.workspaceId)
					: undefined
			}),
			onError: { target: '.unresolved', context: empty }
		},
		{
			id: 'categories',
			src: 'categories',
			input: ({ context }) => ({
				...context,
				observe: context.selection.workspaceId
					? context.ready.capabilities.observeCategories.bind(null, context.selection.workspaceId)
					: undefined
			}),
			onError: { target: '.unresolved', context: empty }
		},
		{
			id: 'tags',
			src: 'tags',
			input: ({ context }) => ({
				...context,
				observe: context.selection.workspaceId
					? context.ready.capabilities.observeTags.bind(null, context.selection.workspaceId)
					: undefined
			}),
			onError: { target: '.unresolved', context: empty }
		},
		{
			id: 'transaction',
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
			onError: { target: '.unresolved', context: empty }
		},
		{
			id: 'transactions',
			src: 'transactions',
			input: ({ context }) => ({
				...context,
				observe: context.selection.workspaceId
					? context.ready.capabilities.observeTransactions.bind(null, context.selection.workspaceId)
					: undefined
			}),
			onError: { target: '.unresolved', context: empty }
		}
	],
	states: {
		running: {
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
					event.binding === context.binding
						? { target: 'releasingFailure', context: empty }
						: undefined
			}
		},
		releasingFailure: {
			entry: (_, enq) => {
				for (const source of contentSources) enq.sendTo(source, { type: 'RELEASE' })
			},
			always: ({ context }) => {
				if (context.receipts.some((receipt) => receipt.outcome === 'unresolved'))
					return { target: 'unresolved' }
				if (context.receipts.length === contentSources.length) return { target: 'failed' }
			},
			on: { SHUTDOWN: { target: 'releasingClose' } }
		},
		releasingClose: {
			entry: (_, enq) => {
				for (const source of contentSources) enq.sendTo(source, { type: 'RELEASE' })
			},
			always: ({ context }) => {
				if (context.receipts.some((receipt) => receipt.outcome === 'unresolved'))
					return { target: 'unresolved' }
				if (context.receipts.length === contentSources.length) return { target: 'closed' }
			},
			on: { SHUTDOWN: {} }
		},
		failed: { on: { SHUTDOWN: { target: 'closed' } } },
		unresolved: { on: { SHUTDOWN: {} } },
		closed: { type: 'final' }
	}
})
export function selectFinanceQueryFacts(
	snapshot: SnapshotFrom<typeof financeQueriesMachine>
): FinanceContentFacts {
	const { context } = snapshot
	const rows = snapshot.status !== 'active' || !snapshot.matches('running') ? empty : context
	return {
		binding: context.binding,
		status:
			snapshot.matches('releasingFailure') || snapshot.matches('releasingClose')
				? 'loading'
				: snapshot.status !== 'active' || !snapshot.matches('running')
					? 'failed'
					: !!context.selection.workspaceId && context.accounts === null
						? 'loading'
						: 'ready',
		bankConnections: rows.bankConnections,
		bankLinks: rows.bankLinks,
		transfers: rows.transfers,
		workspaceMembers: rows.workspaceMembers,
		accountGrants: rows.accountGrants,
		accounts: rows.accounts,
		grants: rows.grants,
		categories: rows.categories,
		tags: rows.tags,
		transaction: rows.transaction,
		transactions: rows.transactions
	}
}

/** Merge app-owned access evidence with the independent financial read scope. */
export function combineFinanceQueryFacts(
	content: FinanceContentFacts,
	access: WorkspaceAccessFacts | undefined
): FinanceQueryFacts {
	return {
		...content,
		status:
			content.status === 'failed' || access?.status === 'failed'
				? 'failed'
				: !access ||
					  (access.workspaces === null && access.membership === undefined) ||
					  content.status === 'loading'
					? 'loading'
					: 'ready',
		profile: access?.profile,
		workspace: access?.workspace,
		workspaces: access?.workspaces ?? null,
		membership: access?.membership
	}
}
export function emptyFinanceContentFacts(
	binding: object,
	status: FinanceContentFacts['status'] = 'loading'
): FinanceContentFacts {
	return { ...empty, binding, status }
}

export function financeQueriesReleaseUnresolved(
	snapshot: SnapshotFrom<typeof financeQueriesMachine>
) {
	return (
		snapshot.status === 'error' || snapshot.status === 'stopped' || snapshot.matches('unresolved')
	)
}
