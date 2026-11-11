import { describe, expect, it } from 'vitest'
import type { Account, Category } from '../schema.js'
import {
	appTransactionSchema,
	defaultTransactionCategory,
	independentTransactionSchema,
	transactionFormSchema
} from './transactions.js'

type Options = ReturnType<Parameters<typeof transactionFormSchema>[0]>
const account: Account = {
	id: '11111111-1111-4111-8111-111111111111',
	organizationId: '22222222-2222-4222-8222-222222222222',
	name: 'Checking',
	kind: 'bank',
	currency: 'USD',
	archivedAt: null
}
const category: Category = {
	id: '33333333-3333-4333-8333-333333333333',
	organizationId: account.organizationId,
	name: 'Groceries',
	kind: 'expense',
	isSystem: false,
	archivedAt: null
}
const fields = {
	accountId: account.id,
	categoryId: category.id,
	amount: '12.34',
	bookedOn: '2026-10-13',
	description: '  Groceries  ',
	memo: '  Market  '
}

function options(kind: Options['kind'] = 'expense'): Options {
	return {
		organizationId: account.organizationId,
		kind,
		accounts: [account],
		categories: [{ ...category, kind }]
	}
}

describe('canonical transaction normalization', () => {
	const base = {
		accountId: account.id,
		organizationId: account.organizationId,
		categoryId: category.id,
		bookedOn: fields.bookedOn,
		money: { amountMinor: 100, currency: 'USD' }
	}
	it('normalizes memos outside the form adapter', () => {
		expect(
			appTransactionSchema.parse({
				...base,
				kind: 'expense',
				source: { source: 'manual' },
				memo: '  Market  '
			}).memo
		).toBe('Market')
		expect(
			appTransactionSchema.parse({
				...base,
				kind: 'expense',
				source: { source: 'manual' },
				memo: ' '
			}).memo
		).toBeUndefined()
	})
	it.each([undefined, '', '  ', '  Groceries  '])(
		'normalizes description %j independently of memo',
		(description) => {
			const result = appTransactionSchema.parse({
				...base,
				kind: 'expense',
				source: { source: 'manual' },
				description,
				memo: '  Additional notes\nSecond line  '
			})
			expect(result.description).toBe(description?.trim() || undefined)
			expect(result.memo).toBe('Additional notes\nSecond line')
		}
	)
	it('leaves the payment method optional for income', () => {
		expect(
			appTransactionSchema.parse({ ...base, kind: 'income', source: { source: 'manual' } })
		).toMatchObject({ paymentMethod: null, checkId: null })
	})
	it('accepts a saved Check reference for either transaction kind', () => {
		const result = appTransactionSchema.parse({
			...base,
			kind: 'expense',
			source: { source: 'manual' },
			paymentMethod: 'check',
			check: {
				kind: 'existing',
				id: '55555555-5555-4555-8555-555555555555'
			}
		})
		expect(result).toMatchObject({ kind: 'expense', paymentMethod: 'check' })
	})
	it.each([
		{ paymentMethod: 'check' },
		{ paymentMethod: 'cash', checkId: '55555555-5555-4555-8555-555555555555' },
		{ paymentMethod: 'check', checkId: 'invalid' }
	])('rejects malformed Check references: %j', (payment) => {
		expect(
			appTransactionSchema.safeParse({
				...base,
				kind: 'income',
				source: { source: 'manual' },
				...payment
			}).success
		).toBe(false)
	})
	it('does not give imported income a manual payment method', () => {
		expect(
			appTransactionSchema.parse({
				...base,
				kind: 'income',
				source: { source: 'simplefin', externalId: ' external ' }
			})
		).toMatchObject({ paymentMethod: null, checkId: null })
	})
})

describe('independent transaction payment references', () => {
	const values = {
		organizationId: '22222222-2222-4222-8222-222222222222',
		accountId: '33333333-3333-4333-8333-333333333333',
		categoryId: '44444444-4444-4444-8444-444444444444',
		bookedOn: '2026-10-13',
		money: { amountMinor: 100, currency: 'USD' },
		source: { source: 'manual' }
	}
	it.each(['income', 'expense'] satisfies ('income' | 'expense')[])(
		'allows an optional payment method or a compatible Check for %s',
		(kind) => {
			expect(independentTransactionSchema.parse({ ...values, kind })).toMatchObject({
				kind,
				paymentMethod: null,
				checkId: null
			})
			expect(
				independentTransactionSchema.parse({
					...values,
					kind,
					paymentMethod: 'check',
					checkId: '55555555-5555-4555-8555-555555555555'
				})
			).toMatchObject({ kind, paymentMethod: 'check' })
		}
	)
	it.each([
		{ paymentMethod: 'check' },
		{ paymentMethod: 'cash', checkId: '55555555-5555-4555-8555-555555555555' },
		{ paymentMethod: 'check', checkId: 'invalid' }
	])('rejects an invalid reference pairing: %j', (payment) => {
		expect(
			independentTransactionSchema.safeParse({ ...values, kind: 'expense', ...payment }).success
		).toBe(false)
	})
})

