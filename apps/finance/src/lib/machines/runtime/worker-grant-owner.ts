import { createAsyncLogic, setup, types, matchesState, type ActorRefFrom } from 'xstate'
import {
	brokerHostChannelInput,
	createBrokerHostChannel,
	type BrokerHostCall,
	type BrokerHostResult
} from 'delightful-local-first/backend/jazz/worker-broker'
import type {
	WorkerChannelPostReceipt,
	WorkerHostClosed,
	WorkerHostCloseFailure
} from 'delightful-local-first/worker/channel/contracts'
import {
	financeGrantDescriptor,
	financeGrantScopeSchema
} from '../../runtime/worker/grant-binding.js'
import {
	decodeFinanceGrantRequest,
	decodeFinanceGrantReply,
	sameFinanceGrantIdentity,
	type FinanceGrantIdentity
} from '../../runtime/worker/grant-protocol.js'
import type {
	FinanceAcquiredGrant,
	FinanceGrantIssue,
	FinanceGrantOwnerInput,
	FinanceGrantOwnerEvent,
	FinanceGrantOwnerOutput,
	FinanceGrantOwnerReport,
	FinanceGrantUncertain
} from './worker-grant-contracts.js'

type GrantEventPayload<Kind extends FinanceGrantOwnerEvent['type']> = Omit<
	Extract<FinanceGrantOwnerEvent, { type: Kind }>,
	'type'
>

function required<Value>(value: Value | undefined): Value {
	if (value === undefined) throw new Error('Missing Finance grant resource')
	return value
}
function validDelay(value: number) {
	return Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647
}
/** Pure input capture before any post/listener. Invalid initialization reaches
 * the invoking population's error boundary, with no native effect selected. */
function selectedInput(input: FinanceGrantOwnerInput): FinanceGrantOwnerInput {
	const decoded = decodeFinanceGrantRequest(input.request, [])
	if (
		decoded.kind !== 'valid' ||
		input.origin.length > 8192 ||
		!financeGrantScopeSchema.safeParse(input.closeRequestId).success ||
		![input.acquisitionTimeoutMs, input.requestTimeoutMs, input.closeTimeoutMs].every(validDelay) ||
		typeof input.postAcquire !== 'function' ||
		!input.reportTo ||
		typeof input.reportTo.send !== 'function'
	)
		throw new Error('Invalid Finance grant owner input')
	let origin: URL
	try {
		origin = new URL(input.origin)
	} catch {
		throw new Error('Invalid Finance grant owner origin')
	}
	if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password)
		throw new Error('Invalid Finance grant owner origin')
	return {
		request: {
			...decoded.message,
			descriptor: financeGrantDescriptor(decoded.message.descriptor, origin.origin)
		},
		origin: origin.origin,
		closeRequestId: input.closeRequestId,
		acquisitionTimeoutMs: input.acquisitionTimeoutMs,
		requestTimeoutMs: input.requestTimeoutMs,
		closeTimeoutMs: input.closeTimeoutMs,
		postAcquire: input.postAcquire,
		reportTo: input.reportTo
	}
}
function refusal(
	call: BrokerHostCall,
	scope: string,
	reason: 'unavailable' | 'closed' | 'rejected'
) {
	const result: BrokerHostResult = {
		kind: 'refused',
		scope,
		requestId: call.requestId,
		reason,
		effectOutcome: 'not-issued'
	}
	call.settle(result)
}

/** One worker-owned acquisition and its shared broker channel. The population
 * retains unaccepted replies and handles child errors/stop; this factory starts
 * no root and introduces no Window or SDK lifecycle. */
