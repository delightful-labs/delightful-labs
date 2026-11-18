import { isDeepStrictEqual } from 'node:util'
import type { MarginRecord } from '../../annotations/margin.js'
import { highlightRowSchema, READER_TEXT_VERSION } from '../../annotations/schema.js'
import { ReadTier } from 'jazz-tools'
import type { Db, Transaction } from 'jazz-tools'
import { createAsyncLogic, setup, types } from 'xstate'
import { createDomainTransaction } from '../../machines/storage/domain-transaction.js'
import type { TransactionDomainInput } from '../../machines/storage/domain-transaction.js'
import { retainDetachedTransaction } from '../../backend/jazz/transaction.js'
import type { SyncReceipt } from '../../contracts/storage.js'
import { app } from '../../backend/jazz/schema.js'
import { publicationSourceSchema } from '../../annotations/publication-link.js'
import type { PublicationSource } from '../../annotations/publication-link.js'
import {
	publicationFromRow,
	publicationSchema,
	publicationValues
} from '../../annotations/publication.js'
import type { Publication } from '../../annotations/publication.js'
import { annotationNoteRowSchema } from '../../annotations/schema.js'
import { toMarginDocumentNote } from '../../annotations/margin.js'

type Write = ReturnType<Transaction<'serializable'>['commit']>
type Resource = {
	tx: Transaction<'serializable'>
	commit: () => Write
	global: () => Promise<void>
}
type Input = TransactionDomainInput<Publication, Resource>
type Facts = {
	publication: Publication
	current: { id: string; value: Publication } | undefined
	owned: boolean
	parentAvailable: boolean
	occupied: boolean
	contentMatches: boolean
	authorized: boolean
}
type Context = Input & { facts: Facts | undefined; verifiedHighlight: MarginRecord | undefined }

function permitsTransition({ current, publication }: Facts) {
	if (!current) return publication.state === 'private' || publication.state === 'requested'
	const previous = current.value
	if (previous.state === 'private') return publication.state === 'requested'
	if (previous.state === 'requested')
		return publication.state === 'private' || publication.state === 'issued'
	if (!('uri' in publication) || previous.uri !== publication.uri) return false
	if (previous.state === 'unpublished') return publication.state === 'issued'
	if (previous.state === 'unpublishing') return publication.state === 'unpublished'
	return (
		publication.state === 'unpublishing' ||
		(previous.state === 'issued' && publication.state === 'published')
	)
}

function matchesAcceptedNote(publication: Publication, note: unknown) {
	if (publication.state !== 'issued') return true
	try {
		const record = toMarginDocumentNote(
			annotationNoteRowSchema.parse(note),
			new Date(publication.record.createdAt)
		)
		// Validate the owned content without rewriting the caller's valid timestamp
		// spelling. The exact original record is what the issued row retains.
		return (
			JSON.stringify({ ...record, createdAt: publication.record.createdAt }) ===
			JSON.stringify(publication.record)
		)
	} catch {
		return false
	}
}

function matchesAcceptedHighlight(
	publication: Publication,
	highlight: unknown,
	verified: MarginRecord | undefined
) {
	if (publication.state !== 'issued') return true
	const parsed = highlightRowSchema.safeParse(highlight)
	if (!parsed.success || !verified || !isDeepStrictEqual(publication.record, verified)) return false
	const value = parsed.data,
		record = publication.record
	const anchors = value.anchors.filter(
		(anchor) => anchor.kind === 'reader' && anchor.normalizationVersion === READER_TEXT_VERSION
	)
	const anchor = anchors[0],
		note = value.notes[0]
	if (
		anchors.length !== 1 ||
		!anchor ||
		value.notes.length > 1 ||
		record.target.source !== value.source ||
		record.target.selector?.exact !== anchor.range.matched
	)
		return false
	if (!note) return record.motivation === 'highlighting'
	return (
		note.libraryId === value.libraryId &&
		note.highlightId === value.id &&
		note.documentId === value.documentId &&
		note.source === null &&
		record.motivation === 'commenting' &&
		record.body.value === note.text
	)
}

