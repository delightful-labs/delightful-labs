import { createAsyncLogic, setup, types } from 'xstate'
import { DEFAULT_WORKER_REQUEST_TIMEOUT_MS } from '../../contracts/worker-request.js'
import type {
	WorkerEffectOutcome,
	WorkerPostReceipt,
	WorkerRequestFailureReason,
	WorkerRequestIdentity,
	WorkerRequestInput,
	WorkerRequestReply,
	WorkerRequestResult
} from '../../contracts/worker-request.js'

function required<Value>(value: Value | undefined): Value {
	if (value === undefined) throw new Error('Missing worker request resource')
	return value
}
function sameIdentity(left: WorkerRequestIdentity, right: WorkerRequestIdentity) {
	return (
		left.scope === right.scope &&
		left.requestId === right.requestId &&
		left.sequence === right.sequence
	)
}

/** One channel-admitted request. The channel owns routing/resources; the account
 * operation owns locks and unknown-write custody until a genuine host-close receipt. */
export function createWorkerRequest<Request, Response>() {
	type Call = WorkerRequestInput<Request>
	type Result = WorkerRequestResult<Response>
	type Context = {
		record: {
			call: Call | undefined
			identity: WorkerRequestIdentity
			effect: Call['effect']
			timeoutMs: number
			result: Result | undefined
		}
	}
	const actors = {
		post: createAsyncLogic<WorkerPostReceipt, Call>({
			run: async ({ input }) => input.post(input.request, input.identity)
		})
	}
	return setup({
		schemas: {
			context: types<Context>(),
			input: types<Call>(),
			output: types<Result>(),
			events: {
				REPLY: types<{ reply: WorkerRequestReply<Response> }>(),
				TRANSPORT_FAILED: types<{
					scope: string
					reason: 'closed' | 'unavailable' | 'invalid-reply'
				}>()
			},
			children: { post: types<import('xstate').ActorRefFrom<typeof actors.post>>() }
		},
		actors,
		delays: { deadline: ({ context }) => context.record.timeoutMs },
		guards: {
			validDeadline: ({ context }: { context: Context }) =>
				Number.isSafeInteger(context.record.timeoutMs) &&
				context.record.timeoutMs > 0 &&
				context.record.timeoutMs <= 2_147_483_647,
			matchingReply: ({ context }: { context: Context }, reply: WorkerRequestReply<Response>) =>
				sameIdentity(context.record.identity, reply.identity),
			matchingScope: ({ context }: { context: Context }, report: { scope: string }) =>
				context.record.identity.scope === report.scope
		},
		actions: {
			succeed: ({ context }: { context: Context }, response: Response) => ({
				context: {
					record: {
						...context.record,
						result: {
							kind: 'succeeded',
							identity: context.record.identity,
							response
						} satisfies Result
					}
				}
			}),
			fail: (
				{ context }: { context: Context },
				facts: { reason: WorkerRequestFailureReason; evidence?: WorkerEffectOutcome }
			) => ({
				context: {
					record: {
						...context.record,
						result: {
							kind: 'failed',
							identity: context.record.identity,
							reason: facts.reason,
							effectOutcome:
								context.record.effect === 'query' ? 'not-issued' : (facts.evidence ?? 'unknown')
						} satisfies Result
					}
				}
			})
		}
	}).createMachine({
		id: 'worker-request',
		context: ({ input }) => ({
			record: {
				call: input,
				identity: input.identity,
				effect: input.effect,
				timeoutMs: input.timeoutMs ?? DEFAULT_WORKER_REQUEST_TIMEOUT_MS,
				result: undefined
			}
		}),
		initial: 'admitting',
		output: ({ context }) => required(context.record.result),
		states: {
			admitting: {
				type: 'choice',
				choice: (args) => {
					if (args.guards.validDeadline(args)) return { target: 'pending' }
					return {
						target: 'failed',
						context: args.actions.fail(args, { reason: 'rejected', evidence: 'not-issued' }).context
					}
				}
			},
			pending: {
				initial: 'posting',
				timeout: 'deadline',
				onTimeout: (args) => ({
					target: 'failed',
					context: args.actions.fail(args, { reason: 'timeout' }).context
				}),
				onError: (args) => ({
					target: 'failed',
					context: args.actions.fail(args, { reason: 'unavailable' }).context
				}),
				on: {
					REPLY: (args) => {
						const { reply } = args.event
						if (!args.guards.matchingReply(args, reply)) return
						if (reply.kind === 'succeeded')
							return {
								target: 'succeeded',
								context: args.actions.succeed(args, reply.response).context
							}
						return {
							target: 'failed',
							context: args.actions.fail(args, {
								reason: reply.reason,
								evidence: reply.effectOutcome
							}).context
						}
					},
					TRANSPORT_FAILED: (args) => {
						if (!args.guards.matchingScope(args, args.event)) return
						return {
							target: 'failed',
							context: args.actions.fail(args, { reason: args.event.reason }).context
						}
					}
				},
				states: {
					posting: {
						invoke: {
							id: 'post',
							src: 'post',
							input: ({ context }) => required(context.record.call),
							onDone: (args) => {
								const receipt = args.event.output
								if (receipt.kind === 'posted') return { target: 'awaitingReply' }
								return {
									target: '#worker-request.failed',
									context: args.actions.fail(args, {
										reason: receipt.reason,
										evidence: 'not-issued'
									}).context
								}
							},
							onError: (args) => ({
								target: '#worker-request.failed',
								context: args.actions.fail(args, { reason: 'unavailable' }).context
							})
						}
					},
					awaitingReply: {}
				}
			},
			succeeded: {
				type: 'final',
				entry: ({ context }) => ({ context: { record: { ...context.record, call: undefined } } })
			},
			failed: {
				type: 'final',
				entry: ({ context }) => ({ context: { record: { ...context.record, call: undefined } } })
			}
		}
	})
}
