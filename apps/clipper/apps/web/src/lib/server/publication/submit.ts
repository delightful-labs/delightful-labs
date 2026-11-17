import { z } from 'zod'
import type { Jazz } from 'jazz-tools/backend'
import { createActor, createAsyncLogic, setup, toPromise, types } from 'xstate'
import type { ActorRefFrom } from 'xstate'
import { createOwnedOperation } from 'delightful-local-first/lifecycle/operation/workflow'
import type {
	DomainTransactionResult,
	TransactionAttempt
} from 'delightful-local-first/transactions/contracts'
import type { SyncReceipt } from '../../contracts/storage.js'
import { publicationBaseSchema } from '../../annotations/publication.js'
import type { Publication } from '../../annotations/publication.js'
import { authorizePublicationTransaction, createPublicationAccess } from './access.js'
import type { PublicationAccess, PublicationAuth } from './access.js'
import { createDocumentNotePreview } from './preview.js'
import { createPublicationStore } from './store.js'
import {
	isJsonRequest,
	isPublicationPost,
	publicationFailure,
	publicationHeaders,
	readPublicationInput
} from './http.js'

type Selection = z.infer<typeof publicationBaseSchema>
type Input = { request: Request; origin: string }
type Context = Input & {
	selection: Selection | undefined
	access: PublicationAccess | undefined
	operationId: string | undefined
}
type StageInput = { attempt: TransactionAttempt<Publication> }
type StageResult = DomainTransactionResult<Publication, SyncReceipt>
type Selected = { selection: Selection; access: PublicationAccess }

function binding(request: Request, selection: Selection, access: PublicationAccess) {
	const signal = request.signal
	return {
		libraryId: selection.libraryId,
		accountId: access.accountId,
		publishingDid: access.did,
		isCurrent: () => !signal.aborted
	}
}

/** One explicit request stores intent only. It neither grants PDS permission nor
 * dispatches content. DLF owns native transaction drain and uncertain custody. */
