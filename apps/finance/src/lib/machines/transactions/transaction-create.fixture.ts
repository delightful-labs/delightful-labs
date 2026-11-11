import { afterEach, vi } from 'vitest'
import { Transaction } from 'jazz-tools'
import { createTransactionSaveMachine } from './transaction-save.js'
import { transactionEntryScope } from './transaction-entry.js'
import type { TransactionEntryObservation } from '#lib/contracts/transaction-entry-contract.js'
import type { TransactionSaveValues } from '#lib/validation/transactions.js'
import { createActor } from 'xstate'
import type { InputFrom } from 'xstate'

export const organizationId = '22222222-2222-4222-8222-222222222222'
export const creationValues: TransactionSaveValues = {
	organizationId,
	accountId: '11111111-1111-4111-8111-111111111111',
	categoryId: '33333333-3333-4333-8333-333333333333',
	kind: 'expense',
	source: { source: 'manual' },
	money: { amountMinor: 100, currency: 'USD' },
	bookedOn: '2026-10-18',
	tags: [],
	paymentMethod: null,
	checkId: null
}
export function creationFacts(binding: object): TransactionEntryObservation {
	return {
		identityId: 'user',
		organizationId,
		binding,
		kind: 'expense',
		sessionReady: true,
		loading: false,
		failed: false,
		membership: {
			id: 'member',
			userId: 'user',
			organizationId,
			role: 'owner',
			accountAccessMode: 'all',
			profileId: null
		},
		grants: [],
		accounts: [
			{
				id: creationValues.accountId,
				organizationId,
				name: 'Ledger',
				kind: 'cash',
				currency: 'USD',
				archivedAt: null
			}
		],
		categories: [
			{
				id: creationValues.categoryId,
				organizationId,
				name: 'Food',
				kind: 'expense',
				isSystem: false,
				archivedAt: null
			}
		],
		tags: []
	}
}
const cleanups: (() => void)[] = []
afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup()
	vi.restoreAllMocks()
})

export function creationFixture() {
	const insert = vi.fn()
	const update = vi.fn()
	const remove = vi.fn()
	const all = vi.fn(async () => [])
	const rollback = vi.fn(async () => true)
	const wait = vi.fn(async (_options: { tier: 'local' }) => {})
	const commit = vi.fn().mockReturnValue({ wait })
	const transactions: Transaction[] = []
	const beginTransaction = vi.fn(() => {
		const transaction = new Transaction('mergeable', () => {
			throw new Error('Unit fixture must not open a runtime')
		})
		vi.spyOn(transaction, 'insert').mockImplementation(insert)
		vi.spyOn(transaction, 'update').mockImplementation(update)
		vi.spyOn(transaction, 'delete').mockImplementation(remove)
		vi.spyOn(transaction, 'all').mockImplementation(all)
		vi.spyOn(transaction, 'rollback').mockImplementation(rollback)
		vi.spyOn(transaction, 'commit').mockImplementation(commit)
		transactions.push(transaction)
		return transaction
	})
	const db = { beginTransaction, all: async <T>(): Promise<T[]> => [] }
	let facts = creationFacts(db)
	const machine = createTransactionSaveMachine(db, () => facts)
	function input(values: TransactionSaveValues = creationValues): InputFrom<typeof machine> {
		facts = { ...facts, kind: values.kind }
		const scope = transactionEntryScope(facts)
		return {
			request: { id: 1, scopeRevision: 0, scope, values },
			observation: { revision: 0, facts }
		}
	}
	function start(
		values = creationValues,
		logic: import('xstate').ActorLogic<
			import('xstate').SnapshotFrom<typeof machine>,
			import('xstate').EventFromLogic<typeof machine>,
			import('xstate').InputFrom<typeof machine>,
			import('xstate').AnyActorSystem,
			import('xstate').EmittedFrom<typeof machine>
		> = machine
	) {
		const actor = createActor(logic, { input: input(values) })
		cleanups.push(() => actor.stop())
		return actor.start()
	}
	return {
		db,
		transactions,
		all,
		insert,
		update,
		remove,
		rollback,
		wait,
		commit,
		beginTransaction,
		machine,
		input,
		start,
		setFacts: (next: TransactionEntryObservation) => (facts = next)
	}
}
