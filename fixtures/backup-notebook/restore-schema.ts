import { schema as s } from 'jazz-tools'

/** Disposable restore-control lane, outside DLF domain exports. Note/activation writers follow later. */
export const notebookRestoreApp = s.defineApp({
	restoreDestinations: s.table(
		{
			ownerId: s.uuid(),
			operationId: s.string(),
			payloadSha256: s.string(),
			graphSha256: s.string(),
			status: s.enum('incomplete', 'active')
		},
		{ attachments: s.reverse('restoreAttachments', 'destination') }
	),
	restoreAttachments: s.table(
		{
			destinationId: s.uuid(),
			ownerId: s.uuid(),
			operationId: s.string(),
			mediaType: s.string(),
			fileName: s.string(),
			sizeBytes: s.int(),
			sha256: s.string(),
			contents: s.bytes()
		},
		{ destination: s.rel('restoreDestinations', 'destinationId') }
	)
})

export const notebookRestorePermissions = s.definePermissions(
	notebookRestoreApp,
	({ policy, session, allOf }) => {
		policy.restoreDestinations.allowRead.where({ ownerId: session.user.account })
		policy.restoreDestinations.allowInsert.where({
			ownerId: session.user.account,
			status: 'incomplete'
		})
		policy.restoreDestinations.allowUpdate.never()
		policy.restoreDestinations.allowDelete.never()
		policy.restoreAttachments.allowRead.where((row) =>
			allOf([
				{ ownerId: session.user.account },
				policy.restoreDestinations.exists.where({
					id: row.destinationId,
					ownerId: session.user.account,
					operationId: row.operationId
				})
			])
		)
		policy.restoreAttachments.allowInsert.where((row) =>
			allOf([
				{ ownerId: session.user.account },
				policy.restoreDestinations.exists.where({
					id: row.destinationId,
					ownerId: session.user.account,
					operationId: row.operationId,
					status: 'incomplete'
				})
			])
		)
		policy.restoreAttachments.allowUpdate.never()
		policy.restoreAttachments.allowDelete.never()
	}
)

/** Ordinary notebook discovery excludes incomplete destinations; recovery reads use their fixed ID. */
export function activeNotebookDestinations(ownerId: string) {
	return notebookRestoreApp.restoreDestinations.where({ ownerId, status: 'active' })
}
