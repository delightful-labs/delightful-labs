import { expect, it } from 'vitest'
import { createFinanceAccountStore, financeAccountStoreBinding } from './account-store.js'

const configuration = {
	serverUrl: 'https://finance.example/jazz',
	scope: '11111111-1111-4111-8111-111111111111'
}
const registry = 'https://finance.example/jazz/apps/11111111-1111-4111-8111-111111111111/accounts'

it('selects the canonical SDK registry and current Finance environment', () => {
	expect(financeAccountStoreBinding(configuration)).toEqual({
		databaseName: 'delightful-finances-account-selection',
		key: JSON.stringify([registry, 'dev'])
	})
})

it('converges canonical endpoint spellings and trims the explicit SDK scope', () => {
	const inputs = [
		{ ...configuration, serverUrl: 'HTTPS://FINANCE.EXAMPLE:443/jazz/' },
		{ ...configuration, serverUrl: 'wss://finance.example/jazz' },
		{ ...configuration, scope: ` ${configuration.scope} ` }
	]
	for (const input of inputs)
		expect(financeAccountStoreBinding(input).key).toBe(JSON.stringify([registry, 'dev']))
})

it('keeps explicitly empty and opaque environment values distinct from the SDK default', () => {
	for (const environment of ['', ' dev ', 'a:\n"b'])
		expect(JSON.parse(financeAccountStoreBinding({ ...configuration, environment }).key)).toEqual([
			registry,
			environment
		])
	expect(financeAccountStoreBinding({ ...configuration, environment: 'dev' })).toEqual(
		financeAccountStoreBinding(configuration)
	)
})

it('isolates different endpoints, application scopes and environments within the app database', () => {
	const bindings = [
		configuration,
		{ ...configuration, serverUrl: 'https://other.example/jazz' },
		{ ...configuration, scope: '22222222-2222-4222-8222-222222222222' },
		{ ...configuration, environment: 'production' }
	].map(financeAccountStoreBinding)
	expect(new Set(bindings.map((binding) => binding.key)).size).toBe(4)
	expect(new Set(bindings.map((binding) => binding.databaseName))).toEqual(
		new Set(['delightful-finances-account-selection'])
	)
})

it.each([
	{ ...configuration, scope: '' },
	{ ...configuration, scope: '  ' },
	{ ...configuration, scope: 'x'.repeat(8193) },
	{ ...configuration, environment: 'x'.repeat(8193) },
	{ ...configuration, serverUrl: 'file:///private-record' },
	{ ...configuration, serverUrl: 'https://private-secret@finance.example/jazz' },
	{ ...configuration, serverUrl: 'https://finance.example/jazz?private=secret' },
	{ ...configuration, serverUrl: 'https://finance.example/jazz#secret' },
	{ ...configuration, extra: 'rejected' }
])('refuses invalid configuration before acquiring a native store %#', (input) => {
	expect(() => createFinanceAccountStore(input)).toThrow(
		new Error('Invalid Finance account storage binding')
	)
})
