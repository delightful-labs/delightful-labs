import { schema as s } from 'jazz-tools'
import { app } from './schema.js'

export default s.definePermissions(app, ({ policy, session, allOf }) => {
	policy.creationOperations.allowRead.where({ ownerId: session.user })
	policy.creationOperations.allowInsert.where({ ownerId: session.user })
	policy.creationOperations.allowUpdate.never()
	policy.creationOperations.allowDelete.never()

	policy.workspaces.allowRead.where({ ownerId: session.user })
	policy.workspaces.allowInsert.where((row) =>
		allOf([
			{ ownerId: session.user },
			policy.creationOperations.exists.where({
				id: row.creationOperationId,
				ownerId: session.user,
				workspaceId: row.id
			})
		])
	)
	policy.workspaces.allowUpdate.never()
	policy.workspaces.allowDelete.never()
})
