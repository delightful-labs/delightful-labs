import { ReadTier } from 'jazz-tools'
import type { Db } from 'jazz-tools'
import { z } from 'zod'
import { app } from './jazz.generated.js'
import { createAnnotationDomain } from '../../annotations/domain.js'
import { createDomainTransaction } from '../../machines/storage/domain-transaction.js'
import { transactionLifecycle, transactionReceipt } from './transaction.js'
import {
	annotationNoteRowSchema,
	highlightRowSchema,
	nativeRangeSchema,
	quoteSchema,
	normalizeReaderText,
	normalizedOffset,
	textFingerprint,
	READER_TEXT_VERSION
} from '../../annotations/schema.js'
import type {
	AnnotationMutation,
	PreparedAnnotation,
	AnnotationRows
} from '../../annotations/schema.js'
import type { AnnotationFacts } from '../../annotations/domain.js'

export function createAnnotationRecords(
	db: Pick<Db, 'one' | 'all' | 'beginTransaction' | 'subscribe' | 'textAnchors'>,
	libraryId: string,
	isCurrent: () => boolean
) {
	const stage = createDomainTransaction<PreparedAnnotation>(
		(spawn, input) =>
			spawn(
				createAnnotationDomain({
					read: async (resource, draft) => {
						const command = draft.command
						const highlightId =
							command.type === 'ADD_NOTE'
								? command.highlightId
								: command.type === 'DELETE_HIGHLIGHT' || command.type === 'RESTORE_HIGHLIGHT'
									? command.id
									: draft.id
						const noteId =
							command.type === 'EDIT_NOTE' || command.type === 'DELETE_NOTE' ? command.id : draft.id
						const [documentResult, highlightResult, noteResult, existingResult, attachmentResult] =
							await Promise.allSettled([
								resource.tx.one(app.libraryDocuments.where({ id: command.documentId, libraryId }), {
									tier: ReadTier.LocalFirst
								}),
								resource.tx.one(
									app.highlights
										.includeDeleted()
										.where({ id: highlightId ?? draft.id, libraryId })
										.select('*', '$deletedAt'),
									{ tier: ReadTier.LocalFirst }
								),
								resource.tx.one(app.notes.where({ id: noteId, libraryId }), {
									tier: ReadTier.LocalFirst
								}),
								resource.tx.all(
									app.notes
										.where({
											libraryId,
											documentId: command.documentId,
											highlightId:
												command.type === 'ADD_NOTE' ? (command.highlightId ?? null) : null
										})
										.limit(2),
									{ tier: ReadTier.LocalFirst }
								),
								resource.tx.one(
									app.libraryDocuments
										.where({ id: command.documentId, libraryId })
										.hopTo('attachment')
										.select('source'),
									{ tier: ReadTier.LocalFirst }
								)
							])
						if (documentResult.status === 'rejected') throw documentResult.reason
						if (highlightResult.status === 'rejected') throw highlightResult.reason
						if (noteResult.status === 'rejected') throw noteResult.reason
						if (existingResult.status === 'rejected') throw existingResult.reason
						if (attachmentResult.status === 'rejected') throw attachmentResult.reason
						const document = documentResult.value,
							highlight = highlightResult.value,
							note = noteResult.value,
							existing = existingResult.value
						return {
							draft,
							documentAvailable: !!document && document.status !== 'trashed',
							documentReadable: !!document?.attachmentId,
							highlightAvailable:
								!!highlight && !highlight.$deletedAt && highlight.documentId === command.documentId,
							highlightDeleted:
								!!highlight?.$deletedAt && highlight.documentId === command.documentId,
							noteAvailable: !!note,
							noteDocumentId: note?.documentId,
							existingNote: existing.length > 0,
							source:
								attachmentResult.value?.source?.resolvedUrl ?? document?.sourceUrl ?? undefined,
							highlight: highlight
								? {
										libraryId: highlight.libraryId,
										documentId: highlight.documentId,
										source: highlight.source
									}
								: undefined
						} satisfies AnnotationFacts
					},
					createHighlight: (resource, { draft, source }) => {
						if (!source || !draft.range || !draft.textHash)
							throw new Error('Missing prepared highlight')
						resource.tx.insert(
							app.highlights,
							{ libraryId, documentId: draft.command.documentId, source },
							{ id: draft.id }
						)
						resource.tx.insert(
							app.highlightAnchors,
							{
								highlightId: draft.id,
								kind: 'reader',
								normalizationVersion: READER_TEXT_VERSION,
								textHash: draft.textHash,
								range: {
									before: draft.range.before,
									matched: draft.range.matched,
									after: draft.range.after,
									...(draft.range.version === undefined ? {} : { version: draft.range.version }),
									...(draft.range.start === undefined ? {} : { start: draft.range.start }),
									...(draft.range.end === undefined ? {} : { end: draft.range.end })
								},
								sourceDate: null,
								textLengthCodePoints: null,
								sourceCodePointPosition: null
							},
							{ id: draft.anchorId }
						)
					},
					createNote: (resource, { draft, source }) => {
						if (draft.command.type !== 'ADD_NOTE' || !source)
							throw new Error('Invalid note creation')
						resource.tx.insert(
							app.notes,
							{
								libraryId,
								documentId: draft.command.documentId,
								source: draft.command.highlightId ? null : source,
								highlightId: draft.command.highlightId ?? null,
								text: ''
							},
							{ id: draft.id }
						)
					},
					editNote: (resource, { draft }) => {
						if (draft.command.type !== 'EDIT_NOTE') throw new Error('Invalid note edit')
						resource.tx.update(
							app.notes,
							draft.command.id,
							{ text: draft.command.text },
							{ editedFrom: { text: draft.command.editedFrom } }
						)
					},
					deleteHighlight: (resource, { draft }) => {
						if (draft.command.type !== 'DELETE_HIGHLIGHT')
							throw new Error('Invalid highlight deletion')
						resource.tx.delete(app.highlights, draft.command.id)
					},
					restoreHighlight: (resource, { draft, highlight }) => {
						if (draft.command.type !== 'RESTORE_HIGHLIGHT' || !highlight)
							throw new Error('Invalid highlight restoration')
						resource.tx.restore(app.highlights, draft.command.id, highlight)
					},
					deleteNote: (resource, { draft }) => {
						if (draft.command.type !== 'DELETE_NOTE') throw new Error('Invalid note deletion')
						resource.tx.delete(app.notes, draft.command.id)
					},
					receipt: transactionReceipt
				}),
				{ input }
			),
		transactionLifecycle(db, isCurrent)
	)
	return {
		libraryId,
		isCurrent,
		stage,
		recoveryTargets: async (documentId: string) => {
			const results = await Promise.allSettled([
				db.all(app.notes.where({ libraryId, documentId, highlightId: null }).limit(20), {
					tier: ReadTier.LocalFirst
				}),
				db.all(
					app.highlights.where({ libraryId, documentId }).limit(100).include({ notes: true }),
					{ tier: ReadTier.LocalFirst }
				)
			])
			const direct = results[0],
				attached = results[1]
			if (direct.status === 'rejected') throw direct.reason
			if (attached.status === 'rejected') throw attached.reason
			return [...direct.value, ...attached.value.flatMap((highlight) => highlight.notes)].map(
				(note) => ({ id: note.id, text: note.text })
			)
		},
		prepare: async (command: AnnotationMutation): Promise<PreparedAnnotation> => {
			const draft: PreparedAnnotation = {
				command,
				id: crypto.randomUUID(),
				anchorId: crypto.randomUUID()
			}
			if (command.type !== 'HIGHLIGHT') return draft
			if (command.end <= command.start || command.end > command.text.length)
				throw new Error('Invalid selection')
			const text = normalizeReaderText(command.text)
			const start = normalizedOffset(command.text, command.start),
				end = normalizedOffset(command.text, command.end)
			const range = nativeRangeSchema.parse(db.textAnchors().captureRange(text, start, end))
			quoteSchema.parse(range.matched)
			return { ...draft, range, textHash: await textFingerprint(text) }
		},
		resolve: (range: z.infer<typeof nativeRangeSchema>, text: string) =>
			db.textAnchors().resolveRange(
				{
					before: range.before,
					matched: range.matched,
					after: range.after,
					...(range.start !== undefined ? { start: range.start } : {}),
					...(range.end !== undefined ? { end: range.end } : {}),
					...(range.version !== undefined ? { version: range.version } : {})
				},
				text
			),
		observe: (
			documentId: string,
			next: (rows: Partial<AnnotationRows>) => void,
			error: () => void
		) => {
			const highlights = db.subscribe(
				app.highlights
					.where({ libraryId, documentId })
					.limit(100)
					.include({ anchors: true, notes: true }),
				{
					onUpdate: (rows) => {
						const result = z.array(highlightRowSchema).safeParse(rows)
						if (!result.success) {
							error()
							return
						}
						next({ highlights: result.data })
					},
					onError: error
				},
				{ tier: ReadTier.LocalFirst }
			)
			let notes: () => void
			try {
				notes = db.subscribe(
					app.notes.where({ libraryId, documentId, highlightId: null }).limit(20),
					{
						onUpdate: (rows) => {
							const result = z.array(annotationNoteRowSchema).safeParse(rows)
							if (!result.success) {
								error()
								return
							}
							next({ notes: result.data })
						},
						onError: error
					},
					{ tier: ReadTier.LocalFirst }
				)
			} catch (error) {
				highlights()
				throw error
			}
			return () => {
				highlights()
				notes()
			}
		}
	}
}
export type AnnotationCapability = ReturnType<typeof createAnnotationRecords> & {
	recovery?: {
		store: import('../../notes/drafts.js').NoteDraftStore
		libraryId: string
		writerId: string
	}
}
