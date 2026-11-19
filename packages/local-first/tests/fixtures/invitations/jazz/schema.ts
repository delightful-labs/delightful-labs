import { schema as s } from 'jazz-tools'
export const schema = s.defineSchema({
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
