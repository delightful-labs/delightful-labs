import {
	createAsyncLogic,
	createCallbackLogic,
	matchesState,
	setup,
	types,
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
	SessionRuntimeSignOutRequest
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
	}
	type Event =
		| SessionOwnerReply<SessionRuntimeResource<Capabilities>>
		| { type: 'CLOSE' | 'RETRY' }
		| { type: 'OBSERVATION_FAILED' | 'OBSERVER_CLOSED' | 'OBSERVER_CLOSE_FAILED'; binding: object }
		| { type: 'OBSERVED'; binding: object; observation: SessionRuntimeObservation<Capabilities> }
		| ({ type: 'SIGN_OUT' } & SessionRuntimeSignOutRequest)
		| { type: 'SIGN_OUT_SETTLED'; outcome: 'completed' | 'bindingChanged' | 'failed' }

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
		signOut: createAsyncLogic({
			run: ({
				input
			}: {
				input: { resource: SessionRuntimeResource<Capabilities>; identityBinding: object }
			}) => input.resource.signOut(input.identityBinding)
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
				SIGN_OUT: types<SessionRuntimeSignOutRequest>(),
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
				SIGN_OUT_SETTLED: types<{ outcome: 'completed' | 'bindingChanged' | 'failed' }>()
			},
			children: {
				acquisition: types<import('xstate').ActorRefFrom<typeof actors.acquisition>>(),
				observe: types<import('xstate').ActorRefFrom<typeof actors.observe>>(),
				close: types<import('xstate').ActorRefFrom<typeof actors.close>>(),
				signOut: types<import('xstate').ActorRefFrom<typeof actors.signOut>>()
			}
		},
		states: {
			acquiring: { states: { active: {}, stopping: {} } },
			openFailed: {},
			bound: {
				id: 'session-runtime-bound',
				states: {
					observing: {},
					signingOut: {
						schemas: { input: types<SessionRuntimeSignOutRequest>() },
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
			validSignOutScope: (
				{ context }: { context: Context },
				request: SessionRuntimeSignOutRequest
			) =>
				request.scope.binding === context.input.binding &&
				Number.isSafeInteger(request.scope.attempt) &&
				request.scope.attempt >= 0,
			signingOut: ({ value }: { value: import('xstate').StateValue }) =>
				matchesState({ bound: 'signingOut' }, value),
			closingSignOut: ({ value }: { value: import('xstate').StateValue }) =>
				matchesState({ bound: { signingOut: 'stopping' } }, value),
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
			failure: undefined
		}),
		initial: 'acquiring',
		on: {
			SIGN_OUT: (args, enq) =>
				enq.sendTo(args.event.replyTo, {
					type: 'SESSION_SIGN_OUT_SETTLED',
					scope: args.event.scope,
					outcome: args.guards.signingOut(args) ? 'busy' : 'unavailable'
				})
		},
		output: ({ context }) =>
			context.failure ? { outcome: 'failed', stage: context.failure } : { outcome: 'closed' },
		invoke: {
			id: 'acquisition',
			src: 'acquisition',
			input: ({ context }) => context.input,
			onError: (args) =>
				args.guards.signingOut(args)
					? { context: { observation: undefined, failure: 'acquisition' } }
					: { target: '.ownerFailed', context: { observation: undefined, failure: 'acquisition' } },
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
					ACQUIRED: (args) => {
						if (!args.guards.currentAcquisition(args)) return
						return {
							target: args.guards.closingAcquisition(args) ? 'closing' : 'bound',
							context: { resource: args.event.session, observationBinding: {} }
						}
					},
					ACQUISITION_FAILED: (args) => {
						if (!args.guards.currentAcquisition(args)) return
						return { target: args.guards.closingAcquisition(args) ? 'closed' : 'openFailed' }
					},
					RELEASED: (args) => {
						if (!args.guards.currentAcquisition(args) || !args.guards.closingAcquisition(args))
							return
						return { target: 'closed' }
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
					onError: (args) =>
						args.guards.signingOut(args)
							? {
									context: {
										observation: undefined,
										failure: args.context.failure ?? 'observation'
									}
								}
							: {
									target: '#session-runtime-observerOwnerFailed',
									context: {
										observation: undefined,
										failure: args.context.failure ?? 'observation'
									}
								}
				},
				on: { CLOSE: { target: '.stopping', context: { observation: undefined } } },
				states: {
					observing: {
						on: {
							SIGN_OUT: (args, enq) => {
								if (!args.guards.validSignOutScope(args, args.event)) {
									enq.sendTo(args.event.replyTo, {
										type: 'SESSION_SIGN_OUT_SETTLED',
										scope: args.event.scope,
										outcome: 'invalidRequest'
									})
									return {}
								}
								if (args.context.observation?.status !== 'ready') {
									enq.sendTo(args.event.replyTo, {
										type: 'SESSION_SIGN_OUT_SETTLED',
										scope: args.event.scope,
										outcome: 'unavailable'
									})
									return {}
								}
								if (args.context.observation.binding !== args.event.identityBinding) {
									enq.sendTo(args.event.replyTo, {
										type: 'SESSION_SIGN_OUT_SETTLED',
										scope: args.event.scope,
										outcome: 'bindingChanged'
									})
									return {}
								}
								return {
									target: 'signingOut',
									input: {
										scope: { ...args.event.scope },
										identityBinding: args.event.identityBinding,
										replyTo: args.event.replyTo
									}
								}
							},
							OBSERVED: (args) =>
								args.guards.currentObserver(args)
									? { context: { observation: args.event.observation } }
									: undefined,
							OBSERVATION_FAILED: (args) =>
								args.guards.currentObserver(args)
									? { target: 'observerFailed', context: { observation: undefined } }
									: undefined
						}
					},
					signingOut: {
						initial: 'active',
						states: { active: {}, stopping: {} },
						on: {
							SIGN_OUT_SETTLED: (args, enq) => {
								enq.sendTo(args.input.replyTo, {
									type: 'SESSION_SIGN_OUT_SETTLED',
									scope: args.input.scope,
									outcome: args.event.outcome
								})
								if (args.guards.closingSignOut(args))
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
							id: 'signOut',
							src: 'signOut',
							input: ({ context, input }) => ({
								resource: required(context.resource),
								identityBinding: input.identityBinding
							}),
							onDone: ({ event }, enq) =>
								enq.raise({ type: 'SIGN_OUT_SETTLED', outcome: event.output }),
							onError: (_, enq) => enq.raise({ type: 'SIGN_OUT_SETTLED', outcome: 'failed' })
						}
					},
					observerFailed: { on: { RETRY: { target: 'reobserving' } } },
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
							OBSERVER_CLOSE_FAILED: (args) =>
								args.guards.currentObserver(args) ? { target: 'closeFailed' } : undefined
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
	return snapshot.matches({ bound: 'observing' }) ? snapshot.context.observation : undefined
}
