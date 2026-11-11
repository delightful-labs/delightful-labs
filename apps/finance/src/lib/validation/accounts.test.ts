import { describe, expect, it } from 'vitest'
import { accountArchiveSchema, accountFormSchema, appAccountSchema } from './accounts.js'

describe('canonical account schema', () => {
	const input = {
		organizationId: '11111111-1111-4111-8111-111111111111',
		name: '  Checking  ',
		kind: 'bank'
	}
	it('normalizes names and supplies currency and active-state defaults', () => {
		expect(appAccountSchema.parse(input)).toEqual({
			...input,
			name: 'Checking',
			currency: 'USD',
			archivedAt: null
		})
	})
	it('preserves Tanzanian shillings and an archive date', () => {
		const archivedAt = new Date()
		expect(appAccountSchema.parse({ ...input, currency: 'TZS', archivedAt })).toMatchObject({
			currency: 'TZS',
			archivedAt
		})
	})
	it.each([
		{ organizationId: 'invalid' },
		{ name: ' ' },
		{ kind: 'investment' },
		{ currency: 'usd' },
		{ currency: 'EUR' },
		{ currency: 'ZZZ' },
		{ archivedAt: '2026-10-13' }
	])('rejects invalid entity fields %j', (values) => {
		expect(appAccountSchema.safeParse({ ...input, ...values }).success).toBe(false)
	})
})

describe('account archive schema', () => {
	const values = {
		organizationId: '11111111-1111-4111-8111-111111111111',
		accountId: '22222222-2222-4222-8222-222222222222'
	}
	it('accepts valid account/workspace IDs', () => {
		expect(accountArchiveSchema.parse(values)).toEqual(values)
	})
	it.each([
		{ accountId: '' },
		{ accountId: undefined },
		{ organizationId: '' },
		{ organizationId: undefined }
	])('rejects invalid archive IDs %j', (input) => {
		expect(accountArchiveSchema.safeParse({ ...values, ...input }).success).toBe(false)
	})
})

describe('account form schema', () => {
	it.each(['cash', 'bank', 'card'])('trims the name and accepts %s accounts', (kind) => {
		expect(accountFormSchema.parse({ name: '  Checking  ', kind })).toEqual({
			name: 'Checking',
			kind,
			currency: 'USD'
		})
	})
	it.each(['', ' ', '\t\n'])('rejects a blank name %j', (name) => {
		expect(accountFormSchema.safeParse({ name, kind: 'bank' }).success).toBe(false)
	})
	it.each(['', 'investment', null, undefined])('rejects an invalid type %j', (kind) => {
		expect(accountFormSchema.safeParse({ name: 'Checking', kind }).success).toBe(false)
	})
	it('keeps the chosen currency and ignores submitted workspace fields', () => {
		expect(
			accountFormSchema.parse({
				name: 'Checking',
				kind: 'bank',
				organizationId: 'other',
				currency: 'TZS'
			})
		).toEqual({ name: 'Checking', kind: 'bank', currency: 'TZS' })
	})
	it.each(['EUR', 'ZZZ'])('rejects unsupported account currency %s', (currency) => {
		expect(accountFormSchema.safeParse({ name: 'Checking', kind: 'bank', currency }).success).toBe(
			false
		)
	})
})
