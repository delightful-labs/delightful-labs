import { z } from 'zod'

export const workerAuthMessage = z.strictObject({
	key: z.enum([
		'login.atproto_working',
		'login.atproto_failed',
		'login.sign_out_failed',
		'actions.sign_out'
	]),
	variant: z.enum(['info', 'loading', 'error'])
})
export type FinanceAuthMessage = z.infer<typeof workerAuthMessage>
export const workerAuthView = z.strictObject({
	canBegin: z.boolean(),
	busy: z.boolean(),
	confirmationRequired: z.boolean(),
	canRetryNavigation: z.boolean(),
	canSignOut: z.boolean(),
	signOutBusy: z.boolean(),
	message: workerAuthMessage.optional(),
	signOutMessage: workerAuthMessage.optional()
})
