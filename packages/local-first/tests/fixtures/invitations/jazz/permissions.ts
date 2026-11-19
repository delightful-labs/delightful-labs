import { schema } from './schema.js'
const { definePermissions, exists, session, allOf } = schema
export const permissions = definePermissions({
	notebooks: {
		read: (notebook) =>
			exists.notebookMembers({
				notebookId: notebook.id,
				accountId: session.user
			}),
		insert: true,
		update: false,
		delete: false
	},
	notebookMembers: {
		read: { accountId: session.user },
		insert: (member) =>
			allOf(
				{ accountId: session.user, invitationId: null, role: 'collaborator' },
				exists.notebooks({
					id: member.notebookId,
					'$createdBy.account': session.user
				})
			),
		update: false,
		delete: { accountId: session.user }
	},
	notebookInvitations: { read: false, insert: false, update: false, delete: false },
	notebookRedemptions: { read: false, insert: false, update: false, delete: false }
})
