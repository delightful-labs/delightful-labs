import { ReadTier } from 'jazz-tools'
import type { Db } from 'jazz-tools'
import { app } from './schema.js'
import { publicationFromRow } from '../../annotations/publication.js'
import type { Publication } from '../../annotations/publication.js'

/** Report native observations independently. Related-record queries hide deleted
 * rows; a direct includeDeleted query supplies actual deletion evidence. The
 * owning chart joins these facts and the backend rechecks authority acceptance. */
export function createPublicationCleanupRecords(
	db: Pick<Db, 'subscribe'>,
	libraryId: string,
	isCurrent: () => boolean
) {
	return {
		libraryId,
		isCurrent,
		observe: (
			publications: (values: Publication[]) => void,
			deletions: (ids: string[]) => void,
			error: () => void
		) => {
			const releasePublications = db.subscribe(
				app.publications.where({ libraryId, highlightId: null }),
				{
					onUpdate: (rows) => {
						if (!isCurrent()) return
						try {
							publications(rows.map(publicationFromRow))
						} catch {
							error()
						}
					},
					onError: error
				},
				{ tier: ReadTier.Remote }
			)
			try {
				const releaseNotes = db.subscribe(
					app.notes
						.includeDeleted()
						.where({ libraryId, highlightId: null })
						.select('id', '$deletedAt'),
					{
						onUpdate: (rows) => {
							if (isCurrent())
								deletions(rows.filter((row) => !!row.$deletedAt).map((row) => row.id))
						},
						onError: error
					},
					{ tier: ReadTier.Remote }
				)
				return () => {
					releasePublications()
					releaseNotes()
				}
			} catch (cause) {
				releasePublications()
				throw cause
			}
		}
	}
}
export type PublicationCleanupCapability = ReturnType<typeof createPublicationCleanupRecords>
