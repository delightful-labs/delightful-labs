import { z } from 'zod'
import { ORGANIZATION_ROLE } from '../domain/organization-role.js'
import { ACCOUNT_ACCESS } from '../domain/account-access.js'
import { persistedAccountSchema } from '../validation/accounts.js'
import { accountArchiveFeedback } from './account-archive-feedback.js'

export const workerWorkspaceMember = z.strictObject({
	id: z.uuid(),
	organizationId: z.uuid(),
	userId: z.uuid(),
	profileId: z.uuid().nullable().default(null),
	role: z.enum(ORGANIZATION_ROLE),
	accountAccessMode: z.enum(ACCOUNT_ACCESS)
})
export const workerAccountGrant = z.strictObject({
	id: z.uuid(),
	organizationId: z.uuid(),
	accountId: z.uuid(),
	userId: z.uuid(),
	access: z.enum(['read', 'write']),
	canDelete: z.boolean()
})
export const workerAccountArchiveView = z.strictObject({
	kind: z.enum([
		'sessionUnavailable',
		'selectWorkspace',
		'loading',
		'loadFailed',
		'ready',
		'closed'
	]),
	rows: z.array(
		z.strictObject({
			account: persistedAccountSchema,
			action: z.enum(['available', 'archiving', 'disabled', 'unavailable'])
		})
	),
	feedback: accountArchiveFeedback.nullable()
})
export const workerAccountAccessView = z.strictObject({
	busy: z.boolean(),
	canManage: z.boolean(),
	loading: z.boolean(),
	failed: z.boolean(),
	members: z.array(workerWorkspaceMember),
	grants: z.array(workerAccountGrant),
	result: z
		.strictObject({
			outcome: z.enum(['succeeded', 'denied', 'failed']),
			request: z.strictObject({ accountId: z.uuid() }).optional()
		})
		.optional()
})
export type WorkerAccountAccessView = z.output<typeof workerAccountAccessView>
export type WorkerAccountArchiveView = z.output<typeof workerAccountArchiveView>
