import { z } from 'zod'
import { ReadTier } from 'jazz-tools'
import { app } from '../../backend/jazz/schema.js'
import type { Jazz } from 'jazz-tools/backend'
import { createActor, createAsyncLogic, matchesState, setup, toPromise, types } from 'xstate'
import type { ActorRefFrom } from 'xstate'
import { createOwnedOperation } from 'delightful-local-first/lifecycle/operation/workflow'
import type {
	DomainTransactionResult,
	TransactionAttempt
} from 'delightful-local-first/transactions/contracts'
import type { SyncReceipt } from '../../contracts/storage.js'
import { publicationBaseSchema, publicationFromRow } from '../../annotations/publication.js'
import type { Publication } from '../../annotations/publication.js'
import type { PublicationPreview } from '../../annotations/publication-preview.js'
import { authorizePublicationTransaction, createPublicationAccess } from './access.js'
import type { PublicationAccess, PublicationAuth } from './access.js'
import { createDocumentNotePreview } from './preview.js'
import { createPublicationStore } from './store.js'
import { hasRestorer, permitsPublication } from './permission.js'
import { allocatePublicationAddress } from './address.js'
import { toFirstPublicationWrite } from './first-write.js'
import { pdsRead } from './pds-read.js'
import type { PdsReadSession } from './pds-read.js'
import { matchesIssuedContent } from './compare.js'
import {
	isJsonRequest,
	isPublicationPost,
	publicationFailure,
	publicationHeaders,
	readPublicationInput
} from './http.js'

type Selection = z.infer<typeof publicationBaseSchema>
type Input = { request: Request; origin: string }
type Session = PdsReadSession & { getTokenInfo: () => Promise<unknown> }
type Selected = { selection: Selection; access: PublicationAccess }
type Removing = Extract<Publication, { state: 'unpublishing' }>
type Mode = 'publish' | 'unpublish' | 'cleanup'
type Issued = Extract<Publication, { state: 'issued' }>
type Context = Input & {
	selection: Selection | undefined
	access: PublicationAccess | undefined
	publication: Publication | undefined
	publicationId: string | undefined
	preview: PublicationPreview | undefined
	issued: Issued | undefined
	removalAccepted: boolean | undefined
	session: Session | undefined
}
type StageInput = { attempt: TransactionAttempt<Publication> }
type StageResult = DomainTransactionResult<Publication, SyncReceipt>
function hasSession(value: unknown): value is { session: Session } {
	return (
		typeof value === 'object' &&
		value !== null &&
		'session' in value &&
		typeof value.session === 'object' &&
		value.session !== null &&
		'did' in value.session &&
		typeof value.session.did === 'string' &&
		'handle' in value.session &&
		typeof value.session.handle === 'function' &&
		'getTokenInfo' in value.session &&
		typeof value.session.getTokenInfo === 'function'
	)
}
function binding(input: Input & Selected) {
	return {
		libraryId: input.selection.libraryId,
		accountId: input.access.accountId,
		publishingDid: input.access.did,
		isCurrent: () => !input.request.signal.aborted
	}
}

/** Document-note publication/removal owner. Jazz owns accepted intent and the immutable
 * issued address/payload. Only this request's newly accepted issuance may PUT;
 * resumed issued work only reads back. No automatic replay, update or overwrite. */
