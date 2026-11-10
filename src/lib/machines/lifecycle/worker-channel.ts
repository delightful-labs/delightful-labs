import { createAsyncLogic, createCallbackLogic, setup, types } from 'xstate'
import type { ActorRef, ActorRefFrom, Snapshot } from 'xstate'
import { MAX_WORKER_CHANNEL_REQUESTS } from '../../contracts/worker-channel.js'
import { DEFAULT_WORKER_REQUEST_TIMEOUT_MS } from '../../contracts/worker-request.js'
import type {
	WorkerChannelCall,
	WorkerChannelInput,
	WorkerChannelResult,
	WorkerHostClosed
} from '../../contracts/worker-channel.js'
import type { WorkerRequestIdentity, WorkerRequestResult } from '../../contracts/worker-request.js'
import { createWorkerRequest } from './worker-request.js'

function required<Value>(value: Value | undefined): Value {
	if (value === undefined) throw new Error('Missing worker channel resource')
	return value
}
function finiteDelay(value: number) {
	return Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647
}
function boundedId(value: string) {
	return value.length > 0 && value.length <= 128
}
function sameIdentity(left: WorkerRequestIdentity, right: WorkerRequestIdentity) {
	return (
		left.scope === right.scope &&
		left.requestId === right.requestId &&
		left.sequence === right.sequence
	)
}
function closureFault(result: WorkerRequestResult<unknown>) {
	if (result.kind === 'succeeded' || result.reason === 'rejected' || result.reason === 'overloaded')
		return undefined
	return result.reason
}
/** Observer delivery is a native boundary, not an account workflow. A thrown
 * observer did not accept the transferred resource's custody. */
function deliver<Request, Response>(
	call: WorkerChannelCall<Request, Response>,
	result: WorkerChannelResult<Response>,
	discard: (response: Response) => void
) {
	try {
		call.settle(result)
	} catch {
		if (result.kind === 'succeeded') discard(result.response)
	}
}

