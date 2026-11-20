import { createAsyncLogic, setup, types, type ActorRefFrom, type SnapshotFrom } from 'xstate'
import { z } from 'zod'

export const AUTH_REQUEST_TIMEOUT_MS = 30_000

const monotonicNow = () => performance.now()
async function requestJSON(path: string, init: RequestInit, now: () => number) {
	const startedAt = now()
	const response = await fetch(path, {
		...init,
		credentials: 'same-origin',
		cache: 'no-store',
		redirect: 'error'
	})
	if (!response.ok) {
		void response.body?.cancel().catch(() => {})
		throw new Error('Authentication request failed')
	}
	const value: unknown = await response.json()
	init.signal?.throwIfAborted()
	return { value, elapsedMs: now() - startedAt }
}
const completionSchema = z.object({ attemptId: z.uuid(), userId: z.string().min(1) })
const redirectSchema = z.object({
	url: z.url().refine((value) => new URL(value).protocol === 'https:')
})
type Input = {
	callbackAttempt?: string | null | undefined
	requestTimeoutMs?: number
	now?: () => number
}
type Context = Input
type Authorization = {
	handle: string
	requiresConfirmation?: boolean
	authorizationScope?: string | undefined
}
function beginAuthorization(
	event: Authorization
): { target: 'confirming' | 'issuingAttempt'; context: Authorization } | undefined {
	const handle = event.handle.trim()
	return handle
		? {
				target: event.requiresConfirmation ? 'confirming' : 'issuingAttempt',
				context: { handle, authorizationScope: event.authorizationScope }
			}
		: undefined
}
export function createAtprotoWorkflow<Message>(configuration: {
	messages: { working: Message; failed: Message }
	defaultAuthorizationScope?: string
}) {
	const actors = {
		identity: createAsyncLogic({ run: async () => crypto.randomUUID() }),
		authorize: createAsyncLogic({
			run: async ({
				input,
				signal
			}: {
				input: Authorization & { attemptId: string; now: () => number }
				signal: AbortSignal
			}) => {
				const result = await requestJSON(
					'/api/auth/sign-in/atproto',
					{
						method: 'POST',
						signal,
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({
							handle: input.handle,
							scope:
								input.authorizationScope ?? configuration.defaultAuthorizationScope ?? 'atproto',
							callbackURL: '/?atproto_attempt=' + input.attemptId
						})
					},
					input.now
				)
				return { url: redirectSchema.parse(result.value).url, elapsedMs: result.elapsedMs }
			}
		}),
		complete: createAsyncLogic({
			run: async ({
				input,
				signal
			}: {
				input: { attemptId: string; now: () => number }
				signal: AbortSignal
			}) => {
				const attempt = z.uuid().parse(input.attemptId)
				const result = await requestJSON(
					'/api/auth/atproto/completion',
					{ method: 'POST', signal },
					input.now
				)
				const completion = completionSchema.parse(result.value)
				if (completion.attemptId !== attempt) throw new Error('OAuth attempt did not complete')
				return { elapsedMs: result.elapsedMs }
			}
		})
	}
	/** The app host drains/closes before navigation; Jazz owns native account following. */
	const atprotoMachine = setup({
		schemas: {
			context: types<Context>(),
			input: types<Input>(),
			events: { BEGIN: types<Authorization>(), CONFIRM: types(), CANCEL: types() },
			tags: types<string>(),
			meta: types<{ message?: Message; confirmation?: 'uncertain' }>(),
			children: {
				identity: types<ActorRefFrom<typeof actors.identity>>(),
				authorize: types<ActorRefFrom<typeof actors.authorize>>(),
				complete: types<ActorRefFrom<typeof actors.complete>>()
			}
		},
		states: {
			starting: {},
			idle: {},
			confirming: { schemas: { context: types<Authorization>() } },
			failed: {},
			completionUncertain: {},
			issuingAttempt: {
				schemas: { context: types<Authorization>() }
			},
			authorizing: { schemas: { input: types<Authorization & { attemptId: string }>() } },
			redirecting: { schemas: { input: types<{ url: string }>() } },
			completing: { schemas: { input: types<{ attemptId: string }>() } }
		},
		actors,
		delays: {
			requestDeadline: ({ context }) => context.requestTimeoutMs ?? AUTH_REQUEST_TIMEOUT_MS
		},
		guards: {
			withinDeadline: ({ context }: { context: Context }, result: { elapsedMs: number }) =>
				result.elapsedMs >= 0 &&
				result.elapsedMs < (context.requestTimeoutMs ?? AUTH_REQUEST_TIMEOUT_MS)
		}
	}).createMachine({
		id: 'atproto',
		context: ({ input }) => input,
		initial: 'starting',
		on: { CANCEL: { target: '.idle' } },
		states: {
			starting: {
				type: 'choice',
				choice: ({ context }) =>
					context.callbackAttempt != null
						? { target: 'completing', input: { attemptId: context.callbackAttempt } }
						: { target: 'idle' }
			},
			confirming: {
				tags: ['confirmation'],
				on: {
					CONFIRM: ({ context }) => ({
						target: 'issuingAttempt',
						context: {
							handle: context.handle,
							authorizationScope: context.authorizationScope
						}
					}),
					CANCEL: { target: 'idle' }
				}
			},
			idle: {
				on: {
					BEGIN: ({ event }) => beginAuthorization(event)
				}
			},
			issuingAttempt: {
				tags: ['busy'],
				meta: { message: configuration.messages.working },
				invoke: {
					id: 'identity',
					src: 'identity',
					onDone: ({ event, context }) => ({
						target: 'authorizing',
						input: {
							handle: context.handle,
							authorizationScope: context.authorizationScope,
							attemptId: event.output
						}
					}),
					onError: { target: 'failed' }
				}
			},
			authorizing: {
				tags: ['busy'],
				meta: { message: configuration.messages.working },
				timeout: 'requestDeadline',
				onTimeout: { target: 'failed' },
				invoke: {
					id: 'authorize',
					src: 'authorize',
					input: ({ context, input }) => ({ ...input, now: context.now ?? monotonicNow }),
					onDone: (args) =>
						args.guards.withinDeadline(args, args.event.output)
							? { target: 'redirecting', input: { url: args.event.output.url } }
							: { target: 'failed' },
					onError: { target: 'failed' }
				}
			},
			redirecting: {
				tags: ['busy'],
				meta: { message: configuration.messages.working },
				entry: ({ input, parent }, enq) => {
					enq.sendTo(parent, { type: 'OAUTH_REDIRECT', url: input.url })
				}
			},
			completing: {
				tags: ['busy'],
				meta: { message: configuration.messages.working },
				timeout: 'requestDeadline',
				onTimeout: { target: 'completionUncertain' },
				invoke: {
					id: 'complete',
					src: 'complete',
					input: ({ context, input }) => ({
						attemptId: input.attemptId,
						now: context.now ?? monotonicNow
					}),
					onDone: (args, enq) => {
						if (!args.guards.withinDeadline(args, args.event.output))
							return { target: 'completionUncertain' }
						const { parent } = args
						enq.sendTo(parent, { type: 'OAUTH_RETURNED' })
						return { target: 'idle' }
					},
					onError: { target: 'completionUncertain' }
				}
			},
			completionUncertain: {
				meta: {
					message: configuration.messages.failed,
					confirmation: 'uncertain'
				},
				on: {
					BEGIN: ({ event }) => beginAuthorization(event)
				}
			},
			failed: {
				meta: { message: configuration.messages.failed },
				on: {
					BEGIN: ({ event }) => beginAuthorization(event)
				}
			}
		}
	})
	function selectAtprotoView(snapshot: SnapshotFrom<typeof atprotoMachine> | undefined) {
		const metadata = snapshot ? Object.values(snapshot.getMeta()) : []
		return {
			busy: snapshot?.hasTag('busy') === true,
			confirmationRequired: snapshot?.hasTag('confirmation') === true,
			...(metadata.some((meta) => meta?.confirmation === 'uncertain')
				? { confirmation: 'uncertain' satisfies 'uncertain' }
				: {}),
			message: metadata.find((meta) => meta?.message !== undefined)?.message
		}
	}

	return { machine: atprotoMachine, selectView: selectAtprotoView }
}

/** One app-session I/O leaf; callers own drain, settlement and native identity changes. */
export async function clearAtprotoAppSession() {
	const response = await fetch('/api/auth/sign-out', {
		method: 'POST',
		credentials: 'same-origin',
		redirect: 'error',
		cache: 'no-store',
		headers: { 'Content-Type': 'application/json' },
		body: '{}'
	})
	if (!response.ok) {
		void response.body?.cancel().catch(() => {})
		throw new Error('Provider sign-out failed')
	}
	await response.body?.cancel()
}
