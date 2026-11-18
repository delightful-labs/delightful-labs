import { expect, it } from 'vitest'
import { selectWorkerLedger, emptyLedgerFilters } from './worker-ledger.js'
import { workerLedgerView } from '../../contracts/worker-application.js'
import type { FinanceQueryFacts } from './worker-queries.js'

const organizationId = '20000000-0000-4000-8000-000000000001'
const categoryId = '50000000-0000-4000-8000-000000000001'
function facts(): FinanceQueryFacts {
	return {
		binding: {},
		status: 'ready',
		transaction: undefined,
		workspaces: [],
		accounts: [],
		membership: null,
		grants: [],
		tags: [],
		categories: [
			{
				id: categoryId,
				organizationId,
				name: 'Archived Food',
				kind: 'expense',
				isSystem: false,
				archivedAt: new Date('2026-01-01')
			}
		],
		transactions: [
			{
				id: '60000000-0000-4000-8000-000000000001',
				organizationId,
				accountId: '30000000-0000-4000-8000-000000000001',
				categoryId,
				kind: 'expense',
				amountMinor: 1234,
				currency: 'USD',
				bookedOn: '2026-11-18',
				description: 'Coffee',
				memo: 'Client visit',
				tagNames: ['Remote']
			},
			{
				id: '60000000-0000-4000-8000-000000000002',
				organizationId,
				accountId: '30000000-0000-4000-8000-000000000002',
				categoryId,
				kind: 'expense',
				amountMinor: 5000,
				currency: 'TZS',
				bookedOn: '2026-11-17',
				description: 'Bus',
				memo: null,
				tagNames: []
			},
			{
				id: '60000000-0000-4000-8000-000000000003',
				organizationId,
				accountId: '30000000-0000-4000-8000-000000000001',
				categoryId,
				kind: 'income',
				amountMinor: 10000,
				currency: 'USD',
				bookedOn: '2026-11-19',
				description: 'Pay',
				memo: null,
				tagNames: []
			}
		]
	}
}
it('combines worker filters, keeps archived category names and projects only display fields', () => {
	const view = selectWorkerLedger(
		facts(),
		'expense',
		{
			...emptyLedgerFilters,
			start: '2026-11-18',
			end: '2026-11-19',
			currency: 'USD',
			categoryId,
			query: 'client remote'
		},
		2
	)
	expect(view?.page).toBe(1)
	expect(view?.groups.flatMap((g) => g.transactions).map((t) => t.description)).toEqual(['Coffee'])
	expect(view?.groups[0]?.totals).toEqual([['USD', 1234n]])
	expect(view?.categories).toEqual([[categoryId, 'Archived Food']])
	expect(view?.currencies).toEqual(['TZS', 'USD'])
	expect(view?.groups[0]?.transactions[0]).not.toHaveProperty('memo')
	expect(view?.groups[0]?.transactions[0]).not.toHaveProperty('organizationId')
	expect(workerLedgerView.parse(structuredClone(view))).toEqual(view)
})
it('keeps missing reads distinct from empty results and rejects inverted ranges in the worker view', () => {
	expect(
		selectWorkerLedger({ ...facts(), transactions: null }, 'expense', emptyLedgerFilters, 1)
	).toBeNull()
	expect(
		selectWorkerLedger({ ...facts(), transactions: [] }, 'expense', emptyLedgerFilters, 1)
	).toMatchObject({ rangeValid: true, groups: [], page: 1, pageCount: 1 })
	expect(
		selectWorkerLedger(
			facts(),
			'expense',
			{ ...emptyLedgerFilters, start: '2026-11-20', end: '2026-11-18' },
			2
		)
	).toMatchObject({ rangeValid: false, groups: [], page: 1, pageCount: 1 })
})