/** Backend-only persistence capability, not consent, grant admission or a PDS
 * executor. Its verified host owns Publish admission and must confirm the remote
 * write before supplying published. Never dispatch until this chart succeeds. */
export function createPublicationStore(
	db: Pick<Db, 'one' | 'beginSerializableTransaction'>,
	binding: {
		libraryId: string
		accountId: string
		publishingDid: string
		isCurrent: () => boolean
	},
	authorize: (tx: Transaction<'serializable'>) => Promise<boolean> = () => Promise.resolve(true),
	verifiedHighlight: MarginRecord | undefined = undefined
) {
	const scope = { ...binding }
	const actors = {
		read: createAsyncLogic({
			run: async ({ input }: { input: Context }): Promise<Facts> => {
				const publication = publicationSchema.parse(input.attempt.draft)
				const values = publicationValues(publication)
				const tx = input.resource.tx
				const [library, highlight, note, sourceRows, publisherRows, existingId, authorized] =
					await Promise.all([
						tx.one(app.libraries.where({ id: scope.libraryId, ownerId: scope.accountId }), {
							tier: ReadTier.Remote
						}),
						values.highlightId
							? tx.one(
									app.highlights
										.where({ id: values.highlightId, libraryId: scope.libraryId })
										.include({ document: true, anchors: true, notes: true }),
									{ tier: ReadTier.Remote }
								)
							: Promise.resolve(null),
						values.noteId
							? tx.one(
									app.notes
										.where({ id: values.noteId, libraryId: scope.libraryId })
										.include({ document: true }),
									{ tier: ReadTier.Remote }
								)
							: Promise.resolve(null),
						tx.all(
							app.publications.where({
								libraryId: scope.libraryId,
								publishingDid: scope.publishingDid,
								highlightId: values.highlightId,
								noteId: values.noteId
							}),
							{ tier: ReadTier.Remote }
						),
						tx.all(app.publications.where({ publishingDid: scope.publishingDid }), {
							tier: ReadTier.Remote
						}),
						tx.one(app.publications.where({ id: input.attempt.operationId }), {
							tier: ReadTier.Remote
						}),
						authorize(tx)
					])
				const document = values.highlightId ? highlight?.document : note?.document
				const row = sourceRows[0]
				const current = row ? { id: row.id, value: publicationFromRow(row) } : undefined
				return {
					publication,
					authorized,
					current,
					owned:
						!!library &&
						publication.libraryId === scope.libraryId &&
						publication.publishingDid === scope.publishingDid,
					parentAvailable:
						!!document &&
						document.libraryId === scope.libraryId &&
						document.status !== 'trashed' &&
						(values.highlightId ? !!highlight : !!note && note.highlightId === null),
					occupied:
						sourceRows.length > 1 ||
						(!!existingId && existingId.id !== current?.id) ||
						publisherRows.some((other) => {
							const value = publicationFromRow(other)
							return (
								other.id !== current?.id &&
								'uri' in value &&
								'uri' in publication &&
								value.uri === publication.uri
							)
						}),
					contentMatches: values.highlightId
						? matchesAcceptedHighlight(publication, highlight, input.verifiedHighlight)
						: matchesAcceptedNote(publication, note)
				}
			}
		})
	}
	const model = setup({
		schemas: {
			input: types<Input>(),
			context: types<Context>(),
			output: types<SyncReceipt>(),
			events: { STAGE: types() },
			internalEvents: { STAGED: types() },
			children: { read: types<import('xstate').ActorRefFrom<typeof actors.read>>() }
		},
		actors,
		states: {
			reading: {},
			ready: { schemas: { context: types<{ facts: Facts }>() } },
			inserting: { schemas: { context: types<{ facts: Facts }>() } },
			updating: { schemas: { context: types<{ facts: Facts }>(), input: types<{ id: string }>() } },
			blocked: {},
			done: {}
		},
		guards: {
			eligible: (_, { facts }: { facts: Facts }) =>
				scope.isCurrent() &&
				facts.authorized &&
				facts.owned &&
				!facts.occupied &&
				permitsTransition(facts) &&
				(facts.parentAvailable ||
					(facts.current !== undefined &&
						(facts.publication.state === 'private' ||
							facts.publication.state === 'published' ||
							facts.publication.state === 'unpublishing' ||
							facts.publication.state === 'unpublished'))) &&
				facts.contentMatches
		}
	})
	const domain = model.createMachine({
		id: 'publication-domain',
		initial: 'reading',
		context: ({ input }) => ({ ...input, facts: undefined, verifiedHighlight }),
		output: ({ context }) => ({ global: context.resource.global }),
		states: {
			reading: {
				invoke: {
					src: 'read',
					input: ({ context }) => context,
					onDone: (args) =>
						args.guards.eligible(args, { facts: args.event.output })
							? { target: 'ready', context: { facts: args.event.output } }
							: { target: 'blocked' },
					onError: { target: 'blocked' }
				}
			},
			ready: {
				entry: ({ context }, enq) =>
					enq.sendTo(context.owner, {
						type: 'PREPARED',
						assessment: { outcome: 'eligible' }
					}),
				on: {
					STAGE: ({ context }) =>
						context.facts.current
							? { target: 'updating', input: { id: context.facts.current.id } }
							: { target: 'inserting' }
				}
			},
			inserting: {
				entry: ({ context, self }, enq) => {
					enq(() =>
						context.resource.tx.insert(
							app.publications,
							publicationValues(context.facts.publication),
							{ id: context.attempt.operationId }
						)
					)
					enq.sendTo(self, { type: 'STAGED' })
				},
				on: { STAGED: { target: 'done' } }
			},
			updating: {
				entry: ({ context, input, self }, enq) => {
					enq(() =>
						context.resource.tx.update(app.publications, input.id, {
							lifecycle: publicationValues(context.facts.publication).lifecycle
						})
					)
					enq.sendTo(self, { type: 'STAGED' })
				},
				on: { STAGED: { target: 'done' } }
			},
			blocked: {
				entry: ({ context }, enq) =>
					enq.sendTo(context.owner, {
						type: 'PREPARED',
						assessment: { outcome: 'blocked', reason: 'Publication unavailable' }
					})
			},
			done: { type: 'final' }
		}
	})
	function assertCurrent() {
		if (!scope.isCurrent()) throw new Error('Publication scope expired')
	}
	async function entries(source: PublicationSource) {
		assertCurrent()
		const parsed = publicationSourceSchema.parse(source)
		const library = await db.one(
			app.libraries.where({ id: scope.libraryId, ownerId: scope.accountId }).include({
				publications: app.publications.where({
					highlightId: 'highlightId' in parsed ? parsed.highlightId : null,
					noteId: 'noteId' in parsed ? parsed.noteId : null
				})
			}),
			{ tier: ReadTier.Remote }
		)
		assertCurrent()
		return (library?.publications ?? []).map((row) => ({
			id: row.id,
			value: publicationFromRow(row)
		}))
	}
	return {
		stage: createDomainTransaction<Publication, Resource, Write>(
			(spawn, input) => spawn(domain, { input }),
			{
				retainDetached: retainDetachedTransaction<Resource, Write>,
				open: () => {
					assertCurrent()
					const tx = db.beginSerializableTransaction()
					let write: Write | undefined
					return {
						tx,
						commit: () => {
							write = tx.commit()
							return write
						},
						global: () => {
							if (!write) throw new Error('Missing publication receipt')
							return write.wait()
						}
					}
				},
				commit: (resource) => {
					assertCurrent()
					return resource.commit()
				},
				persistLocal: (write) => write.wait(),
				rollback: (resource) => resource.tx.rollback()
			}
		),
		entries,
		list: async (source: PublicationSource) => (await entries(source)).map((row) => row.value)
	}
}
