import { createCallbackLogic, setup, types, type SnapshotFrom } from 'xstate'
import type { SessionRuntimeObservation } from 'delightful-local-first/session/runtime'
import type {
	FinanceWorkerCapabilities,
	WorkerSelection,
	WorkerWorkspace,
	WorkerAccountRecord,
	WorkerLedgerRecord
} from '../../contracts/worker-application.js'
import type { TransactionEntryObservation } from '../../contracts/transaction-entry-contract.js'
import type { Category, Tag } from '../../schema.js'
import type { ArchiveObservation } from '../accounts/account-archive-operation.js'

export type FinanceWorkerReady = Extract<
	SessionRuntimeObservation<FinanceWorkerCapabilities>,
	{ status: 'ready' }
>
type Input = {
	ready: FinanceWorkerReady
	initialWorkspaces: WorkerWorkspace[] | null
	transactionId: string | null
	selection: WorkerSelection
	binding: object
	reportDisposalFailure: () => void
}
const empty = {
	workspaces: null,
	accounts: null,
	membership: undefined,
	grants: null,
	categories: null,
	tags: null,
	transaction: undefined,
	transactions: null
}
type Rows = {
	workspaces: WorkerWorkspace[] | null
	accounts: WorkerAccountRecord[] | null
	membership: ArchiveObservation['membership']
	grants: ArchiveObservation['grants'] | null
	categories: Category[] | null
	tags: Tag[] | null
	transaction: TransactionEntryObservation['transaction']
	transactions: WorkerLedgerRecord[] | null
}
export type FinanceQueryFacts = Rows & { binding: object; status: 'loading' | 'ready' | 'failed' }

/** One native subscription per invoked actor; failures and release stay with its owner. */
function observeQuery<Result>(
	event:
		| 'WORKSPACES'
		| 'ACCOUNTS'
		| 'MEMBERSHIP'
		| 'GRANTS'
		| 'CATEGORIES'
		| 'TAGS'
		| 'TRANSACTIONS'
		| 'TRANSACTION'
) {
	return createCallbackLogic<
		never,
		{
			binding: object
			observe: ((publish: (result: Result) => void, failed: () => void) => () => void) | undefined
			reportDisposalFailure: () => void
		}
	>(({ input, sendBack }) => {
		let active = true
		const release = input.observe?.(
			(rows) => {
				if (active) sendBack({ type: event, binding: input.binding, rows })
			},
			() => {
				if (active) sendBack({ type: 'READ_FAILED', binding: input.binding })
			}
		)
		return () => {
			active = false
			try {
				release?.()
			} catch {
				input.reportDisposalFailure()
			}
		}
	})
}
const workspaces = observeQuery<WorkerWorkspace[]>('WORKSPACES')
const accounts = observeQuery<WorkerAccountRecord[]>('ACCOUNTS')
const membership = observeQuery<ArchiveObservation['membership']>('MEMBERSHIP')
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
			WORKSPACES: types<{ binding: object; rows: WorkerWorkspace[] }>(),
			ACCOUNTS: types<{ binding: object; rows: WorkerAccountRecord[] }>(),
			MEMBERSHIP: types<{ binding: object; rows: ArchiveObservation['membership'] }>(),
			GRANTS: types<{ binding: object; rows: ArchiveObservation['grants'] }>(),
			CATEGORIES: types<{ binding: object; rows: Category[] }>(),
			TAGS: types<{ binding: object; rows: Tag[] }>(),
			TRANSACTION: types<{ binding: object; rows: TransactionEntryObservation['transaction'] }>(),
			TRANSACTIONS: types<{ binding: object; rows: WorkerLedgerRecord[] }>(),
			READ_FAILED: types<{ binding: object }>()
		}
	},
	actors: { workspaces, accounts, membership, grants, categories, tags, transactions, transaction }
}).createMachine({
	id: 'finance-queries',
	initial: 'running',
	context: ({ input }) => ({ ...input, ...empty, workspaces: input.initialWorkspaces }),
	states: {
		running: {
			invoke: [
				{
					src: 'workspaces',
					input: ({ context }) => ({
						...context,
						observe: context.ready.capabilities.observeWorkspaces
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
					src: 'membership',
					input: ({ context }) => ({
						...context,
						observe: context.selection.workspaceId
							? context.ready.capabilities.observeMembership.bind(
									null,
									context.selection.workspaceId
								)
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
				WORKSPACES: ({ context, event }) =>
					event.binding === context.binding ? { context: { workspaces: event.rows } } : undefined,
				ACCOUNTS: ({ context, event }) =>
					event.binding === context.binding ? { context: { accounts: event.rows } } : undefined,
				MEMBERSHIP: ({ context, event }) =>
					event.binding === context.binding ? { context: { membership: event.rows } } : undefined,
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
