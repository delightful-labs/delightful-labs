import { createAsyncLogic, setup, types, type ActorRefFrom } from 'xstate'
import type { WorkerHostClosed } from 'delightful-local-first/worker/channel/contracts'
import {
	financeGrantDescriptor,
	financeGrantKey,
	financeGrantScopeSchema
} from '../../runtime/worker/grant-binding.js'
import {
	sameFinanceGrantIdentity,
	type FinanceGrantIdentity
} from '../../runtime/worker/grant-protocol.js'
import { prepareFinanceSdkCall } from '../../runtime/worker/sdk-call-binding.js'
import type {
	FinanceSdkCallbackIdentity,
	FinanceSdkCallbackResult
} from './worker-sdk-call-contracts.js'
import type {
	FinanceSdkCallOwnerInput,
	FinanceSdkCallOwnerEvent,
	FinanceSdkCallOutput
} from './worker-sdk-call-owner-contracts.js'

type Payload<Kind extends FinanceSdkCallOwnerEvent['type']> = Omit<
	Extract<FinanceSdkCallOwnerEvent, { type: Kind }>,
	'type'
>
function required<Value>(value: Value | undefined): Value {
	if (value === undefined) throw new Error('Missing Finance SDK callback resource')
	return value
}
function sameCallback(left: FinanceSdkCallbackIdentity, right: FinanceSdkCallbackIdentity) {
	return left.runtimeId === right.runtimeId && left.requestId === right.requestId
}
/** Pure capture; no callback registration, grant admission or native effect. */
function selectedInput(input: FinanceSdkCallOwnerInput): FinanceSdkCallOwnerInput {
	const {
		prepared: source,
		origin: sourceOrigin,
		grant: sourceGrant,
		closeRequestId,
		grantTo,
		reportTo,
		custody
	} = input
	let origin: URL
	try {
		origin = new URL(sourceOrigin)
	} catch {
		throw new Error('Invalid Finance SDK callback origin')
	}
	if (
		sourceOrigin.length > 8192 ||
		!['http:', 'https:'].includes(origin.protocol) ||
		origin.username ||
		origin.password
	)
		throw new Error('Invalid Finance SDK callback origin')
	const prepared = prepareFinanceSdkCall({
		identity: source.identity,
		operation: source.call.request,
		origin: origin.origin,
		onBrokerResult: source.call.settle
	})
	const grant = {
		runtimeId: financeGrantScopeSchema.parse(sourceGrant.runtimeId),
		grantId: financeGrantScopeSchema.parse(sourceGrant.grantId),
		acquisitionId: financeGrantScopeSchema.parse(sourceGrant.acquisitionId)
	}
	if (
		grant.runtimeId !== prepared.identity.runtimeId ||
		source.call.requestId !== prepared.identity.requestId ||
		source.payloadBytes !== prepared.payloadBytes ||
		financeGrantKey(grant.runtimeId, financeGrantDescriptor(source.descriptor, origin.origin)) !==
			financeGrantKey(grant.runtimeId, prepared.descriptor) ||
		!financeGrantScopeSchema.safeParse(closeRequestId).success ||
		typeof grantTo?.send !== 'function' ||
		typeof reportTo?.send !== 'function' ||
		typeof custody?.recordStopResult !== 'function' ||
		typeof custody.deliver !== 'function'
	)
		throw new Error('Invalid Finance SDK callback input')
	return {
		prepared,
		origin: origin.origin,
		grant,
		closeRequestId,
		grantTo,
		reportTo,
		custody: { recordStopResult: custody.recordStopResult, deliver: custody.deliver }
	}
}

/** One population-admitted callback, not a root or an SDK promise facade.
 * Admission/physical intake bounds and grant ownership belong to the population.
 * The native root retains the shared keeper before this child is created. */