function createChannelController<Request, Response>() {
	type Input = WorkerChannelInput<Request, Response>
	type Call = WorkerChannelCall<Request, Response>
	type Token = object
	type DataCommand =
		| { type: 'DISCARD'; token: Token }
		| { type: 'REGISTER'; identity: WorkerRequestIdentity; call: Call }
		| {
				type: 'DELIVER'
				token: Token | undefined
				identity: WorkerRequestIdentity
				result: WorkerRequestResult<Response>
		  }
	const request = createWorkerRequest<Request, Response>()
	type Slot = {
		identity: WorkerRequestIdentity
		call: Call
		child: ActorRefFrom<typeof request>
		subscription: ActorRef<Snapshot<unknown>, never>
		replyReceived: boolean
		resourceToken: Token | undefined
	}
	type Report = {
		type: 'REQUEST_DONE'
		identity: WorkerRequestIdentity
		result: WorkerRequestResult<Response>
	}
	const data = createCallbackLogic<DataCommand, Input>(({ input, sendBack, receive }) => {
		// Native resource custody only. The chart selects admission, correlation,
		// delivery and release. Forced stop disposes everything still unclaimed.
		let disposed = false
		const resources = new Map<Token, Response>()
		const observers = new Map<number, { identity: WorkerRequestIdentity; call: Call }>()
		function discard(token: Token) {
			if (!resources.has(token)) return
			const response = resources.get(token)!
			resources.delete(token)
			input.discard(response)
		}
		receive((command) => {
			if (command.type === 'REGISTER') {
				observers.set(command.identity.sequence, command)
				return
			}
			if (command.type === 'DISCARD') {
				discard(command.token)
				return
			}
			const observer = observers.get(command.identity.sequence)
			if (!observer || !sameIdentity(observer.identity, command.identity)) return
			observers.delete(command.identity.sequence)
			if (command.token) {
				if (command.result.kind === 'succeeded') resources.delete(command.token)
				else discard(command.token)
			}
			deliver(observer.call, command.result, input.discard)
		})
		let dispose: (() => void) | undefined
		try {
			dispose = input.listenData((event) => {
				if (disposed) {
					if (event.type === 'REPLY' && event.reply.kind === 'succeeded')
						input.discard(event.reply.response)
					return
				}
				if (event.type === 'TRANSPORT_FAILED') {
					sendBack(event)
					return
				}
				const token = event.reply.kind === 'succeeded' ? {} : undefined
				if (token && event.reply.kind === 'succeeded') resources.set(token, event.reply.response)
				sendBack({ type: 'RESOURCE_REPLY', reply: event.reply, token })
			})
		} catch {
			sendBack({ type: 'TRANSPORT_FAILED', scope: input.scope, reason: 'unavailable' })
		}
		return () => {
			disposed = true
			try {
				dispose?.()
			} finally {
				for (const token of resources.keys()) discard(token)
				for (const observer of observers.values())
					deliver(
						observer.call,
						{
							kind: 'failed',
							identity: observer.identity,
							reason: 'closed',
							effectOutcome: observer.call.effect === 'effect' ? 'unknown' : 'not-issued'
						},
						input.discard
					)
				observers.clear()
			}
		}
	})
	const control = createCallbackLogic<never, Input>(({ input, sendBack }) => {
		try {
			return input.listenControl(sendBack)
		} catch {
			sendBack({ type: 'CLOSE_FAILED', scope: input.scope })
		}
	})
	const close = createAsyncLogic<void, Input>({
		run: async ({ input }) =>
			input.postClose({ scope: input.scope, requestId: input.closeRequestId })
	})
	type Fault = 'closed' | 'timeout' | 'unavailable' | 'invalid-reply'
	type Context = {
		record: {
			configuration: Input | undefined
			scope: string
			closeIdentity: WorkerHostClosed
			maxInFlight: number
			requestTimeoutMs: number
			closeTimeoutMs: number
			sequence: number
			slots: Slot[]
			fault: Fault | undefined
			receipt: WorkerHostClosed | undefined
		}
	}
	return setup({
		schemas: {
			context: types<Context>(),
			input: types<Input>(),
			output: types<WorkerHostClosed>(),
			events: {
				REQUEST: types<{ call: Call }>(),
				CLOSE: types(),
				RESOURCE_REPLY: types<{
					reply: import('../../contracts/worker-request.js').WorkerRequestReply<Response>
					token: Token | undefined
				}>(),
				TRANSPORT_FAILED: types<{ scope: string; reason: Fault }>(),
				HOST_CLOSED: types<{ receipt: WorkerHostClosed }>(),
				CLOSE_FAILED: types<{ scope: string }>(),
				REQUEST_DONE: types<Omit<Report, 'type'>>()
			},
			children: {
				data: types<ActorRefFrom<typeof data>>(),
				control: types<ActorRefFrom<typeof control>>(),
				close: types<ActorRefFrom<typeof close>>()
			}
		},
		actors: { request, data, control, close },
		delays: { closeDeadline: ({ context }) => context.record.closeTimeoutMs },
		guards: {
			validConfiguration: ({ context }: { context: Context }) => {
				const r = context.record
				return (
					boundedId(r.scope) &&
					boundedId(r.closeIdentity.requestId) &&
					Number.isInteger(r.maxInFlight) &&
					r.maxInFlight > 0 &&
					r.maxInFlight <= MAX_WORKER_CHANNEL_REQUESTS &&
					finiteDelay(r.requestTimeoutMs) &&
					finiteDelay(r.closeTimeoutMs)
				)
			},
			matchingScope: ({ context }: { context: Context }, scope: string) =>
				context.record.scope === scope
		}
	}).createMachine({
		id: 'worker-channel-controller',
		context: ({ input }) => ({
			record: {
				configuration: input,
				scope: input.scope,
				closeIdentity: { scope: input.scope, requestId: input.closeRequestId },
				maxInFlight: input.maxInFlight ?? MAX_WORKER_CHANNEL_REQUESTS,
				requestTimeoutMs: input.requestTimeoutMs ?? DEFAULT_WORKER_REQUEST_TIMEOUT_MS,
				closeTimeoutMs: input.closeTimeoutMs ?? DEFAULT_WORKER_REQUEST_TIMEOUT_MS,
				sequence: 0,
				slots: [],
				fault: undefined,
				receipt: undefined
			}
		}),
		initial: 'checking',
		output: ({ context }) => required(context.record.receipt),
		on: {
			REQUEST: ({ context, event }, enq) => {
				enq(
					deliver<Request, Response>,
					event.call,
					{
						kind: 'refused',
						scope: context.record.scope,
						requestId: event.call.requestId,
						reason: 'closed',
						effectOutcome: 'not-issued'
					},
					required(context.record.configuration).discard
				)
			}
		},
		states: {
			checking: {
				type: 'choice',
				choice: (args) =>
					args.guards.validConfiguration(args) ? { target: 'operating' } : { target: 'blocked' }
			},
			operating: {
				invoke: [
					{
						id: 'data',
						src: 'data',
						input: ({ context }) => required(context.record.configuration)
					},
					{
						id: 'control',
						src: 'control',
						input: ({ context }) => required(context.record.configuration)
					}
				],
				onError: { target: 'blocked' },
				initial: 'accepting',
				on: {
					CLOSE: ({ context }) => ({
						context: { record: { ...context.record, fault: context.record.fault ?? 'closed' } }
					}),
					TRANSPORT_FAILED: (args) => {
						if (!args.guards.matchingScope(args, args.event.scope)) return
						return {
							context: {
								record: {
									...args.context.record,
									fault: args.context.record.fault ?? args.event.reason
								}
							}
						}
					},
					CLOSE_FAILED: (args) => {
						if (!args.guards.matchingScope(args, args.event.scope)) return
						return {
							context: {
								record: {
									...args.context.record,
									fault: args.context.record.fault ?? 'unavailable'
								}
							}
						}
					},
					RESOURCE_REPLY: ({ context, event }, enq) => {
						const { reply } = event
						const slot = context.record.slots.find((candidate) =>
							sameIdentity(candidate.identity, reply.identity)
						)
						if (!slot || slot.replyReceived) {
							if (event.token) enq.sendTo('data', { type: 'DISCARD', token: event.token })
							return
						}
						if (reply.kind === 'succeeded' && !slot.call.accept(reply.response)) {
							if (event.token) enq.sendTo('data', { type: 'DISCARD', token: event.token })
							enq.sendTo(slot.child, {
								type: 'REPLY',
								reply: {
									identity: slot.identity,
									kind: 'failed',
									reason: 'invalid-reply',
									effectOutcome: 'unknown'
								}
							})
						} else enq.sendTo(slot.child, { type: 'REPLY', reply })
						return {
							context: {
								record: {
									...context.record,
									slots: context.record.slots.map((candidate) =>
										candidate === slot
											? { ...slot, replyReceived: true, resourceToken: event.token }
											: candidate
									)
								}
							}
						}
					},
					REQUEST_DONE: ({ context, event }, enq) => {
						const slot = context.record.slots.find((candidate) =>
							sameIdentity(candidate.identity, event.identity)
						)
						if (!slot) return
						enq.stop(slot.subscription)
						enq.stop(slot.child)
						enq.sendTo('data', {
							type: 'DELIVER',
							identity: slot.identity,
							result: event.result,
							token: slot.resourceToken
						})
						return {
							context: {
								record: {
									...context.record,
									slots: context.record.slots.filter((candidate) => candidate !== slot),
									fault: context.record.fault ?? closureFault(event.result)
								}
							}
						}
					}
				},
				states: {
					accepting: {
						always: ({ context }) => (context.record.fault ? { target: 'closing' } : undefined),
						on: {
							REQUEST: ({ context, event }, enq) => {
								const r = context.record,
									configuration = required(r.configuration),
									call = event.call
								const overloaded = r.slots.length >= r.maxInFlight
								if (
									overloaded ||
									!boundedId(call.requestId) ||
									r.slots.some((slot) => slot.identity.requestId === call.requestId) ||
									r.sequence >= Number.MAX_SAFE_INTEGER
								) {
									enq(
										deliver<Request, Response>,
										call,
										{
											kind: 'refused',
											scope: r.scope,
											requestId: call.requestId,
											reason: overloaded ? 'overloaded' : 'rejected',
											effectOutcome: 'not-issued'
										},
										configuration.discard
									)
									return
								}
								const identity = {
									scope: r.scope,
									requestId: call.requestId,
									sequence: r.sequence + 1
								}
								enq.sendTo('data', { type: 'REGISTER', identity, call })
								const child = enq.spawn('request', {
									input: {
										identity,
										request: call.request,
										effect: call.effect,
										timeoutMs: r.requestTimeoutMs,
										post: configuration.post
									}
								})
								const subscription = enq.subscribeTo(child, {
									done: (result): Report => ({ type: 'REQUEST_DONE', identity, result }),
									error: (): Report => ({
										type: 'REQUEST_DONE',
										identity,
										result: {
											kind: 'failed',
											identity,
											reason: 'unavailable',
											effectOutcome: call.effect === 'effect' ? 'unknown' : 'not-issued'
										}
									})
								})
								return {
									context: {
										record: {
											...r,
											sequence: identity.sequence,
											slots: [
												...r.slots,
												{
													identity,
													call,
													child,
													subscription,
													replyReceived: false,
													resourceToken: undefined
												}
											]
										}
									}
								}
							}
						}
					},
					closing: {
						entry: ({ context }, enq) => {
							for (const slot of context.record.slots)
								enq.sendTo(slot.child, {
									type: 'TRANSPORT_FAILED',
									scope: context.record.scope,
									reason:
										context.record.fault === 'invalid-reply'
											? 'invalid-reply'
											: context.record.fault === 'unavailable'
												? 'unavailable'
												: 'closed'
								})
						},
						invoke: {
							id: 'close',
							src: 'close',
							input: ({ context }) => required(context.record.configuration),
							onError: { target: '.overdue' }
						},
						initial: 'waiting',
						on: {
							HOST_CLOSED: ({ context, event }) => {
								if (
									event.receipt.scope !== context.record.scope ||
									event.receipt.requestId !== context.record.closeIdentity.requestId
								)
									return
								return {
									target: 'settling',
									context: { record: { ...context.record, receipt: event.receipt } }
								}
							}
						},
						states: {
							waiting: {
								timeout: 'closeDeadline',
								onTimeout: { target: 'overdue' },
								on: {
									CLOSE_FAILED: (args) =>
										args.guards.matchingScope(args, args.event.scope)
											? { target: 'overdue' }
											: undefined
								}
							},
							overdue: {
								entry: ({ context }, enq) =>
									enq(
										required(context.record.configuration).onOverdue,
										context.record.closeIdentity
									)
							}
						}
					},
					settling: {
						always: ({ context }) =>
							context.record.slots.length === 0
								? { target: '#worker-channel-controller.closed' }
								: undefined
					}
				}
			},
			blocked: {
				entry: ({ context }, enq) => {
					const configuration = required(context.record.configuration)
					for (const slot of context.record.slots) {
						enq.stop(slot.subscription)
						enq.stop(slot.child)
					}
					enq(configuration.onBlocked, context.record.scope)
					return { context: { record: { ...context.record, slots: [] } } }
				},
				on: {
					REQUEST: ({ context, event }, enq) =>
						enq(
							deliver<Request, Response>,
							event.call,
							{
								kind: 'refused',
								scope: context.record.scope,
								requestId: event.call.requestId,
								reason: 'unavailable',
								effectOutcome: 'not-issued'
							},
							required(context.record.configuration).discard
						)
				}
			},
			closed: {
				type: 'final',
				entry: ({ context }) => ({
					context: { record: { ...context.record, configuration: undefined } }
				})
			}
		}
	})
}

