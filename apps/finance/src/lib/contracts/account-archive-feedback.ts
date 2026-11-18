import { z } from 'zod'
import type { ArchiveResult } from '../machines/accounts/account-archive-operation.js'

export const accountArchiveFeedback = z.strictObject({
	outcome: z.enum([
		'succeeded',
		'invalid',
		'denied',
		'unavailable',
		'failed',
		'scopeChanged',
		'cancelled',
		'closed'
	]),
	settlement: z.enum(['notStarted', 'locallyPersisted', 'rejected', 'unknown']),
	name: z.string()
})
export type AccountArchiveFeedback = z.infer<typeof accountArchiveFeedback>
export function projectAccountArchiveFeedback(
	result: ArchiveResult | undefined
): AccountArchiveFeedback | null {
	return result
		? { outcome: result.outcome, settlement: result.settlement, name: result.request.name }
		: null
}
