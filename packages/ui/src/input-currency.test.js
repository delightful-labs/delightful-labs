import { expect, test } from 'vitest'
import { render } from 'svelte/server'
import { InputCurrency } from './lib/index.js'

test('currency input preserves string defaults and combines description IDs', () => {
	const { body } = render(InputCurrency, {
		props: {
			label: 'Amount',
			currencyLabel: 'USD',
			name: 'amount',
			defaultValue: '0.00',
			'aria-describedby': 'help'
		}
	})
	expect(body).toContain('type="text"')
	expect(body).toContain('value="0.00"')
	expect(body).toContain('inputmode="decimal"')
	const currencyId = body.match(/<span\b[^>]*id="([^"]+)"/)?.[1]
	expect(currencyId).toBeTruthy()
	expect(body).toContain(`aria-describedby="help ${currencyId}"`)
})

test('explicit empty values take precedence and comma decimals remain unchanged', () => {
	const { body } = render(InputCurrency, {
		props: {
			label: 'Amount',
			currencyLabel: 'EUR',
			defaultValue: '12,50',
			value: ''
		}
	})
	expect(body).toContain('value=""')
	const { body: comma } = render(InputCurrency, {
		props: { label: 'Amount', currencyLabel: 'EUR', defaultValue: '12,50' }
	})
	expect(comma).toContain('value="12,50"')
})
