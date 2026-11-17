import { z } from 'zod'
import { ReadTier } from 'jazz-tools'
import type { Jazz } from 'jazz-tools/backend'
import { createActor, createAsyncLogic, setup, toPromise, types } from 'xstate'
import type { ActorRefFrom } from 'xstate'
import { app } from '../../backend/jazz/schema.js'
import { publicationPreviewSchema } from '../../annotations/publication-preview.js'
import type { PublicationPreview } from '../../annotations/publication-preview.js'
import { lowercaseUuidSchema } from '../../validation/values.js'
import { didSchema } from '../../annotations/publication-link.js'
import { createDocumentNotePreview } from './preview.js'

const inputSchema = publicationPreviewSchema.pick({ libraryId: true, source: true })
type Selection = z.infer<typeof inputSchema>
const sessionSchema = z.object({
	user: z.object({ id: lowercaseUuidSchema, atprotoDid: didSchema }),
	session: z.object({ id: lowercaseUuidSchema, expiresAt: z.date() })
})
type Identity = {
	userId: string
	did: string
	sessionId: string
	expiresAt: number
	observedAt: number
}
type Binding = { accountId: string | null; linked: boolean; observedAt: number }
export type PreviewAuth = {
	api: {
		getSession: (input: {
			headers: Headers
			query: { disableCookieCache: true; disableRefresh: true }
		}) => Promise<unknown>
	}
}
type Input = { request: Request; origin: string }
type Context = Input & {
	selection: Selection | undefined
	identity: Identity | undefined
	binding: Binding | undefined
	preview: PublicationPreview | undefined
}
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' }
const failure = (status: number) => new Response(null, { status, headers })

/** One bounded native stream read. The request chart owns admission/lifetime. */
async function readInput(request: Request, signal: AbortSignal) {
	const reader = request.body?.getReader()
	if (!reader) throw new Error('Missing preview input')
	const abort = () => {
		void reader.cancel().catch(() => {})
	}
	signal.addEventListener('abort', abort, { once: true })
	const chunks: Uint8Array[] = []
	let length = 0
	try {
		signal.throwIfAborted()
		for (;;) {
			const next = await reader.read()
			if (next.done) break
			length += next.value.byteLength
			if (length > 2048) throw new Error('Preview input too large')
			chunks.push(next.value)
		}
	} finally {
		signal.removeEventListener('abort', abort)
		void reader.cancel().catch(() => {})
		reader.releaseLock()
	}
	signal.throwIfAborted()
	const bytes = new Uint8Array(length)
	let offset = 0
	for (const chunk of chunks) {
		bytes.set(chunk, offset)
		offset += chunk.length
	}
	const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
	return inputSchema.parse(value)
}