export function createFinanceSdkCallOwner() {
	type Context = {
		record: {
			configuration: FinanceSdkCallOwnerInput | undefined
			identity: FinanceSdkCallbackIdentity
			grant: FinanceGrantIdentity
			closeIdentity: WorkerHostClosed
			result: FinanceSdkCallbackResult | undefined
			token: object | undefined
			receipt: WorkerHostClosed | undefined
			output: FinanceSdkCallOutput | undefined
		}
	}
	const deliver = createAsyncLogic<
		void,
		Readonly<{
			configuration: FinanceSdkCallOwnerInput
			result: FinanceSdkCallbackResult
			token: object | undefined
		}>
	>({
		run: async ({ input }) =>
			input.configuration.custody.deliver(
				input.configuration.prepared.identity,
				input.result,
				input.token
			)
	})
	return setup({
		schemas: {
			input: types<FinanceSdkCallOwnerInput>(),
			context: types<Context>(),
			output: types<FinanceSdkCallOutput>(),
			events: {
				GRANT_AVAILABLE: types<Payload<'GRANT_AVAILABLE'>>(),
				BROKER_RESULT: types<Payload<'BROKER_RESULT'>>(),
				ADMISSION_FAULTED: types<Payload<'ADMISSION_FAULTED'>>(),
				SDK_CALLBACK_SETTLED: types<Payload<'SDK_CALLBACK_SETTLED'>>(),
				CANCEL_WAITING: types<Payload<'CANCEL_WAITING'>>(),
				GRANT_CLOSED: types<Payload<'GRANT_CLOSED'>>()
			},
			children: { deliver: types<ActorRefFrom<typeof deliver>>() }
		},
		actors: { deliver },
		guards: {
			hasLiveGrant: ({ context }: { context: Context }) =>
				required(context.record.configuration).grantTo.getSnapshot().status === 'active',
			matchingCallback: ({ context }: { context: Context }, identity: FinanceSdkCallbackIdentity) =>
				sameCallback(context.record.identity, identity),
			matchingGrant: ({ context }: { context: Context }, identity: FinanceGrantIdentity) =>
				sameFinanceGrantIdentity(context.record.grant, identity),
			matchingReceipt: ({ context }: { context: Context }, receipt: WorkerHostClosed) =>
				receipt.scope === context.record.closeIdentity.scope &&
				receipt.requestId === context.record.closeIdentity.requestId,
			requiresGrantClosure: ({ context }: { context: Context }) => {
				const result = required(context.record.result)
				return (
					result.kind === 'failed' ||
					(result.kind === 'interrupted' && result.effectOutcome === 'unknown')
				)
			}
		}
	}).createMachine({
		id: 'finance-sdk-call',
		context: ({ input }) => {
			const configuration = selectedInput(input)
			return {
				record: {
					configuration,
					identity: configuration.prepared.identity,
					grant: configuration.grant,
					closeIdentity: {
						scope: configuration.grant.grantId,
						requestId: configuration.closeRequestId
					},
					result: undefined,
					token: undefined,
					receipt: undefined,
					output: undefined
				}
			}
		},
		initial: 'owning',
		output: ({ context }) => required(context.record.output),
		states: {
			owning: {
				initial: 'waitingForGrant',
				onError: { target: '.blocked' },
				on: {
					SDK_CALLBACK_SETTLED: (args) =>
						args.guards.matchingCallback(args, args.event.identity) ? {} : undefined,
					GRANT_AVAILABLE: (args) =>
						args.guards.matchingGrant(args, args.event.identity) ? {} : undefined,
					CANCEL_WAITING: (args) =>
						args.guards.matchingCallback(args, args.event.identity) ? {} : undefined,
					ADMISSION_FAULTED: (args) =>
						args.guards.matchingCallback(args, args.event.identity) ? {} : undefined,
					GRANT_CLOSED: (args) => {
						if (
							!args.guards.matchingGrant(args, args.event.identity) ||
							!args.guards.matchingReceipt(args, args.event.receipt)
						)
							return
						return {
							context: { record: { ...args.context.record, receipt: { ...args.event.receipt } } }
						}
					}
				},
				states: {
					waitingForGrant: {
						on: {
							GRANT_CLOSED: (args) => {
								if (
									!args.guards.matchingGrant(args, args.event.identity) ||
									!args.guards.matchingReceipt(args, args.event.receipt)
								)
									return
								return {
									target: 'awaitingAdmissionFault',
									context: {
										record: {
											...args.context.record,
											receipt: { ...args.event.receipt },
											result: {
												kind: 'interrupted',
												reason: 'unavailable',
												effectOutcome: 'not-issued'
											}
										}
									}
								}
							},
							GRANT_AVAILABLE: (args, enq) => {
								if (!args.guards.matchingGrant(args, args.event.identity)) return
								const c = required(args.context.record.configuration)
								if (!args.guards.hasLiveGrant(args))
									return {
										target: 'awaitingAdmissionFault',
										context: {
											record: {
												...args.context.record,
												result: {
													kind: 'interrupted',
													reason: 'unavailable',
													effectOutcome: 'not-issued'
												}
											}
										}
									}
								enq(c.custody.recordStopResult, c.prepared.identity, {
									kind: 'interrupted',
									reason: 'closed',
									effectOutcome: c.prepared.call.effect === 'effect' ? 'unknown' : 'not-issued'
								})
								enq.sendTo(c.grantTo, { type: 'REQUEST', call: c.prepared.call })
								return { target: 'issued' }
							},
							CANCEL_WAITING: (args) => {
								if (!args.guards.matchingCallback(args, args.event.identity)) return
								return {
									target: 'delivering',
									context: {
										record: {
											...args.context.record,
											result: {
												kind: 'interrupted',
												reason: args.event.reason,
												effectOutcome: 'not-issued'
											}
										}
									}
								}
							}
						}
					},
					issued: {
						on: {
							GRANT_CLOSED: (args) => {
								if (
									!args.guards.matchingGrant(args, args.event.identity) ||
									!args.guards.matchingReceipt(args, args.event.receipt)
								)
									return
								return {
									target: 'awaitingAdmissionFault',
									context: {
										record: {
											...args.context.record,
											receipt: { ...args.event.receipt },
											result: {
												kind: 'interrupted',
												reason: 'closed',
												effectOutcome:
													required(args.context.record.configuration).prepared.call.effect ===
													'effect'
														? 'unknown'
														: 'not-issued'
											}
										}
									}
								}
							},
							BROKER_RESULT: (args) => {
								if (!args.guards.matchingCallback(args, args.event.identity)) return
								const { result } = args.event,
									r = args.context.record
								const identity = result.kind === 'refused' ? result : result.identity
								if (
									identity.scope !== r.grant.grantId ||
									identity.requestId !== r.identity.requestId
								)
									return
								// Protocol acceptance remains the public broker contract. An
								// opened port needs a retained native token before SDK delivery.
								if (
									result.kind === 'succeeded' &&
									(!required(r.configuration).prepared.call.accept(result.response) ||
										(result.response.type === 'OPENED' && !args.event.token))
								)
									return {
										target: 'blocked',
										context: { record: { ...r, result, token: args.event.token } }
									}
								return {
									target: result.kind === 'succeeded' ? 'delivering' : 'awaitingAdmissionFault',
									context: {
										record: {
											...r,
											result:
												result.kind === 'refused'
													? { ...result }
													: { ...result, identity: { ...result.identity } },
											token: args.event.token
										}
									}
								}
							}
						}
					},
					awaitingAdmissionFault: {
						entry: ({ context }, enq) =>
							enq.sendTo(required(context.record.configuration).reportTo, {
								type: 'SDK_CALL_REQUIRES_FAULT',
								identity: context.record.identity,
								grant: context.record.grant
							}),
						on: {
							ADMISSION_FAULTED: (args) =>
								args.guards.matchingCallback(args, args.event.identity)
									? { target: 'delivering' }
									: undefined
						}
					},
					delivering: {
						type: 'parallel',
						states: {
							nativeDelivery: {
								initial: 'running',
								states: {
									running: {
										invoke: {
											id: 'deliver',
											src: 'deliver',
											input: ({ context }) => ({
												configuration: required(context.record.configuration),
												result: required(context.record.result),
												token: context.record.token
											}),
											onDone: { target: 'finished' },
											onError: { target: '#finance-sdk-call.owning.blocked' }
										}
									},
									finished: { type: 'final' }
								}
							},
							sdkSettlement: {
								initial: 'waiting',
								states: {
									waiting: {
										on: {
											SDK_CALLBACK_SETTLED: (args) =>
												args.guards.matchingCallback(args, args.event.identity)
													? { target: 'observed' }
													: undefined
										}
									},
									observed: { type: 'final' }
								}
							}
						},
						onDone: (args, enq) => {
							enq.sendTo(required(args.context.record.configuration).reportTo, {
								type: 'SDK_CALL_DELIVERED',
								identity: args.context.record.identity,
								grant: args.context.record.grant,
								reservation: args.guards.requiresGrantClosure(args)
									? 'retained-until-close'
									: 'releasable'
							})
							return {
								target: 'checkingRelease',
								context: { record: { ...args.context.record, token: undefined } }
							}
						}
					},
					checkingRelease: {
						type: 'choice',
						choice: (args) => {
							if (args.guards.requiresGrantClosure(args) && !args.context.record.receipt)
								return { target: 'retainingSettlement' }
							return {
								target: '#finance-sdk-call.released',
								context: {
									record: {
										...args.context.record,
										output: {
											kind: 'released',
											identity: args.context.record.identity,
											grant: args.context.record.grant,
											evidence: args.guards.requiresGrantClosure(args)
												? 'grant-closed'
												: 'definitive-result'
										}
									}
								}
							}
						}
					},
					retainingSettlement: {
						on: {
							GRANT_CLOSED: (args) => {
								if (
									!args.guards.matchingGrant(args, args.event.identity) ||
									!args.guards.matchingReceipt(args, args.event.receipt)
								)
									return
								return {
									target: '#finance-sdk-call.released',
									context: {
										record: {
											...args.context.record,
											output: {
												kind: 'released',
												identity: args.context.record.identity,
												grant: args.context.record.grant,
												evidence: 'grant-closed'
											}
										}
									}
								}
							}
						}
					},
					blocked: {
						entry: ({ context }, enq) =>
							enq.sendTo(required(context.record.configuration).reportTo, {
								type: 'SDK_CALL_BLOCKED',
								identity: context.record.identity,
								grant: context.record.grant
							})
					}
				}
			},
			released: {
				type: 'final',
				entry: ({ context }) => ({
					context: {
						record: {
							...context.record,
							configuration: undefined,
							result: undefined,
							token: undefined,
							receipt: undefined
						}
					}
				})
			}
		}
	})
}
