import { createCallbackLogic, createAsyncLogic, matchesState, setup, types } from 'xstate'
import { createBrowserWorkerJob } from 'delightful-local-first/worker/browser-job'
import { prepareProviderFetch } from '#lib/integrations/simplefin.js'
import { debugEnabled } from '#lib/diagnostics/logger.js'
import { providerReplySchema } from '#lib/validation/integrations.js'
import type { OperationWork, ProviderResponse } from './types.js'
import type { ProviderRequest } from './provider-request.js'

type Input = { work: OperationWork; accessUrl: string }
export type ProviderFetchResult =
	| { kind: 'replied'; response: ProviderResponse }
	| { kind: 'failed'; reason: 'provider' | 'timeout' }
	| { kind: 'cancelled' }
type Context = { input: Input | undefined; result: ProviderFetchResult }
function admitted(context: Context) {
	if (!context.input) throw new Error('missing-provider-input')
	return context.input
}
const prepare = createAsyncLogic({
	run: ({ input, signal }: { input: Input; signal: AbortSignal }) =>
		prepareProviderFetch(
			input.accessUrl,
			input.work.command.type === 'DISCOVER',
			signal,
			input.work.trace
		)
})
const job = createBrowserWorkerJob<ProviderRequest, ProviderResponse>()
// Diagnostic lifetime follows the actual job, including a blocked native release.
const diagnostics = createCallbackLogic<never, Input>(({ input }) => {
	const started = performance.now()
	input.work.trace.log('provider.worker:start')
	const heartbeat = debugEnabled
		? setInterval(
				() =>
					input.work.trace.log('provider.worker:waiting', {
						durationMs: Math.round(performance.now() - started)
					}),
				10000
			)
		: undefined
	return () => {
		if (heartbeat !== undefined) clearInterval(heartbeat)
	}
})

export const providerFetchMachine = setup({
	schemas: {
		input: types<Input>(),
		context: types<Context>(),
		output: types<ProviderFetchResult>(),
		events: { CANCEL: types() },
		children: { job: types<import('xstate').ActorRefFrom<typeof job>>() }
	},
	actors: { prepare, job, diagnostics }
}).createMachine({
	id: 'provider-fetch',
	initial: 'preparing',
	context: ({ input }) => ({ input, result: { kind: 'cancelled' } }),
	output: ({ context }) => context.result,
	on: {
		CANCEL: { target: '.settled', context: { input: undefined, result: { kind: 'cancelled' } } }
	},
	states: {
		preparing: {
			invoke: {
				src: 'prepare',
				input: ({ context }) => admitted(context),
				onDone: ({ event }) =>
					event.output.kind === 'demo'
						? {
								target: 'settled',
								context: {
									input: undefined,
									result: { kind: 'replied', response: event.output.response }
								}
							}
						: { target: 'requesting' },
				onError: {
					target: 'settled',
					context: { input: undefined, result: { kind: 'failed', reason: 'provider' } }
				}
			}
		},
		requesting: {
			initial: 'working',
			states: {
				working: {
					after: {
						75000: ({ children }, enq) => {
							if (children.job?.getSnapshot().status === 'active')
								enq.sendTo(children.job, { type: 'CANCEL' })
							return { target: 'timingOut' }
						}
					}
				},
				cancelling: { on: { CANCEL: {} } },
				timingOut: {}
			},
			on: {
				CANCEL: ({ children }, enq) => {
					if (children.job?.getSnapshot().status === 'active')
						enq.sendTo(children.job, { type: 'CANCEL' })
					return { target: '.cancelling' }
				}
			},
			invoke: [
				{
					id: 'job',
					src: 'job',
					input: ({ context }) => {
						const { work, accessUrl } = admitted(context)
						return {
							open: () =>
								new Worker(new URL('../../integrations/simplefin.worker.ts', import.meta.url), {
									type: 'module'
								}),
							message: {
								endpoint: new URL('/api/simplefin', globalThis.location.origin).href,
								accessUrl,
								discovery: work.command.type === 'DISCOVER',
								traceId: work.trace.id
							},
							decode: (value: unknown) => {
								const reply = providerReplySchema.parse(value)
								if (!reply.ok) {
									work.trace.log(
										`provider.worker.${reply.stage}.failed`,
										reply.status === undefined ? {} : { status: reply.status }
									)
									throw new Error('provider-failure')
								}
								work.trace.log('provider.worker.response', {
									count: reply.response.accounts.length,
									providerErrors: reply.response.errors.length
								})
								return reply.response
							}
						}
					},
					onDone: ({ context, event, value }, enq) => {
						const trace = admitted(context).work.trace
						const cancelled = matchesState({ requesting: 'cancelling' }, value)
						const timedOut = matchesState({ requesting: 'timingOut' }, value)
						const result: ProviderFetchResult = cancelled
							? { kind: 'cancelled' }
							: timedOut
								? { kind: 'failed', reason: 'timeout' }
								: event.output.kind === 'replied'
									? { kind: 'replied', response: event.output.reply }
									: { kind: 'failed', reason: 'provider' }
						enq(() => {
							if (cancelled) trace.log('provider.worker.cancelled')
							else if (timedOut) trace.log('provider.worker.timeout')
							if (result.kind === 'replied')
								trace.log('provider.worker:done', {
									durationMs: Math.round(event.output.elapsedMs)
								})
							else
								trace.failed(
									'provider.worker:failed',
									new DOMException(
										'provider-failure',
										cancelled ? 'AbortError' : timedOut ? 'TimeoutError' : 'Error'
									)
								)
						})
						return { target: 'settled', context: { input: undefined, result } }
					},
					onError: { target: 'blocked' }
				},
				{
					src: 'diagnostics',
					input: ({ context }) => admitted(context),
					onError: { target: 'blocked' }
				}
			]
		},
		blocked: { on: { CANCEL: {} } },
		settled: { type: 'final' }
	}
})
