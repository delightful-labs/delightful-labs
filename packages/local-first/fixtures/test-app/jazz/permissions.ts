import { schema } from './schema.js'
const { definePermissions, exists, session, allOf, anyOf } = schema
export const permissions = definePermissions({
	restoreDestinations: {
		read: { ownerId: session.user },
		insert: {
			ownerId: session.user,
			status: 'incomplete'
		},
		updateIf: { ownerId: session.user, status: 'incomplete' },
		updateTo: (row) =>
			allOf(
				{ ownerId: session.user, status: 'active' },
				exists.restoreDestinations({
					id: row.id,
					ownerId: row.ownerId,
					operationId: row.operationId,
					payloadSha256: row.payloadSha256,
					graphSha256: row.graphSha256,
					status: 'incomplete'
				})
			),
		delete: false
	},
	restoreNotes: {
		read: (row) =>
			allOf(
				{ ownerId: session.user },
				exists.restoreDestinations({
					id: row.destinationId,
					ownerId: session.user,
					operationId: row.operationId
				})
			),
		insert: (row) =>
			allOf(
				{ ownerId: session.user },
				exists.restoreDestinations({
					id: row.destinationId,
					ownerId: session.user,
					operationId: row.operationId,
					status: 'incomplete'
				}),
				exists.restoreNotebooks({
					id: row.notebookId,
					destinationId: row.destinationId,
					ownerId: session.user,
					operationId: row.operationId
				}),
				anyOf(
					{ attachmentId: null },
					exists.restoreAttachments({
						id: row.attachmentId,
						destinationId: row.destinationId,
						ownerId: session.user,
						operationId: row.operationId
					})
				)
			),
		update: false,
		delete: false
	},
	restoreNotebooks: {
		read: (row) =>
			allOf(
				{ ownerId: session.user },
				exists.restoreDestinations({
					id: row.destinationId,
					ownerId: session.user,
					operationId: row.operationId
				})
			),
		insert: (row) =>
			allOf(
				{ ownerId: session.user },
				exists.restoreDestinations({
					id: row.destinationId,
					ownerId: session.user,
					operationId: row.operationId,
					status: 'incomplete'
				})
			),
		update: false,
		delete: false
	},
	restoreAttachments: {
		read: (row) =>
			allOf(
				{ ownerId: session.user },
				exists.restoreDestinations({
					id: row.destinationId,
					ownerId: session.user,
					operationId: row.operationId
				})
			),
		insert: (row) =>
			allOf(
				{ ownerId: session.user },
				exists.restoreDestinations({
					id: row.destinationId,
					ownerId: session.user,
					operationId: row.operationId,
					status: 'incomplete'
				})
			),
		update: false,
		delete: false
	}
})
