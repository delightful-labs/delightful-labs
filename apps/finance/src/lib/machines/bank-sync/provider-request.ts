import { providerResponseSchema } from '#lib/validation/integrations.js'
import type { z } from 'zod'
import { requestRelay } from '#lib/integrations/simplefin-relay.js'
import type { ProviderReply } from '#lib/validation/integrations.js'
import { setup, types, createAsyncLogic } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'

export type { ProviderReply } from '#lib/validation/integrations.js'

export type ProviderRequest = {
	endpoint: string
	accessUrl: string
	discovery: boolean
	traceId: string
}
type Context = ProviderRequest & {
	response: Response | undefined
	payload: unknown
	result: ProviderReply | undefined
}

// A disposable worker owns this root. No Jazz client or passkey is opened here.
const events0 = { REQUEST: types<EventPayload<{ type: 'REQUEST' }, 'REQUEST'>>() }
type NativeEvent0 =
	| import('xstate').InferEvents<typeof events0>
	| import('xstate').DoneActorEvent<
			| import('xstate').OutputFrom<(typeof actors)['request']>
			| import('xstate').OutputFrom<(typeof actors)['decode']>
			| import('xstate').OutputFrom<(typeof actors)['validate']>
	  >
	| import('xstate').ErrorActorEvent
	| import('xstate').AfterEvent
	| import('xstate').DoneStateEvent
	| import('xstate').SnapshotEvent
	| import('xstate').TimeoutEvent
	| import('xstate').ActorTimeoutEvent
	| import('xstate').ErrorPlatformEvent
const actors = {
	request: createAsyncLogic<Response, ProviderRequest>({
		run: ({ input, signal }) =>
			requestRelay(
				input.endpoint,
				{
					operation: input.discovery ? 'discover' : 'sync',
					url: input.accessUrl
				},
				signal,
				input.traceId
			)
	}),
	decode: createAsyncLogic<unknown, Response>({ run: ({ input }) => input.json() }),
	validate: createAsyncLogic<z.output<typeof providerResponseSchema>, { payload: unknown }>({
		run: async ({ input }) => providerResponseSchema.parse(input.payload)
	})
}
export const providerRequestMachine = setup({
	schemas: {
		context: types<Context>(),
		events: events0,
		input: types<ProviderRequest>(),
		output: types<ProviderReply>(),
		children: {
			request: types<import('xstate').ActorRefFrom<(typeof actors)['request']>>(),
			decode: types<import('xstate').ActorRefFrom<(typeof actors)['decode']>>(),
			validate: types<import('xstate').ActorRefFrom<(typeof actors)['validate']>>()
		}
	},
	actors
}).createMachine({
	id: 'bank-provider-request',
	initial: 'requesting',
	context: ({ input }) => ({
		...input,
		response: undefined,
		payload: undefined,
		result: undefined
	}),
	output: ({ context }) => {
		if (!context.result) throw new Error('missing-provider-result')
		return context.result
	},
	states: {
		requesting: {
			invoke: {
				src: 'request',
				input: ({ context }) => context,
				onDone: (args) => {
					const { event } = args
					if (!event.output.ok) {
						return {
							target: 'failed',
							context: {
								accessUrl: '',
								result: { ok: false, stage: 'http', status: event.output.status }
							}
						}
					}
					return { target: 'decoding', context: { response: event.output, accessUrl: '' } }
				},
				onError: () => {
					return { target: 'failed', context: { result: { ok: false, stage: 'request' } } }
				}
			}
		},
		decoding: {
			invoke: {
				src: 'decode',
				input: ({ context }) => {
					if (!context.response) throw new Error('missing-provider-response')
					return context.response
				},
				onDone: (args) => {
					return {
						target: 'validating',
						context: { payload: args.event.output, response: undefined }
					}
				},
				onError: () => {
					return { target: 'failed', context: { result: { ok: false, stage: 'decode' } } }
				}
			}
		},
		validating: {
			invoke: {
				src: 'validate',
				input: ({ context }) => ({ payload: context.payload }),
				onDone: (args) => {
					return {
						target: 'complete',
						context: { result: { ok: true, response: args.event.output } }
					}
				},
				onError: () => {
					return { target: 'failed', context: { result: { ok: false, stage: 'validation' } } }
				}
			}
		},
		complete: {
			type: 'final',
			entry: () => {
				return { context: { payload: undefined } }
			}
		},
		failed: {
			type: 'final',
			entry: () => {
				return { context: { accessUrl: '', response: undefined, payload: undefined } }
			}
		}
	}
})
