import { z } from 'zod'
import type { Jazz } from 'jazz-tools/backend'
import { createActor, createAsyncLogic, setup, toPromise, types } from 'xstate'
import type { ActorRefFrom } from 'xstate'
import { publicationBaseSchema } from '../../annotations/publication.js'
import { didSchema } from '../../annotations/publication-link.js'
import { createPublicationAccess } from './access.js'
import type { PublicationAccess, PublicationAuth } from './access.js'
import { createPublicationPreview } from './annotation-preview.js'
import {
	isJsonRequest,
	isPublicationPost,
	publicationFailure,
	publicationHeaders,
	readPublicationInput
} from './http.js'

type Selection = z.infer<typeof publicationBaseSchema>
type Input = { request: Request; origin: string }
type Selected = { selection: Selection; access: PublicationAccess }
type Context = Input & {
	selection: Selection | undefined
	access: PublicationAccess | undefined
}

// The plugin publishes a broad BetterAuthPlugin declaration. Narrow its actual
// server-only capability at this boundary without changing vendor declarations,
// starting another OAuth client or accepting native handles from HTTP input.
export function hasRestorer(value: unknown): value is {
	getAtprotoClient: (input: { body: { did: string } }) => Promise<unknown>
} {
	return (
		typeof value === 'object' &&
		value !== null &&
		'getAtprotoClient' in value &&
		typeof value.getAtprotoClient === 'function'
	)
}
type Restored = { session: { did: unknown; getTokenInfo: () => Promise<unknown> } }
function hasSession(value: unknown): value is Restored {
	return (
		typeof value === 'object' &&
		value !== null &&
		'session' in value &&
		typeof value.session === 'object' &&
		value.session !== null &&
		'did' in value.session &&
		'getTokenInfo' in value.session &&
		typeof value.session.getTokenInfo === 'function'
	)
}

/** Inspect the SDK's existing TokenInfo fields, never access/refresh tokens.
 * Recognize the full collection permission Clipper requests; do not infer grants
 * from client metadata, linked-account scope, prefixes or legacy broad scopes. */
export function permitsPublication(value: unknown, did: string, observedAt: number) {
	if (typeof value !== 'object' || value === null) return false
	if (!('sub' in value) || value.sub !== did || !didSchema.safeParse(value.sub).success)
		return false
	if (!('scope' in value) || typeof value.scope !== 'string') return false
	const scopes = value.scope.split(' ')
	if (!scopes.includes('atproto') || !scopes.includes('repo:at.margin.note')) return false
	if ('expired' in value && value.expired !== undefined && value.expired !== false) return false
	if ('expiresAt' in value && value.expiresAt !== undefined) {
		const expiration = z.date().safeParse(value.expiresAt)
		if (!expiration.success || expiration.data.getTime() <= observedAt) return false
	}
	return true
}

/** Read-only HTTP observation, not a durable permission or dispatch capability.
 * SDK restoration/refresh may update its own auth store; this chart never changes
 * publication intent or sends a repository request. A publisher must recheck. */
export function createPublicationPermission(
	auth: PublicationAuth,
	backend: Pick<Jazz, 'accountFor' | 'db'>
) {
	const actors = {
		input: createAsyncLogic({
			run: ({ input, signal }: { input: Request; signal: AbortSignal }) =>
				readPublicationInput(input, signal, publicationBaseSchema, 4096)
		}),
		access: createPublicationAccess(auth, backend),
		preview: createPublicationPreview(backend.db),
		restore: createAsyncLogic({
			run: ({ input }: { input: string }) => {
				if (!hasRestorer(auth.api)) throw new Error('Publication provider unavailable')
				return auth.api.getAtprotoClient({ body: { did: input } })
			}
		}),
		token: createAsyncLogic({
			run: async ({
				input,
				signal
			}: {
				input: { restored: Restored; did: string }
				signal: AbortSignal
			}) => {
				const info = await input.restored.session.getTokenInfo()
				signal.throwIfAborted()
				return permitsPublication(info, input.did, Date.now())
			}
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
				access: types<ActorRefFrom<typeof actors.access>>(),
				preview: types<ActorRefFrom<typeof actors.preview>>(),
				restore: types<ActorRefFrom<typeof actors.restore>>(),
				token: types<ActorRefFrom<typeof actors.token>>()
			}
		},
		actors,
		states: {
			admitting: {},
			readingInput: {},
			readingAccess: { schemas: { context: types<{ selection: Selection }>() } },
			previewing: { schemas: { context: types<Selected>() } },
			restoring: { schemas: { context: types<Selected>() } },
			checkingGrant: {
				schemas: { context: types<Selected>(), input: types<{ restored: Restored }>() }
			},
			checkingAccess: { schemas: { context: types<Selected>() } },
			ready: {},
			invalid: {},
			forbidden: {},
			unauthenticated: {},
			unavailable: {},
			failed: {},
			disconnected: {}
		}
	})
	return model.createMachine({
		id: 'publication-permission',
		initial: 'admitting',
		context: ({ input }) => ({ ...input, selection: undefined, access: undefined }),
		timeout: 30_000,
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
					onDone: ({ context, event }) =>
						event.output.kind === 'allowed'
							? event.output.access.did === context.selection.publishingDid
								? { target: 'previewing', context: { access: event.output.access } }
								: { target: 'unavailable' }
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
						source: context.selection.source,
						createdAt: new Date(context.access.observedAt),
						binding: {
							libraryId: context.selection.libraryId,
							accountId: context.access.accountId,
							publishingDid: context.access.did,
							isCurrent: () => !context.request.signal.aborted
						}
					}),
					onDone: ({ event }) =>
						event.output ? { target: 'restoring' } : { target: 'unavailable' },
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
							? { target: 'checkingGrant', input: { restored: event.output } }
							: { target: 'unavailable' },
					onError: { target: 'failed' }
				}
			},
			checkingGrant: {
				invoke: {
					id: 'token',
					src: 'token',
					input: ({ context, input }) => ({ restored: input.restored, did: context.access.did }),
					onDone: ({ event }) =>
						event.output ? { target: 'checkingAccess' } : { target: 'unavailable' },
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
								? { target: 'failed' }
								: { target: 'unauthenticated' },
					onError: { target: 'failed' }
				}
			},
			ready: {
				type: 'final',
				output: () => new Response(null, { status: 204, headers: publicationHeaders })
			},
			invalid: { type: 'final', output: () => publicationFailure(400) },
			forbidden: { type: 'final', output: () => publicationFailure(403) },
			unauthenticated: { type: 'final', output: () => publicationFailure(401) },
			unavailable: { type: 'final', output: () => publicationFailure(409) },
			failed: { type: 'final', output: () => publicationFailure(503) },
			disconnected: {
				type: 'final',
				output: () => {
					throw new DOMException('Publication permission disconnected', 'AbortError')
				}
			}
		}
	})
}

/** HTTP host owns the request actor; the auth host retains the shared SDK session. */
export async function handlePublicationPermission(
	auth: PublicationAuth,
	backend: Pick<Jazz, 'accountFor' | 'db'>,
	request: Request,
	origin: string
) {
	const actor = createActor(createPublicationPermission(auth, backend), {
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
