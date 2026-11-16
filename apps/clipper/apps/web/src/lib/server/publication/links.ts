import { ReadTier } from 'jazz-tools'
import type { Db, Transaction } from 'jazz-tools'
import { createAsyncLogic, setup, types } from 'xstate'
import { createDomainTransaction } from '../../machines/storage/domain-transaction.js'
import type { TransactionDomainInput } from '../../machines/storage/domain-transaction.js'
import { retainDetachedTransaction } from '../../backend/jazz/transaction.js'
import type { SyncReceipt } from '../../contracts/storage.js'
import { app } from '../../backend/jazz/schema.js'
import {
	publicationDid,
	publicationLinkFromRow,
	publicationLinkSchema,
	publicationLinkValues,
	publicationSourceSchema
} from '../../annotations/publication-link.js'
import type { PublicationLink, PublicationSource } from '../../annotations/publication-link.js'

type Write = ReturnType<Transaction<'serializable'>['commit']>
type Resource = {
	tx: Transaction<'serializable'>
	commit: () => Write
	global: () => Promise<void>
}
type Input = TransactionDomainInput<PublicationLink, Resource>
type Facts = { link: PublicationLink; owned: boolean; parentAvailable: boolean; occupied: boolean }
type Context = Input & { facts: Facts | undefined }

/** Backend-only capability. The future publication owner must supply its verified
 * Jazz account/library and provider DID; this is not an HTTP admission endpoint.
 * A link reserves an address association, not proof that a PDS write succeeded. */
export function createPublicationLinkStore(
	db: Pick<Db, 'one' | 'beginSerializableTransaction'>,
	binding: { libraryId: string; accountId: string; publishingDid: string; isCurrent: () => boolean }
) {
	const scope = { ...binding }
	const actors = {
		read: createAsyncLogic({
			run: async ({ input }: { input: Input }): Promise<Facts> => {
				const link = publicationLinkSchema.parse(input.attempt.draft)
				const values = publicationLinkValues(link)
				const tx = input.resource.tx
				const [library, highlight, note, sourceLinks, addressLinks, existingId] = await Promise.all(
					[
						tx.one(app.libraries.where({ id: scope.libraryId, ownerId: scope.accountId }), {
							tier: ReadTier.Remote
						}),
						values.highlightId
							? tx.one(
									app.highlights
										.where({ id: values.highlightId, libraryId: scope.libraryId })
										.include({ document: true }),
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
							app.publicationLinks.where({
								libraryId: scope.libraryId,
								highlightId: values.highlightId,
								noteId: values.noteId
							}),
							{ tier: ReadTier.Remote }
						),
						tx.all(app.publicationLinks.where({ uri: link.uri }).limit(1), {
							tier: ReadTier.Remote
						}),
						tx.one(app.publicationLinks.where({ id: input.attempt.operationId }), {
							tier: ReadTier.Remote
						})
					]
				)
				const document = values.highlightId ? highlight?.document : note?.document
				return {
					link,
					owned:
						!!library &&
						link.libraryId === scope.libraryId &&
						publicationDid(link.uri) === scope.publishingDid,
					parentAvailable:
						!!document &&
						document.libraryId === scope.libraryId &&
						document.status !== 'trashed' &&
						(values.highlightId
							? !!highlight
							: !!note && note.highlightId === null && note.documentId !== null),
					occupied:
						!!existingId ||
						addressLinks.length > 0 ||
						sourceLinks.some(
							(row) => publicationDid(publicationLinkFromRow(row).uri) === scope.publishingDid
						)
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
			staging: { schemas: { context: types<{ facts: Facts }>() } },
			blocked: {},
			done: {}
		},
		guards: {
			eligible: (_, { facts }: { facts: Facts }) =>
				scope.isCurrent() && facts.owned && facts.parentAvailable && !facts.occupied
		}
	})
	const domain = model.createMachine({
		id: 'publication-link-domain',
		initial: 'reading',
		context: ({ input }) => ({ ...input, facts: undefined }),
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
				on: { STAGE: { target: 'staging' } }
			},
			staging: {
				entry: ({ context, self }, enq) => {
					enq(() =>
						context.resource.tx.insert(
							app.publicationLinks,
							publicationLinkValues(context.facts.link),
							{ id: context.attempt.operationId }
						)
					)
					enq.sendTo(self, { type: 'STAGED' })
				},
				on: { STAGED: { target: 'done' } }
			},
			blocked: {
				entry: ({ context }, enq) =>
					enq.sendTo(context.owner, {
						type: 'PREPARED',
						assessment: { outcome: 'blocked', reason: 'Publication link unavailable' }
					})
			},
			done: { type: 'final' }
		}
	})
	function assertCurrent() {
		if (!scope.isCurrent()) throw new Error('Publication scope expired')
	}
	return {
		stage: createDomainTransaction<PublicationLink, Resource, Write>(
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
							if (!write) throw new Error('Missing publication link receipt')
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
		list: async (source: PublicationSource) => {
			assertCurrent()
			const parsed = publicationSourceSchema.parse(source)
			const library = await db.one(
				app.libraries.where({ id: scope.libraryId, ownerId: scope.accountId }).include({
					publicationLinks: app.publicationLinks.where({
						highlightId: 'highlightId' in parsed ? parsed.highlightId : null,
						noteId: 'noteId' in parsed ? parsed.noteId : null
					})
				}),
				{ tier: ReadTier.Remote }
			)
			assertCurrent()
			return (library?.publicationLinks ?? []).map(publicationLinkFromRow)
		}
	}
}
