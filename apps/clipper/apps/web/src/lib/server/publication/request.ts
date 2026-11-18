import { z } from 'zod'
import type { Jazz } from 'jazz-tools/backend'
import { createActor, createAsyncLogic, setup, toPromise, types } from 'xstate'
import type { ActorRefFrom } from 'xstate'
import { publicationPreviewSchema } from '../../annotations/publication-preview.js'
import type { Publication } from '../../annotations/publication.js'
import { createPublicationStore } from './store.js'
import type { PublicationPreview } from '../../annotations/publication-preview.js'
import { highlightSourceGateway } from './highlight-preview.js'
import { createPublicationPreview } from './annotation-preview.js'
import { createPublicationAccess } from './access.js'
import type { PublicationAccess, PublicationAuth } from './access.js'
import {
	isJsonRequest,
	isPublicationPost,
	readPublicationInput,
	publicationHeaders,
	publicationFailure
} from './http.js'

const inputSchema = publicationPreviewSchema.pick({ libraryId: true, source: true })
type Selection = z.infer<typeof inputSchema>
export type PreviewAuth = PublicationAuth
type Input = { request: Request; origin: string }
type Preview = PublicationPreview | Publication
type Context = Input & {
	selection: Selection | undefined
	access: PublicationAccess | undefined
	preview: Preview | undefined
}

export function createPreviewRequest(
	auth: PreviewAuth,
	backend: Pick<Jazz, 'accountFor' | 'db'>,
	sourceGateway = highlightSourceGateway
) {
	const actors = {
		preview: createPublicationPreview(backend.db, sourceGateway),
		access: createPublicationAccess(auth, backend),
		current: createAsyncLogic({
			run: ({
				input
			}: {
				input: { selection: Selection; access: PublicationAccess; request: Request }
			}) =>
				createPublicationStore(backend.db, {
					libraryId: input.selection.libraryId,
					accountId: input.access.accountId,
					publishingDid: input.access.did,
					isCurrent: () => !input.request.signal.aborted
				}).list(input.selection.source)
		}),
		input: createAsyncLogic({
			run: ({ input, signal }: { input: Request; signal: AbortSignal }) =>
				readPublicationInput(input, signal, inputSchema, 2048)
		})
	}
	const model = setup({
		schemas: {
			input: types<Input>(),
			context: types<Context>(),
			output: types<Response>(),
			events: { DISCONNECT: types() },
			children: {
				input: types<ActorRefFrom<typeof actors.input>>(),
				current: types<ActorRefFrom<typeof actors.current>>(),
				access: types<ActorRefFrom<typeof actors.access>>(),
				preview: types<ActorRefFrom<typeof actors.preview>>()
			}
		},
		actors,
		states: {
			admitting: {},
			readingInput: {},
			readingAccess: { schemas: { context: types<{ selection: Selection }>() } },
			readingPublication: {
				schemas: { context: types<{ selection: Selection; access: PublicationAccess }>() }
			},
			previewing: {
				schemas: { context: types<{ selection: Selection; access: PublicationAccess }>() }
			},
			checkingAccess: {
				schemas: {
					context: types<{
						selection: Selection
						access: PublicationAccess
						preview: Preview
					}>()
				}
			},
			ready: { schemas: { context: types<{ preview: Preview }>() } },
			invalid: {},
			forbidden: {},
			unauthenticated: {},
			unavailable: {},
			failed: {},
			disconnected: {}
		}
	})
	return model.createMachine({
		id: 'publication-preview-request',
		initial: 'admitting',
		context: ({ input }) => ({
			...input,
			selection: undefined,
			access: undefined,
			preview: undefined
		}),
		timeout: 45_000,
		onTimeout: { target: '.failed', context: { preview: undefined } },
		on: { DISCONNECT: { target: '.disconnected', context: { preview: undefined } } },
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
					onDone: ({ event }) => ({
						target: 'readingAccess',
						context: { selection: event.output }
					}),
					onError: { target: 'invalid' }
				}
			},
			readingAccess: {
				invoke: {
					id: 'access',
					src: 'access',
					input: ({ context }) => ({ request: context.request }),
					onDone: ({ event }) =>
						event.output.kind === 'allowed'
							? { target: 'previewing', context: { access: event.output.access } }
							: event.output.kind === 'failed'
								? { target: 'failed' }
								: { target: 'unauthenticated' },
					onError: { target: 'failed' }
				}
			},
			previewing: {
				invoke: {
					id: 'preview',
					src: 'preview',
					input: ({ context }) => ({
						binding: {
							libraryId: context.selection.libraryId,
							accountId: context.access.accountId,
							publishingDid: context.access.did,
							isCurrent: () => !context.request.signal.aborted
						},
						source: context.selection.source,
						createdAt: new Date(context.access.observedAt)
					}),
					onDone: ({ event }) =>
						event.output
							? { target: 'checkingAccess', context: { preview: event.output } }
							: { target: 'readingPublication' },
					onError: { target: 'failed' }
				}
			},
			readingPublication: {
				invoke: {
					id: 'current',
					src: 'current',
					input: ({ context }) => ({
						selection: context.selection,
						access: context.access,
						request: context.request
					}),
					onDone: ({ context, event }) => {
						const values = event.output.filter(
							(value) => value.publishingDid === context.access.did
						)
						const value = values[0]
						return values.length === 1 && value && 'uri' in value
							? { target: 'checkingAccess', context: { preview: value } }
							: { target: 'unavailable' }
					},
					onError: { target: 'failed' }
				}
			},
			checkingAccess: {
				invoke: {
					id: 'access',
					src: 'access',
					input: ({ context }) => ({ request: context.request, expected: context.access }),
					onDone: ({ event }) =>
						event.output.kind === 'allowed'
							? { target: 'ready' }
							: event.output.kind === 'failed'
								? { target: 'failed', context: { preview: undefined } }
								: { target: 'unauthenticated', context: { preview: undefined } },
					onError: { target: 'failed', context: { preview: undefined } }
				}
			},
			ready: {
				type: 'final',
				output: ({ context }) => Response.json(context.preview, { headers: publicationHeaders })
			},
			invalid: { type: 'final', output: () => publicationFailure(400) },
			forbidden: { type: 'final', output: () => publicationFailure(403) },
			unauthenticated: { type: 'final', output: () => publicationFailure(401) },
			unavailable: { type: 'final', output: () => publicationFailure(409) },
			failed: { type: 'final', output: () => publicationFailure(503) },
			disconnected: {
				type: 'final',
				output: () => {
					throw new DOMException('Preview request disconnected', 'AbortError')
				}
			}
		}
	})
}

/** Actual HTTP boundary owns this root, abort listener and final response. */
export async function handlePreviewRequest(
	auth: PreviewAuth,
	backend: Pick<Jazz, 'accountFor' | 'db'>,
	request: Request,
	origin: string,
	sourceGateway = highlightSourceGateway
) {
	const actor = createActor(createPreviewRequest(auth, backend, sourceGateway), {
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