export function createPreviewRequest(auth: PreviewAuth, backend: Pick<Jazz, 'accountFor' | 'db'>) {
	const actors = {
		preview: createDocumentNotePreview(backend.db),
		input: createAsyncLogic({
			run: ({ input, signal }: { input: Request; signal: AbortSignal }) => readInput(input, signal)
		}),
		session: createAsyncLogic({
			run: async ({
				input,
				signal
			}: {
				input: Request
				signal: AbortSignal
			}): Promise<Identity | undefined> => {
				const result = await auth.api.getSession({
					headers: input.headers,
					query: { disableCookieCache: true, disableRefresh: true }
				})
				signal.throwIfAborted()
				const parsed = sessionSchema.safeParse(result)
				return parsed.success
					? {
							userId: parsed.data.user.id,
							did: parsed.data.user.atprotoDid,
							sessionId: parsed.data.session.id,
							expiresAt: parsed.data.session.expiresAt.getTime(),
							observedAt: Date.now()
						}
					: undefined
			}
		}),
		binding: createAsyncLogic({
			run: async ({
				input,
				signal
			}: {
				input: { request: Request; identity: Identity }
				signal: AbortSignal
			}): Promise<Binding> => {
				const [accountId, accounts] = await Promise.all([
					backend.accountFor(input.request),
					backend.db.all(
						app.better_auth_account
							.where({
								userId: input.identity.userId,
								providerId: 'atproto',
								accountId: input.identity.did
							})
							.limit(2),
						{ tier: ReadTier.Remote }
					)
				])
				signal.throwIfAborted()
				return { accountId, linked: accounts.length === 1, observedAt: Date.now() }
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
				session: types<ActorRefFrom<typeof actors.session>>(),
				binding: types<ActorRefFrom<typeof actors.binding>>(),
				preview: types<ActorRefFrom<typeof actors.preview>>()
			}
		},
		actors,
		states: {
			admitting: {},
			readingInput: {},
			readingSession: { schemas: { context: types<{ selection: Selection }>() } },
			readingBinding: {
				schemas: { context: types<{ selection: Selection; identity: Identity }>() }
			},
			previewing: {
				schemas: {
					context: types<{
						selection: Selection
						identity: Identity
						binding: Binding & { accountId: string }
					}>()
				}
			},
			checkingSession: {
				schemas: {
					context: types<{
						selection: Selection
						identity: Identity
						binding: Binding & { accountId: string }
						preview: PublicationPreview
					}>()
				}
			},
			checkingBinding: {
				schemas: {
					context: types<{
						selection: Selection
						identity: Identity
						binding: Binding & { accountId: string }
						preview: PublicationPreview
					}>()
				}
			},
			ready: { schemas: { context: types<{ preview: PublicationPreview }>() } },
			invalid: {},
			forbidden: {},
			unauthenticated: {},
			unavailable: {},
			failed: {},
			disconnected: {}
		},
		guards: {
			validRequest: ({ context }: { context: Context }) =>
				context.request.method === 'POST' &&
				!context.request.headers.has('authorization') &&
				context.request.headers.get('origin') === context.origin &&
				new URL(context.request.url).origin === context.origin,
			validIdentity: (_, identity: Identity | undefined) =>
				!!identity && identity.expiresAt > identity.observedAt,
			validBinding: ({ context }: { context: Context }, binding: Binding) =>
				binding.linked &&
				lowercaseUuidSchema.safeParse(binding.accountId).success &&
				!!context.identity &&
				context.identity.expiresAt > binding.observedAt,
			matchingIdentity: ({ context }: { context: Context }, identity: Identity | undefined) =>
				!!identity &&
				identity.expiresAt > identity.observedAt &&
				identity.userId === context.identity?.userId &&
				identity.sessionId === context.identity.sessionId &&
				identity.did === context.identity.did
		}
	})
	return model.createMachine({
		id: 'publication-preview-request',
		initial: 'admitting',
		context: ({ input }) => ({
			...input,
			selection: undefined,
			identity: undefined,
			binding: undefined,
			preview: undefined
		}),
		timeout: 45_000,
		onTimeout: { target: '.failed', context: { preview: undefined } },
		on: { DISCONNECT: { target: '.disconnected', context: { preview: undefined } } },
		states: {
			admitting: {
				type: 'choice',
				choice: (args) =>
					args.context.request.signal.aborted
						? { target: 'disconnected' }
						: !args.guards.validRequest(args)
							? { target: 'forbidden' }
							: args.context.request.headers
										.get('content-type')
										?.split(';')[0]
										?.trim()
										.toLowerCase() !== 'application/json'
								? { target: 'invalid' }
								: { target: 'readingInput' }
			},
			readingInput: {
				invoke: {
					id: 'input',
					src: 'input',
					input: ({ context }) => context.request,
					onDone: ({ event }) => ({
						target: 'readingSession',
						context: { selection: event.output }
					}),
					onError: { target: 'invalid' }
				}
			},
			readingSession: {
				invoke: {
					id: 'session',
					src: 'session',
					input: ({ context }) => context.request,
					onDone: (args) =>
						args.guards.validIdentity(args, args.event.output) && args.event.output
							? { target: 'readingBinding', context: { identity: args.event.output } }
							: { target: 'unauthenticated' },
					onError: { target: 'failed' }
				}
			},
			readingBinding: {
				invoke: {
					id: 'binding',
					src: 'binding',
					input: ({ context }) => ({ request: context.request, identity: context.identity }),
					onDone: (args) =>
						args.guards.validBinding(args, args.event.output) && args.event.output.accountId
							? {
									target: 'previewing',
									context: {
										binding: { ...args.event.output, accountId: args.event.output.accountId }
									}
								}
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
							accountId: context.binding.accountId,
							publishingDid: context.identity.did,
							isCurrent: () => !context.request.signal.aborted
						},
						source: context.selection.source,
						createdAt: new Date(context.identity.observedAt)
					}),
					onDone: ({ event }) =>
						event.output
							? { target: 'checkingSession', context: { preview: event.output } }
							: { target: 'unavailable' },
					onError: { target: 'failed' }
				}
			},
			checkingSession: {
				invoke: {
					id: 'session',
					src: 'session',
					input: ({ context }) => context.request,
					onDone: (args) =>
						args.guards.matchingIdentity(args, args.event.output) && args.event.output
							? { target: 'checkingBinding', context: { identity: args.event.output } }
							: { target: 'unauthenticated', context: { preview: undefined } },
					onError: { target: 'failed', context: { preview: undefined } }
				}
			},
			checkingBinding: {
				invoke: {
					id: 'binding',
					src: 'binding',
					input: ({ context }) => ({ request: context.request, identity: context.identity }),
					onDone: (args) =>
						args.guards.validBinding(args, args.event.output) &&
						args.event.output.accountId === args.context.binding.accountId
							? { target: 'ready' }
							: { target: 'unauthenticated', context: { preview: undefined } },
					onError: { target: 'failed', context: { preview: undefined } }
				}
			},
			ready: {
				type: 'final',
				output: ({ context }) => Response.json(context.preview, { headers })
			},
			invalid: { type: 'final', output: () => failure(400) },
			forbidden: { type: 'final', output: () => failure(403) },
			unauthenticated: { type: 'final', output: () => failure(401) },
			unavailable: { type: 'final', output: () => failure(409) },
			failed: { type: 'final', output: () => failure(503) },
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
	origin: string
) {
	const actor = createActor(createPreviewRequest(auth, backend), { input: { request, origin } })
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