export function createPublicationPublish(
	auth: PublicationAuth,
	backend: Pick<Jazz, 'accountFor' | 'db'>,
	mode: Mode = 'publish'
) {
	const actors = {
		input: createAsyncLogic({
			run: ({ input, signal }: { input: Request; signal: AbortSignal }) =>
				readPublicationInput(input, signal, publicationBaseSchema, 4096)
		}),
		access: createPublicationAccess(auth, backend),
		current: createAsyncLogic({
			run: ({ input }: { input: Input & Selected }) =>
				createPublicationStore(backend.db, binding(input)).entries(input.selection.source)
		}),
		history: createAsyncLogic({
			run: async ({ input }: { input: Selected & { uri: string; publicationId: string } }) => {
				const source = input.selection.source
				const rows = await backend.db.all(
					app.$history.publications
						.where({
							id: input.publicationId,
							libraryId: input.selection.libraryId,
							publishingDid: input.access.did,
							highlightId: null,
							noteId: 'noteId' in source ? source.noteId : null
						})
						.orderBy('$acceptedAt', 'desc'),
					{ tier: ReadTier.Remote }
				)
				const matches = rows
					.map(publicationFromRow)
					.filter((value): value is Issued => value.state === 'issued' && value.uri === input.uri)
				return matches[0]
			}
		}),
		deleted: createAsyncLogic({
			run: async ({ input }: { input: Selection }) => {
				if (!('noteId' in input.source)) return false
				const row = await backend.db.one(
					app.notes
						.includeDeleted()
						.where({ id: input.source.noteId, libraryId: input.libraryId })
						.select('*', '$deletedAt'),
					{ tier: ReadTier.Remote }
				)
				return !!row?.$deletedAt
			}
		}),
		remove: createAsyncLogic({
			run: async ({
				input,
				signal
			}: {
				input: { publication: Removing; session: Session }
				signal: AbortSignal
			}) => {
				const publication = input.publication
				signal.throwIfAborted()
				const response = await input.session.handle('/xrpc/com.atproto.repo.deleteRecord', {
					method: 'POST',
					signal,
					redirect: 'error',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						repo: publication.publishingDid,
						collection: 'at.margin.note',
						rkey: publication.uri.split('/')[4],
						swapRecord: publication.cid
					})
				})
				void response.body?.cancel().catch(() => {})
				signal.throwIfAborted()
				return { status: response.status, redirected: response.redirected }
			}
		}),
		preview: createDocumentNotePreview(backend.db),
		restore: createAsyncLogic({
			run: ({ input }: { input: string }) => {
				if (!hasRestorer(auth.api)) throw new Error('Publication provider unavailable')
				return auth.api.getAtprotoClient({ body: { did: input } })
			}
		}),
		grant: createAsyncLogic({
			run: async ({ input, signal }: { input: Session; signal: AbortSignal }) => {
				const token = await input.getTokenInfo()
				signal.throwIfAborted()
				return permitsPublication(token, input.did, Date.now())
			}
		}),
		address: allocatePublicationAddress,
		id: createAsyncLogic({ run: async () => crypto.randomUUID() }),
		save: createOwnedOperation<StageInput, StageResult, { type: 'CANCEL' | 'SHUTDOWN' }>(),
		write: createAsyncLogic({
			run: async ({
				input,
				signal
			}: {
				input: { publication: Issued; session: Session }
				signal: AbortSignal
			}) => {
				signal.throwIfAborted()
				const response = await input.session.handle('/xrpc/com.atproto.repo.putRecord', {
					method: 'POST',
					signal,
					redirect: 'error',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(toFirstPublicationWrite(input.publication))
				})
				// Readback is the success proof, including when the PUT response is lost.
				void response.body?.cancel().catch(() => {})
				signal.throwIfAborted()
			}
		}),
		read: pdsRead
	}
	return setup({
		schemas: {
			input: types<Input>(),
			context: types<Context>(),
			output: types<Response>(),
			events: { DISCONNECT: types() },
			children: {
				input: types<ActorRefFrom<typeof actors.input>>(),
				access: types<ActorRefFrom<typeof actors.access>>(),
				current: types<ActorRefFrom<typeof actors.current>>(),
				history: types<ActorRefFrom<typeof actors.history>>(),
				deleted: types<ActorRefFrom<typeof actors.deleted>>(),
				remove: types<ActorRefFrom<typeof actors.remove>>(),
				preview: types<ActorRefFrom<typeof actors.preview>>(),
				restore: types<ActorRefFrom<typeof actors.restore>>(),
				grant: types<ActorRefFrom<typeof actors.grant>>(),
				address: types<ActorRefFrom<typeof actors.address>>(),
				id: types<ActorRefFrom<typeof actors.id>>(),
				save: types<ActorRefFrom<typeof actors.save>>(),
				write: types<ActorRefFrom<typeof actors.write>>(),
				read: types<ActorRefFrom<typeof actors.read>>()
			}
		},
		actors,
		states: {
			admitting: {},
			readingInput: {},
			readingAccess: { schemas: { context: types<{ selection: Selection }>() } },
			readingCurrent: { schemas: { context: types<Selected>() } },
			checkingDeletion: { schemas: { context: types<Selected & { publication: Publication }>() } },
			readingIssued: {
				schemas: {
					context: types<
						Selected & { publication: Extract<Publication, { uri: string }>; publicationId: string }
					>()
				}
			},
			readingRemovalTarget: {
				schemas: {
					context: types<
						Selected & { publication: Extract<Publication, { uri: string }>; session: Session }
					>()
				}
			},
			removing: {
				schemas: { context: types<Selected & { publication: Removing; session: Session }>() }
			},
			verifyingRemoval: {
				schemas: {
					context: types<
						Selected & { publication: Removing; session: Session; removalAccepted: boolean }
					>()
				}
			},
			previewing: { schemas: { context: types<Selected>() } },
			restoring: { schemas: { context: types<Selected & { publication: Publication }>() } },
			checkingGrant: {
				schemas: { context: types<Selected & { publication: Publication; session: Session }>() }
			},
			choosingWork: {
				schemas: { context: types<Selected & { publication: Publication; session: Session }>() }
			},
			allocating: { schemas: { context: types<Selected & { preview: PublicationPreview }>() } },
			identifyingSave: { schemas: { context: types<Selected & { publication: Publication }>() } },
			saving: {
				schemas: {
					context: types<Selected & { publication: Publication }>(),
					input: types<{ operationId: string }>()
				},
				states: { waiting: {}, draining: {} }
			},
			checkingCleanupDispatch: {
				schemas: { context: types<Selected & { publication: Removing; session: Session }>() }
			},
			checkingDispatchAccess: {
				schemas: {
					context: types<Selected & { publication: Issued | Removing; session: Session }>()
				}
			},
			writing: {
				schemas: { context: types<Selected & { publication: Issued; session: Session }>() }
			},
			readingRemote: {
				schemas: { context: types<Selected & { publication: Issued; session: Session }>() }
			},
			ready: { schemas: { context: types<{ publication: Publication }>() } },
			invalid: {},
			forbidden: {},
			unauthenticated: {},
			needsGrant: {},
			unavailable: {},
			failed: { id: 'publication-publish-failed' },
			disconnected: {}
		}
	}).createMachine({
		id: 'publication-publish',
		initial: 'admitting',
		context: ({ input }) => ({
			...input,
			selection: undefined,
			access: undefined,
			publication: undefined,
			publicationId: undefined,
			preview: undefined,
			issued: undefined,
			removalAccepted: undefined,
			session: undefined
		}),
		timeout: 120_000,
		onTimeout: { target: '.failed' },
		on: { DISCONNECT: { target: '.disconnected' } },
		states: {
			admitting: {
				type: 'choice',
				choice: ({ context }) =>
					context.request.signal.aborted
						? { target: 'disconnected' }
						: !isPublicationPost(context.request, context.origin)
							? { target: 'forbidden' }
							: !isJsonRequest(context.request)
								? { target: 'invalid' }
								: { target: 'readingInput' }
			},
			readingInput: {
				invoke: {
					id: 'input',
					src: 'input',
					input: ({ context }) => context.request,
					onDone: ({ event }) =>
						'noteId' in event.output.source
							? { target: 'readingAccess', context: { selection: event.output } }
							: { target: 'unavailable' },
					onError: { target: 'invalid' }
				}
			},
			readingAccess: {
				invoke: {
					id: 'access',
					src: 'access',
					input: ({ context }) => ({ request: context.request }),
					onDone: ({ context, event }) =>
						event.output.kind === 'allowed'
							? event.output.access.did === context.selection.publishingDid
								? { target: 'readingCurrent', context: { access: event.output.access } }
								: { target: 'unavailable' }
							: event.output.kind === 'failed'
								? { target: 'failed' }
								: { target: 'unauthenticated' },
					onError: { target: 'failed' }
				}
			},
			readingCurrent: {
				invoke: {
					id: 'current',
					src: 'current',
					input: ({ context }) => ({
						...context,
						selection: context.selection,
						access: context.access
					}),
					onDone: ({ context, event }) => {
						const matches = event.output.filter(
							(row) => row.value.publishingDid === context.access.did
						)
						if (matches.length > 1) return { target: 'unavailable' }
						const current = matches[0]
						const publication = current?.value
						if (mode !== 'publish') {
							if (!publication || !('uri' in publication)) return { target: 'unavailable' }
							if (publication.state === 'unpublished')
								return { target: 'ready', context: { publication, publicationId: current?.id } }
							return mode === 'cleanup'
								? {
										target: 'checkingDeletion',
										context: { publication, publicationId: current?.id }
									}
								: { target: 'restoring', context: { publication, publicationId: current?.id } }
						}
						if (publication?.state === 'unpublishing') return { target: 'unavailable' }
						if (publication?.state === 'unpublished' && current)
							return {
								target: 'readingIssued',
								context: { publication, publicationId: current.id }
							}
						return publication?.state === 'published'
							? { target: 'ready', context: { publication, publicationId: current?.id } }
							: publication?.state === 'issued'
								? { target: 'restoring', context: { publication, publicationId: current?.id } }
								: { target: 'previewing', context: { publication, publicationId: current?.id } }
					},
					onError: { target: 'failed' }
				}
			},
			checkingDeletion: {
				invoke: {
					id: 'deleted',
					src: 'deleted',
					input: ({ context }) => context.selection,
					onDone: ({ event }) =>
						event.output ? { target: 'restoring' } : { target: 'unavailable' },
					onError: { target: 'failed' }
				}
			},
			readingIssued: {
				invoke: {
					id: 'history',
					src: 'history',
					input: ({ context }) => ({
						selection: context.selection,
						access: context.access,
						uri: context.publication.uri,
						publicationId: context.publicationId
					}),
					onDone: ({ context, event }) =>
						event.output
							? mode === 'publish'
								? { target: 'previewing', context: { issued: event.output } }
								: context.session
									? {
											target: 'readingRemovalTarget',
											context: { issued: event.output, session: context.session }
										}
									: { target: 'failed' }
							: { target: 'unavailable' },
					onError: { target: 'failed' }
				}
			},

			previewing: {
				invoke: {
					id: 'preview',
					src: 'preview',
					input: ({ context }) => ({
						source: context.selection.source,
						createdAt: new Date(context.issued?.record.createdAt ?? context.access.observedAt),
						republish: context.publication?.state === 'unpublished',
						binding: binding(context)
					}),
					onDone: ({ context, event }) =>
						event.output
							? {
									target: 'restoring',
									context: {
										preview: event.output,
										publication: context.publication ?? { ...context.selection, state: 'private' }
									}
								}
							: { target: 'unavailable' },
					onError: { target: 'failed' }
				}
			},
			restoring: {
				invoke: {
					id: 'restore',
					src: 'restore',
					input: ({ context }) => context.access.did,
					onDone: ({ context, event }) =>
						hasSession(event.output) && event.output.session.did === context.access.did
							? { target: 'checkingGrant', context: { session: event.output.session } }
							: { target: 'needsGrant' },
					onError: { target: 'needsGrant' }
				}
			},
			checkingGrant: {
				invoke: {
					id: 'grant',
					src: 'grant',
					input: ({ context }) => context.session,
					onDone: ({ event }) =>
						event.output ? { target: 'choosingWork' } : { target: 'needsGrant' },
					onError: { target: 'needsGrant' }
				}
			},
			choosingWork: {
				type: 'choice',
				choice: ({ context }) => {
					if (mode !== 'publish')
						return context.publication.state === 'unpublishing'
							? { target: 'readingRemovalTarget', context: { publication: context.publication } }
							: 'uri' in context.publication && context.publicationId
								? {
										target: 'readingIssued',
										context: {
											publication: context.publication,
											publicationId: context.publicationId
										}
									}
								: { target: 'unavailable' }
					if (context.publication.state === 'unpublished' && context.preview)
						return {
							target: 'identifyingSave',
							context: {
								publication: {
									...context.selection,
									state: 'issued',
									uri: context.publication.uri,
									record: context.preview.record
								}
							}
						}
					return context.publication.state === 'issued'
						? { target: 'readingRemote', context: { publication: context.publication } }
						: context.publication.state === 'requested'
							? { target: 'allocating' }
							: {
									target: 'identifyingSave',
									context: { publication: { ...context.selection, state: 'requested' } }
								}
				}
			},
			allocating: {
				invoke: {
					id: 'address',
					src: 'address',
					input: ({ context }) => context.access.did,
					onDone: ({ context, event }) => ({
						target: 'identifyingSave',
						context: {
							publication: {
								...context.selection,
								state: 'issued',
								uri: event.output,
								record: context.preview.record
							}
						}
					}),
					onError: { target: 'failed' }
				}
			},
			identifyingSave: {
				invoke: {
					id: 'id',
					src: 'id',
					onDone: ({ event }) => ({ target: 'saving', input: { operationId: event.output } }),
					onError: { target: 'failed' }
				}
			},
			saving: {
				initial: 'waiting',
				invoke: {
					id: 'save',
					src: 'save',
					input: ({ context, input }) => {
						const scope = binding(context),
							access = context.access
						const logic = createPublicationStore(backend.db, scope, async (tx) => {
							const source = context.selection.source
							const [authorized, note] = await Promise.all([
								authorizePublicationTransaction(tx, access),
								mode === 'cleanup' && 'noteId' in source
									? tx.one(
											app.notes
												.includeDeleted()
												.where({ id: source.noteId, libraryId: scope.libraryId })
												.select('*', '$deletedAt'),
											{ tier: ReadTier.Remote }
										)
									: Promise.resolve(undefined)
							])
							return authorized && (mode !== 'cleanup' || !!note?.$deletedAt)
						}).stage
						return {
							operationId: input.operationId,
							input: {
								attempt: {
									operationId: input.operationId,
									workspaceId: scope.libraryId,
									membershipId: scope.libraryId,
									draft: context.publication
								}
							},
							spawn: (spawn, value) => spawn(logic, { input: value })
						}
					},
					onDone: ({ context, event, value }) => {
						if (matchesState({ saving: 'draining' }, value)) return { target: 'failed' }
						if (context.request.signal.aborted) return { target: 'disconnected' }
						if (event.output.kind !== 'completed' || event.output.output.outcome !== 'succeeded')
							return { target: 'unavailable' }
						if (context.publication.state === 'requested' && context.preview)
							return { target: 'allocating', context: { preview: context.preview } }
						if (
							(context.publication.state === 'issued' ||
								context.publication.state === 'unpublishing') &&
							context.session
						)
							return {
								target: 'checkingDispatchAccess',
								context: { publication: context.publication, session: context.session }
							}
						return context.publication.state === 'published' ||
							context.publication.state === 'unpublished'
							? { target: 'ready' }
							: { target: 'failed' }
					},
					onError: { target: 'failed' }
				},
				on: {
					DISCONNECT: (_args, enq) => {
						enq.sendTo('save', { type: 'INTERRUPT', command: { type: 'CANCEL' } })
						return { target: '.draining' }
					}
				},
				states: {
					waiting: {
						timeout: 10_000,
						onTimeout: (_args, enq) => {
							enq.sendTo('save', { type: 'INTERRUPT', command: { type: 'CANCEL' } })
							return { target: 'draining' }
						}
					},
					draining: {
						timeout: 10_000,
						onTimeout: { target: '#publication-publish-failed' },
						on: { DISCONNECT: {} }
					}
				}
			},
			checkingDispatchAccess: {
				invoke: {
					id: 'access',
					src: 'access',
					input: ({ context }) => ({ request: context.request, expected: context.access }),
					onDone: ({ context, event }) =>
						event.output.kind === 'allowed'
							? context.publication.state === 'unpublishing'
								? mode === 'cleanup'
									? {
											target: 'checkingCleanupDispatch',
											context: { publication: context.publication }
										}
									: { target: 'removing', context: { publication: context.publication } }
								: { target: 'writing', context: { publication: context.publication } }
							: { target: 'unauthenticated' },
					onError: { target: 'failed' }
				}
			},
			checkingCleanupDispatch: {
				invoke: {
					id: 'deleted',
					src: 'deleted',
					input: ({ context }) => context.selection,
					onDone: ({ event }) =>
						event.output ? { target: 'removing' } : { target: 'unavailable' },
					onError: { target: 'failed' }
				}
			},

			writing: {
				invoke: {
					id: 'write',
					src: 'write',
					input: ({ context }) => ({ publication: context.publication, session: context.session }),
					timeout: 30_000,
					onTimeout: { target: 'readingRemote' },
					onDone: { target: 'readingRemote' },
					onError: { target: 'readingRemote' }
				}
			},
			readingRemovalTarget: {
				invoke: {
					id: 'read',
					src: 'read',
					input: ({ context }) => ({
						uri: context.publication.uri,
						session: context.session,
						isCurrent: () => !context.request.signal.aborted
					}),
					onDone: ({ context, event }) => {
						const result = event.output
						if (result.status === 'notFound')
							return context.publication.state === 'unpublishing'
								? {
										target: 'checkingDispatchAccess',
										context: { publication: context.publication }
									}
								: { target: 'unavailable' }
						if (context.publication.state === 'unpublishing')
							return result.record.cid === context.publication.cid
								? {
										target: 'checkingDispatchAccess',
										context: { publication: context.publication }
									}
								: { target: 'unavailable' }
						if (
							!context.issued ||
							!result.record.cid ||
							!matchesIssuedContent(context.issued, result.record)
						)
							return { target: 'unavailable' }
						return {
							target: 'identifyingSave',
							context: {
								publication: {
									...context.selection,
									state: 'unpublishing',
									uri: context.publication.uri,
									cid: result.record.cid
								}
							}
						}
					},
					onError: { target: 'failed' }
				}
			},
			removing: {
				invoke: {
					id: 'remove',
					src: 'remove',
					input: ({ context }) => ({ publication: context.publication, session: context.session }),
					timeout: 30_000,
					onTimeout: { target: 'verifyingRemoval', context: { removalAccepted: false } },
					onError: { target: 'verifyingRemoval', context: { removalAccepted: false } },
					onDone: ({ event }) => ({
						target: 'verifyingRemoval',
						context: {
							removalAccepted:
								event.output.status >= 200 && event.output.status < 300 && !event.output.redirected
						}
					})
				}
			},
			verifyingRemoval: {
				invoke: {
					id: 'read',
					src: 'read',
					input: ({ context }) => ({
						uri: context.publication.uri,
						session: context.session,
						isCurrent: () => !context.request.signal.aborted
					}),
					onDone: ({ context, event }) =>
						event.output.status === 'notFound'
							? context.removalAccepted
								? {
										target: 'identifyingSave',
										context: {
											publication: {
												...context.selection,
												state: 'unpublished',
												uri: context.publication.uri
											}
										}
									}
								: { target: 'unavailable' }
							: { target: 'unavailable' },
					onError: { target: 'failed' }
				}
			},

			readingRemote: {
				invoke: {
					id: 'read',
					src: 'read',
					input: ({ context }) => ({
						uri: context.publication.uri,
						session: context.session,
						isCurrent: () => !context.request.signal.aborted
					}),
					onDone: ({ context, event }) =>
						event.output.status === 'found' &&
						matchesIssuedContent(context.publication, event.output.record)
							? {
									target: 'identifyingSave',
									context: {
										publication: {
											...context.selection,
											state: 'published',
											uri: context.publication.uri
										}
									}
								}
							: { target: 'unavailable' },
					onError: { target: 'failed' }
				}
			},
			ready: {
				type: 'final',
				output: ({ context }) => Response.json(context.publication, { headers: publicationHeaders })
			},
			invalid: { type: 'final', output: () => publicationFailure(400) },
			forbidden: { type: 'final', output: () => publicationFailure(403) },
			unauthenticated: { type: 'final', output: () => publicationFailure(401) },
			needsGrant: { type: 'final', output: () => publicationFailure(403) },
			unavailable: { type: 'final', output: () => publicationFailure(409) },
			failed: { type: 'final', output: () => publicationFailure(503) },
			disconnected: {
				type: 'final',
				output: () => {
					throw new DOMException('Publication disconnected', 'AbortError')
				}
			}
		}
	})
}

export async function handlePublicationPublish(
	auth: PublicationAuth,
	backend: Pick<Jazz, 'accountFor' | 'db'>,
	request: Request,
	origin: string,
	mode: Mode = 'publish'
) {
	const actor = createActor(createPublicationPublish(auth, backend, mode), {
		input: { request, origin }
	})
	const disconnect = () => actor.send({ type: 'DISCONNECT' })
	request.signal.addEventListener('abort', disconnect, { once: true })
	try {
		const result = toPromise(actor)
		actor.start()
		const response = await result
		request.signal.throwIfAborted()
		return response
	} finally {
		request.signal.removeEventListener('abort', disconnect)
		actor.stop()
	}
}
