import { schema as s } from 'jazz-tools'
export const schema = s.defineSchema({
	workspaces: s.table(
		{ ownerId: s.uuid(), creationOperationId: s.uuid() },
		{ operation: s.rel('creationOperations', 'creationOperationId') }
	),
	creationOperations: s.table(
		{ ownerId: s.uuid(), workspaceId: s.uuid(), requestFingerprint: s.string() },
		{}
	)
})
