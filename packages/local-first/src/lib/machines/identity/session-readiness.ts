import type { ActorRefFrom } from 'xstate'
import {
	types,
	createAsyncLogic,
	matchesState,
	createCallbackLogic,
	setup,
	type ActorRef,
	type Snapshot
} from 'xstate'

import type { EventPayload } from '../../contracts/machine-events.js'
import type {
	SessionObservationFailure,
	SessionReadinessCapability,
	SessionReadinessReport,
	SessionReadinessScope,
	SessionStatus
} from '../../contracts/session.js'
export type SessionReadinessInput = Readonly<{
	reportTo: ActorRef<Snapshot<unknown>, SessionReadinessReport>
}>
export type SessionReadinessEvent =
	| Readonly<{
			type: 'BIND'
			scope: SessionReadinessScope
			capability: SessionReadinessCapability
	  }>
	| Readonly<{
			type: 'RETRY'
			scope: SessionReadinessScope
			attempt: number
	  }>
	| Readonly<{
			type: 'REOBSERVE'
			scope: SessionReadinessScope
			observation: number
	  }>
	| Readonly<{
			type: 'SHUTDOWN'
	  }>
type ObservationEvent =
	| {
			type: 'OBSERVED'
			scope: SessionReadinessScope
			observation: number
			status: SessionStatus
			afterRetry: number | undefined
	  }
	| {
			type: 'OBSERVATION_FAILED'
			scope: SessionReadinessScope
			observation: number
			reason: SessionObservationFailure
	  }
