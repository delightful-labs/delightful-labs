import {
	matchesState,
	type StateValue,
	types,
	createAsyncLogic,
	setup,
	type Snapshot
} from 'xstate'

import type { EventPayload } from '../../contracts/machine-events.js'
import { formInterruptionResult } from '../../contracts/scoped-form.js'
import { createScopedFormReadinessMachine } from './readiness.js'
import type { ScopedFormAvailabilityLogic } from './readiness.js'
import type { ScopedFormOperationLogic } from './submission.js'
import type {
	FormCapability,
	FormChildEvent,
	FormInterruption,
	FormObservation,
	FormOperationInput,
	FormOperationResult
} from '../../contracts/scoped-form.js'
/** Exactly one persistence implementation: a leaf effect or a resource-owning actor. */
export type FormPersistence<
	Values,
	Result,
	Reason,
	Scope,
	Observation,
	PersistenceSnapshot extends Snapshot<FormOperationResult<Result, Reason>>
> =
	| {
			write: (input: FormOperationInput<Values, Scope, Observation>) => Promise<Result>
			persistence?: never
	  }
	| {
			write?: never
			persistence: ScopedFormOperationLogic<Values, Scope, Observation, PersistenceSnapshot>
	  }
/** Owns prewrite readiness and settlement; supplied effects retain their domain resource obligations. */
export function createScopedFormWriteMachine<
	Values,
	Result,
	Reason,
	Scope,
	Observation,
	AvailabilitySnapshot extends Snapshot<unknown>,
	PersistenceSnapshot extends Snapshot<FormOperationResult<Result, Reason>> = Snapshot<
		FormOperationResult<Result, Reason>
	>
