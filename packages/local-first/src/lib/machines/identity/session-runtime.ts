import {
	createAsyncLogic,
	createCallbackLogic,
	matchesState,
	setup,
	types,
	type ActorFromLogic,
	type SnapshotFrom
} from 'xstate'
import {
	createSessionAcquisitionMachine,
	selectSessionAcquisitionAvailability
} from './session-acquisition.js'
import type { SessionOwnerReply, SessionScope } from '../../contracts/session.js'
import type {
	SessionRuntimeInput,
	SessionRuntimeObservation,
	SessionRuntimeResource,
	SessionRuntimeResult,
	SessionRuntimeChangeRequest,
	SessionRuntimeConnection,
	SessionRuntimeView
} from '../../contracts/session-runtime.js'

function required<Value>(value: Value | undefined): Value {
	if (value === undefined) throw new Error('Session runtime resource unavailable')
	return value
}

/** One host-lifetime owner; app capabilities do not change its lifecycle. */
export function createSessionRuntimeMachine<Capabilities = undefined>() {
	type Context = {
		input: SessionRuntimeInput<Capabilities>
		scope: SessionScope
		resource: SessionRuntimeResource<Capabilities> | undefined
		observation: SessionRuntimeObservation<Capabilities> | undefined
		observationBinding: object | undefined
		failure: 'acquisition' | 'observation' | undefined
		retryRequest: Omit<SessionRuntimeChangeRequest, 'change'> | undefined
	}
	type Event =
		| SessionOwnerReply<SessionRuntimeResource<Capabilities>>
		| { type: 'CLOSE' | 'RETRY' }
		| { type: 'OBSERVATION_FAILED' | 'OBSERVER_CLOSED' | 'OBSERVER_CLOSE_FAILED'; binding: object }
		| { type: 'OBSERVED'; binding: object; observation: SessionRuntimeObservation<Capabilities> }
		| ({ type: 'CHANGE_IDENTITY' } & SessionRuntimeChangeRequest)
		| { type: 'CHANGE_SETTLED'; outcome: 'completed' | 'bindingChanged' | 'failed' }

	const actors = {
		acquisition: createSessionAcquisitionMachine<SessionRuntimeResource<Capabilities>>(),
		observe: createCallbackLogic<
			{ type: 'CLOSE' },
			{ resource: SessionRuntimeResource<Capabilities>; binding: object }
		>(({ input, receive, sendBack }) => {
			let active = true
			let unsubscribe: (() => void) | undefined
			receive(() => {
				active = false
				try {
					unsubscribe?.()
					unsubscribe = undefined
					sendBack({ type: 'OBSERVER_CLOSED', binding: input.binding })
				} catch {
					sendBack({ type: 'OBSERVER_CLOSE_FAILED', binding: input.binding })
				}
			})
			try {
				unsubscribe = input.resource.observe(
					(observation) => {
						if (active) sendBack({ type: 'OBSERVED', binding: input.binding, observation })
					},
					() => {
						if (active) {
							active = false
							sendBack({ type: 'OBSERVATION_FAILED', binding: input.binding })
						}
					}
				)
			} catch {
				active = false
				sendBack({ type: 'OBSERVATION_FAILED', binding: input.binding })
			}
			return () => {
				active = false
				unsubscribe?.()
			}
		}),
		close: createAsyncLogic({
			run: ({ input }: { input: SessionRuntimeResource<Capabilities> }) => input.close()
		}),
		changeIdentity: createAsyncLogic({
			run: ({
				input
			}: {
				input: {
					resource: SessionRuntimeResource<Capabilities>
					change: SessionRuntimeChangeRequest['change']
				}
			}) => input.resource.changeIdentity(input.change)
		})
	}

	return setup({
		schemas: {
			context: types<Context>(),
			input: types<SessionRuntimeInput<Capabilities>>(),
			output: types<SessionRuntimeResult>(),
			events: {
				CLOSE: types(),
				RETRY: types(),
				CHANGE_IDENTITY: types<SessionRuntimeChangeRequest>(),
				ACQUIRED: types<Omit<Extract<Event, { type: 'ACQUIRED' }>, 'type'>>(),
				ACQUISITION_FAILED: types<Omit<Extract<Event, { type: 'ACQUISITION_FAILED' }>, 'type'>>(),
				RELEASED: types<Omit<Extract<Event, { type: 'RELEASED' }>, 'type'>>(),
				OBSERVED: types<{
					binding: object
					observation: SessionRuntimeObservation<Capabilities>
				}>(),
				OBSERVATION_FAILED: types<{ binding: object }>(),
				OBSERVER_CLOSED: types<{ binding: object }>(),
				OBSERVER_CLOSE_FAILED: types<{ binding: object }>()
			},
			internalEvents: {
				CHANGE_SETTLED: types<{ outcome: 'completed' | 'bindingChanged' | 'failed' }>()
			},
			children: {
				acquisition: types<import('xstate').ActorRefFrom<typeof actors.acquisition>>(),
				observe: types<import('xstate').ActorRefFrom<typeof actors.observe>>(),
				close: types<import('xstate').ActorRefFrom<typeof actors.close>>(),
				changeIdentity: types<import('xstate').ActorRefFrom<typeof actors.changeIdentity>>()
			}
		},
		states: {
			acquiring: { states: { active: {}, stopping: {} } },
			openFailed: {},
			bound: {
				id: 'session-runtime-bound',
				states: {
					observing: {},
					changingIdentity: {
						schemas: {
							input: types<
								Omit<SessionRuntimeChangeRequest, 'change'> & {
									operation: SessionRuntimeChangeRequest['change']['operation']
								}
							>()
						},
						states: { active: {}, stopping: {} }
					},
					observerFailed: {},
					reobserving: {},
					stopping: {},
					closeFailed: {}
				}
			},
			closing: { id: 'session-runtime-closing' },
			closeFailed: {},
			ownerFailed: { id: 'session-runtime-ownerFailed' },
			observerOwnerFailed: { id: 'session-runtime-observerOwnerFailed' },
			closed: {}
		},
		actors,
		guards: {
			validChangeScope: ({ context }: { context: Context }, request: SessionRuntimeChangeRequest) =>
				request.scope.binding === context.input.binding &&
				Number.isSafeInteger(request.scope.attempt) &&
				request.scope.attempt >= 0,
			changingIdentity: ({ value }: { value: import('xstate').StateValue }) =>
				matchesState({ bound: 'changingIdentity' }, value),
			closingChange: ({ value }: { value: import('xstate').StateValue }) =>
				matchesState({ bound: { changingIdentity: 'stopping' } }, value),
			currentObserver: ({ context, event }: { context: Context; event: Event }) =>
				'binding' in event && event.binding === context.observationBinding,
			currentAcquisition: ({ context, event }: { context: Context; event: Event }) =>
				(event.type === 'ACQUIRED' ||
					event.type === 'ACQUISITION_FAILED' ||
					event.type === 'RELEASED') &&
				event.scope.binding === context.scope.binding &&
				event.scope.attachment === context.scope.attachment &&
				event.scope.generation === context.scope.generation,
			closingAcquisition: ({ value }: { value: import('xstate').StateValue }) =>
				matchesState({ acquiring: 'stopping' }, value)
		}
	}).createMachine({
		id: 'session-runtime',
		context: ({ input }) => ({
			input,
			scope: { binding: input.binding, attachment: {}, generation: 0 },
			resource: undefined,
			observation: undefined,
			observationBinding: undefined,
			failure: undefined,
			retryRequest: undefined
		}),
		initial: 'acquiring',
		on: {
			CHANGE_IDENTITY: (args, enq) =>
				enq.sendTo(args.event.replyTo, {
					type: 'SESSION_CHANGE_SETTLED',
					scope: args.event.scope,
					operation: args.event.change.operation,
					outcome: args.guards.changingIdentity(args) ? 'busy' : 'unavailable'
				})
		},
		output: ({ context }) =>
			context.failure ? { outcome: 'failed', stage: context.failure } : { outcome: 'closed' },
		invoke: {
			id: 'acquisition',
			src: 'acquisition',
			input: ({ context }) => context.input,
			onError: (args, enq) => {
				if (args.context.retryRequest)
					enq.sendTo(args.context.retryRequest.replyTo, {
						type: 'SESSION_CHANGE_SETTLED',
						scope: args.context.retryRequest.scope,
						operation: 'retry',
						outcome: 'failed'
					})
				return args.guards.changingIdentity(args)
					? { context: { observation: undefined, retryRequest: undefined, failure: 'acquisition' } }
					: {
							target: '.ownerFailed',
							context: { observation: undefined, retryRequest: undefined, failure: 'acquisition' }
						}
			},
			onSnapshot: (args, enq) => {
				if (
					args.guards.closingAcquisition(args) &&
					selectSessionAcquisitionAvailability(args.event.snapshot) !== undefined
				)
					enq.sendTo('acquisition', {
						type: 'CANCEL_WAIT',
						scope: args.context.scope,
						replyTo: args.self
					})
			}
		},
		states: {
			acquiring: {
				initial: 'active',
				entry: ({ context, self }, enq) =>
					enq.sendTo('acquisition', {
						type: context.scope.generation === 0 ? 'ACQUIRE' : 'RETRY_ACQUIRE',
						scope: context.scope,
						replyTo: self
					}),
				on: {
					CLOSE: { target: '.stopping' },
					ACQUIRED: (args, enq) => {
						if (!args.guards.currentAcquisition(args)) return
						if (args.context.retryRequest)
							enq.sendTo(args.context.retryRequest.replyTo, {
								type: 'SESSION_CHANGE_SETTLED',
								scope: args.context.retryRequest.scope,
								operation: 'retry',
								outcome: 'completed'
							})
						return {
							target: args.guards.closingAcquisition(args) ? 'closing' : 'bound',
							context: {
								resource: args.event.session,
								observationBinding: {},
								retryRequest: undefined
							}
						}
					},
					ACQUISITION_FAILED: (args, enq) => {
						if (!args.guards.currentAcquisition(args)) return
						if (args.context.retryRequest)
							enq.sendTo(args.context.retryRequest.replyTo, {
								type: 'SESSION_CHANGE_SETTLED',
								scope: args.context.retryRequest.scope,
								operation: 'retry',
								outcome: 'failed'
							})
						return {
							target: args.guards.closingAcquisition(args) ? 'closed' : 'openFailed',
							context: { retryRequest: undefined }
						}
					},
					RELEASED: (args, enq) => {
						if (!args.guards.currentAcquisition(args) || !args.guards.closingAcquisition(args))
							return
						if (args.context.retryRequest)
							enq.sendTo(args.context.retryRequest.replyTo, {
								type: 'SESSION_CHANGE_SETTLED',
								scope: args.context.retryRequest.scope,
								operation: 'retry',
								outcome: 'failed'
							})
						return { target: 'closed', context: { retryRequest: undefined } }
					}
				},
				states: {
					active: {},
					stopping: {
						entry: ({ context, self }, enq) =>
							enq.sendTo('acquisition', {
								type: 'CANCEL_WAIT',
								scope: context.scope,
								replyTo: self
							})
					}
				}
			},
			openFailed: {
				on: {
					CHANGE_IDENTITY: (args, enq) => {
						if (args.event.change.operation !== 'retry') return
						if (
							!args.guards.validChangeScope(args, args.event) ||
							args.context.scope.generation >= Number.MAX_SAFE_INTEGER
						) {
							enq.sendTo(args.event.replyTo, {
								type: 'SESSION_CHANGE_SETTLED',
								scope: args.event.scope,
								operation: 'retry',
								outcome: 'invalidRequest'
							})
							return {}
						}
						return {
							target: 'acquiring',
							context: {
								retryRequest: { scope: args.event.scope, replyTo: args.event.replyTo },
								scope: { ...args.context.scope, generation: args.context.scope.generation + 1 }
							}
						}
					},
					CLOSE: { target: 'closed' },
					RETRY: ({ context }) => {
						if (context.scope.generation >= Number.MAX_SAFE_INTEGER) return
						return {
							target: 'acquiring',
							context: { scope: { ...context.scope, generation: context.scope.generation + 1 } }
						}
					}
				}
			},
			bound: {
				initial: 'observing',
				invoke: {
					id: 'observe',
					src: 'observe',
					input: ({ context }) => ({
						resource: required(context.resource),
						binding: required(context.observationBinding)
					}),
					onError: (args, enq) => {
						if (args.context.retryRequest)
							enq.sendTo(args.context.retryRequest.replyTo, {
								type: 'SESSION_CHANGE_SETTLED',
								scope: args.context.retryRequest.scope,
								operation: 'retry',
								outcome: 'failed'
							})
						return args.guards.changingIdentity(args)
							? {
									context: {
										observation: undefined,
										retryRequest: undefined,
										failure: args.context.failure ?? 'observation'
									}
								}
							: {
									target: '#session-runtime-observerOwnerFailed',
									context: {
										observation: undefined,
										retryRequest: undefined,
										failure: args.context.failure ?? 'observation'
									}
								}
					}
				},
				on: {
					CLOSE: (args, enq) => {
						if (args.context.retryRequest)
							enq.sendTo(args.context.retryRequest.replyTo, {
								type: 'SESSION_CHANGE_SETTLED',
								scope: args.context.retryRequest.scope,
								operation: 'retry',
								outcome: 'failed'
							})
						return {
							target: '.stopping',
							context: { observation: undefined, retryRequest: undefined }
						}
					}
				},
				states: {
					observing: {
						on: {
							CHANGE_IDENTITY: (args, enq) => {
								if (!args.guards.validChangeScope(args, args.event)) {
									enq.sendTo(args.event.replyTo, {
										type: 'SESSION_CHANGE_SETTLED',
										scope: args.event.scope,
										operation: args.event.change.operation,
										outcome: 'invalidRequest'
									})
									return {}
								}
								if (
									args.event.change.operation !== 'retry' &&
									(!args.event.change.before ||
										(args.context.observation?.status !== 'ready' &&
											args.context.observation?.status !== 'signed-out'))
								) {
									enq.sendTo(args.event.replyTo, {
										type: 'SESSION_CHANGE_SETTLED',
										scope: args.event.scope,
										operation: args.event.change.operation,
										outcome: 'unavailable'
									})
									return {}
								}
								if (
									args.event.change.operation !== 'retry' &&
									(!args.event.change.before ||
										!args.context.observation ||
										!('binding' in args.context.observation) ||
										args.context.observation.status !== args.event.change.before.status ||
										args.context.observation.binding !== args.event.change.before.binding)
								) {
									enq.sendTo(args.event.replyTo, {
										type: 'SESSION_CHANGE_SETTLED',
										scope: args.event.scope,
										operation: args.event.change.operation,
										outcome: 'bindingChanged'
									})
									return {}
								}
								return {
									target: 'changingIdentity',
									input: {
										scope: { ...args.event.scope },
										operation: args.event.change.operation,
										replyTo: args.event.replyTo
									}
								}
							},
							OBSERVED: (args, enq) => {
								if (!args.guards.currentObserver(args)) return
								if (args.context.retryRequest)
									enq.sendTo(args.context.retryRequest.replyTo, {
										type: 'SESSION_CHANGE_SETTLED',
										scope: args.context.retryRequest.scope,
										operation: 'retry',
										outcome: 'completed'
									})
								return { context: { observation: args.event.observation, retryRequest: undefined } }
							},
							OBSERVATION_FAILED: (args, enq) => {
								if (!args.guards.currentObserver(args)) return
								if (args.context.retryRequest)
									enq.sendTo(args.context.retryRequest.replyTo, {
										type: 'SESSION_CHANGE_SETTLED',
										scope: args.context.retryRequest.scope,
										operation: 'retry',
										outcome: 'failed'
									})
								return {
									target: 'observerFailed',
									context: { observation: undefined, retryRequest: undefined }
								}
							}
						}
					},
					changingIdentity: {
						initial: 'active',
						states: { active: {}, stopping: {} },
						on: {
							CHANGE_SETTLED: (args, enq) => {
								enq.sendTo(args.input.replyTo, {
									type: 'SESSION_CHANGE_SETTLED',
									scope: args.input.scope,
									operation: args.input.operation,
									outcome: args.event.outcome
								})
								if (args.guards.closingChange(args))
									return {
										target: args.context.failure ? '#session-runtime-closing' : 'stopping',
										context: { observation: undefined }
									}
								if (args.context.failure)
									return {
										target:
											args.context.failure === 'acquisition'
												? '#session-runtime-ownerFailed'
												: '#session-runtime-observerOwnerFailed'
									}
								return { target: args.context.observation ? 'observing' : 'observerFailed' }
							},
							CLOSE: { target: '.stopping' },
							OBSERVED: (args) =>
								args.guards.currentObserver(args)
									? { context: { observation: args.event.observation } }
									: undefined,
							OBSERVATION_FAILED: (args) =>
								args.guards.currentObserver(args)
									? { context: { observation: undefined } }
									: undefined
						},
						invoke: {
							id: 'changeIdentity',
							src: 'changeIdentity',
							input: ({ context, event }) => {
								if (event.type !== 'CHANGE_IDENTITY')
									throw new Error('Identity command unavailable')
								return { resource: required(context.resource), change: event.change }
							},
							onDone: ({ event }, enq) =>
								enq.raise({ type: 'CHANGE_SETTLED', outcome: event.output }),
							onError: (_, enq) => enq.raise({ type: 'CHANGE_SETTLED', outcome: 'failed' })
						}
					},
					observerFailed: {
						on: {
							RETRY: { target: 'reobserving' },
							CHANGE_IDENTITY: (args, enq) => {
								if (args.event.change.operation !== 'retry') return
								if (!args.guards.validChangeScope(args, args.event)) {
									enq.sendTo(args.event.replyTo, {
										type: 'SESSION_CHANGE_SETTLED',
										scope: args.event.scope,
										operation: 'retry',
										outcome: 'invalidRequest'
									})
									return {}
								}
								return {
									target: 'reobserving',
									context: {
										retryRequest: { scope: args.event.scope, replyTo: args.event.replyTo }
									}
								}
							}
						}
					},
					reobserving: {
						entry: (_, enq) => enq.sendTo('observe', { type: 'CLOSE' }),
						on: {
							OBSERVER_CLOSED: (args) =>
								args.guards.currentObserver(args)
									? {
											target: '#session-runtime-bound',
											reenter: true,
											context: { observationBinding: {} }
										}
									: undefined,
							OBSERVER_CLOSE_FAILED: (args, enq) => {
								if (!args.guards.currentObserver(args)) return
								if (args.context.retryRequest)
									enq.sendTo(args.context.retryRequest.replyTo, {
										type: 'SESSION_CHANGE_SETTLED',
										scope: args.context.retryRequest.scope,
										operation: 'retry',
										outcome: 'failed'
									})
								return { target: 'closeFailed', context: { retryRequest: undefined } }
							}
						}
					},
					stopping: {
						entry: (_, enq) => enq.sendTo('observe', { type: 'CLOSE' }),
						on: {
							OBSERVER_CLOSED: (args) =>
								args.guards.currentObserver(args)
									? { target: '#session-runtime-closing' }
									: undefined,
							OBSERVER_CLOSE_FAILED: (args) =>
								args.guards.currentObserver(args) ? { target: 'closeFailed' } : undefined
						}
					},
					closeFailed: {}
				}
			},
			closing: {
				invoke: {
					id: 'close',
					src: 'close',
					input: ({ context }) => required(context.resource),
					onDone: { target: 'closed', context: { resource: undefined } },
					onError: { target: 'closeFailed' }
				}
			},
			closeFailed: { on: { CLOSE: { target: 'closing' } } },
			ownerFailed: {
				on: { CLOSE: ({ context }) => (context.resource ? { target: 'closing' } : undefined) }
			},
			observerOwnerFailed: { on: { CLOSE: { target: 'closing' } } },
			closed: { type: 'final' }
		}
	})
}

