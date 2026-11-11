import { z } from 'zod'

export const checkNumberText = z.string().trim().min(1)
export const checkDateText = z.iso.date()

export const appCheckSchema = z.strictObject({
	organizationId: z.uuid(),
	// Authorization scope also applies while the check is detached.
	accountId: z.uuid(),
	checkNumber: checkNumberText,
	checkDate: checkDateText,
	payerName: z.string().optional(),
	bankName: z.string().optional(),
	memoOnCheck: z.string().optional()
})

export const checkFormSchema = appCheckSchema
	.pick({ checkNumber: true, checkDate: true, payerName: true, bankName: true, memoOnCheck: true })
	.strip()
