import { types, createAsyncLogic, matchesState, setup } from 'xstate'
import { createFinalTransitions } from '../finalize.js'

import type { EventPayload } from '../../contracts/machine-events.js'
import { restorationMachine } from './restoration.js'
import type { RestorationCapability, RestorationReport } from '../../contracts/restoration.js'
function required<Value>(value: Value | undefined): Value {
	if (value === undefined) throw new Error('Missing recovery resource')
	return value
}
export type RecoverySession = {
	getSnapshot: () => {
		status: string
		account?:
			| {
					id: string
			  }
			| undefined
	}
}
type Session = RecoverySession
export type RecoveryRestorationBinding = Readonly<{
	binding: object
	capability: RestorationCapability
	/** Total, synchronous, idempotent release of this binding's references; never SDK I/O. */
	invalidate: () => void
}>
export type RecoveryNavigation = {
	origin: string
	destination: string
	identity: string
}
export type RecoveryRequest =
	| {
			kind: 'restore'
			phrase: string
			origin: string
			destination: string
	  }
	| ({
			kind: 'navigate'
	  } & RecoveryNavigation)
export type RecoveryResult =
	| {
			outcome: 'invalid' | 'restoreFailed' | 'restored' | 'closed'
			mutation: 'notStarted' | 'settled'
	  }
	| {
			outcome: 'navigationFailed'
			mutation: 'notStarted' | 'settled'
			navigation: RecoveryNavigation | undefined
	  }
	| {
			outcome: 'restorationChildFailed'
			/** A permit allows issue; a child crash cannot establish mutation settlement. */
			mutation: 'notStarted' | 'unknown'
	  }
export type RecoveryNotice =
	| {
			type: 'RECOVERY_VALIDATED'
			attempt: number
	  }
	| {
			type: 'RECOVERY_DRAIN_REQUESTED'
			attempt: number
	  }
type Input = {
	attempt: number
	request: RecoveryRequest
	session: Session
	restorationBinding: RecoveryRestorationBinding | undefined
	readHref: () => string
	navigate: (destination: string) => Promise<void>
}
type Context = {
	attempt: number
	request: RecoveryRequest | undefined
	session: Session
	restorationBinding: RecoveryRestorationBinding | undefined
	readHref: () => string
	navigate: Input['navigate']
	origin: string
	destination: string
	identity: string | undefined
	mutation: 'notStarted' | 'settled'
	/** Records the PREPARED command, not whether the child actually issued the SDK mutation. */
	permitIssued: boolean
	result: RecoveryResult | undefined
}
type Event =
	| RestorationReport
	| {
			type: 'WORKSPACE_DRAINED'
	  }
	| {
			type: 'SHUTDOWN'
	  }
	| {
			type: 'RELEASE_REQUEST'
	  }
function childFailure(context: Context): Extract<
	RecoveryResult,
	{
		outcome: 'restorationChildFailed'
	}
> {
	return {
		outcome: 'restorationChildFailed',
		mutation: context.permitIssued ? 'unknown' : 'notStarted'
	}
}
const actors = {
	restoration: restorationMachine,
	navigationFacts: createAsyncLogic({
		run: async ({
			input
		}: {
			input: {
				session: Session
				readHref: () => string
			}
		}) => {
			const snapshot = input.session.getSnapshot()
			return { status: snapshot.status, identity: snapshot.account?.id, href: input.readHref() }
		}
	}),
	navigate: createAsyncLogic({
		run: ({
			input
		}: {
			input: {
				navigate: Input['navigate']
				destination: string
			}
		}) => input.navigate(input.destination)
	})
}
const patches = {
	navigationFailed: ({ context }: { context: Context }): Partial<Context> => ({
		result: {
			outcome: 'navigationFailed',
			mutation: context.mutation,
			navigation: context.identity
				? { identity: context.identity, origin: context.origin, destination: context.destination }
				: undefined
		}
	})
}
const model = setup({
	schemas: {
		context: types<Context>(),
		events: {
			RESTORATION_VALIDATED: types<EventPayload<Event, 'RESTORATION_VALIDATED'>>(),
			RESTORATION_PREPARE_REQUESTED: types<EventPayload<Event, 'RESTORATION_PREPARE_REQUESTED'>>(),
			WORKSPACE_DRAINED: types<EventPayload<Event, 'WORKSPACE_DRAINED'>>(),
			SHUTDOWN: types<EventPayload<Event, 'SHUTDOWN'>>(),
			RELEASE_REQUEST: types<EventPayload<Event, 'RELEASE_REQUEST'>>()
		},
		input: types<Input>(),
		output: types<RecoveryResult>()
	},
	actors,
	guards: {
		currentReport: ({ context, event }: { context: Context; event: Event }) =>
			(event.type === 'RESTORATION_VALIDATED' || event.type === 'RESTORATION_PREPARE_REQUESTED') &&
			event.binding === context.restorationBinding?.binding &&
			event.attempt === context.attempt
	},
	actions: {
		releaseBinding: ({ context }: { context: Context }) => context.restorationBinding?.invalidate()
	}
})