export function createPublicationSubmit(
	auth: PublicationAuth,
	backend: Pick<Jazz, 'accountFor' | 'db'>
) {
	const actors = {
		input: createAsyncLogic({
			run: ({ input, signal }: { input: Request; signal: AbortSignal }) =>
				readPublicationInput(input, signal, publicationBaseSchema, 4096)
		}),
		access: createPublicationAccess(auth, backend),
		preview: createDocumentNotePreview(backend.db),
		current: createAsyncLogic({
			run: ({ input }: { input: Input & Selected }) =>
				createPublicationStore(
					backend.db,
					binding(input.request, input.selection, input.access)
				).list(input.selection.source)
		}),
		id: createAsyncLogic({ run: async () => crypto.randomUUID() }),
		save: createOwnedOperation<StageInput, StageResult, { type: 'CANCEL' | 'SHUTDOWN' }>()
	}
	const model = setup({
		schemas: {
			input: types<Input>(),
			context: types<Context>(),
			output: types<Response>(),
			events: { DISCONNECT: types() },
			children: {
				input: types<ActorRefFrom<typeof actors.input>>(),
				access: types<ActorRefFrom<typeof actors.access>>(),
				preview: types<ActorRefFrom<typeof actors.preview>>(),
				current: types<ActorRefFrom<typeof actors.current>>(),
				id: types<ActorRefFrom<typeof actors.id>>(),
				save: types<ActorRefFrom<typeof actors.save>>()
			}
		},
		actors,
		states: {
			preparing: {
				states: {
					admitting: {},
					readingInput: {},
					readingAccess: { schemas: { context: types<{ selection: Selection }>() } },
					previewing: { schemas: { context: types<Selected>() } },
					checkingAccess: { schemas: { context: types<Selected>() } },
					readingCurrent: { schemas: { context: types<Selected>() } },
					allocating: { schemas: { context: types<Selected>() } }
				}
			},
			persisting: {
				id: 'publication-submit-persisting',
				schemas: { context: types<Selected & { operationId: string }>() },
				states: { waiting: {}, draining: {} }
			},
			ready: {
				id: 'publication-submit-ready',
				schemas: { context: types<{ selection: Selection }>() }
			},
			invalid: { id: 'publication-submit-invalid' },
			forbidden: { id: 'publication-submit-forbidden' },
			unauthenticated: { id: 'publication-submit-unauthenticated' },
			unavailable: { id: 'publication-submit-unavailable' },
			failed: { id: 'publication-submit-failed' },
			disconnected: { id: 'publication-submit-disconnected' }
		}
	})
	return model.createMachine({
		id: 'publication-submit',
		initial: 'preparing',
		context: ({ input }) => ({
			...input,
			selection: undefined,
			access: undefined,
			operationId: undefined
		}),
		on: { DISCONNECT: { target: '.disconnected' } },
		states: {
			preparing: {
				initial: 'admitting',
				timeout: 30_000,
				onTimeout: { target: 'failed' },
				states: {
					admitting: {
						type: 'choice',
						choice: ({ context }) =>
							context.request.signal.aborted
								? { target: '#publication-submit-disconnected' }
								: !isPublicationPost(context.request, context.origin)
									? { target: '#publication-submit-forbidden' }
									: !isJsonRequest(context.request)
										? { target: '#publication-submit-invalid' }
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
									: { target: '#publication-submit-unavailable' },
							onError: { target: '#publication-submit-invalid' }
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
										? { target: 'previewing', context: { access: event.output.access } }
										: { target: '#publication-submit-unavailable' }
									: event.output.kind === 'failed'
										? { target: '#publication-submit-failed' }
										: { target: '#publication-submit-unauthenticated' },
							onError: { target: '#publication-submit-failed' }
						}
					},
					previewing: {
						invoke: {
							id: 'preview',
							src: 'preview',
							input: ({ context }) => ({
								binding: binding(context.request, context.selection, context.access),
								source: context.selection.source,
								createdAt: new Date(context.access.observedAt)
							}),
							onDone: ({ event }) =>
								event.output
									? { target: 'checkingAccess' }
									: { target: '#publication-submit-unavailable' },
							onError: { target: '#publication-submit-failed' }
						}
					},
					checkingAccess: {
						invoke: {
							id: 'access',
							src: 'access',
							input: ({ context }) => ({ request: context.request, expected: context.access }),
							onDone: ({ event }) =>
								event.output.kind === 'allowed'
									? { target: 'readingCurrent', context: { access: event.output.access } }
									: event.output.kind === 'failed'
										? { target: '#publication-submit-failed' }
										: { target: '#publication-submit-unauthenticated' },
							onError: { target: '#publication-submit-failed' }
						}
					},
					readingCurrent: {
						invoke: {
							id: 'current',
							src: 'current',
							input: ({ context }) => ({
								request: context.request,
								origin: context.origin,
								selection: context.selection,
								access: context.access
							}),
							onDone: ({ context, event }) => {
								const matches = event.output.filter(
									(value) => value.publishingDid === context.access.did
								)
								if (matches.length > 1) return { target: '#publication-submit-unavailable' }
								const current = matches[0]
								return current?.state === 'requested'
									? { target: '#publication-submit-ready' }
									: !current || current.state === 'private'
										? { target: 'allocating' }
										: { target: '#publication-submit-unavailable' }
							},
							onError: { target: '#publication-submit-failed' }
						}
					},
					allocating: {
						invoke: {
							id: 'id',
							src: 'id',
							onDone: ({ event }) => ({
								target: '#publication-submit-persisting',
								context: { operationId: event.output }
							}),
							onError: { target: '#publication-submit-failed' }
						}
					}
				}
			},
			persisting: {
				id: 'publication-submit-persisting',
				initial: 'waiting',
				invoke: {
					id: 'save',
					src: 'save',
					input: ({ context }) => {
						const scope = binding(context.request, context.selection, context.access)
						const access = context.access
						const logic = createPublicationStore(backend.db, scope, (tx) =>
							authorizePublicationTransaction(tx, access)
						).stage
						return {
							operationId: context.operationId,
							input: {
								attempt: {
									operationId: context.operationId,
									workspaceId: scope.libraryId,
									membershipId: scope.libraryId,
									draft: { ...context.selection, state: 'requested' }
								}
							},
							spawn: (spawn, input) => spawn(logic, { input })
						}
					},
					onDone: ({ event }) =>
						event.output.kind === 'completed' && event.output.output.outcome === 'succeeded'
							? { target: 'ready' }
							: event.output.kind === 'completed' && event.output.output.outcome === 'blocked'
								? { target: 'unavailable' }
								: { target: 'failed' },
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
					// On a second deadline DLF's forced-stop custody retains any native
					// unknown commit. A 503 never means the intent was not stored.
					draining: {
						timeout: 10_000,
						onTimeout: { target: '#publication-submit-failed' },
						on: { DISCONNECT: {} }
					}
				}
			},
			ready: {
				id: 'publication-submit-ready',
				type: 'final',
				output: ({ context }) =>
					Response.json(
						{ ...context.selection, state: 'requested' },
						{ status: 202, headers: publicationHeaders }
					)
			},
			invalid: {
				id: 'publication-submit-invalid',
				type: 'final',
				output: () => publicationFailure(400)
			},
			forbidden: {
				id: 'publication-submit-forbidden',
				type: 'final',
				output: () => publicationFailure(403)
			},
			unauthenticated: {
				id: 'publication-submit-unauthenticated',
				type: 'final',
				output: () => publicationFailure(401)
			},
			unavailable: {
				id: 'publication-submit-unavailable',
				type: 'final',
				output: () => publicationFailure(409)
			},
			failed: {
				id: 'publication-submit-failed',
				type: 'final',
				output: () => publicationFailure(503)
			},
			disconnected: {
				id: 'publication-submit-disconnected',
				type: 'final',
				output: () => {
					throw new DOMException('Publication request disconnected', 'AbortError')
				}
			}
		}
	})
}

/** Actual HTTP boundary; stopping a root is never used to claim rollback. */
export async function handlePublicationSubmit(
	auth: PublicationAuth,
	backend: Pick<Jazz, 'accountFor' | 'db'>,
	request: Request,
	origin: string
) {
	const actor = createActor(createPublicationSubmit(auth, backend), { input: { request, origin } })
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