describe('default category', () => {
	const system = {
		...category,
		id: '66666666-6666-4666-8666-666666666666',
		name: 'Renamed default',
		isSystem: true
	}
	it.each(['expense', 'income'] satisfies Options['kind'][])(
		'defaults missing or empty %s categories by system identity',
		(kind) => {
			const current = {
				...options(kind),
				categories: [
					{ ...category, kind },
					{ ...system, kind }
				]
			}
			const schema = transactionFormSchema(() => current)
			const { categoryId, ...withoutCategory } = fields
			expect(schema.parse(withoutCategory).categoryId).toBe(system.id)
			expect(schema.parse({ ...fields, categoryId: '' }).categoryId).toBe(system.id)
			expect(schema.parse(fields).categoryId).toBe(categoryId)
		}
	)
	it.each([
		{ organizationId: 'other' },
		{ kind: 'income' },
		{ archivedAt: new Date() },
		{ isSystem: false }
	] satisfies Partial<Category>[])(
		'does not select an unavailable system category %j',
		(values) => {
			const current = { ...options(), categories: [{ ...system, ...values }] }
			expect(defaultTransactionCategory(current)).toBeUndefined()
			expect(
				transactionFormSchema(() => current).safeParse({ ...fields, categoryId: '' }).success
			).toBe(false)
		}
	)
	it('rejects an invalid explicit category rather than substituting the default', () => {
		const current = { ...options(), categories: [category, system] }
		expect(
			transactionFormSchema(() => current).safeParse({ ...fields, categoryId: 'missing' }).success
		).toBe(false)
	})
})