export const sessionRuntimeMachine = createSessionRuntimeMachine()

export type SessionRuntimeSnapshot<Capabilities = undefined> = SnapshotFrom<
	ReturnType<typeof createSessionRuntimeMachine<Capabilities>>
>

/** Bounded facts/capabilities; withdrawal follows the owning session state. */
export function selectSessionRuntimeObservation<Capabilities = undefined>(
	snapshot: SessionRuntimeSnapshot<Capabilities>
) {
	return snapshot.status === 'active' && snapshot.matches({ bound: 'observing' })
		? snapshot.context.observation
		: undefined
}

/** Public host boundary; projects native facts without exposing private resources. */
export function selectSessionRuntimeView<Capabilities>(
	snapshot: SessionRuntimeSnapshot<Capabilities>
): SessionRuntimeView<Capabilities> {
	const observation = selectSessionRuntimeObservation(snapshot)
	const stage =
		snapshot.status === 'error' ||
		snapshot.status === 'stopped' ||
		snapshot.output?.outcome === 'failed' ||
		snapshot.matches('ownerFailed') ||
		snapshot.matches('observerOwnerFailed') ||
		snapshot.matches('closeFailed') ||
		snapshot.matches({ bound: 'closeFailed' })
			? 'failed'
			: snapshot.status === 'done'
				? 'closed'
				: snapshot.matches('acquiring')
					? 'acquiring'
					: snapshot.matches('openFailed')
						? 'openFailed'
						: snapshot.matches({ bound: 'observerFailed' }) ||
							  snapshot.matches({ bound: 'reobserving' })
							? 'observerFailed'
							: snapshot.matches('closing') ||
								  snapshot.matches({ bound: 'stopping' }) ||
								  snapshot.matches({ bound: { changingIdentity: 'stopping' } })
								? 'closing'
								: 'active'
	return {
		stage,
		status:
			observation?.status ??
			(stage === 'failed' || stage === 'openFailed' || stage === 'observerFailed'
				? 'error'
				: stage === 'closed' || stage === 'closing'
					? 'closed'
					: stage === 'active'
						? 'transitioning'
						: 'starting'),
		observation
	}
}

export function createSessionRuntimeConnection<Capabilities>(
	owner: ActorFromLogic<ReturnType<typeof createSessionRuntimeMachine<Capabilities>>>,
	binding: object
): SessionRuntimeConnection<Capabilities> {
	return {
		owner,
		binding,
		view: owner.select(
			(snapshot) => selectSessionRuntimeView(snapshot),
			(left, right) =>
				left.stage === right.stage &&
				left.status === right.status &&
				left.observation === right.observation
		)
	}
}

export function selectSessionRuntimeIdentity(
	view: SessionRuntimeView
): import('../../contracts/session-runtime.js').SessionRuntimeIdentity | undefined {
	const observation = view.observation
	return observation?.status === 'ready' || observation?.status === 'signed-out'
		? { status: observation.status, binding: observation.binding }
		: undefined
}
