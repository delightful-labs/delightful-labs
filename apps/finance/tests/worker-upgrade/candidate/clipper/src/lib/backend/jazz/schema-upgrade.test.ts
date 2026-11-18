import { expect, it } from 'vitest'
import { createJazz, sqlite } from 'jazz-tools/backend'
import { app } from './jazz.generated.js'
import permissions from './jazz.permissions.json' with { type: 'json' }
import retained from '../../../../retained-baseline.json' with { type: 'json' }
import { createLibraryRecords } from './records.js'
import {
	encodeResumeObservations,
	resumeObservationsSchema,
	resumePositionSchema
} from '../../reader/schema.js'
import type { ReaderDocumentState } from '../../reader/schema.js'

it('retains actual alpha.60 reading sets and domain dates through alpha.66 writes and reopen', async () => {
	const open = () =>
		createJazz({
			app,
			permissions,
			store: sqlite({ path: retained.directory }),
			authenticate: async () => null
		})
	const later = resumePositionSchema.parse({
		...retained.later,
		interactedAt: new Date(retained.later.interactedAt)
	})
	const first = open()
	try {
		await first.ready()
		expect(first.appId).toBe(retained.appId)
		const rows = Promise.withResolvers<ReaderDocumentState[]>()
		const release = createLibraryRecords(
			first.db,
			retained.libraryId,
			() => true
		).reader.capability.subscribeDocuments(
			(values) => {
				if (values.some((value) => value.id === retained.documentId)) rows.resolve(values)
			},
			() => rows.reject(new Error('Reading observation failed'))
		)
		try {
			expect(await rows.promise).toContainEqual({
				id: retained.documentId,
				readingProgress: 0.8,
				resumePosition: later
			})
		} finally {
			release()
		}
		await first.db
			.update(app.libraryDocuments, retained.documentId, {
				readingProgress: 0.9,
				resumePosition: encodeResumeObservations({
					...later,
					offset: 10,
					interactedAt: new Date('2026-11-13T12:00:00Z')
				})
			})
			.wait({ tier: 'global' })
	} finally {
		await first.close()
	}
	const reopened = open()
	try {
		await reopened.ready()
		const row = await reopened.db.one(app.libraryDocuments.where({ id: retained.documentId }))
		expect(row?.readingProgress).toBe(0.9)
		expect(resumeObservationsSchema.parse(row?.resumePosition)).toMatchObject({
			offset: 10,
			interactedAt: new Date('2026-11-13T12:00:00Z')
		})
	} finally {
		await reopened.close()
	}
})
