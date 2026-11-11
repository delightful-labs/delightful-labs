import { schema as s } from 'jazz-tools'

// Isolated qualification schema; never exported as a consumer workspace model.
export const app = s.defineApp(
	{
		workspaces: s.table(
			{ ownerId: s.uuid(), creationOperationId: s.uuid() },
			{ operation: s.rel('creationOperations', 'creationOperationId') }
		),
		creationOperations: s.table(
			{ ownerId: s.uuid(), workspaceId: s.uuid(), requestFingerprint: s.string() },
			{}
		)
	},
	{ migrations: 'none' }
)