describe('transaction form schema', () => {
	it('derives domain fields from current rows and ignores injected domain values', () => {
		const schema = transactionFormSchema(() => options())
		expect(
			schema.parse({
				...fields,
				kind: 'income',
				organizationId: 'other',
				currency: 'EUR',
				source: 'simplefin'
			})
		).toEqual({
			accountId: account.id,
			categoryId: category.id,
			organizationId: account.organizationId,
			kind: 'expense',
			money: { amountMinor: 1234, currency: 'USD' },
			bookedOn: fields.bookedOn,
			description: 'Groceries',
			memo: 'Market',
			source: { source: 'manual' },
			paymentMethod: null,
			checkId: null,
			tags: undefined
		})
	})

	it.each(['', '-1', '1.234', '1e3', '90071992547409.92'])(
		'rejects invalid amount %j',
		(amount) => {
			expect(transactionFormSchema(() => options()).safeParse({ ...fields, amount }).success).toBe(
				false
			)
		}
	)

	it.each([
		['21474836.48', 2_147_483_648],
		['90071992547409.91', Number.MAX_SAFE_INTEGER]
	])('accepts exact amount %s above the former ceiling', (amount, amountMinor) => {
		expect(transactionFormSchema(() => options()).parse({ ...fields, amount }).money).toEqual({
			amountMinor,
			currency: 'USD'
		})
	})

	it('accepts zero, omits blank memo, and uses the account currency', () => {
		const schema = transactionFormSchema(() => ({
			...options(),
			accounts: [{ ...account, currency: 'EUR' }]
		}))
		const result = schema.parse({ ...fields, amount: '0', description: '  ', memo: '  ' })
		expect(result.money).toEqual({ amountMinor: 0, currency: 'EUR' })
		expect(result.memo).toBeUndefined()
		expect(result.description).toBeUndefined()
	})

	it('parses TZS transaction amounts using two minor-unit digits', () => {
		const schema = transactionFormSchema(() => ({
			...options(),
			accounts: [{ ...account, currency: 'TZS' }]
		}))
		expect(schema.parse({ ...fields, amount: '65000.00' }).money).toEqual({
			amountMinor: 6500000,
			currency: 'TZS'
		})
		expect(schema.safeParse({ ...fields, amount: '65000.001' }).success).toBe(false)
	})

	it.each(['2026-02-29', '2026-13-01', '10/13/2026', ''])(
		'rejects invalid booked date %j',
		(bookedOn) => {
			expect(
				transactionFormSchema(() => options()).safeParse({ ...fields, bookedOn }).success
			).toBe(false)
		}
	)

	it('accepts a leap-day calendar date', () => {
		expect(
			transactionFormSchema(() => options()).parse({ ...fields, bookedOn: '2028-02-29' }).bookedOn
		).toBe('2028-02-29')
	})

	it.each(['cash', 'transfer', 'electronic'])(
		'creates %s income without a Check reference',
		(paymentMethod) => {
			const result = transactionFormSchema(() => options('income')).parse({
				...fields,
				paymentMethod,
				checkNumber: '',
				checkDate: 'invalid'
			})
			expect(result).toMatchObject({ kind: 'income', paymentMethod })
			expect(result).toHaveProperty('checkId', null)
		}
	)

	it('leaves income payment method unspecified when omitted', () => {
		expect(transactionFormSchema(() => options('income')).parse(fields)).toMatchObject({
			kind: 'income',
			paymentMethod: null,
			checkId: null
		})
	})

	it('creates a new Check from inline fields', () => {
		const result = transactionFormSchema(() => options('income')).parse({
			...fields,
			paymentMethod: 'check',
			checkNumber: '  123  ',
			checkDate: '2026-10-12'
		})
		expect(result).toMatchObject({
			kind: 'income',
			paymentMethod: 'check',
			check: { kind: 'new', values: { checkNumber: '123', checkDate: '2026-10-12' } }
		})
	})

	it.each([
		{ checkNumber: '', checkDate: '2026-10-12' },
		{ checkNumber: ' ', checkDate: '2026-10-12' },
		{ checkNumber: '123' },
		{ checkNumber: '123', checkDate: '' },
		{ checkNumber: '123', checkDate: '2026-02-29' }
	])('rejects invalid check details %j', (details) => {
		expect(
			transactionFormSchema(() => options('income')).safeParse({
				...fields,
				paymentMethod: 'check',
				...details
			}).success
		).toBe(false)
	})

	it.each([
		{ name: 'missing account', values: { accounts: [] } },
		{ name: 'missing category', values: { categories: [] } },
		{ name: 'no workspace', values: { organizationId: null } },
		{ name: 'foreign account', values: { accounts: [{ ...account, organizationId: 'other' }] } },
		{
			name: 'foreign category',
			values: { categories: [{ ...category, organizationId: 'other' }] }
		},
		{ name: 'archived account', values: { accounts: [{ ...account, archivedAt: new Date() }] } },
		{
			name: 'archived category',
			values: { categories: [{ ...category, archivedAt: new Date() }] }
		},
		{ name: 'wrong category kind', values: { kind: 'income' } }
	] satisfies { name: string; values: Partial<Options> }[])('rejects $name', ({ values }) => {
		expect(
			transactionFormSchema(() => ({ ...options(), ...values })).safeParse(fields).success
		).toBe(false)
	})

	it('reads current options on every validation', () => {
		let current = options()
		const schema = transactionFormSchema(() => current)
		expect(schema.parse(fields).kind).toBe('expense')
		current = options('income')
		expect(schema.parse(fields).kind).toBe('income')
		current = { ...current, accounts: [] }
		expect(schema.safeParse(fields).success).toBe(false)
	})
})

describe('transaction tag names', () => {
	it('preserves all repeated form values while trimming and deduplicating case-insensitively', () => {
		expect(
			transactionFormSchema(() => options()).parse({
				...fields,
				tags: [' Garden ', 'Work', 'garden']
			}).tags
		).toEqual(['garden', 'Work'])
	})
	it('accepts an empty tag list', () => {
		expect(transactionFormSchema(() => options()).parse({ ...fields, tags: [] }).tags).toEqual([])
	})
	it.each([[' '], [123], 'Garden'])('rejects invalid tag values %j', (tags) => {
		expect(transactionFormSchema(() => options()).safeParse({ ...fields, tags }).success).toBe(
			false
		)
	})
})

describe('imported edit form provenance', () => {
	it.each(['expense', 'income'] satisfies Options['kind'][])(
		'uses the observed %s provenance and preserves missing payment method',
		(kind) => {
			const schema = transactionFormSchema(() => ({
				...options(kind),
				transaction: { source: 'simplefin', externalId: 'original-provider-id' }
			}))
			const result = schema.parse({
				...fields,
				source: 'manual',
				externalId: 'forged',
				tags: ['Garden']
			})
			expect(result).toMatchObject({
				kind,
				source: { source: 'simplefin', externalId: 'original-provider-id' },
				tags: ['Garden'],
				description: 'Groceries',
				memo: 'Market'
			})
			expect(result).toMatchObject({ paymentMethod: null, checkId: null })
		}
	)
	it('rejects imported editing with missing provider identity', () => {
		const schema = transactionFormSchema(() => ({
			...options(),
			transaction: { source: 'simplefin', externalId: null }
		}))
		expect(schema.safeParse(fields).success).toBe(false)
	})
})
