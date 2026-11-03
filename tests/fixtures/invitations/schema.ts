import { schema as s } from 'jazz-tools'

/** Disposable host schema, deliberately outside the library's packaged/public API. */
export const invitationApp = s.defineApp({
	notebooks: s.table({ name: s.string() }, { members: s.reverse('notebookMembers', 'notebook') }),
	notebookMembers: s.table(
		{
			notebookId: s.uuid(),
			accountId: s.uuid(),
			role: s.enum('collaborator'),
			invitationId: s.uuid().optional()
		},
		{ notebook: s.rel('notebooks', 'notebookId') }
	),
	notebookInvitations: s.table(
		{
			notebookId: s.uuid(),
			codeDigest: s.string(),
			role: s.enum('collaborator'),
			expiresAt: s.float().optional(),
			revoked: s.boolean(),
			consumedAccountId: s.uuid().optional(),
			consumedOperationId: s.string().optional(),
			consumedMembershipId: s.uuid().optional()
		},
		{ notebook: s.rel('notebooks', 'notebookId') }
	),
	notebookRedemptions: s.table(
		{
			operationId: s.string(),
			invitationId: s.uuid(),
			notebookId: s.uuid(),
			accountId: s.uuid(),
			membershipId: s.uuid(),
			acceptedAt: s.float()
		},
		{
			notebook: s.rel('notebooks', 'notebookId'),
			invitation: s.rel('notebookInvitations', 'invitationId')
		}
	)
})

export const invitationPermissions = s.definePermissions(
	invitationApp,
	({ policy, session, allOf }) => {
		policy.notebooks.allowRead.where((notebook) =>
			policy.notebookMembers.exists.where({
				notebookId: notebook.id,
				accountId: session.user.account
			})
		)
		policy.notebooks.allowInsert.always()
		policy.notebooks.allowUpdate.never()
		policy.notebooks.allowDelete.never()

		policy.notebookMembers.allowRead.where({ accountId: session.user.account })
		// Only the notebook's creator may bootstrap their own fixed-role membership.
		// Redemption for anyone else is exclusively a backend-authorized write.
		policy.notebookMembers.allowInsert.where((member) =>
			allOf([
				{ accountId: session.user.account, invitationId: null, role: 'collaborator' },
				policy.notebooks.exists.where({
					id: member.notebookId,
					'$createdBy.account': session.user.account
				})
			])
		)
		policy.notebookMembers.allowUpdate.never()
		policy.notebookMembers.allowDelete.where({ accountId: session.user.account })

		policy.notebookInvitations.allowRead.never()
		policy.notebookInvitations.allowInsert.never()
		policy.notebookInvitations.allowUpdate.never()
		policy.notebookInvitations.allowDelete.never()
		policy.notebookRedemptions.allowRead.never()
		policy.notebookRedemptions.allowInsert.never()
		policy.notebookRedemptions.allowUpdate.never()
		policy.notebookRedemptions.allowDelete.never()
	}
)
