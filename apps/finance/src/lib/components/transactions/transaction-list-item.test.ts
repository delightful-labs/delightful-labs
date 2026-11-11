import { expect, it } from 'vitest'
import { render } from 'svelte/server'
import type { TransactionRow } from '#lib/schema.js'
import TransactionListItem from './TransactionListItem.svelte'
import TransferList from '../transfers/TransferList.svelte'
import { queryLinksKey, type QueryLinkContext } from '#lib/filters/query-links.js'

const transaction: TransactionRow = {
	id: 'expense',
	bookedOn: '2026-10-23',
	amountMinor: 4217,
	currency: 'USD',
	categoryId: 'food',
	organizationId: 'org',
	accountId: 'checking',
	kind: 'expense',
	source: 'manual',
	description: 'Weekly groceries',
	memo: null,
	paymentMethod: null,
	checkId: null,
	checkDetailsId: null,
	internalTransferId: null,
	externalId: null,
	batchId: null
}
const scope = {
	href: 'https://finance.example/expenses?workspace=personal&page=2&account=cash',
	keys: ['workspace', 'page', 'account']
} satisfies QueryLinkContext
const context = new Map([[queryLinksKey, scope]])

it('renders a native list item with one named link, row content and query inheritance', () => {
	const { body } = render(TransactionListItem, {
		props: {
			href: '/expenses/expense',
			transaction,
			categoryName: 'Food',
			tagNames: ['Weekly', 'Home']
		},
		context
	})
	expect([...body.matchAll(/<li\b/g)]).toHaveLength(1)
	expect([...body.matchAll(/<a\b/g)]).toHaveLength(1)
	expect(body).toContain('aria-label="Transaction details: Food, Weekly groceries, $42.17"')
	expect(body).toContain('href="/expenses/expense?workspace=personal&amp;page=2&amp;account=cash"')
	expect(body).toContain('Weekly groceries')
	expect(body).toContain('Weekly, Home')
})

it('keeps a useful accessible name when category and description are unavailable', () => {
	const { body } = render(TransactionListItem, {
		props: {
			href: '/expenses/expense?page=3',
			transaction: { ...transaction, description: null },
			categoryName: undefined
		},
		context
	})
	expect(body).toContain('aria-label="Transaction details: Category unavailable, $42.17"')
	expect(body).toContain('href="/expenses/expense?page=3&amp;workspace=personal&amp;account=cash"')
})

it('renders transfer rows with independent dates, currencies, descriptions and a scoped destination', () => {
	const { body } = render(TransferList, {
		props: {
			pairs: [
				{
					id: 'transfer',
					expense: transaction,
					income: {
						...transaction,
						id: 'income',
						kind: 'income',
						accountId: 'savings',
						bookedOn: '2026-10-24',
						currency: 'EUR',
						amountMinor: 4000,
						description: 'Received transfer'
					}
				}
			],
			accountNames: new Map([
				['checking', 'Checking'],
				['savings', 'Savings']
			]),
			noAccountsSelected: false,
			requestedPage: 1,
			pageHref: (page) => `/transfers?page=${page}`,
			transferHref: (id) => `/transfers/${id}`
		},
		context
	})
	expect([...body.matchAll(/<li\b/g)]).toHaveLength(1)
	expect([...body.matchAll(/<a\b/g)]).toHaveLength(1)
	expect(body).toContain('aria-label="Transfer details: Checking → Savings, $42.17 → €40.00"')
	expect(body).toContain(
		'href="/transfers/transfer?workspace=personal&amp;page=2&amp;account=cash"'
	)
	expect(body).toContain('datetime="2026-10-23"')
	expect(body).toContain('datetime="2026-10-24"')
	expect(body).toContain('Weekly groceries')
	expect(body).toContain('Received transfer')
})
