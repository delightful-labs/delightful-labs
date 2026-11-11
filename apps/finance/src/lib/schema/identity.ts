import { ACCOUNT_ACCESS } from '#lib/domain/account-access.js'
import { ORGANIZATION_ROLE } from '#lib/domain/organization-role.js'
import { schema as s } from 'jazz-tools'
import { avatarMimeType } from '../validation/identity.js'

const avatarTypes = avatarMimeType.enum

export const identitySchema = {
	profiles: s.table(
		{
			userId: s.uuid(),
			// Initialization provenance only; never active-workspace selection or authority.
			initialWorkspaceId: s.uuid().optional(),
			displayName: s.string().optional(),
			avatarData: s.bytes().optional(),
			avatarMimeType: s
				.enum(avatarTypes['image/png'], avatarTypes['image/jpeg'], avatarTypes['image/webp'])
				.optional()
		},
		{ memberships: s.reverse('organizationMembers', 'profile') }
	),
	organizations: s.table(
		{
			name: s.string(),
			kind: s.enum('personal', 'business'),
			defaultCurrency: s.string(),
			ownerId: s.uuid()
		},
		{
			members: s.reverse('organizationMembers', 'organization'),
			accounts: s.reverse('accounts', 'organization'),
			categories: s.reverse('categories', 'organization'),
			tags: s.reverse('tags', 'organization'),
			transactions: s.reverse('transactions', 'organization'),
			internalTransfers: s.reverse('internalTransfers', 'organization'),
			simplefinConnections: s.reverse('simplefinConnections', 'organization'),
			batches: s.reverse('transactionBatches', 'organization'),
			batchTemplates: s.reverse('batchTemplates', 'organization')
		}
	),
	organizationMembers: s.table(
		{
			organizationId: s.uuid(),
			userId: s.uuid(),
			profileId: s.uuid().optional(),
			role: s.enum(
				ORGANIZATION_ROLE.OWNER,
				ORGANIZATION_ROLE.ADMIN,
				ORGANIZATION_ROLE.MEMBER,
				ORGANIZATION_ROLE.VIEWER
			),
			accountAccessMode: s.enum(ACCOUNT_ACCESS.ALL, ACCOUNT_ACCESS.SELECTED)
		},
		{
			organization: s.rel('organizations', 'organizationId'),
			profile: s.rel('profiles', 'profileId')
		}
	)
}
