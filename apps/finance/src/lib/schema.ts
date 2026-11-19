import { schema as s } from 'jazz-tools'

import { accountsSchema } from './schema/accounts.js'
import { attachmentsSchema } from './schema/attachments.js'
import { batchesSchema } from './schema/batches.js'
import { categoriesSchema } from './schema/categories.js'
import { checksSchema } from './schema/checks.js'
import { identitySchema } from './schema/identity.js'
import { integrationsSchema } from './schema/integrations.js'
import { bankSyncLogSchema } from './schema/bank-sync-log.js'
import { tagsSchema } from './schema/tags.js'
import { transactionsSchema } from './schema/transactions.js'

const baseDefinition = {
	...identitySchema,
	...accountsSchema,
	...categoriesSchema,
	...tagsSchema,
	...transactionsSchema,
	...checksSchema,
	...integrationsSchema,
	...bankSyncLogSchema,
	...attachmentsSchema,
	...batchesSchema
}

const restoreDefinition = {
	...baseDefinition,
	organizations: s.table(
		{ ...identitySchema.organizations.columns, restoreOperationId: s.uuid().optional() },
		{
			...identitySchema.organizations.relations,
			restoreOperation: s.rel('restoreOperations', 'restoreOperationId')
		}
	),
	restoreOperations: s.table(
		{
			workspaceId: s.uuid(),
			sourceFileId: s.uuid(),
			ownerId: s.uuid(),
			status: s.enum('incomplete', 'active'),
			payloadSha256: s.string(),
			graphSha256: s.string(),
			workspaceName: s.string(),
			workspaceKind: s.enum('personal', 'business'),
			workspaceCurrency: s.string()
		},
		{ workspace: s.rel('organizations', 'workspaceId'), sourceFile: s.rel('files', 'sourceFileId') }
	)
}
export const schema = s.defineSchema(restoreDefinition)