type Event = SessionReadinessEvent | ObservationEvent
type Context = {
	reportTo: SessionReadinessInput['reportTo']
	scope: SessionReadinessScope | undefined
	capability: SessionReadinessCapability | undefined
	observation: number
	attempt: number
}
type ObserverInput = {
	scope: SessionReadinessScope
	capability: SessionReadinessCapability
	observation: number
	reportTo: SessionReadinessInput['reportTo']
}
function required<Value>(value: Value | undefined): Value {
	if (value === undefined) throw new Error('Session readiness binding unavailable')
	return value
}
function sameScope(left: SessionReadinessScope, right: SessionReadinessScope | undefined) {
	return left.binding === right?.binding && left.attachment === right.attachment
}
function fresh(value: number, previous: number) {
	return Number.isSafeInteger(value) && value > previous
}
const actors = {
	observe: createCallbackLogic<
		{
			type: 'REFRESH'
			attempt: number
		},
		ObserverInput
	>(({ input, sendBack, receive }) => {
		// Resource-boundary guards only; workflow phases remain in the machine below.
		let active = true
		const publish = (afterRetry: number | undefined) => {
			if (!active) return
			try {
				const status = input.capability.readStatus()
				sendBack({
					type: 'OBSERVED',
					scope: input.scope,
					observation: input.observation,
					status,
					afterRetry
				})
			} catch {
				active = false
				sendBack({
					type: 'OBSERVATION_FAILED',
					scope: input.scope,
					observation: input.observation,
					reason: 'readFailed'
				})
			}
		}
		receive((event) => publish(event.attempt))
		let unsubscribe: (() => void) | undefined
		try {
			unsubscribe = input.capability.subscribe(() => publish(undefined))
		} catch {
			active = false
			sendBack({
				type: 'OBSERVATION_FAILED',
				scope: input.scope,
				observation: input.observation,
				reason: 'subscribeFailed'
			})
		}
		publish(undefined)
		return () => {
			active = false
			try {
				unsubscribe?.()
			} catch {
				input.reportTo.send({
					type: 'SESSION_OBSERVATION_CLEANUP_FAILED',
					scope: input.scope,
					observation: input.observation
				})
			}
		}
	}),
	retry: createAsyncLogic({
		run: ({ input }: { input: SessionReadinessCapability }) => input.retry()
	})
}
/** Host authorizes RETRY only after its workspace drain and mutual exclusion with restoration. */
export function createSessionReadinessMachine() {
	const model = setup({
		schemas: {
			context: types<Context>(),
			children: {
				observer: types<ActorRefFrom<typeof actors.observe>>(),
				retry: types<ActorRefFrom<typeof actors.retry>>()
			},
			events: {
				BIND: types<EventPayload<Event, 'BIND'>>(),
				RETRY: types<EventPayload<Event, 'RETRY'>>(),
				REOBSERVE: types<EventPayload<Event, 'REOBSERVE'>>(),
				SHUTDOWN: types<EventPayload<Event, 'SHUTDOWN'>>(),
				OBSERVED: types<EventPayload<Event, 'OBSERVED'>>(),
				OBSERVATION_FAILED: types<EventPayload<Event, 'OBSERVATION_FAILED'>>()
			},
			input: types<SessionReadinessInput>(),
			output: types<{
				outcome: 'closed'
			}>()
		},
		actors,
		guards: {
			currentObservation: ({ context, event }: { context: Context; event: Event }) =>
				(event.type === 'OBSERVED' || event.type === 'OBSERVATION_FAILED') &&
				sameScope(event.scope, context.scope) &&
				event.observation === context.observation,
			freshRetry: ({ context, event }: { context: Context; event: Event }) =>
				event.type === 'RETRY' &&
				sameScope(event.scope, context.scope) &&
				fresh(event.attempt, context.attempt),
			freshObservation: ({ context, event }: { context: Context; event: Event }) =>
				event.type === 'REOBSERVE' &&
				sameScope(event.scope, context.scope) &&
				fresh(event.observation, context.observation),
			refreshed: ({ context, event }: { context: Context; event: Event }) =>
				event.type === 'OBSERVED' &&
				sameScope(event.scope, context.scope) &&
				event.observation === context.observation &&
				event.afterRetry === context.attempt
		},
		actions: {}
	})
	const retryCommands = model.createStateConfig({
		on: {
			RETRY: (args) => {
				if (!args.guards.freshRetry(args)) return
				return {
					target: 'retrying',
					context: { attempt: args.event.attempt } satisfies Partial<Context>
				}
			}
		}
	})
	type CompletionEntry = Extract<
		NonNullable<Parameters<typeof model.createStateConfig>[0]['entry']>,
		(...args: never[]) => unknown
	>
	type CompletionArgs = Pick<Parameters<CompletionEntry>[0], 'context' | 'actions'>
	type CompletionQueue = Parameters<CompletionEntry>[1]
	const finalizers = {
		closed: (_args) => {
			return {
				context: { capability: undefined, scope: undefined } satisfies Partial<Context>
			}
		}
	} satisfies Record<
		string,
		(args: CompletionArgs, enq: CompletionQueue) => void | { context?: Partial<Context> }
	>

	return model.createMachine({
		id: 'session-readiness',
		initial: 'waiting',
		context: ({ input }) => ({
			reportTo: input.reportTo,
			scope: undefined,
			capability: undefined,
			observation: 0,
			attempt: 0
		}),
		output: () => ({ outcome: 'closed' }),
		states: {
			waiting: {
				on: {
					BIND: (args) => {
						const { event } = args
						return {
							target: 'bound',
							context: {
								scope: { ...event.scope },
								capability: event.capability
							} satisfies Partial<Context>
						}
					},
					SHUTDOWN: (_args) => {
						return { target: 'closed' }
					}
				}
			},
			bound: {
				initial: 'observing',
				invoke: {
					id: 'observer',
					src: actors.observe,
					input: ({ context }) => ({
						scope: required(context.scope),
						capability: required(context.capability),
						observation: context.observation,
						reportTo: context.reportTo
					}),
					onError: (args, enq) => {
						const { context } = args
						enq.sendTo(context.reportTo, {
							type: 'SESSION_OBSERVATION_FAILED',
							scope: required(context.scope),
							observation: context.observation,
							reason: 'observerFailed'
						})
						return { target: '.observerFailed' }
					}
				},
				on: {
					OBSERVED: (args, enq) => {
						if (!args.guards.currentObservation(args)) return
						const { context } = args
						enq.sendTo(
							context.reportTo,
							(({ context, event }): SessionReadinessReport => {
								if (event.type !== 'OBSERVED') throw new Error('Missing observation')
								return {
									type: 'SESSION_STATUS',
									scope: required(context.scope),
									observation: event.observation,
									status: event.status,
									afterRetry: event.afterRetry
								}
							})(args)
						)
					},
					OBSERVATION_FAILED: (args, enq) => {
						if (!args.guards.currentObservation(args)) return
						const { context, event } = args
						enq.sendTo(context.reportTo, {
							type: 'SESSION_OBSERVATION_FAILED',
							scope: required(context.scope),
							observation: context.observation,
							reason: event.type === 'OBSERVATION_FAILED' ? event.reason : 'observerFailed'
						})
						return { target: '.observerFailed' }
					},
					SHUTDOWN: (_args) => {
						return { target: '#session-readiness.closed' }
					}
				},
				states: {
					observing: retryCommands,
					retryFailed: retryCommands,
					observerFailed: {
						entry: (args, enq) => {
							enq.stop(args.children['observer'])
						},
						on: {
							OBSERVED: {},
							OBSERVATION_FAILED: {},
							REOBSERVE: (args) => {
								if (!args.guards.freshObservation(args)) return
								return {
									target: '#session-readiness.bound',
									reenter: true,
									context: { observation: args.event.observation } satisfies Partial<Context>
								}
							}
						}
					},
					refreshing: {
						entry: (args, enq) => {
							enq.sendTo('observer', {
								type: 'REFRESH',
								attempt: args.context.attempt
							})
						},
						on: {
							OBSERVED: (args, enq) => {
								const { context } = args
								if (args.guards.refreshed(args)) {
									enq.sendTo(
										context.reportTo,
										(({ context, event }): SessionReadinessReport => {
											if (event.type !== 'OBSERVED') throw new Error('Missing observation')
											return {
												type: 'SESSION_STATUS',
												scope: required(context.scope),
												observation: event.observation,
												status: event.status,
												afterRetry: event.afterRetry
											}
										})(args)
									)
									return { target: 'observing' }
								}
								return {}
							}
						}
					},
					retrying: {
						initial: 'active',
						entry: (args, enq) => {
							const { context } = args
							enq.sendTo(context.reportTo, {
								type: 'SESSION_RETRY_STARTED',
								scope: required(context.scope),
								attempt: context.attempt
							})
						},
						invoke: {
							id: 'retry',
							src: actors.retry,
							input: ({ context }) => required(context.capability),
							onDone: (args, enq) => {
								const { context } = args
								if (matchesState({ bound: { retrying: 'closing' } }, args.value)) {
									enq.sendTo(context.reportTo, {
										type: 'SESSION_RETRY_SETTLED',
										scope: required(context.scope),
										attempt: context.attempt,
										outcome: 'resolved'
									})

									return { target: '#session-readiness.closed' }
								}
								if (matchesState({ bound: { retrying: 'observerFailed' } }, args.value)) {
									enq.sendTo(context.reportTo, {
										type: 'SESSION_RETRY_SETTLED',
										scope: required(context.scope),
										attempt: context.attempt,
										outcome: 'resolved'
									})
									return { target: '#session-readiness.bound.observerFailed' }
								}
								enq.sendTo(context.reportTo, {
									type: 'SESSION_RETRY_SETTLED',
									scope: required(context.scope),
									attempt: context.attempt,
									outcome: 'resolved'
								})
								return { target: '#session-readiness.bound.refreshing' }
							},
							onError: (args, enq) => {
								const { context } = args
								if (matchesState({ bound: { retrying: 'closing' } }, args.value)) {
									enq.sendTo(context.reportTo, {
										type: 'SESSION_RETRY_SETTLED',
										scope: required(context.scope),
										attempt: context.attempt,
										outcome: 'rejected'
									})

									return { target: '#session-readiness.closed' }
								}
								if (matchesState({ bound: { retrying: 'observerFailed' } }, args.value)) {
									enq.sendTo(context.reportTo, {
										type: 'SESSION_RETRY_SETTLED',
										scope: required(context.scope),
										attempt: context.attempt,
										outcome: 'rejected'
									})
									return { target: '#session-readiness.bound.observerFailed' }
								}
								enq.sendTo(context.reportTo, {
									type: 'SESSION_RETRY_SETTLED',
									scope: required(context.scope),
									attempt: context.attempt,
									outcome: 'rejected'
								})
								return { target: '#session-readiness.bound.retryFailed' }
							}
						},
						on: {
							RETRY: {},
							REOBSERVE: {},
							OBSERVATION_FAILED: (args, enq) => {
								if (!args.guards.currentObservation(args)) return
								const { context, event } = args
								enq.sendTo(context.reportTo, {
									type: 'SESSION_OBSERVATION_FAILED',
									scope: required(context.scope),
									observation: context.observation,
									reason: event.type === 'OBSERVATION_FAILED' ? event.reason : 'observerFailed'
								})
								return { target: '.observerFailed' }
							},
							'xstate.error.actor': (args, enq) => {
								if (args.event.actorId !== 'observer') return
								return ((args, enq) => {
									const { context } = args
									enq.sendTo(context.reportTo, {
										type: 'SESSION_OBSERVATION_FAILED',
										scope: required(context.scope),
										observation: context.observation,
										reason: 'observerFailed'
									})
									return { target: '.observerFailed' }
								})(args, enq)
							},
							SHUTDOWN: { target: '.closing' }
						},
						states: {
							active: {},
							observerFailed: {
								entry: (args, enq) => {
									enq.stop(args.children['observer'])
								},
								on: {
									OBSERVED: {},
									OBSERVATION_FAILED: {},
									'xstate.error.actor': (args) => {
										if (args.event.actorId !== 'observer') return
										return {}
									}
								}
							},
							closing: {
								entry: (args, enq) => {
									enq.stop(args.children['observer'])
								},
								on: {
									SHUTDOWN: {},
									OBSERVED: {},
									OBSERVATION_FAILED: {},
									'xstate.error.actor': (args) => {
										if (args.event.actorId !== 'observer') return
										return {}
									}
								}
							}
						}
					}
				}
			},
			closed: {
				type: 'final',
				entry: finalizers.closed
			}
		}
	})
}
