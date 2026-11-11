import { describe, expect, it } from 'vitest'
import { appCheckSchema, checkFormSchema } from './checks.js'
import { transactionPaymentSchema } from './transactions.js'
const organizationId = crypto.randomUUID(),
	accountId = crypto.randomUUID(),
	checkId = crypto.randomUUID()

describe('independent check validation', () => {
	it('keeps check metadata independent of transaction direction and identity', () => {
		expect(
			appCheckSchema.parse({
				organizationId,
				accountId,
				checkNumber: ' 100 ',
				checkDate: '2026-10-23'
			})
		).toEqual({ organizationId, accountId, checkNumber: '100', checkDate: '2026-10-23' })
		expect(
			checkFormSchema.parse({
				checkNumber: '100',
				checkDate: '2026-10-23',
				organizationId,
				transactionId: 'forged'
			})
		).toEqual({ checkNumber: '100', checkDate: '2026-10-23' })
	})
	it.each([
		{ checkNumber: ' ' },
		{ checkDate: '2026-02-30' },
		{ accountId: 'bad' },
		{ organizationId: 'bad' }
	])('rejects invalid check %j', (patch) => {
		expect(
			appCheckSchema.safeParse({
				organizationId,
				accountId,
				checkNumber: '100',
				checkDate: '2026-10-23',
				...patch
			}).success
		).toBe(false)
	})
	it('normalizes optional method and reference without inventing cash', () => {
		expect(transactionPaymentSchema.parse({})).toEqual({ paymentMethod: null, checkId: null })
		expect(transactionPaymentSchema.parse({ paymentMethod: 'check', checkId })).toEqual({
			paymentMethod: 'check',
			checkId
		})
	})
	it.each(['cash', 'transfer', 'electronic'])('accepts %s without a check', (paymentMethod) => {
		expect(transactionPaymentSchema.parse({ paymentMethod })).toEqual({
			paymentMethod,
			checkId: null
		})
	})
	it.each([
		{ paymentMethod: 'check' },
		{ paymentMethod: 'check', checkId: null },
		{ checkId },
		{ paymentMethod: 'cash', checkId }
	])('rejects incompatible payment/reference %j', (values) => {
		expect(transactionPaymentSchema.safeParse(values).success).toBe(false)
	})
})
