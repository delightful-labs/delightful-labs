import {
	matchesState,
	type StateValue,
	types,
	createCallbackLogic,
	setup,
	type ActorRef,
	type Snapshot
} from 'xstate'

import type { EventPayload } from '../../contracts/machine-events.js'
import type {
	SessionFailure,
	SessionOwnerReply,
	SessionScope,
	SessionStartupOutput,
	SessionStartupReport
} from '../../contracts/session.js'
import type { SessionOwnerRef } from './session-acquisition.js'
export type SessionStartupInput<Session extends object> = Readonly<{
	reportTo: ActorRef<Snapshot<unknown>, SessionStartupReport<Session>>
}>
export type SessionStartupEvent<Session extends object> =
	| Readonly<{
			type: 'START'
			owner: SessionOwnerRef<Session>
			scope: SessionScope
	  }>
	| Readonly<{
			type: 'RETRY' | 'SHUTDOWN'
	  }>
	| SessionOwnerReply<Session>
type Event<Session extends object> =
	| SessionStartupEvent<Session>
	| {
			type: 'OWNER_FAILED' | 'OWNER_OBSERVER_FAILED'
	  }
type Context<Session extends object> = {
	reportTo: SessionStartupInput<Session>['reportTo']
	owner: SessionOwnerRef<Session> | undefined
	scope: SessionScope | undefined
	reason: SessionFailure | undefined
	acquisition: {
		session: Session | undefined
	}
}
function required<Value>(value: Value | undefined): Value {
	if (value === undefined) throw new Error('Session attachment binding unavailable')
	return value
}
/** Application-scoped attachment. Its owner retains SDK creation and session beyond this actor. */
export function createSessionStartupMachine<Session extends object>() {
	const actors = {
		observeOwner: createCallbackLogic<Event<Session>, SessionOwnerRef<Session>>(
			({ input, sendBack }) => {
				try {
					// XState 5.33 does not replay complete() for an already-stopped snapshot.
					// Read public lifecycle status before acquiring the subscription (no context access).
					if (input.getSnapshot().status !== 'active') {
						sendBack({ type: 'OWNER_FAILED' })
						return undefined
					}
					const subscription = input.subscribe({
						error: () => sendBack({ type: 'OWNER_FAILED' }),
						complete: () => sendBack({ type: 'OWNER_FAILED' })
					})
					return () => subscription.unsubscribe()
				} catch {
					sendBack({ type: 'OWNER_OBSERVER_FAILED' })
					return undefined
				}
			}
		)
	}
	const model = setup({
		schemas: {
			context: types<Context<Session>>(),
			events: {
				SHUTDOWN: types<EventPayload<Event<Session>, 'SHUTDOWN'>>(),
				RETRY: types<EventPayload<Event<Session>, 'RETRY'>>(),
				ACQUISITION_FAILED: types<EventPayload<Event<Session>, 'ACQUISITION_FAILED'>>(),
				RELEASED: types<EventPayload<Event<Session>, 'RELEASED'>>(),
				OWNER_FAILED: types<EventPayload<Event<Session>, 'OWNER_FAILED'>>(),
				OWNER_OBSERVER_FAILED: types<EventPayload<Event<Session>, 'OWNER_OBSERVER_FAILED'>>(),
				START: types<EventPayload<Event<Session>, 'START'>>(),
				ACQUIRED: types<EventPayload<Event<Session>, 'ACQUIRED'>>()
			},
			input: types<SessionStartupInput<Session>>(),
			output: types<SessionStartupOutput>()
		},
		actors,
		guards: {
			releasing: ({ value }: { value: StateValue }) => matchesState({ bound: 'releasing' }, value),
			matchingReply: ({ context, event }: { context: Context<Session>; event: Event<Session> }) =>
				(event.type === 'ACQUIRED' ||
					event.type === 'ACQUISITION_FAILED' ||
					event.type === 'RELEASED') &&
				event.scope.binding === context.scope?.binding &&
				event.scope.attachment === context.scope.attachment &&
				event.scope.generation === context.scope.generation,
			canRetry: ({ context }: { context: Context<Session> }) =>
				context.scope !== undefined && context.scope.generation < Number.MAX_SAFE_INTEGER
		},
		actions: {}
	})
	const replyTransitions = model.createStateConfig({
		on: {
			ACQUIRED: (args, enq) => {
				if (!args.guards.matchingReply(args)) return
				const context: Context<Session> = {
					...args.context,
					acquisition: { session: args.event.session }
				}
				enq.sendTo(context.reportTo, {
					type: 'SESSION_ACQUIRED',
					scope: required(context.scope),
					session: required(context.acquisition.session)
				})
				return { target: 'attached', context }
			},
			ACQUISITION_FAILED: (args) => {
				if (!args.guards.matchingReply(args)) return
				return {
					target: 'failed',
					context: { ...args.context, reason: args.event.reason } satisfies Context<Session>
				}
			}
		}
	}).on
	type CompletionEntry = Extract<
		NonNullable<Parameters<typeof model.createStateConfig>[0]['entry']>,
		(...args: never[]) => unknown
	>
	type CompletionArgs = Pick<Parameters<CompletionEntry>[0], 'context' | 'actions'>
	type CompletionQueue = Parameters<CompletionEntry>[1]
	const finalizers = {
		closed: (_args) => {
			return {
				context: {
					owner: undefined,
					scope: undefined,
					reason: undefined,
					acquisition: {
						..._args.context.acquisition,
						session: undefined
					}
				} satisfies Partial<Context<Session>>
			}
		}
	} satisfies Record<
		string,
		(
			args: CompletionArgs,
			enq: CompletionQueue
		) => void | {
			context?: Partial<Context<Session>>
		}
	>

	return model.createMachine({
		id: 'session-startup',
		initial: 'waiting',
		context: ({ input }) => ({
			reportTo: input.reportTo,
			owner: undefined,
			scope: undefined,
			reason: undefined,
			acquisition: {
				session: undefined
			}
		}),
		output: () => ({ outcome: 'closed' }),
		states: {
			waiting: {
				on: {
					START: (args) => {
						const { event } = args
						return {
							target: 'bound',
							context: {
								owner: event.owner,
								scope: {
									binding: event.scope.binding,
									attachment: event.scope.attachment,
									generation: event.scope.generation
								}
							} satisfies Partial<Context<Session>>
						}
					},
					SHUTDOWN: (_args) => {
						return { target: 'closed' }
					}
				}
			},
			bound: {
				initial: 'requesting',
				invoke: {
					src: actors.observeOwner,
					input: ({ context }) => required(context.owner),
					onError: (args, enq) => {
						const { context, self } = args
						if (matchesState({ bound: 'releasing' }, args.value)) {
							return { target: 'closed' }
						}
						enq.sendTo(required(context.owner), {
							type: 'RELEASE',
							scope: required(context.scope),
							replyTo: self
						})
						return {
							target: 'ownerFailed',
							context: { reason: 'ownerFailed' } satisfies Partial<Context<Session>>
						}
					}
				},
				on: {
					OWNER_FAILED: (_args) => {
						return {
							target: 'ownerFailed',
							context: { reason: 'ownerFailed' } satisfies Partial<Context<Session>>
						}
					},
					OWNER_OBSERVER_FAILED: (args, enq) => {
						const { context, self } = args
						enq.sendTo(required(context.owner), {
							type: 'RELEASE',
							scope: required(context.scope),
							replyTo: self
						})
						return {
							target: 'ownerFailed',
							context: { reason: 'ownerFailed' } satisfies Partial<Context<Session>>
						}
					},
					SHUTDOWN: { target: '.releasing' }
				},
				states: {
					requesting: {
						entry: (args, enq) => {
							const { context, self } = args
							enq.sendTo(context.reportTo, {
								type: 'SESSION_STARTING',
								scope: required(context.scope)
							})
							enq.sendTo(required(context.owner), {
								type: 'ACQUIRE',
								scope: required(context.scope),
								replyTo: self
							})
						},
						on: replyTransitions
					},
					retrying: {
						entry: (args, enq) => {
							const { context, self } = args
							enq.sendTo(context.reportTo, {
								type: 'SESSION_STARTING',
								scope: required(context.scope)
							})
							enq.sendTo(required(context.owner), {
								type: 'RETRY_ACQUIRE',
								scope: required(context.scope),
								replyTo: self
							})
						},
						on: replyTransitions
					},
					attached: {},
					failed: {
						entry: (args, enq) => {
							const { context } = args
							enq.sendTo(context.reportTo, {
								type: 'SESSION_STARTUP_FAILED',
								scope: required(context.scope),
								reason: required(context.reason)
							})
						},
						on: {
							RETRY: (args) => {
								if (!args.guards.canRetry(args)) return
								const { context } = args
								return {
									target: 'retrying',
									context: {
										scope: {
											...required(context.scope),
											generation: required(context.scope).generation + 1
										},
										reason: undefined
									} satisfies Partial<Context<Session>>
								}
							}
						}
					},
					releasing: {
						entry: (args, enq) => {
							const { self } = args
							let context = args.context
							let patch = {}
							patch = {
								...patch,
								acquisition: {
									...context.acquisition,
									session: undefined
								}
							}
							context = { ...args.context, ...patch }
							enq.sendTo(required(context.owner), {
								type: 'RELEASE',
								scope: required(context.scope),
								replyTo: self
							})
							return { context: patch satisfies Partial<Context<Session>> }
						},
						on: {
							RELEASED: (args) => {
								if (!args.guards.matchingReply(args)) return

								return { target: '#session-startup.closed' }
							},
							OWNER_FAILED: (_args) => {
								return { target: '#session-startup.closed' }
							},
							OWNER_OBSERVER_FAILED: (_args) => {
								return { target: '#session-startup.closed' }
							},
							SHUTDOWN: {}
						}
					}
				}
			},
			ownerFailed: {
				entry: (args, enq) => {
					let context = args.context
					let patch = {}
					patch = {
						...patch,
						owner: undefined,
						acquisition: {
							...context.acquisition,
							session: undefined
						}
					}
					context = { ...args.context, ...patch }
					enq.sendTo(context.reportTo, {
						type: 'SESSION_STARTUP_FAILED',
						scope: required(context.scope),
						reason: required(context.reason)
					})
					return { context: patch satisfies Partial<Context<Session>> }
				},
				on: {
					SHUTDOWN: (_args) => {
						return { target: 'closed' }
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
