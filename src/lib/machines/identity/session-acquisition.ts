import { sendTo, enqueueActions, assign, fromPromise, setup } from 'xstate'
import type { ActorRef, Snapshot, SnapshotFrom } from 'xstate'
import type {
	SessionOpenCapability,
	SessionOwnerReply,
	SessionScope
} from '../../contracts/session.js'

type Recipient<Session extends object> = ActorRef<Snapshot<unknown>, SessionOwnerReply<Session>>
type Request<Session extends object> = Readonly<{
	scope: SessionScope
	replyTo: Recipient<Session>
}>
export type SessionOwnerEvent<Session extends object> =
	| (Request<Session> & Readonly<{ type: 'ACQUIRE' }>)
	| (Request<Session> & Readonly<{ type: 'RETRY_ACQUIRE' }>)
	| (Request<Session> & Readonly<{ type: 'RELEASE' }>)
export type SessionOwnerRef<Session extends object> = ActorRef<
	Snapshot<unknown>,
	SessionOwnerEvent<Session>
>
export type SessionOwnerInput<Session extends object> = Readonly<{
	binding: object
	capability: SessionOpenCapability<Session>
	existing?: Session
}>
type Context<Session extends object> = {
	binding: object
	capability: SessionOpenCapability<Session>
	session: Session | undefined
	requests: Request<Session>[]
	// Terminal attachment tokens are weakly retained to reject late messages without a token leak.
	released: WeakSet<object>
}

function validScope(binding: object, scope: SessionScope): boolean {
	return (
		scope.binding === binding && Number.isSafeInteger(scope.generation) && scope.generation >= 0
	)
}

