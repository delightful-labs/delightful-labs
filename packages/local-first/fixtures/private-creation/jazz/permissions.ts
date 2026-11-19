import { schema } from './schema.js'
const { definePermissions, exists, session, allOf } = schema
export const permissions = definePermissions({
	creationOperations: {
		read: { ownerId: session.user },
		insert: { ownerId: session.user },
		update: false,
		delete: false
	},
	workspaces: {
		read: { ownerId: session.user },
		insert: (row) =>
			allOf(
				{ ownerId: session.user },
				exists.creationOperations({
					id: row.creationOperationId,
					ownerId: session.user,
					workspaceId: row.id
				})
			),
		update: false,
		delete: false
	}
})