/** Invoke once per native host scope. Only a genuine independent host-close
 * receipt can complete this owner; timeout/stop are never closure evidence. */
export function createWorkerChannel<Request, Response>() {
	type Input = WorkerChannelInput<Request, Response>
	type Context = { record: { input: Input | undefined; receipt: WorkerHostClosed | undefined } }
	const controller = createChannelController<Request, Response>()
	return setup({
		schemas: {
			context: types<Context>(),
			input: types<Input>(),
			output: types<WorkerHostClosed>(),
			events: { REQUEST: types<{ call: WorkerChannelCall<Request, Response> }>(), CLOSE: types() },
			children: { controller: types<ActorRefFrom<typeof controller>>() }
		},
		actors: { controller }
	}).createMachine({
		id: 'worker-channel',
		context: ({ input }) => ({ record: { input, receipt: undefined } }),
		initial: 'running',
		output: ({ context }) => required(context.record.receipt),
		states: {
			running: {
				invoke: {
					id: 'controller',
					src: 'controller',
					input: ({ context }) => required(context.record.input),
					onDone: ({ context, event }) => ({
						target: 'closed',
						context: { record: { ...context.record, receipt: event.output } }
					}),
					onError: { target: 'blocked' }
				},
				on: {
					REQUEST: ({ event }, enq) => enq.sendTo('controller', event),
					CLOSE: (_, enq) => enq.sendTo('controller', { type: 'CLOSE' })
				}
			},
			blocked: {
				entry: ({ context }, enq) => {
					const input = required(context.record.input)
					enq(input.onBlocked, input.scope)
				},
				on: {
					REQUEST: ({ context, event }, enq) => {
						const input = required(context.record.input)
						enq(
							deliver<Request, Response>,
							event.call,
							{
								kind: 'refused',
								scope: input.scope,
								requestId: event.call.requestId,
								reason: 'unavailable',
								effectOutcome: 'not-issued'
							},
							input.discard
						)
					}
				}
			},
			closed: {
				type: 'final',
				entry: ({ context }) => ({ context: { record: { ...context.record, input: undefined } } })
			}
		}
	})
}
