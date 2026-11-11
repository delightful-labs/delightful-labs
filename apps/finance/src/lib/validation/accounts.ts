import { ACCOUNT_KIND } from '#lib/domain/account-kind.js'
import { ACCOUNT_CURRENCY } from '#lib/domain/account-currency.js'
import { z } from 'zod'

export const accountCurrencySchema = z.enum(ACCOUNT_CURRENCY)
export type AccountCurrency = z.output<typeof accountCurrencySchema>

export const appAccountSchema = z.strictObject({
	organizationId: z.uuid(),
	name: z.string().trim().min(1),
	kind: z.enum([ACCOUNT_KIND.CASH, ACCOUNT_KIND.BANK, ACCOUNT_KIND.CARD]),
	currency: accountCurrencySchema.default('USD'),
	archivedAt: z.date().nullable().default(null)
})

export const accountFormSchema = appAccountSchema
	.pick({ name: true, kind: true, currency: true })
	.strip()

export type AccountFormValues = z.output<typeof accountFormSchema>

export const accountArchiveSchema = appAccountSchema
	.pick({ organizationId: true })
	.extend({ accountId: z.uuid() })
