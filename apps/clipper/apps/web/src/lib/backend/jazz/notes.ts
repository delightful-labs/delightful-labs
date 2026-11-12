import type { z } from 'zod'
import { ReadTier } from 'jazz-tools'
import type { Db } from 'jazz-tools'
import { app } from './schema.js'
import { transactionLifecycle, transactionReceipt } from './transaction.js'
import type { TransactionResource } from './transaction.js'
import {
	noteCreateSchema,
	noteSchema,
	noteHistorySchema,
	noteRevisionSchema,
	storedNoteHistorySchema,
	storedNoteRevisionSchema,
	sameNoteRevision,
	projectNote
} from '../../notes/schema.js'
import type { Note, NoteCreate, NoteRevision } from '../../notes/schema.js'
import { matchesNoteOperation } from '../../notes/eligibility.js'
import { createDomainTransaction } from '../../machines/storage/domain-transaction.js'
import {
	createNoteCreationMachine,
	createNoteRevisionMachine
} from '../../notes/domain-machines.js'

function noteObserver<T>(schema: z.ZodType<T>, next: (rows: T) => void, error: () => void) {
	return {
		onUpdate: (rows: unknown) => {
			const parsed = schema.safeParse(rows)
			if (!parsed.success) {
				error()
				return
			}
			next(parsed.data)
		},
		onError: error
	}
}
/** Entity creation and revision writes each have one DLF transaction
 * owner. IDs are supplied by the caller's operation owner and never derived from
 * an article, account-provider identifier or external protocol address. */
export function createNoteRecords(
	db: Pick<Db, 'one' | 'all' | 'beginTransaction' | 'subscribe'>,
	libraryId: string,
	isCurrent: () => boolean
) {
	const lifecycle = transactionLifecycle(db, isCurrent)
	const readAssociation = async (resource: TransactionResource, targetId: string) => {
		const tx = resource.tx
		const library = await tx.one(app.libraries.where({ id: libraryId }), {
			tier: ReadTier.LocalFirst
		})
		const document = await tx.one(app.libraryDocuments.where({ id: targetId, libraryId }), {
			tier: ReadTier.LocalFirst
		})
		const notes = noteHistorySchema.parse(
			await tx.all(app.notes.where({ libraryId }), { tier: ReadTier.LocalFirst })
		)
		return { library, document, documentId: targetId, notes }
	}
	function validateCreate(input: unknown, operationId: string) {
		const request = noteCreateSchema.parse(input)
		if (!matchesNoteOperation(request, libraryId, operationId))
			throw new Error('Invalid note scope')
		return request
	}
	function validateRevision(input: unknown, operationId: string) {
		const revision = noteRevisionSchema.parse(input)
		if (!matchesNoteOperation(revision, libraryId, operationId))
			throw new Error('Invalid note scope')
		return revision
	}
	function insertRevision(resource: TransactionResource, { id, ...revision }: NoteRevision) {
		resource.tx.insert(
			app.noteRevisions,
			{ ...revision, parents: JSON.stringify(revision.parents) },
			{ id }
		)
	}
	function insertDocument(resource: TransactionResource, request: NoteCreate) {
		resource.tx.insert(app.notes, { libraryId, documentId: request.documentId }, { id: request.id })
	}
	async function readCreation(
		resource: TransactionResource,
		input: NoteCreate,
		operationId: string
	) {
		const request = validateCreate(input, operationId)
		return { ...(await readAssociation(resource, request.documentId)), request }
	}
	async function readRevisionFacts(
		resource: TransactionResource,
		input: NoteRevision,
		operationId: string
	) {
		const revision = validateRevision(input, operationId)
		const row = await resource.tx.one(app.notes.where({ id: revision.noteId, libraryId }), {
			tier: ReadTier.LocalFirst
		})
		const history = storedNoteHistorySchema.parse(
			await resource.tx.all(app.noteRevisions.where({ libraryId }), { tier: ReadTier.LocalFirst })
		)
		return { note: row ? noteSchema.parse(row) : null, history, revision }
	}
	const create = createDomainTransaction<NoteCreate>(
		(spawn, input) =>
			spawn(
				createNoteCreationMachine({
					read: readCreation,
					insertDocument,
					receipt: transactionReceipt
				}),
				{ input }
			),
		lifecycle
	)
	const stage = createDomainTransaction<NoteRevision>(
		(spawn, input) =>
			spawn(
				createNoteRevisionMachine({
					read: readRevisionFacts,
					insertRevision,
					receipt: transactionReceipt
				}),
				{ input }
			),
		lifecycle
	)
	const read = async (noteId: string) => {
		const row = await db.one(app.notes.where({ id: noteId, libraryId }), {
			tier: ReadTier.LocalFirst
		})
		return row ? noteSchema.parse(row) : null
	}
	return {
		create,
		stage,
		isCurrent,
		libraryId,
		read,
		forDocument: async (documentId: string) =>
			noteHistorySchema.parse(
				await db.all(app.notes.where({ libraryId, documentId }), { tier: ReadTier.LocalFirst })
			),
		content: async (noteId: string) =>
			projectNote(
				{ libraryId, noteId },
				storedNoteHistorySchema.parse(
					await db.all(app.noteRevisions.where({ noteId, libraryId }), {
						tier: ReadTier.LocalFirst
					})
				)
			),
		readRevision: async (revision: NoteRevision) => {
			const row = await db.one(app.noteRevisions.where({ id: revision.id, libraryId }), {
				tier: ReadTier.LocalFirst
			})
			if (!row) return null
			const parsed = storedNoteRevisionSchema.parse(row)
			if (!sameNoteRevision(parsed, revision)) throw new Error('Invalid note operation')
			return parsed
		},
		subscribe: (next: (rows: NoteRevision[]) => void, error: () => void) =>
			db.subscribe(
				app.noteRevisions.where({ libraryId }),
				noteObserver(storedNoteHistorySchema, next, error),
				{ tier: ReadTier.LocalFirst }
			),
		subscribeNotes: (next: (rows: Note[]) => void, error: () => void) =>
			db.subscribe(app.notes.where({ libraryId }), noteObserver(noteHistorySchema, next, error), {
				tier: ReadTier.LocalFirst
			})
	}
}
