import { z } from 'zod'
import type { Jazz } from 'jazz-tools/backend'
import { createActor, createAsyncLogic, matchesState, setup, toPromise, types } from 'xstate'
import type { ActorRefFrom } from 'xstate'
import { createOwnedOperation } from 'delightful-local-first/lifecycle/operation/workflow'
import type {
	DomainTransactionResult,
	TransactionAttempt
} from 'delightful-local-first/transactions/contracts'
import type { SyncReceipt } from '../../contracts/storage.js'
import { publicationBaseSchema } from '../../annotations/publication.js'
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
type Issued = Extract<Publication, { state: 'issued' }>
type Context = Input & {
	selection: Selection | undefined
	access: PublicationAccess | undefined
	publication: Publication | undefined
	preview: PublicationPreview | undefined
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

/** Explicit document-note Publish. Jazz owns accepted intent and the immutable
 * issued address/payload. Only this request's newly accepted issuance may PUT;
 * resumed issued work only reads back. No automatic replay, update or overwrite. */
export function createPublicationPublish(
	auth: PublicationAuth,
	backend: Pick<Jazz, 'accountFor' | 'db'>
) {
	const actors = {
		input: createAsyncLogic({
			run: ({ input, signal }: { input: Request; signal: AbortSignal }) =>
				readPublicationInput(input, signal, publicationBaseSchema, 4096)
		}),
		access: createPublicationAccess(auth, backend),
		current: createAsyncLogic({
			run: ({ input }: { input: Input & Selected }) =>
				createPublicationStore(backend.db, binding(input)).list(input.selection.source)
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
			checkingDispatchAccess: {
				schemas: { context: types<Selected & { publication: Issued; session: Session }>() }
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
			preview: undefined,
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
							(value) => value.publishingDid === context.access.did
						)
						if (matches.length > 1) return { target: 'unavailable' }
						const publication = matches[0]
						return publication?.state === 'published'
							? { target: 'ready', context: { publication } }
							: publication?.state === 'issued'
								? { target: 'restoring', context: { publication } }
								: { target: 'previewing', context: { publication } }
					},
					onError: { target: 'failed' }
				}
			},
			previewing: {
				invoke: {
					id: 'preview',
					src: 'preview',
					input: ({ context }) => ({
						source: context.selection.source,
						createdAt: new Date(context.access.observedAt),
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
				choice: ({ context }) =>
					context.publication.state === 'issued'
						? { target: 'readingRemote', context: { publication: context.publication } }
						: context.publication.state === 'requested'
							? { target: 'allocating' }
							: {
									target: 'identifyingSave',
									context: { publication: { ...context.selection, state: 'requested' } }
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
						const logic = createPublicationStore(backend.db, scope, (tx) =>
							authorizePublicationTransaction(tx, access)
						).stage
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
						if (context.publication.state === 'issued' && context.session)
							return {
								target: 'checkingDispatchAccess',
								context: { publication: context.publication, session: context.session }
							}
						return context.publication.state === 'published'
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
					onDone: ({ event }) =>
						event.output.kind === 'allowed' ? { target: 'writing' } : { target: 'unauthenticated' },
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
	origin: string
) {
	const actor = createActor(createPublicationPublish(auth, backend), { input: { request, origin } })
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
