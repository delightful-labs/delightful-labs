import { schema as s } from 'jazz-tools'

export const integrationsSchema = {
	simplefinConnections: s.table(
		{
			organizationId: s.uuid(),
			// Preserve the legacy column shape; new writes contain only an empty sentinel.
			accessUrl: s.string(),
			ownerId: s.uuid().optional(),
			credentialVersion: s.int().optional(),
			credentialId: s.string().optional(),
			prfSalt: s.string().optional(),
			iv: s.string().optional(),
			ciphertext: s.string().optional(),
			lastOutcome: s.enum('succeeded', 'partial', 'failed').optional(),
			importedCount: s.int().optional(),
			existingCount: s.int().optional(),
			omittedCount: s.int().optional(),
			status: s.enum('active', 'error', 'revoked'),
			lastSyncAt: s.timestamp().optional(),
			lastError: s.string().optional(),
			claimedAt: s.timestamp()
		},
		{ organization: s.rel('organizations', 'organizationId') }
	),
	simplefinAccountLinks: s.table(
		{
			organizationId: s.uuid(),
			accountId: s.uuid(),
			connectionId: s.uuid().optional(),
			simplefinAccountId: s.string(),
			simplefinOrgId: s.string().optional(),
			availableBalance: s.string().optional(),
			balanceDate: s.timestamp().optional()
		},
		{
			organization: s.rel('organizations', 'organizationId'),
			account: s.rel('accounts', 'accountId'),
			connection: s.rel('simplefinConnections', 'connectionId')
		}
	)
}
