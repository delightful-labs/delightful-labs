import { app } from '../schema.js'

export function organizationMembershipQuery(
	organizationId: string | null | undefined,
	userId: string | null | undefined
) {
	return organizationId && userId
		? app.organizationMembers.where({ organizationId, userId })
		: undefined
}