/** Restoration lifetime coordinated with host-owned drain and navigation capabilities. */
type CompletionEntry = Extract<
	NonNullable<Parameters<typeof model.createStateConfig>[0]['entry']>,
	(...args: never[]) => unknown
>
type CompletionArgs = Pick<Parameters<CompletionEntry>[0], 'context' | 'actions'>
type CompletionQueue = Parameters<CompletionEntry>[1]
const finalizers = {
	invalid: (args, _enq) => {
		return {
			context: {
				result: { outcome: 'invalid', mutation: args.context.mutation },
				request: undefined
			} satisfies Partial<Context>
		}
	},
	restoreFailed: (args, _enq) => {
		return {
			context: {
				result: { outcome: 'restoreFailed', mutation: args.context.mutation },
				request: undefined
			} satisfies Partial<Context>
		}
	},
	restored: (args, _enq) => {
		return {
			context: {
				result: { outcome: 'restored', mutation: args.context.mutation },
				request: undefined
			} satisfies Partial<Context>
		}
	},
	closed: (args, _enq) => {
		return {
			context: {
				result: { outcome: 'closed', mutation: args.context.mutation },
				request: undefined
			} satisfies Partial<Context>
		}
	},
	restorationChildFailed: (args, _enq) => {
		const { context } = args
		return {
			context: { request: undefined, result: childFailure(context) } satisfies Partial<Context>
		}
	},
	navigationFailed: (_args, _enq) => {
		return { context: { request: undefined } satisfies Partial<Context> }
	}
} satisfies Record<
	string,
	(args: CompletionArgs, enq: CompletionQueue) => void | { context?: Partial<Context> }
>
const complete = createFinalTransitions<
	Context,
	CompletionArgs,
	CompletionQueue,
	keyof typeof finalizers
>(finalizers)

