import { describe, expect, it } from 'vitest'
import { render } from 'svelte/server'
import TransactionListFilters from './TransactionListFilters.svelte'

function filters(currencies: string[]) {
	return render(TransactionListFilters, {
		props: {
			value: { start: '', end: '', categoryId: '', currency: '', query: '' },
			categories: new Map([['food', 'Food']]),
			currencies,
			onchange: () => {}
		}
	}).body
}

describe('transaction list filter controls', () => {
	it('preserves unrestricted initial dates with the custom fields available', () => {
		const html = filters(['USD'])
		expect(html).toMatch(/<input\b[^>]*value="custom"[^>]*\bchecked(?:=""|\s|\/?>)/)
		expect(html).toContain('Start Date')
		expect(html).toContain('End Date')
		expect([...html.matchAll(/type="date"/g)]).toHaveLength(2)
	})
	for (const currencies of [[], ['USD']]) {
		it(`hides the currency filter with ${currencies.length} available currencies`, () => {
			const html = filters(currencies)
			expect(html).not.toContain('Filter Currency')
			expect(html).toContain('Search Transactions')
			expect(html).toContain('Filter Category')
		})
	}
	it('shows currency selection when multiple currencies are available', () => {
		const html = filters(['USD', 'TZS'])
		expect(html).toContain('Filter Currency')
		expect(html).toContain('value="USD"')
		expect(html).toContain('value="TZS"')
	})
})