/** Browser host owns this actor beyond its applications. Never stop it to cancel SDK creation. */
export function createSessionAcquisitionMachine<Session extends object>() {
	const actors = {
		open: fromPromise<Session, SessionOpenCapability<Session>>(({ input }) => input.open())
	}
	const model = setup<
		Context<Session>,
		SessionOwnerEvent<Session>,
		typeof actors,
		{},
		{
			remember: undefined
			publishAcquired: undefined
			publishFailure: undefined
			rejectRequest: undefined
			release: undefined
			acknowledgeRelease: undefined
		},
		{
			allowedRequest: undefined
			allowedRelease: undefined
			newRetry: undefined
			supplied: undefined
		},
		never,
		string,
		SessionOwnerInput<Session>
	>({
		actors,
		guards: {
			supplied: ({ context }) => context.session !== undefined,
			allowedRequest: ({ context, event }) => {
				if (
					!validScope(context.binding, event.scope) ||
					context.released.has(event.scope.attachment)
				)
					return false
				const previous = context.requests.find(
					(request) => request.scope.attachment === event.scope.attachment
				)
				return (
					!previous ||
					(previous.replyTo === event.replyTo &&
						event.scope.generation >= previous.scope.generation)
				)
			},
			newRetry: ({ context, event }) => {
				if (
					!validScope(context.binding, event.scope) ||
					context.released.has(event.scope.attachment)
				)
					return false
				const previous = context.requests.find(
					(request) => request.scope.attachment === event.scope.attachment
				)
				return (
					!previous ||
					(previous.replyTo === event.replyTo && event.scope.generation > previous.scope.generation)
				)
			},
			allowedRelease: ({ context, event }) => {
				if (!validScope(context.binding, event.scope)) return false
				const previous = context.requests.find(
					(request) => request.scope.attachment === event.scope.attachment
				)
				return (
					!previous ||
					(previous.replyTo === event.replyTo &&
						event.scope.generation >= previous.scope.generation)
				)
			}
		},
		actions: {
			remember: assign(({ context, event }) => ({
				requests: [
					...context.requests.filter(
						(request) => request.scope.attachment !== event.scope.attachment
					),
					{
						scope: {
							binding: event.scope.binding,
							attachment: event.scope.attachment,
							generation: event.scope.generation
						},
						replyTo: event.replyTo
					}
				]
			})),
			publishAcquired: enqueueActions(({ context, enqueue }) => {
				const session = context.session
				if (session === undefined) throw new Error('Acquired session unavailable')
				for (const request of context.requests) {
					enqueue.sendTo(request.replyTo, { type: 'ACQUIRED', scope: request.scope, session })
				}
			}),
			publishFailure: enqueueActions(({ context, enqueue }) => {
				for (const request of context.requests) {
					enqueue.sendTo(request.replyTo, {
						type: 'ACQUISITION_FAILED',
						scope: request.scope,
						reason: 'openFailed'
					})
				}
			}),
			rejectRequest: sendTo(
				({ event }) => event.replyTo,
				({ event }): SessionOwnerReply<Session> => ({
					type: 'ACQUISITION_FAILED',
					scope: event.scope,
					reason: 'invalidRequest'
				})
			),
			release: assign(({ context, event }) => {
				context.released.add(event.scope.attachment)
				return {
					requests: context.requests.filter(
						(request) => request.scope.attachment !== event.scope.attachment
					)
				}
			}),
			acknowledgeRelease: sendTo(
				({ event }) => event.replyTo,
				({ event }) => ({ type: 'RELEASED', scope: event.scope })
			)
		}
	})

	return model.createMachine({
		id: 'session-acquisition',
		initial: 'assessing',
		context: ({ input }) => ({
			binding: input.binding,
			capability: input.capability,
			session: input.existing,
			requests: [],
			released: new WeakSet()
		}),
		on: {
			RELEASE: [
				{ guard: 'allowedRelease', actions: ['release', 'acknowledgeRelease'] },
				{ actions: 'acknowledgeRelease' }
			]
		},
		states: {
			assessing: { always: [{ guard: 'supplied', target: 'acquired' }, { target: 'idle' }] },
			idle: {
				on: {
					ACQUIRE: [
						{ guard: 'allowedRequest', target: 'opening', actions: 'remember' },
						{ actions: 'rejectRequest' }
					],
					RETRY_ACQUIRE: [
						{ guard: 'allowedRequest', target: 'opening', actions: 'remember' },
						{ actions: 'rejectRequest' }
					]
				}
			},
			opening: {
				invoke: {
					src: 'open',
					input: ({ context }) => context.capability,
					onDone: {
						target: 'acquired',
						actions: [assign({ session: ({ event }) => event.output }), 'publishAcquired']
					},
					onError: { target: 'failed', actions: 'publishFailure' }
				},
				on: {
					ACQUIRE: [{ guard: 'allowedRequest', actions: 'remember' }, { actions: 'rejectRequest' }],
					RETRY_ACQUIRE: [
						{ guard: 'allowedRequest', actions: 'remember' },
						{ actions: 'rejectRequest' }
					]
				}
			},
			failed: {
				on: {
					ACQUIRE: [
						{ guard: 'allowedRequest', actions: ['remember', 'publishFailure'] },
						{ actions: 'rejectRequest' }
					],
					RETRY_ACQUIRE: [
						{ guard: 'newRetry', target: 'opening', actions: 'remember' },
						{ actions: 'rejectRequest' }
					]
				}
			},
			acquired: {
				on: {
					ACQUIRE: [
						{ guard: 'allowedRequest', actions: ['remember', 'publishAcquired'] },
						{ actions: 'rejectRequest' }
					],
					RETRY_ACQUIRE: [
						{ guard: 'allowedRequest', actions: ['remember', 'publishAcquired'] },
						{ actions: 'rejectRequest' }
					]
				}
			}
		}
	})
}

/** Public host integration selector. Acquired means a reference, not SDK identity/readiness. */
export function selectAcquiredSession<Session extends object>(
	snapshot: SnapshotFrom<ReturnType<typeof createSessionAcquisitionMachine<Session>>>
): Session | undefined {
	return snapshot.status === 'active' && snapshot.matches('acquired')
		? snapshot.context.session
		: undefined
}
