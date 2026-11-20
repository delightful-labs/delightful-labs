// Native Better Auth/AT Protocol tables, preserving the qualified consumer storage shape.
import { schema as s } from 'jazz-tools'

export const tables = {
	better_auth_user: s.table(
		{
			name: s.string(),
			email: s.string(),
			emailVerified: s.boolean(),
			image: s.string().optional(),
			createdAt: s.allowExternalProvenanceName(s.timestamp()),
			updatedAt: s.allowExternalProvenanceName(s.timestamp()),
			atprotoDid: s.string().optional(),
			atprotoHandle: s.string().optional()
		},
		{}
	),

	better_auth_session: s.table(
		{
			expiresAt: s.timestamp(),
			token: s.string(),
			createdAt: s.allowExternalProvenanceName(s.timestamp()),
			updatedAt: s.allowExternalProvenanceName(s.timestamp()),
			ipAddress: s.string().optional(),
			userAgent: s.string().optional(),
			userId: s.uuid()
		},
		{
			userIdRelation: s.rel('better_auth_user', 'userId')
		}
	),

	better_auth_account: s.table(
		{
			accountId: s.string(),
			providerId: s.string(),
			userId: s.uuid(),
			accessToken: s.string().optional(),
			refreshToken: s.string().optional(),
			idToken: s.string().optional(),
			accessTokenExpiresAt: s.timestamp().optional(),
			refreshTokenExpiresAt: s.timestamp().optional(),
			scope: s.string().optional(),
			password: s.string().optional(),
			createdAt: s.allowExternalProvenanceName(s.timestamp()),
			updatedAt: s.allowExternalProvenanceName(s.timestamp())
		},
		{
			userIdRelation: s.rel('better_auth_user', 'userId')
		}
	),

	better_auth_verification: s.table(
		{
			identifier: s.string(),
			value: s.string(),
			expiresAt: s.timestamp(),
			createdAt: s.allowExternalProvenanceName(s.timestamp()),
			updatedAt: s.allowExternalProvenanceName(s.timestamp())
		},
		{}
	),

	better_auth_atprotoSession: s.table(
		{
			did: s.string(),
			sessionData: s.string(),
			userId: s.uuid().optional(),
			handle: s.string(),
			pdsUrl: s.string(),
			updatedAt: s.allowExternalProvenanceName(s.timestamp())
		},
		{
			userIdRelation: s.rel('better_auth_user', 'userId')
		}
	),

	better_auth_atprotoState: s.table(
		{
			stateKey: s.string(),
			stateData: s.string(),
			expiresAt: s.timestamp()
		},
		{}
	)
}

/** Native backend auth tables never participate in client CRUD permissions. */
const denied: { read: false; insert: false; update: false; delete: false } = {
	read: false,
	insert: false,
	update: false,
	delete: false
}
export const authPermissions = {
	better_auth_user: denied,
	better_auth_session: denied,
	better_auth_account: denied,
	better_auth_verification: denied,
	better_auth_atprotoSession: denied,
	better_auth_atprotoState: denied
}