export const sessionRecoveryMachine = model.createMachine({
	id: 'session-recovery',
	initial: 'choosing',
	context: ({ input }) => ({
		attempt: input.attempt,
		request: input.request,
		session: input.session,
		restorationBinding: input.restorationBinding,
		readHref: input.readHref,
		navigate: input.navigate,
		origin: input.request.origin,
		destination: input.request.destination,
		identity: input.request.kind === 'navigate' ? input.request.identity : undefined,
		mutation: 'notStarted',
		permitIssued: false,
		result: undefined
	}),
	output: ({ context }) => context.result ?? childFailure(context),
	on: {
		SHUTDOWN: (args, enq) => {
			return complete('closed', args, enq, { target: '.closed' })
		}
	},
	states: {
		choosing: {
			always: (args) => {
				if (args.context.request?.kind === 'navigate') {
					return {
						target: 'checkingNavigation',
						context: { request: undefined } satisfies Partial<Context>
					}
				}
				return { target: 'restoring' }
			}
		},
		restoring: {
			initial: 'validating',
			entry: (args, enq) => {
				enq.raise({ type: 'RELEASE_REQUEST' })
			},
			exit: (args, enq) => {
				enq(args.actions.releaseBinding, args)
				return {
					context: { restorationBinding: undefined } satisfies Partial<Context>
				}
			},
			invoke: {
				id: 'restoration',
				src: actors.restoration,
				input: ({ context, self }) => {
					const request = required(context.request)
					if (request.kind !== 'restore') throw new Error('Missing recovery input')
					const binding = required(context.restorationBinding)
					return {
						scope: { binding: binding.binding, attempt: context.attempt },
						capability: binding.capability,
						phrase: request.phrase,
						reportTo: self
					}
				},
				onDone: (args, enq) => {
					const { event } = args
					if (matchesState({ restoring: 'closing' }, args.value)) {
						{
							return complete('closed', args, enq, {
								target: 'closed',
								context: { mutation: event.output.mutation } satisfies Partial<Context>
							})
						}
					}
					if (event.output.outcome === 'invalid') {
						{
							return complete('invalid', args, enq, { target: 'invalid' })
						}
					}
					if (event.output.outcome === 'cancelled') {
						{
							return complete('closed', args, enq, {
								target: 'closed',
								context: { mutation: event.output.mutation } satisfies Partial<Context>
							})
						}
					}
					if (event.output.outcome === 'restored') {
						return {
							target: 'checkingNavigation',
							context: {
								mutation: event.output.mutation,
								identity: event.output.outcome === 'restored' ? event.output.identityId : undefined
							} satisfies Partial<Context>
						}
					}
					if (event.output.outcome === 'identityUnavailable') {
						let context = args.context
						let patch = {}
						patch = { ...patch, mutation: event.output.mutation }
						context = { ...args.context, ...patch }
						patch = { ...patch, ...patches.navigationFailed({ ...args, context }) }
						context = { ...args.context, ...patch }
						{
							return complete('navigationFailed', args, enq, {
								target: 'navigationFailed',
								context: patch satisfies Partial<Context>
							})
						}
					}
					{
						return complete('restoreFailed', args, enq, {
							target: 'restoreFailed',
							context: { mutation: event.output.mutation } satisfies Partial<Context>
						})
					}
				},
				// Exit the owned binding scope before publishing a finite, sanitized failure.
				onError: (args, enq) => {
					return complete('restorationChildFailed', args, enq, { target: 'restorationChildFailed' })
				}
			},
			on: {
				RELEASE_REQUEST: (_args) => {
					return { context: { request: undefined } satisfies Partial<Context> }
				},
				SHUTDOWN: (args, enq) => {
					enq.sendTo('restoration', { type: 'SHUTDOWN' })
					return { target: '.closing' }
				}
			},
			states: {
				validating: {
					on: {
						RESTORATION_VALIDATED: (args, enq) => {
							if (!args.guards.currentReport(args)) return
							enq.sendTo(args.parent, {
								type: 'RECOVERY_VALIDATED',
								attempt: args.context.attempt
							})
						},
						RESTORATION_PREPARE_REQUESTED: (args, enq) => {
							if (!args.guards.currentReport(args)) return
							enq.sendTo(args.parent, {
								type: 'RECOVERY_DRAIN_REQUESTED',
								attempt: args.context.attempt
							})
							return { target: 'awaitingDrain' }
						}
					}
				},
				awaitingDrain: {
					on: {
						WORKSPACE_DRAINED: (args, enq) => {
							let context = args.context
							let patch = {}
							patch = { ...patch, permitIssued: true }
							context = { ...args.context, ...patch }
							enq.sendTo('restoration', {
								type: 'PREPARED',
								binding: required(context.restorationBinding).binding,
								attempt: context.attempt
							})
							return {
								target: 'operating',
								context: patch satisfies Partial<Context>
							}
						}
					}
				},
				operating: {},
				closing: { on: { SHUTDOWN: {} } }
			}
		},
		checkingNavigation: {
			invoke: {
				src: actors.navigationFacts,
				input: ({ context }) => ({ session: context.session, readHref: context.readHref }),
				onDone: (args, enq) => {
					const { context, event } = args
					if (
						event.output.status === 'ready' &&
						event.output.identity === context.identity &&
						event.output.href === context.origin
					) {
						return { target: 'navigating' }
					}
					{
						return complete('restored', args, enq, { target: 'restored' })
					}
				},
				onError: (args, enq) => {
					{
						return complete('navigationFailed', args, enq, {
							target: 'navigationFailed',
							context: patches.navigationFailed(args) satisfies Partial<Context>
						})
					}
				}
			}
		},
		navigating: {
			initial: 'active',
			invoke: {
				src: actors.navigate,
				input: ({ context }) => ({ navigate: context.navigate, destination: context.destination }),
				onDone: (args, enq) => {
					if (matchesState({ navigating: 'closing' }, args.value)) {
						{
							return complete('closed', args, enq, { target: 'closed' })
						}
					}
					{
						return complete('restored', args, enq, { target: 'restored' })
					}
				},
				onError: (args, enq) => {
					if (matchesState({ navigating: 'closing' }, args.value)) {
						{
							return complete('closed', args, enq, { target: 'closed' })
						}
					}
					{
						return complete('navigationFailed', args, enq, {
							target: 'navigationFailed',
							context: patches.navigationFailed(args) satisfies Partial<Context>
						})
					}
				}
			},
			on: { SHUTDOWN: { target: '.closing' } },
			states: { active: {}, closing: { on: { SHUTDOWN: {} } } }
		},
		invalid: {
			type: 'final'
		},
		restoreFailed: {
			type: 'final'
		},
		restored: {
			type: 'final'
		},
		closed: {
			type: 'final'
		},
		restorationChildFailed: {
			type: 'final'
		},
		navigationFailed: {
			type: 'final'
		}
	}
})