export function createFinanceGrantOwner() {
	const channel = createBrokerHostChannel()
	const post = createAsyncLogic<WorkerChannelPostReceipt, FinanceGrantOwnerInput>({
		run: async ({ input }) => input.postAcquire(input.request)
	})
	type Context = {
		record: {
			input: FinanceGrantOwnerInput | undefined
			identity: FinanceGrantIdentity
			grant: FinanceAcquiredGrant | undefined
			uncertain: FinanceGrantUncertain | undefined
			closeFailure: WorkerHostCloseFailure | undefined
			outcome: FinanceGrantOwnerOutput | undefined
		}
	}
	function issue(context: Context, fact: FinanceGrantIssue): FinanceGrantOwnerReport {
		return { type: 'GRANT_ISSUE', identity: context.record.identity, issue: fact }
	}
	return setup({
		schemas: {
			input: types<FinanceGrantOwnerInput>(),
			context: types<Context>(),
			output: types<FinanceGrantOwnerOutput>(),
			events: {
				GRANT_REPLY: types<GrantEventPayload<'GRANT_REPLY'>>(),
				REQUEST: types<GrantEventPayload<'REQUEST'>>(),
				RETIRE: types(),
				CHANNEL_OVERDUE: types<GrantEventPayload<'CHANNEL_OVERDUE'>>(),
				CHANNEL_BLOCKED: types<GrantEventPayload<'CHANNEL_BLOCKED'>>(),
				CHANNEL_NATIVE_FAILED: types<GrantEventPayload<'CHANNEL_NATIVE_FAILED'>>()
			},
			children: {
				channel: types<ActorRefFrom<typeof channel>>(),
				post: types<ActorRefFrom<typeof post>>()
			}
		},
		actors: { channel, post },
		guards: {
			hasActiveChannel: (_args, ref: ActorRefFrom<typeof channel> | undefined) =>
				ref?.getSnapshot().status === 'active',
			matchingAcquisition: ({ context }: { context: Context }, identity: FinanceGrantIdentity) =>
				sameFinanceGrantIdentity(context.record.identity, identity),
			validGrant: (_args, grant: FinanceAcquiredGrant) =>
				decodeFinanceGrantReply(grant, [grant.dataPort, grant.controlPort]).kind === 'valid',
			matchingClose: ({ context }: { context: Context }, identity: WorkerHostClosed) =>
				identity.scope === context.record.identity.grantId &&
				identity.requestId === required(context.record.input).closeRequestId,
			matchingOperation: ({ context }: { context: Context }, call: BrokerHostCall) => {
				const input = required(context.record.input),
					descriptor = input.request.descriptor
				if (call.request.type !== 'OPEN')
					return descriptor.kind === 'generation' && descriptor.key === call.request.key
				if (descriptor.kind !== 'broker') return false
				try {
					const candidate = financeGrantDescriptor(
						{ kind: 'broker', url: call.request.url, name: call.request.name },
						input.origin
					)
					return (
						candidate.kind === 'broker' &&
						candidate.url === descriptor.url &&
						candidate.name === descriptor.name
					)
				} catch {
					return false
				}
			}
		}
	}).createMachine({
		id: 'finance-native-grant',
		context: ({ input }) => {
			const configuration = selectedInput(input)
			const { runtimeId, grantId, acquisitionId } = configuration.request
			return {
				record: {
					input: configuration,
					identity: { runtimeId, grantId, acquisitionId },
					grant: undefined,
					uncertain: undefined,
					closeFailure: undefined,
					outcome: undefined
				}
			}
		},
		output: ({ context }) => required(context.record.outcome),
		initial: 'acquiring',
		on: {
			GRANT_REPLY: ({ context, event }, enq) =>
				enq.sendTo(required(context.record.input).reportTo, {
					type: 'GRANT_REPLY_REJECTED',
					identity: context.record.identity,
					reply: event.reply
				}),
			REQUEST: ({ context, event, value }, enq) =>
				enq(
					refusal,
					event.call,
					context.record.identity.grantId,
					matchesState({ acquiring: 'waiting' }, value) ? 'unavailable' : 'closed'
				)
		},
		states: {
			acquiring: {
				timeout: ({ context }) => required(context.record.input).acquisitionTimeoutMs,
				onTimeout: ({ context, value }, enq) => {
					if (matchesState({ acquiring: 'overdue' }, value)) return {}
					enq.sendTo(
						required(context.record.input).reportTo,
						issue(context, { kind: 'acquisition-overdue' })
					)
					return { target: '.overdue' }
				},
				invoke: {
					id: 'post',
					src: 'post',
					input: ({ context }) => required(context.record.input),
					onDone: ({ context, event }, enq) => {
						if (event.output.kind !== 'not-issued' || context.record.uncertain !== undefined) return
						enq.sendTo(
							required(context.record.input).reportTo,
							issue(context, { kind: 'acquisition-refused', reason: event.output.reason })
						)
						return {
							target: '#finance-native-grant.closed',
							context: {
								record: {
									...context.record,
									outcome: {
										kind: 'not-issued',
										identity: context.record.identity,
										reason: event.output.reason
									}
								}
							}
						}
					},
					onError: ({ context, value }, enq) => {
						enq.sendTo(
							required(context.record.input).reportTo,
							issue(context, { kind: 'post-error' })
						)
						return matchesState({ acquiring: 'overdue' }, value) ? {} : { target: '.uncertain' }
					}
				},
				initial: 'waiting',
				on: {
					GRANT_REPLY: (args, enq) => {
						const { context, event, value } = args
						if (!args.guards.matchingAcquisition(args, event.reply)) return
						if (event.reply.type === 'GRANT_READY') {
							if (!args.guards.validGrant(args, event.reply)) return
							return {
								target: matchesState({ acquiring: 'waiting' }, value)
									? '#finance-native-grant.bound.accepting'
									: '#finance-native-grant.bound.closing',
								context: { record: { ...context.record, grant: { ...event.reply } } }
							}
						}
						if (event.reply.type === 'GRANT_REFUSED') {
							enq.sendTo(
								required(context.record.input).reportTo,
								issue(context, { kind: 'acquisition-refused', reason: event.reply.reason })
							)
							return {
								target: '#finance-native-grant.closed',
								context: {
									record: {
										...context.record,
										outcome: {
											kind: 'not-issued',
											identity: context.record.identity,
											reason: event.reply.reason
										}
									}
								}
							}
						}
						if (context.record.uncertain !== undefined) return {}
						enq.sendTo(
							required(context.record.input).reportTo,
							issue(context, { kind: 'acquisition-uncertain' })
						)
						const update = { record: { ...context.record, uncertain: event.reply } }
						return matchesState({ acquiring: 'overdue' }, value)
							? { context: update }
							: { target: '.uncertain', context: update }
					},
					RETIRE: ({ value }) =>
						matchesState({ acquiring: 'waiting' }, value) ? { target: '.retiring' } : {}
				},
				states: { waiting: {}, retiring: {}, uncertain: {}, overdue: {} }
			},
			bound: {
				entry: ({ context }, enq) =>
					enq.sendTo(required(context.record.input).reportTo, {
						type: 'GRANT_ACQUIRED',
						identity: context.record.identity,
						grant: required(context.record.grant)
					}),
				invoke: {
					id: 'channel',
					src: 'channel',
					input: ({ context, self }) => {
						const configuration = required(context.record.input),
							grant = required(context.record.grant)
						return brokerHostChannelInput(
							grant.dataPort,
							grant.controlPort,
							{ scope: context.record.identity.grantId, requestId: configuration.closeRequestId },
							{
								requestTimeoutMs: configuration.requestTimeoutMs,
								closeTimeoutMs: configuration.closeTimeoutMs,
								onOverdue: () =>
									self.send({
										type: 'CHANNEL_OVERDUE',
										identity: { scope: grant.grantId, requestId: configuration.closeRequestId }
									}),
								onBlocked: () => self.send({ type: 'CHANNEL_BLOCKED', scope: grant.grantId }),
								onCloseFailure: (failure) => self.send({ type: 'CHANNEL_NATIVE_FAILED', failure })
							}
						)
					},
					onDone: (args, enq) => {
						if (!args.guards.matchingClose(args, args.event.output)) return { target: '.blocked' }
						if (matchesState({ bound: 'accepting' }, args.value))
							enq.sendTo(
								required(args.context.record.input).reportTo,
								issue(args.context, { kind: 'channel-closed' })
							)
						return {
							target: '#finance-native-grant.closed',
							context: {
								record: {
									...args.context.record,
									outcome: {
										kind: 'closed',
										identity: args.context.record.identity,
										receipt: args.event.output
									}
								}
							}
						}
					},
					onError: { target: '.blocked' }
				},
				initial: 'accepting',
				on: {
					RETIRE: (args) =>
						matchesState({ bound: 'accepting' }, args.value) &&
						args.guards.hasActiveChannel(args, args.children.channel)
							? { target: '.closing' }
							: {},
					CHANNEL_OVERDUE: (args, enq) => {
						if (!args.guards.matchingClose(args, args.event.identity)) return
						if (
							matchesState({ bound: 'overdue' }, args.value) ||
							matchesState({ bound: 'blocked' }, args.value)
						)
							return {}
						enq.sendTo(
							required(args.context.record.input).reportTo,
							issue(args.context, { kind: 'channel-overdue' })
						)
						return { target: '.overdue' }
					},
					CHANNEL_BLOCKED: ({ context, event, value }) =>
						event.scope !== context.record.identity.grantId
							? undefined
							: matchesState({ bound: 'blocked' }, value)
								? {}
								: { target: '.blocked' },
					CHANNEL_NATIVE_FAILED: (args, enq) => {
						if (!args.guards.matchingClose(args, args.event.failure)) return
						if (args.context.record.closeFailure !== undefined) return {}
						enq.sendTo(
							required(args.context.record.input).reportTo,
							issue(args.context, { kind: 'native-close-failed', failure: args.event.failure })
						)
						const context = { record: { ...args.context.record, closeFailure: args.event.failure } }
						return matchesState({ bound: 'closing' }, args.value) ||
							matchesState({ bound: 'overdue' }, args.value) ||
							matchesState({ bound: 'blocked' }, args.value) ||
							!args.guards.hasActiveChannel(args, args.children.channel)
							? { context }
							: { target: '.closing', context }
					}
				},
				states: {
					accepting: {
						entry: ({ context }, enq) =>
							enq.sendTo(required(context.record.input).reportTo, {
								type: 'GRANT_AVAILABLE',
								identity: context.record.identity
							}),
						on: {
							REQUEST: (args, enq) => {
								if (!args.guards.matchingOperation(args, args.event.call))
									return enq(
										refusal,
										args.event.call,
										args.context.record.identity.grantId,
										'rejected'
									)
								if (!args.guards.hasActiveChannel(args, args.children.channel))
									return enq(
										refusal,
										args.event.call,
										args.context.record.identity.grantId,
										'closed'
									)
								enq.sendTo('channel', args.event)
							}
						}
					},
					closing: { entry: (_, enq) => enq.sendTo('channel', { type: 'CLOSE' }) },
					overdue: {},
					blocked: {
						entry: ({ context }, enq) =>
							enq.sendTo(
								required(context.record.input).reportTo,
								issue(context, { kind: 'channel-blocked' })
							)
					}
				}
			},
			closed: {
				type: 'final',
				entry: ({ context }) => ({
					context: {
						record: {
							...context.record,
							input: undefined,
							grant: undefined,
							uncertain: undefined,
							closeFailure: undefined
						}
					}
				})
			}
		}
	})
}
