import { sendTo, assign, fromCallback, setup, stateIn } from 'xstate'
import type { ActorRef, Snapshot } from 'xstate'
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
	| Readonly<{ type: 'START'; owner: SessionOwnerRef<Session>; scope: SessionScope }>
	| Readonly<{ type: 'RETRY' | 'SHUTDOWN' }>
	| SessionOwnerReply<Session>
type Event<Session extends object> =
	| SessionStartupEvent<Session>
	| { type: 'OWNER_FAILED' | 'OWNER_OBSERVER_FAILED' }
type Context<Session extends object> = {
	reportTo: SessionStartupInput<Session>['reportTo']
	owner: SessionOwnerRef<Session> | undefined
	scope: SessionScope | undefined
	session: Session | undefined
	reason: SessionFailure | undefined
}

function required<Value>(value: Value | undefined): Value {
	if (value === undefined) throw new Error('Session attachment binding unavailable')
	return value
}

/** Application-scoped attachment. Its owner retains SDK creation and session beyond this actor. */
export function createSessionStartupMachine<Session extends object>() {
	const actors = {
		observeOwner: fromCallback<Event<Session>, SessionOwnerRef<Session>>(({ input, sendBack }) => {
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
		})
	}
	const model = setup<
		Context<Session>,
		Event<Session>,
		typeof actors,
		{},
		{
			reportStarting: undefined
			acquire: undefined
			retryAcquire: undefined
			reportAcquired: undefined
			reportFailure: undefined
			release: undefined
		},
		{ matchingReply: undefined; canRetry: undefined; releasing: undefined },
		never,
		string,
		SessionStartupInput<Session>,
		SessionStartupOutput
	>({
		actors,
		guards: {
			releasing: stateIn({ bound: 'releasing' }),
			matchingReply: ({ context, event }) =>
				(event.type === 'ACQUIRED' ||
					event.type === 'ACQUISITION_FAILED' ||
					event.type === 'RELEASED') &&
				event.scope.binding === context.scope?.binding &&
				event.scope.attachment === context.scope.attachment &&
				event.scope.generation === context.scope.generation,
			canRetry: ({ context }) =>
				context.scope !== undefined && context.scope.generation < Number.MAX_SAFE_INTEGER
		},
		actions: {
			reportStarting: sendTo(
				({ context }) => context.reportTo,
				({ context }): SessionStartupReport<Session> => ({
					type: 'SESSION_STARTING',
					scope: required(context.scope)
				})
			),
			acquire: sendTo(
				({ context }) => required(context.owner),
				({ context, self }) => ({ type: 'ACQUIRE', scope: required(context.scope), replyTo: self })
			),
			retryAcquire: sendTo(
				({ context }) => required(context.owner),
				({ context, self }) => ({
					type: 'RETRY_ACQUIRE',
					scope: required(context.scope),
					replyTo: self
				})
			),
			reportAcquired: sendTo(
				({ context }) => context.reportTo,
				({ context }): SessionStartupReport<Session> => ({
					type: 'SESSION_ACQUIRED',
					scope: required(context.scope),
					session: required(context.session)
				})
			),
			reportFailure: sendTo(
				({ context }) => context.reportTo,
				({ context }): SessionStartupReport<Session> => ({
					type: 'SESSION_STARTUP_FAILED',
					scope: required(context.scope),
					reason: required(context.reason)
				})
			),
			release: sendTo(
				({ context }) => required(context.owner),
				({ context, self }) => ({ type: 'RELEASE', scope: required(context.scope), replyTo: self })
			)
		}
	})
	const replyTransitions = {
		ACQUIRED: {
			guard: 'matchingReply',
			target: 'attached',
			actions: [
				assign({
					session: ({ event }: { event: SessionOwnerReply<Session> }) =>
						event.type === 'ACQUIRED' ? event.session : undefined
				}),
				'reportAcquired'
			]
		},
		ACQUISITION_FAILED: {
			guard: 'matchingReply',
			target: 'failed',
			actions: assign({
				reason: ({ event }: { event: SessionOwnerReply<Session> }) =>
					event.type === 'ACQUISITION_FAILED' ? event.reason : undefined
			})
		}
	} satisfies NonNullable<Parameters<typeof model.createStateConfig>[0]['on']>

	return model.createMachine({
		id: 'session-startup',
		initial: 'waiting',
		context: ({ input }) => ({
			reportTo: input.reportTo,
			owner: undefined,
			scope: undefined,
			session: undefined,
			reason: undefined
		}),
		output: () => ({ outcome: 'closed' }),
		states: {
			waiting: {
				on: {
					START: {
						target: 'bound',
						actions: assign(({ event }) => ({
							owner: event.owner,
							scope: {
								binding: event.scope.binding,
								attachment: event.scope.attachment,
								generation: event.scope.generation
							}
						}))
					},
					SHUTDOWN: 'closed'
				}
			},
			bound: {
				initial: 'requesting',
				invoke: {
					src: 'observeOwner',
					input: ({ context }) => required(context.owner),
					onError: [
						{ guard: 'releasing', target: 'closed' },
						{
							target: 'ownerFailed',
							actions: ['release', assign({ reason: (): SessionFailure => 'ownerFailed' })]
						}
					]
				},
				on: {
					OWNER_FAILED: {
						target: 'ownerFailed',
						actions: assign({ reason: (): SessionFailure => 'ownerFailed' })
					},
					OWNER_OBSERVER_FAILED: {
						target: 'ownerFailed',
						actions: ['release', assign({ reason: (): SessionFailure => 'ownerFailed' })]
					},
					SHUTDOWN: '.releasing'
				},
				states: {
					requesting: { entry: ['reportStarting', 'acquire'], on: replyTransitions },
					retrying: { entry: ['reportStarting', 'retryAcquire'], on: replyTransitions },
					attached: {},
					failed: {
						entry: 'reportFailure',
						on: {
							RETRY: {
								guard: 'canRetry',
								target: 'retrying',
								actions: assign(({ context }) => ({
									scope: {
										...required(context.scope),
										generation: required(context.scope).generation + 1
									},
									reason: undefined
								}))
							}
						}
					},
					releasing: {
						entry: [assign({ session: undefined }), 'release'],
						on: {
							RELEASED: { guard: 'matchingReply', target: '#session-startup.closed' },
							OWNER_FAILED: '#session-startup.closed',
							OWNER_OBSERVER_FAILED: '#session-startup.closed',
							SHUTDOWN: {}
						}
					}
				}
			},
			ownerFailed: {
				entry: [assign({ owner: undefined, session: undefined }), 'reportFailure'],
				on: { SHUTDOWN: 'closed' }
			},
			closed: {
				type: 'final',
				entry: assign({ owner: undefined, scope: undefined, session: undefined, reason: undefined })
			}
		}
	})
}
