import { types, createAsyncLogic, matchesState, setup, type ActorRef, type Snapshot } from 'xstate'

import type { EventPayload } from '../../contracts/machine-events.js'
import type {
	RestorationCapability,
	RestorationEvent,
	RestorationIdentity,
	RestorationReport,
	RestorationResult,
	RestorationScope
} from '../../contracts/restoration.js'
/** Sensitive input: never inspect, persist, or retain this actor's inputs/events/snapshots. */
export type RestorationInput = Readonly<{
	scope: RestorationScope
	phrase: string
	reportTo: ActorRef<Snapshot<unknown>, RestorationReport>
}>
type Context = {
	capability: RestorationCapability
	scope: RestorationScope
	reportTo: RestorationInput['reportTo']
	phrase: string | undefined
	credential: string | undefined
	mutation: 'notStarted' | 'settled'
	result: RestorationResult | undefined
}
type Event =
	| RestorationEvent
	| {
			type: 'RELEASE_CREDENTIAL'
	  }
function required<Value>(value: Value | undefined): Value {
	if (value === undefined) throw new Error('Restoration input unavailable')
	return value
}
/** Invoke under a host that survives its UI and waits for terminal output before stopping. */
function defineRestorationMachine<Input extends RestorationInput>(
	readCapability: (input: Input) => RestorationCapability
) {
	const actors = {
		parse: createAsyncLogic<
			string,
			{
				capability: RestorationCapability
				phrase: string
			}
		>({ run: ({ input }) => input.capability.parsePhrase(input.phrase) }),
		restore: createAsyncLogic<
			void,
			{
				capability: RestorationCapability
				scope: RestorationScope
				credential: string
			}
		>({ run: ({ input }) => input.capability.restoreIdentity(input.scope, input.credential) }),
		identity: createAsyncLogic<
			RestorationIdentity,
			{
				capability: RestorationCapability
				scope: RestorationScope
			}
		>({ run: ({ input }) => input.capability.readIdentity(input.scope) })
	}
	const patches = {
		settled: (_args: { context: Context }): Partial<Context> => ({ mutation: 'settled' })
	}
	const model = setup({
		schemas: {
			context: types<Context>(),
			events: {
				PREPARED: types<EventPayload<Event, 'PREPARED'>>(),
				CANCEL: types<EventPayload<Event, 'CANCEL'>>(),
				SHUTDOWN: types<EventPayload<Event, 'SHUTDOWN'>>(),
				BINDING_INVALIDATED: types<EventPayload<Event, 'BINDING_INVALIDATED'>>()
			},
			internalEvents: { RELEASE_CREDENTIAL: types<EventPayload<Event, 'RELEASE_CREDENTIAL'>>() },
			input: types<Input>(),
			output: types<RestorationResult>()
		},
		actors,
		actions: {},
		guards: {
			currentBinding: ({ context }: { context: Context }) =>
				context.capability.isCurrentBinding(context.scope.binding),
			matchingPermit: ({ context, event }: { context: Context; event: Event }) =>
				event.type === 'PREPARED' &&
				event.binding === context.scope.binding &&
				event.attempt === context.scope.attempt &&
				context.capability.isCurrentBinding(context.scope.binding)
		}
	})

	type CompletionEntry = Extract<
		NonNullable<Parameters<typeof model.createStateConfig>[0]['entry']>,
		(...args: never[]) => unknown
	>
	type CompletionArgs = Pick<Parameters<CompletionEntry>[0], 'context' | 'actions'>
	type CompletionQueue = Parameters<CompletionEntry>[1]
	const finalizers = {
		restored: (_args) => {
			return {
				context: { phrase: undefined, credential: undefined } satisfies Partial<Context>
			}
		},
		invalid: (args) => {
			let context = args.context
			let patch = {}
			patch = { ...patch, phrase: undefined, credential: undefined }
			context = { ...args.context, ...patch }
			patch = {
				...patch,
				result: { ...context.scope, outcome: 'invalid', mutation: 'notStarted' }
			}
			context = { ...args.context, ...patch }
			return { context: patch satisfies Partial<Context> }
		},
		failed: (args) => {
			let context = args.context
			let patch = {}
			patch = { ...patch, phrase: undefined, credential: undefined }
			context = { ...args.context, ...patch }
			patch = {
				...patch,
				result: { ...context.scope, outcome: 'failed', mutation: 'settled' }
			}
			context = { ...args.context, ...patch }
			return { context: patch satisfies Partial<Context> }
		},
		identityUnavailable: (args) => {
			let context = args.context
			let patch = {}
			patch = { ...patch, phrase: undefined, credential: undefined }
			context = { ...args.context, ...patch }
			patch = {
				...patch,
				result: { ...context.scope, outcome: 'identityUnavailable', mutation: 'settled' }
			}
			context = { ...args.context, ...patch }
			return { context: patch satisfies Partial<Context> }
		},
		cancelled: (args) => {
			let context = args.context
			let patch = {}
			patch = { ...patch, phrase: undefined, credential: undefined }
			context = { ...args.context, ...patch }
			patch = {
				...patch,
				result: {
					...context.scope,
					outcome: 'cancelled',
					mutation: context.mutation
				}
			}
			context = { ...args.context, ...patch }
			return { context: patch satisfies Partial<Context> }
		}
	} satisfies Record<
		string,
		(args: CompletionArgs, enq: CompletionQueue) => void | { context?: Partial<Context> }
	>

	return model.createMachine({
		id: 'identity-restoration',
		initial: 'assessing',
		context: ({ input }) => ({
			capability: readCapability(input),
			scope: { binding: input.scope.binding, attempt: input.scope.attempt },
			reportTo: input.reportTo,
			phrase: input.phrase,
			credential: undefined,
			mutation: 'notStarted',
			result: undefined
		}),
		output: ({ context }) => required(context.result),
		on: {
			CANCEL: (_args) => {
				return { target: '.cancelled' }
			},
			SHUTDOWN: (_args) => {
				return { target: '.cancelled' }
			},
			BINDING_INVALIDATED: (_args) => {
				return { target: '.cancelled' }
			}
		},
		states: {
			assessing: {
				always: (args) => {
					if (args.guards.currentBinding(args)) {
						return { target: 'validating' }
					}

					return { target: 'cancelled' }
				}
			},
			validating: {
				invoke: {
					src: actors.parse,
					input: ({ context }) => ({
						capability: context.capability,
						phrase: required(context.phrase)
					}),
					onDone: (args) => {
						const { event } = args
						if (!args.guards.currentBinding(args)) {
							return { target: 'cancelled' }
						}
						if (event.output.trim().length > 0) {
							return {
								target: 'awaitingPreparation',
								context: { phrase: undefined, credential: event.output } satisfies Partial<Context>
							}
						}

						return { target: 'invalid' }
					},
					onError: (args) => {
						if (args.guards.currentBinding(args)) {
							return { target: 'invalid' }
						}

						return { target: 'cancelled' }
					}
				}
			},
			awaitingPreparation: {
				entry: (args, enq) => {
					const { context } = args
					enq.sendTo(context.reportTo, {
						type: 'RESTORATION_VALIDATED',
						...context.scope
					})
					enq.sendTo(context.reportTo, {
						type: 'RESTORATION_PREPARE_REQUESTED',
						...context.scope
					})
				},
				always: (args) => {
					if (args.guards.currentBinding(args)) return

					return { target: 'cancelled' }
				},
				on: {
					PREPARED: (args) => {
						if (!args.guards.matchingPermit(args)) return
						return { target: 'restoring' }
					}
				}
			},
			restoring: {
				initial: 'active',
				// XState binds invoke input in this entry microstep before processing the raised event.
				entry: (args, enq) => {
					enq.raise({ type: 'RELEASE_CREDENTIAL' })
				},
				invoke: {
					src: actors.restore,
					input: ({ context }) => ({
						capability: context.capability,
						scope: context.scope,
						credential: required(context.credential)
					}),
					onDone: (args) => {
						if (matchesState({ restoring: 'settlingCancellation' }, args.value)) {
							return {
								target: 'cancelled',
								context: patches.settled(args) satisfies Partial<Context>
							}
						}
						if (!args.guards.currentBinding(args)) {
							return {
								target: 'cancelled',
								context: patches.settled(args) satisfies Partial<Context>
							}
						}
						return {
							target: 'readingIdentity',
							context: patches.settled(args) satisfies Partial<Context>
						}
					},
					onError: (args) => {
						if (matchesState({ restoring: 'settlingCancellation' }, args.value)) {
							return {
								target: 'cancelled',
								context: patches.settled(args) satisfies Partial<Context>
							}
						}
						if (!args.guards.currentBinding(args)) {
							return {
								target: 'cancelled',
								context: patches.settled(args) satisfies Partial<Context>
							}
						}

						return {
							target: 'failed',
							context: patches.settled(args) satisfies Partial<Context>
						}
					}
				},
				on: {
					RELEASE_CREDENTIAL: (_args) => {
						return {
							context: { phrase: undefined, credential: undefined } satisfies Partial<Context>
						}
					},
					CANCEL: { target: '.settlingCancellation' },
					SHUTDOWN: { target: '.settlingCancellation' },
					BINDING_INVALIDATED: { target: '.settlingCancellation' }
				},
				states: {
					active: {},
					settlingCancellation: {
						on: { CANCEL: {}, SHUTDOWN: {}, BINDING_INVALIDATED: {} }
					}
				}
			},
			readingIdentity: {
				invoke: {
					src: actors.identity,
					input: ({ context }) => ({ capability: context.capability, scope: context.scope }),
					onDone: (args) => {
						const { event } = args
						if (!args.guards.currentBinding(args)) {
							return { target: 'cancelled' }
						}
						if (event.output.kind === 'ready' && event.output.identityId.trim().length > 0) {
							return {
								target: 'restored',
								context: {
									result: (({ context, event }): RestorationResult => {
										if (event.output.kind !== 'ready')
											throw new Error('Restoration identity unavailable')
										return {
											...context.scope,
											outcome: 'restored',
											mutation: 'settled',
											identityId: event.output.identityId
										}
									})(args)
								} satisfies Partial<Context>
							}
						}

						return { target: 'identityUnavailable' }
					},
					onError: (args) => {
						if (args.guards.currentBinding(args)) {
							return { target: 'identityUnavailable' }
						}

						return { target: 'cancelled' }
					}
				}
			},
			restored: {
				type: 'final',
				entry: finalizers.restored
			},
			invalid: {
				type: 'final',
				entry: finalizers.invalid
			},
			failed: {
				type: 'final',
				entry: finalizers.failed
			},
			identityUnavailable: {
				type: 'final',
				entry: finalizers.identityUnavailable
			},
			cancelled: {
				type: 'final',
				entry: finalizers.cancelled
			}
		}
	})
}
/** Fixed capability for callers that already own their backend binding at definition time. */
export function createRestorationMachine(capability: RestorationCapability) {
	return defineRestorationMachine((_input: RestorationInput) => capability)
}
/** Invocation-time binding for hosts whose session becomes available after machine definition. */
export type SuppliedRestorationInput = RestorationInput &
	Readonly<{
		capability: RestorationCapability
	}>
export const restorationMachine = defineRestorationMachine(
	(input: SuppliedRestorationInput) => input.capability
)
