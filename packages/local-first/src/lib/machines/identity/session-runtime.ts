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
	SessionRuntimeResult
} from '../../contracts/session-runtime.js'

type Context = {
	input: SessionRuntimeInput
	scope: SessionScope
	resource: SessionRuntimeResource | undefined
	observation: SessionRuntimeObservation | undefined
	observationBinding: object | undefined
	failure: 'acquisition' | 'observation' | undefined
}
type Event =
	| SessionOwnerReply<SessionRuntimeResource>
	| { type: 'CLOSE' | 'RETRY' }
	| { type: 'OBSERVATION_FAILED' | 'OBSERVER_CLOSED' | 'OBSERVER_CLOSE_FAILED'; binding: object }
	| { type: 'OBSERVED'; binding: object; observation: SessionRuntimeObservation }

function required<Value>(value: Value | undefined): Value {
	if (value === undefined) throw new Error('Session runtime resource unavailable')
	return value
}

const actors = {
	acquisition: createSessionAcquisitionMachine<SessionRuntimeResource>(),
	observe: createCallbackLogic<
		{ type: 'CLOSE' },
		{ resource: SessionRuntimeResource; binding: object }
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
	close: createAsyncLogic({ run: ({ input }: { input: SessionRuntimeResource }) => input.close() })
}

/** One host-lifetime owner. CLOSE is a protocol; stopping an actor is not native disposal. */
export const sessionRuntimeMachine = setup({
	schemas: {
		context: types<Context>(),
		input: types<SessionRuntimeInput>(),
		output: types<SessionRuntimeResult>(),
		events: {
			CLOSE: types(),
			RETRY: types(),
			ACQUIRED: types<Omit<Extract<Event, { type: 'ACQUIRED' }>, 'type'>>(),
			ACQUISITION_FAILED: types<Omit<Extract<Event, { type: 'ACQUISITION_FAILED' }>, 'type'>>(),
			RELEASED: types<Omit<Extract<Event, { type: 'RELEASED' }>, 'type'>>(),
			OBSERVED: types<{ binding: object; observation: SessionRuntimeObservation }>(),
			OBSERVATION_FAILED: types<{ binding: object }>(),
			OBSERVER_CLOSED: types<{ binding: object }>(),
			OBSERVER_CLOSE_FAILED: types<{ binding: object }>()
		},
		children: {
			acquisition: types<import('xstate').ActorRefFrom<typeof actors.acquisition>>(),
			observe: types<import('xstate').ActorRefFrom<typeof actors.observe>>(),
			close: types<import('xstate').ActorRefFrom<typeof actors.close>>()
		}
	},
	actors,
	guards: {
		currentObserver: ({ context, event }: { context: Context; event: Event }) =>
			'binding' in event && event.binding === context.observationBinding,
		currentAcquisition: ({ context, event }: { context: Context; event: Event }) =>
			'scope' in event &&
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
	output: ({ context }) =>
		context.failure ? { outcome: 'failed', stage: context.failure } : { outcome: 'closed' },
	invoke: {
		id: 'acquisition',
		src: 'acquisition',
		input: ({ context }) => context.input,
		onError: {
			target: '.ownerFailed',
			context: { observation: undefined, failure: 'acquisition' }
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
					if (!args.guards.currentAcquisition(args) || !args.guards.closingAcquisition(args)) return
					return { target: 'closed' }
				}
			},
			states: {
				active: {},
				stopping: {
					entry: ({ context, self }, enq) =>
						enq.sendTo('acquisition', { type: 'CANCEL_WAIT', scope: context.scope, replyTo: self })
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
				onError: {
					target: '#session-runtime.observerOwnerFailed',
					context: { observation: undefined, failure: 'observation' }
				}
			},
			on: { CLOSE: { target: '.stopping', context: { observation: undefined } } },
			states: {
				observing: {
					on: {
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
				observerFailed: { on: { RETRY: { target: 'reobserving' } } },
				reobserving: {
					entry: (_, enq) => enq.sendTo('observe', { type: 'CLOSE' }),
					on: {
						OBSERVER_CLOSED: (args) =>
							args.guards.currentObserver(args)
								? {
										target: '#session-runtime.bound',
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
								? { target: '#session-runtime.closing' }
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

export type SessionRuntimeSnapshot = SnapshotFrom<typeof sessionRuntimeMachine>

/** Bounded SDK facts; withdrawal is immediate when the owner starts closing or loses observation. */
export function selectSessionRuntimeObservation(snapshot: SessionRuntimeSnapshot) {
	return snapshot.matches({ bound: 'observing' }) ? snapshot.context.observation : undefined
}
