export const ORGANIZATION_ROLE = Object.freeze({
	OWNER: 'owner',
	ADMIN: 'admin',
	MEMBER: 'member',
	VIEWER: 'viewer'
})

export type OrganizationRole = (typeof ORGANIZATION_ROLE)[keyof typeof ORGANIZATION_ROLE]