>(
	options: {
		availability: ScopedFormAvailabilityLogic<AvailabilitySnapshot, Observation>
		selectAvailability: (snapshot: AvailabilitySnapshot) => FormCapability<Scope, Reason>
		scopeOf: (facts: Observation) => Scope
		sameScope: (left: Scope, right: Scope) => boolean
		observe: () => Observation
		classifyBlocked: (reason: Reason) => 'denied' | 'unavailable'
		assessmentObservation?: (input: FormOperationInput<Values, Scope, Observation>) => Observation
		settlement: 'locallyPersisted' | 'confirmed'
	} & FormPersistence<Values, Result, Reason, Scope, Observation, PersistenceSnapshot>
) {
	type Input = FormOperationInput<Values, Scope, Observation>
	type Output = FormOperationResult<Result, Reason>
	type Context = {
		request: Input['request'] | undefined
		observation: FormObservation<Observation> | undefined
		assessmentError:
			| {
					generation: number
			  }
			| undefined
		assessmentGeneration: number
		capability: FormCapability<Scope, Reason> | undefined
		result: Output | undefined
	}
	type Event = FormChildEvent<Observation>
	const review = createScopedFormReadinessMachine<Scope, Reason, Observation, AvailabilitySnapshot>(
		options
	)
	const effect = options.write
	const nativeWrite = effect
		? createAsyncLogic<Output, Input>({
				run: async ({ input }) => ({
					outcome: 'succeeded',
					value: await effect(input),
					settlement: options.settlement
				})
			})
		: setup({
				schemas: {
					context: types<{}>(),
					events: {
						CANCEL: types<EventPayload<FormChildEvent<Observation>, 'CANCEL'>>(),
						SHUTDOWN: types<EventPayload<FormChildEvent<Observation>, 'SHUTDOWN'>>(),
						INVALIDATE: types<EventPayload<FormChildEvent<Observation>, 'INVALIDATE'>>(),
						OBSERVE: types<EventPayload<FormChildEvent<Observation>, 'OBSERVE'>>()
					},
					input: types<Input>(),
					output: types<Output>()
				}
			}).createMachine({
				context: {},
				initial: 'failed',
				output: () => ({ outcome: 'failed', code: 'operationFailed', settlement: 'notStarted' }),
				states: { failed: { type: 'final' } }
			})
	const actors = {
		refresh: createAsyncLogic<FormObservation<Observation>, FormObservation<Observation>>({
			run: ({ input }) => Promise.resolve({ revision: input.revision, facts: options.observe() })
		}),
		review,
		write: options.persistence ?? nativeWrite
	}
	const form = setup({
		schemas: {
			context: types<Context>(),
			events: {
				CANCEL: types<EventPayload<Event, 'CANCEL'>>(),
				SHUTDOWN: types<EventPayload<Event, 'SHUTDOWN'>>(),
				INVALIDATE: types<EventPayload<Event, 'INVALIDATE'>>(),
				OBSERVE: types<EventPayload<Event, 'OBSERVE'>>()
			},
			input: types<Input>(),
			output: types<Output>()
		},
		actors,
		actions: {},
		guards: {
			closing: ({ value }: { value: StateValue }) => matchesState({ writing: 'closing' }, value),
			invalidated: ({ value }: { value: StateValue }) =>
				matchesState({ writing: 'invalidated' }, value),
			cancelling: ({ value }: { value: StateValue }) =>
				matchesState({ writing: 'cancelling' }, value)
		}
	})
	function observation(context: Context) {
		if (!context.observation) throw new Error('Missing write observation')
		return context.observation
	}
	function request(context: Context) {
		if (!context.request) throw new Error('Missing write request')
		return context.request
	}

	function interruptedResult(outcome: FormInterruption, result: Output | undefined): Output {
		return formInterruptionResult(outcome, result)
	}
	function failure(outcome: FormInterruption | 'failed'): Output {
		return outcome === 'failed'
			? { outcome, code: 'operationFailed', settlement: 'unknown' }
			: { outcome, settlement: 'unknown' }
	}
	const prewriteFailure: Output = {
		outcome: 'failed',
		code: 'operationFailed',
		settlement: 'notStarted'
	}
	type CompletionEntry = Extract<
		NonNullable<Parameters<typeof form.createStateConfig>[0]['entry']>,
		(...args: never[]) => unknown
	>
	type CompletionArgs = Pick<Parameters<CompletionEntry>[0], 'context' | 'actions'>
	type CompletionQueue = Parameters<CompletionEntry>[1]
	const finalizers = {
		partial: (_args) => {
			return {
				context: {
					request: undefined,
					observation: undefined,
					capability: undefined,
					assessmentError: undefined
				} satisfies Partial<Context>
			}
		},
		succeeded: (_args) => {
			return {
				context: {
					request: undefined,
					observation: undefined,
					capability: undefined,
					assessmentError: undefined
				} satisfies Partial<Context>
			}
		},
		denied: (args) => {
			return {
				context: {
					result: (({ context }): Output => {
						if (context.result) return context.result
						const readiness = context.capability?.readiness
						if (readiness?.kind !== 'blocked')
							return { outcome: 'failed', code: 'availabilityFailed', settlement: 'notStarted' }
						return { outcome: 'denied', reason: readiness.reason, settlement: 'notStarted' }
					})(args),
					request: undefined,
					observation: undefined,
					capability: undefined,
					assessmentError: undefined
				} satisfies Partial<Context>
			}
		},
		unavailable: (args) => {
			return {
				context: {
					result: (({ context }): Output => {
						if (context.result) return context.result
						const readiness = context.capability?.readiness
						if (readiness?.kind !== 'blocked')
							return { outcome: 'failed', code: 'availabilityFailed', settlement: 'notStarted' }
						return { outcome: 'unavailable', reason: readiness.reason, settlement: 'notStarted' }
					})(args),
					request: undefined,
					observation: undefined,
					capability: undefined,
					assessmentError: undefined
				} satisfies Partial<Context>
			}
		},
		failed: (_args) => {
			return {
				context: {
					request: undefined,
					observation: undefined,
					capability: undefined,
					assessmentError: undefined
				} satisfies Partial<Context>
			}
		},
		cancelled: (args) => {
			return {
				context: {
					result: args.context.result ?? { outcome: 'cancelled', settlement: 'notStarted' },
					request: undefined,
					observation: undefined,
					capability: undefined,
					assessmentError: undefined
				} satisfies Partial<Context>
			}
		},
		scopeChanged: (args) => {
			return {
				context: {
					result: args.context.result ?? { outcome: 'scopeChanged', settlement: 'notStarted' },
					request: undefined,
					observation: undefined,
					capability: undefined,
					assessmentError: undefined
				} satisfies Partial<Context>
			}
		},
		closed: (args) => {
			return {
				context: {
					result: args.context.result ?? { outcome: 'closed', settlement: 'notStarted' },
					request: undefined,
					observation: undefined,
					capability: undefined,
					assessmentError: undefined
				} satisfies Partial<Context>
			}
		}
	} satisfies Record<
		string,
		(args: CompletionArgs, enq: CompletionQueue) => void | { context?: Partial<Context> }
	>

	return form.createMachine({
		id: 'scoped-form-write',
		initial: 'admittingInput',
		context: ({ input }) => ({
			request: input.request,
			observation: input.observation,
			assessmentError: undefined,
			assessmentGeneration: 0,
			capability: undefined,
			result: undefined
		}),
		output: ({ context }) => context.result ?? failure('failed'),
		on: {
			CANCEL: (_args) => {
				return { target: '.cancelled' }
			},
			INVALIDATE: (_args) => {
				return { target: '.scopeChanged' }
			},
			SHUTDOWN: (_args) => {
				return { target: '.closed' }
			}
		},
		states: {
			admittingInput: {
				always: (args) => {
					const { context } = args
					if (context.request !== undefined && context.observation !== undefined) {
						return { target: 'refreshing' }
					}

					return {
						target: 'failed',
						context: { result: prewriteFailure } satisfies Partial<Context>
					}
				}
			},
			refreshing: {
				invoke: form.createInvoke<typeof actors.refresh, Context>({
					src: actors.refresh,
					input: ({ context }) => observation(context),
					onDone: (args) => {
						const { context, event } = args
						return {
							target: 'checkingScope',
							context: {
								observation:
									event.output.revision === context.observation?.revision
										? event.output
										: context.observation
							} satisfies Partial<Context>
						}
					},
					onError: (_args) => {
						return {
							target: 'failed',
							context: { result: prewriteFailure } satisfies Partial<Context>
						}
					}
				}),
				on: {
					OBSERVE: (args) => {
						const { event } = args
						return {
							context: {
								observation: event.type === 'OBSERVE' ? event.observation : args.context.observation
							} satisfies Partial<Context>
						}
					}
				}
			},
			checkingScope: {
				always: (args) => {
					const { context } = args
					if (context.request === undefined || context.observation === undefined) {
						return {
							target: 'failed',
							context: { result: prewriteFailure } satisfies Partial<Context>
						}
					}
					if (
						!options.sameScope(request(context).scope, options.scopeOf(observation(context).facts))
					) {
						return { target: 'scopeChanged' }
					}
					return { target: 'authorizing' }
				}
			},
			authorizing: {
				initial: 'pending',
				states: {
					pending: {},
					checkingError: {
						always: (args) => {
							const { context } = args
							if (context.assessmentError?.generation === context.assessmentGeneration) {
								return {
									target: '#scoped-form-write.failed',
									context: { result: prewriteFailure } satisfies Partial<Context>
								}
							}
							return { target: 'pending' }
						}
					}
				},
				entry: (args) => {
					return {
						context: {
							assessmentGeneration: args.context.assessmentGeneration + 1,
							assessmentError: undefined,
							capability: undefined
						} satisfies Partial<Context>
					}
				},
				invoke: form.createInvoke<typeof actors.review, Context>({
					id: 'review',
					src: actors.review,
					input: ({ context }) => ({
						observation: {
							...observation(context),
							facts:
								options.assessmentObservation?.({
									request: request(context),
									observation: observation(context)
								}) ?? observation(context).facts
						},
						delivery: {
							kind: 'assessment',
							token: {
								requestId: request(context).id,
								scopeRevision: request(context).scopeRevision,
								generation: context.assessmentGeneration
							}
						}
					}),
					onDone: (args) => {
						const { context, event } = args
						if (
							event.output.token !== undefined &&
							event.output.token.generation < context.assessmentGeneration
						) {
							return {}
						}
						if (
							event.output.kind === 'assessed' &&
							event.output.token.requestId === request(context).id &&
							event.output.token.scopeRevision === request(context).scopeRevision &&
							event.output.token.generation === context.assessmentGeneration &&
							event.output.capability.revision === observation(context).revision &&
							options.sameScope(event.output.capability.scope, request(context).scope)
						) {
							return {
								target: 'deciding',
								context: {
									capability: event.output.kind === 'assessed' ? event.output.capability : undefined
								} satisfies Partial<Context>
							}
						}

						return {
							target: 'failed',
							context: { result: prewriteFailure } satisfies Partial<Context>
						}
					},
					onError: (args) => {
						let _context = args.context
						let patch = {}
						{
							const contextBefore = args.context
							patch = {
								...patch,
								assessmentError: { generation: contextBefore.assessmentGeneration }
							}
							_context = { ...args.context, ...patch }
						}
						return {
							target: '.checkingError',
							context: patch satisfies Partial<Context>
						}
					}
				}),
				on: {
					OBSERVE: (args) => {
						const { event } = args
						return {
							target: 'checkingScope',
							context: {
								observation: event.type === 'OBSERVE' ? event.observation : args.context.observation
							} satisfies Partial<Context>
						}
					}
				}
			},
			deciding: {
				always: (args) => {
					const { context } = args
					if (context.request === undefined || context.observation === undefined) {
						return {
							target: 'failed',
							context: { result: prewriteFailure } satisfies Partial<Context>
						}
					}
					if (context.capability?.readiness.kind === 'ready') {
						return { target: 'writing' }
					}
					if (
						(({ context }) => {
							const readiness = context.capability?.readiness
							return (
								readiness?.kind === 'blocked' &&
								options.classifyBlocked(readiness.reason) === 'denied'
							)
						})(args)
					) {
						return { target: 'denied' }
					}
					if (context.capability?.readiness.kind === 'blocked') {
						return { target: 'unavailable' }
					}

					return {
						target: 'failed',
						context: { result: prewriteFailure } satisfies Partial<Context>
					}
				}
			},
			writing: {
				initial: 'pending',
				invoke: {
					id: 'write',
					src: 'write',
					input: ({ context }) => ({
						request: request(context),
						observation: observation(context)
					}),
					onDone: (args) => {
						const { event } = args
						if (matchesState({ writing: 'closing' }, args.value)) {
							return {
								target: 'closed',
								context: {
									result: interruptedResult('closed', event.output)
								} satisfies Partial<Context>
							}
						}
						if (matchesState({ writing: 'invalidated' }, args.value)) {
							return {
								target: 'scopeChanged',
								context: {
									result: interruptedResult('scopeChanged', event.output)
								} satisfies Partial<Context>
							}
						}
						if (matchesState({ writing: 'cancelling' }, args.value)) {
							return {
								target: 'cancelled',
								context: {
									result: interruptedResult('cancelled', event.output)
								} satisfies Partial<Context>
							}
						}
						return {
							target: 'settled',
							context: { result: event.output ?? failure('failed') } satisfies Partial<Context>
						}
					},
					onError: (args) => {
						if (matchesState({ writing: 'closing' }, args.value)) {
							return {
								target: 'closed',
								context: { result: failure('closed') } satisfies Partial<Context>
							}
						}
						if (matchesState({ writing: 'invalidated' }, args.value)) {
							return {
								target: 'scopeChanged',
								context: { result: failure('scopeChanged') } satisfies Partial<Context>
							}
						}
						if (matchesState({ writing: 'cancelling' }, args.value)) {
							return {
								target: 'cancelled',
								context: { result: failure('cancelled') } satisfies Partial<Context>
							}
						}

						return {
							target: 'failed',
							context: { result: failure('failed') } satisfies Partial<Context>
						}
					}
				},
				on: {
					CANCEL: ({ event }, enq) => {
						if (options.persistence) enq.sendTo('write', event)
						return { target: '.cancelling' }
					},
					INVALIDATE: ({ event }, enq) => {
						if (options.persistence) enq.sendTo('write', event)
						return { target: '.invalidated' }
					},
					SHUTDOWN: ({ event }, enq) => {
						if (options.persistence) enq.sendTo('write', event)
						return { target: '.closing' }
					},
					OBSERVE: ({ context, event }, enq) => {
						const changed = !options.sameScope(
							request(context).scope,
							options.scopeOf(event.observation.facts)
						)
						if (options.persistence) enq.sendTo('write', changed ? { type: 'INVALIDATE' } : event)
						return {
							...(changed ? { target: '.invalidated' } : {}),
							context: { ...context, observation: event.observation } satisfies Context
						}
					}
				},
				states: {
					pending: {},
					cancelling: { on: { CANCEL: {} } },
					invalidated: { on: { CANCEL: {}, INVALIDATE: {} } },
					closing: { on: { CANCEL: {}, INVALIDATE: {}, SHUTDOWN: {}, OBSERVE: {} } }
				}
			},
			settled: {
				always: (args) => {
					const { context } = args
					if (context.result?.outcome === 'succeeded') {
						return { target: 'succeeded' }
					}
					if (context.result?.outcome === 'denied') {
						return { target: 'denied' }
					}
					if (context.result?.outcome === 'unavailable') {
						return { target: 'unavailable' }
					}
					if (context.result?.outcome === 'cancelled') {
						return { target: 'cancelled' }
					}
					if (context.result?.outcome === 'closed') {
						return { target: 'closed' }
					}
					if (context.result?.outcome === 'scopeChanged') {
						return { target: 'scopeChanged' }
					}
					if (context.result?.outcome === 'partial') {
						return { target: 'partial' }
					}

					return { target: 'failed' }
				}
			},
			partial: {
				type: 'final',
				entry: finalizers.partial
			},
			succeeded: {
				type: 'final',
				entry: finalizers.succeeded
			},
			denied: {
				type: 'final',
				entry: finalizers.denied
			},
			unavailable: {
				type: 'final',
				entry: finalizers.unavailable
			},
			failed: {
				type: 'final',
				entry: finalizers.failed
			},
			cancelled: {
				type: 'final',
				entry: finalizers.cancelled
			},
			scopeChanged: {
				type: 'final',
				entry: finalizers.scopeChanged
			},
			closed: {
				type: 'final',
				entry: finalizers.closed
			}
		}
	})
}
