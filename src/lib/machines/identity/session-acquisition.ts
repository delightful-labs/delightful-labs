import {
	types,
	createAsyncLogic,
	setup,
	type ActorRef,
	type Snapshot,
	type SnapshotFrom
} from 'xstate'

import type { EventPayload } from '../../contracts/machine-events.js'
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
	| (Request<Session> &
			Readonly<{
				type: 'ACQUIRE'
			}>)
	| (Request<Session> &
			Readonly<{
				type: 'RETRY_ACQUIRE'
			}>)
	| (Request<Session> &
			Readonly<{
				type: 'RELEASE'
			}>)
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
	requests: Request<Session>[]
	// Terminal attachment tokens are weakly retained to reject late messages without a token leak.
	released: readonly WeakRef<object>[]
	acquisition: {
		session: Session | undefined
	}
}
function validScope(binding: object, scope: SessionScope): boolean {
	return (
		scope.binding === binding && Number.isSafeInteger(scope.generation) && scope.generation >= 0
	)
}
/** Browser host owns this actor beyond its applications. Never stop it to cancel SDK creation. */
export function createSessionAcquisitionMachine<Session extends object>() {
	const actors = {
		open: createAsyncLogic<Session, SessionOpenCapability<Session>>({
			run: ({ input }) => input.open()
		})
	}
	const patches = {
		remember: ({
			context,
			event
		}: {
			context: Context<Session>
			event: SessionOwnerEvent<Session>
		}): Partial<Context<Session>> => ({
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
		}),
		release: ({
			context,
			event
		}: {
			context: Context<Session>
			event: SessionOwnerEvent<Session>
		}): Partial<Context<Session>> => {
			return {
				requests: context.requests.filter(
					(request) => request.scope.attachment !== event.scope.attachment
				),
				released: [
					...context.released.filter(
						(reference) =>
							reference.deref() !== undefined && reference.deref() !== event.scope.attachment
					),
					new WeakRef(event.scope.attachment)
				]
			}
		}
	}
	const model = setup({
		schemas: {
			context: types<Context<Session>>(),
			events: {
				ACQUIRE: types<EventPayload<SessionOwnerEvent<Session>, 'ACQUIRE'>>(),
				RETRY_ACQUIRE: types<EventPayload<SessionOwnerEvent<Session>, 'RETRY_ACQUIRE'>>(),
				RELEASE: types<EventPayload<SessionOwnerEvent<Session>, 'RELEASE'>>()
			},
			input: types<SessionOwnerInput<Session>>()
		},
		actors,
		guards: {
			supplied: ({ context }: { context: Context<Session> }) =>
				context.acquisition.session !== undefined,
			allowedRequest: ({
				context,
				event
			}: {
				context: Context<Session>
				event: SessionOwnerEvent<Session>
			}) => {
				if (
					!validScope(context.binding, event.scope) ||
					context.released.some((reference) => reference.deref() === event.scope.attachment)
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
			newRetry: ({
				context,
				event
			}: {
				context: Context<Session>
				event: SessionOwnerEvent<Session>
			}) => {
				if (
					!validScope(context.binding, event.scope) ||
					context.released.some((reference) => reference.deref() === event.scope.attachment)
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
			allowedRelease: ({
				context,
				event
			}: {
				context: Context<Session>
				event: SessionOwnerEvent<Session>
			}) => {
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
		actions: {}
	})
	return model.createMachine({
		id: 'session-acquisition',
		initial: 'assessing',
		context: ({ input }) => ({
			binding: input.binding,
			capability: input.capability,
			requests: [],
			released: [],
			acquisition: {
				session: input.existing
			}
		}),
		on: {
			RELEASE: (args, enq) => {
				const { event } = args
				if (args.guards.allowedRelease(args)) {
					enq.sendTo(event.replyTo, { type: 'RELEASED', scope: event.scope })
					return {
						context: patches.release(args) satisfies Partial<Context<Session>>
					}
				}
				enq.sendTo(event.replyTo, { type: 'RELEASED', scope: event.scope })
				return {}
			}
		},
		states: {
			assessing: {
				type: 'choice',
				choice: (args) => {
					if (args.guards.supplied(args)) {
						return { target: 'acquired' }
					}
					return { target: 'idle' }
				}
			},
			idle: {
				on: {
					ACQUIRE: (args, enq) => {
						const { event } = args
						if (args.guards.allowedRequest(args)) {
							return {
								target: 'opening',
								context: patches.remember(args) satisfies Partial<Context<Session>>
							}
						}
						enq.sendTo(event.replyTo, {
							type: 'ACQUISITION_FAILED',
							scope: event.scope,
							reason: 'invalidRequest'
						})
						return {}
					},
					RETRY_ACQUIRE: (args, enq) => {
						const { event } = args
						if (args.guards.allowedRequest(args)) {
							return {
								target: 'opening',
								context: patches.remember(args) satisfies Partial<Context<Session>>
							}
						}
						enq.sendTo(event.replyTo, {
							type: 'ACQUISITION_FAILED',
							scope: event.scope,
							reason: 'invalidRequest'
						})
						return {}
					}
				}
			},
			opening: {
				invoke: {
					src: actors.open,
					input: ({ context }) => context.capability,
					onDone: (args, enq) => {
						let context = args.context
						let patch = {}
						patch = {
							...patch,
							acquisition: {
								...context.acquisition,
								session: args.event.output
							}
						}
						context = { ...args.context, ...patch }
						{
							const contextBefore = context
							const session = contextBefore.acquisition.session
							if (session === undefined) throw new Error('Acquired session unavailable')
							for (const request of contextBefore.requests) {
								enq.sendTo(request.replyTo, { type: 'ACQUIRED', scope: request.scope, session })
							}
						}
						return {
							target: 'acquired',
							context: patch satisfies Partial<Context<Session>>
						}
					},
					onError: (args, enq) => {
						for (const request of args.context.requests) {
							enq.sendTo(request.replyTo, {
								type: 'ACQUISITION_FAILED',
								scope: request.scope,
								reason: 'openFailed'
							})
						}
						return { target: 'failed' }
					}
				},
				on: {
					ACQUIRE: (args, enq) => {
						const { event } = args
						if (args.guards.allowedRequest(args)) {
							return {
								context: patches.remember(args) satisfies Partial<Context<Session>>
							}
						}
						enq.sendTo(event.replyTo, {
							type: 'ACQUISITION_FAILED',
							scope: event.scope,
							reason: 'invalidRequest'
						})
						return {}
					},
					RETRY_ACQUIRE: (args, enq) => {
						const { event } = args
						if (args.guards.allowedRequest(args)) {
							return {
								context: patches.remember(args) satisfies Partial<Context<Session>>
							}
						}
						enq.sendTo(event.replyTo, {
							type: 'ACQUISITION_FAILED',
							scope: event.scope,
							reason: 'invalidRequest'
						})
						return {}
					}
				}
			},
			failed: {
				on: {
					ACQUIRE: (args, enq) => {
						const { event } = args
						if (args.guards.allowedRequest(args)) {
							let context = args.context
							let patch = {}
							patch = { ...patch, ...patches.remember(args) }
							context = { ...args.context, ...patch }
							{
								const contextBefore = context
								for (const request of contextBefore.requests) {
									enq.sendTo(request.replyTo, {
										type: 'ACQUISITION_FAILED',
										scope: request.scope,
										reason: 'openFailed'
									})
								}
							}
							return { context: patch satisfies Partial<Context<Session>> }
						}
						enq.sendTo(event.replyTo, {
							type: 'ACQUISITION_FAILED',
							scope: event.scope,
							reason: 'invalidRequest'
						})
						return {}
					},
					RETRY_ACQUIRE: (args, enq) => {
						const { event } = args
						if (args.guards.newRetry(args)) {
							return {
								target: 'opening',
								context: patches.remember(args) satisfies Partial<Context<Session>>
							}
						}
						enq.sendTo(event.replyTo, {
							type: 'ACQUISITION_FAILED',
							scope: event.scope,
							reason: 'invalidRequest'
						})
						return {}
					}
				}
			},
			acquired: {
				on: {
					ACQUIRE: (args, enq) => {
						const { event } = args
						if (args.guards.allowedRequest(args)) {
							let context = args.context
							let patch = {}
							patch = { ...patch, ...patches.remember(args) }
							context = { ...args.context, ...patch }
							{
								const contextBefore = context
								const session = contextBefore.acquisition.session
								if (session === undefined) throw new Error('Acquired session unavailable')
								for (const request of contextBefore.requests) {
									enq.sendTo(request.replyTo, { type: 'ACQUIRED', scope: request.scope, session })
								}
							}
							return { context: patch satisfies Partial<Context<Session>> }
						}
						enq.sendTo(event.replyTo, {
							type: 'ACQUISITION_FAILED',
							scope: event.scope,
							reason: 'invalidRequest'
						})
						return {}
					},
					RETRY_ACQUIRE: (args, enq) => {
						const { event } = args
						if (args.guards.allowedRequest(args)) {
							let context = args.context
							let patch = {}
							patch = { ...patch, ...patches.remember(args) }
							context = { ...args.context, ...patch }
							{
								const contextBefore = context
								const session = contextBefore.acquisition.session
								if (session === undefined) throw new Error('Acquired session unavailable')
								for (const request of contextBefore.requests) {
									enq.sendTo(request.replyTo, { type: 'ACQUIRED', scope: request.scope, session })
								}
							}
							return { context: patch satisfies Partial<Context<Session>> }
						}
						enq.sendTo(event.replyTo, {
							type: 'ACQUISITION_FAILED',
							scope: event.scope,
							reason: 'invalidRequest'
						})
						return {}
					}
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
		? snapshot.context.acquisition.session
		: undefined
}
