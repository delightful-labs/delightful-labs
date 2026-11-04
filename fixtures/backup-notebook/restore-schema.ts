import { schema as s } from 'jazz-tools'

/** Disposable restore-control lane, outside DLF domain exports. Data/activation writers follow later. */
export const notebookRestoreApp = s.defineApp({
	restoreDestinations: s.table(
		{
			ownerId: s.uuid(),
			operationId: s.string(),
			payloadSha256: s.string(),
			graphSha256: s.string(),
			status: s.enum('incomplete', 'active')
		},
		{}
	)
})

export const notebookRestorePermissions = s.definePermissions(
	notebookRestoreApp,
	({ policy, session }) => {
		policy.restoreDestinations.allowRead.where({ ownerId: session.user.account })
		policy.restoreDestinations.allowInsert.where({
			ownerId: session.user.account,
			status: 'incomplete'
		})
		policy.restoreDestinations.allowUpdate.never()
		policy.restoreDestinations.allowDelete.never()
	}
)

/** Ordinary notebook discovery excludes incomplete destinations; recovery reads use their fixed ID. */
export function activeNotebookDestinations(ownerId: string) {
	return notebookRestoreApp.restoreDestinations.where({ ownerId, status: 'active' })
}
