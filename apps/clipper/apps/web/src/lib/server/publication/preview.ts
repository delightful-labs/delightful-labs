import { ReadTier } from 'jazz-tools'
import type { Db } from 'jazz-tools'
import { createAsyncLogic, setup, types } from 'xstate'
import { app } from '../../backend/jazz/schema.js'
import { annotationNoteRowSchema } from '../../annotations/schema.js'
import { toMarginDocumentNote } from '../../annotations/margin.js'
import { publicationSourceSchema } from '../../annotations/publication-link.js'
import { publicationFromRow } from '../../annotations/publication.js'
import type { PublicationSource } from '../../annotations/publication-link.js'
import { publicationPreviewSchema } from '../../annotations/publication-preview.js'
import type { PublicationPreview } from '../../annotations/publication-preview.js'

type Binding = {
	libraryId: string
	accountId: string
	publishingDid: string
	isCurrent: () => boolean
}
type Input = { source: PublicationSource; createdAt: Date; binding: Binding }
type Context = Input & { preview: PublicationPreview | undefined }

/** Backend-only read capability, not an authenticated request endpoint. The host
 * supplies its verified binding and owns one chart per preview request. Existing
 * public addresses require reconciliation, so this supports first previews only. */
export function createDocumentNotePreview(db: Pick<Db, 'one'>) {
	async function readNote(noteId: string, scope: Binding, signal: AbortSignal) {
		const row = await db.one(
			app.notes.where({ id: noteId, libraryId: scope.libraryId }).include({
				document: true,
				library: app.libraries.where({ id: scope.libraryId, ownerId: scope.accountId }).include({
					publications: app.publications.where({ highlightId: null, noteId })
				})
			}),
			{ tier: ReadTier.Remote }
		)
		signal.throwIfAborted()
		if (!row) return undefined
		return {
			note: annotationNoteRowSchema.parse(row),
			ownerId: row.library?.ownerId,
			document: row.document
				? { libraryId: row.document.libraryId, status: row.document.status }
				: undefined,
			publications: (row.library?.publications ?? []).map(publicationFromRow)
		}
	}
	type Facts = Awaited<ReturnType<typeof readNote>>
	function project(facts: Facts, context: Context) {
		if (!facts) return undefined
		const scope = context.binding
		try {
			return publicationPreviewSchema.parse({
				libraryId: scope.libraryId,
				source: context.source,
				publishingDid: scope.publishingDid,
				record: toMarginDocumentNote(facts.note, context.createdAt)
			})
		} catch {
			return undefined
		}
	}
	const actors = {
		read: createAsyncLogic({
			run: ({
				input,
				signal
			}: {
				input: { noteId: string; binding: Binding }
				signal: AbortSignal
			}) => readNote(input.noteId, input.binding, signal)
		})
	}
	const model = setup({
		schemas: {
			input: types<Input>(),
			context: types<Context>(),
			output: types<PublicationPreview | undefined>(),
			events: { CANCEL: types() },
			children: { read: types<import('xstate').ActorRefFrom<typeof actors.read>>() }
		},
		actors,
		states: {
			admitting: {},
			reading: { schemas: { input: types<{ noteId: string }>() } },
			ready: {},
			unavailable: {}
		},
		guards: {
			validScope: ({ context }: { context: Context }) =>
				context.binding.isCurrent() &&
				publicationPreviewSchema.shape.libraryId.safeParse(context.binding.libraryId).success &&
				publicationPreviewSchema.shape.libraryId.safeParse(context.binding.accountId).success &&
				publicationPreviewSchema.shape.publishingDid.safeParse(context.binding.publishingDid)
					.success,
			eligible: ({ context }: { context: Context }, facts: Facts) =>
				context.binding.isCurrent() &&
				facts !== undefined &&
				facts.ownerId === context.binding.accountId &&
				facts.note.libraryId === context.binding.libraryId &&
				facts.note.highlightId === null &&
				facts.note.documentId !== null &&
				facts.document?.libraryId === context.binding.libraryId &&
				facts.document.status !== 'trashed' &&
				!facts.publications.some(
					(publication) =>
						publication.publishingDid === context.binding.publishingDid &&
						(publication.state === 'issued' || publication.state === 'published')
				)
		}
	})
	return model.createMachine({
		id: 'document-note-publication-preview',
		initial: 'admitting',
		context: ({ input }) => ({
			binding: { ...input.binding },
			source: { ...input.source },
			createdAt: new Date(input.createdAt),
			preview: undefined
		}),
		output: ({ context }) => context.preview,
		on: { CANCEL: { target: '.unavailable', context: { preview: undefined } } },
		states: {
			admitting: {
				type: 'choice',
				choice: (args) => {
					const source = publicationSourceSchema.safeParse(args.context.source)
					return args.guards.validScope(args) &&
						source.success &&
						'noteId' in source.data &&
						Number.isFinite(args.context.createdAt.getTime())
						? { target: 'reading', input: { noteId: source.data.noteId } }
						: { target: 'unavailable' }
				}
			},
			reading: {
				invoke: {
					id: 'read',
					src: 'read',
					input: ({ input, context }) => ({ ...input, binding: context.binding }),
					timeout: 30_000,
					onTimeout: { target: 'unavailable' },
					onError: { target: 'unavailable' },
					onDone: (args) => {
						if (!args.guards.eligible(args, args.event.output)) return { target: 'unavailable' }
						const preview = project(args.event.output, args.context)
						return preview ? { target: 'ready', context: { preview } } : { target: 'unavailable' }
					}
				}
			},
			ready: { type: 'final' },
			unavailable: { type: 'final' }
		}
	})
}
