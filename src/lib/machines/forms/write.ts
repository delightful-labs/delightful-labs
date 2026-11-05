import { formInterruptionResult } from '../../contracts/scoped-form.js'
import { createScopedFormReadinessMachine } from './readiness.js'
import { enqueueActions, assign, fromPromise, setup, stateIn, type Snapshot } from 'xstate'
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
		assessmentError: { generation: number } | undefined
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
		? fromPromise<Output, Input>(async ({ input }) => ({
				outcome: 'succeeded',
				value: await effect(input),
				settlement: options.settlement
			}))
		: setup<{}, FormChildEvent<Observation>, {}, {}, {}, {}, never, string, Input, Output>(
				{}
			).createMachine({
				initial: 'failed',
				output: () => ({ outcome: 'failed', code: 'operationFailed', settlement: 'notStarted' }),
				states: { failed: { type: 'final' } }
			})
	const actors = {
		refresh: fromPromise<FormObservation<Observation>, FormObservation<Observation>>(({ input }) =>
			Promise.resolve({ revision: input.revision, facts: options.observe() })
		),
		review,
		write: options.persistence ?? nativeWrite
	}
	const form = setup<
		Context,
		Event,
		typeof actors,
		{},
		{ observeAssessmentError: undefined },
		{
			closing: undefined
			invalidated: undefined
			cancelling: undefined
		},
		never,
		string,
		Input,
		Output
	>({
		actors,
		actions: {
			observeAssessmentError: enqueueActions(({ self, context, enqueue }) => {
				enqueue.assign({
					assessmentError:
						self.getSnapshot().children.review?.getSnapshot().status === 'error'
							? { generation: context.assessmentGeneration }
							: undefined
				})
			})
		},
		guards: {
			closing: stateIn({ writing: 'closing' }),
			invalidated: stateIn({ writing: 'invalidated' }),
			cancelling: stateIn({ writing: 'cancelling' })
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
	const observe = form.assign({
		observation: ({ context, event }) =>
			event.type === 'OBSERVE' ? event.observation : context.observation
	})
	const clear = form.assign({
		request: undefined,
		observation: undefined,
		capability: undefined,
		assessmentError: undefined
	})
	const interrupted = (outcome: FormInterruption) =>
		form.createStateConfig({
			type: 'final',
			entry: [
				form.assign({
					result: ({ context }) => context.result ?? { outcome, settlement: 'notStarted' }
				}),
				clear
			]
		})
	const blocked = (outcome: 'denied' | 'unavailable') =>
		form.createStateConfig({
			type: 'final',
			entry: [
				form.assign({
					result: ({ context }): Output => {
						if (context.result) return context.result
						const readiness = context.capability?.readiness
						if (readiness?.kind !== 'blocked')
							return { outcome: 'failed', code: 'availabilityFailed', settlement: 'notStarted' }
						return { outcome, reason: readiness.reason, settlement: 'notStarted' }
					}
				}),
				clear
			]
		})
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
		on: { CANCEL: '.cancelled', INVALIDATE: '.scopeChanged', SHUTDOWN: '.closed' },
		states: {
			admittingInput: {
				always: [
					{
						guard: ({ context }) =>
							context.request !== undefined && context.observation !== undefined,
						target: 'refreshing'
					},
					{ target: 'failed', actions: assign({ result: () => prewriteFailure }) }
				]
			},
			refreshing: {
				invoke: {
					src: 'refresh',
					input: ({ context }) => observation(context),
					onDone: {
						target: 'checkingScope',
						actions: assign({
							observation: ({ context, event }) =>
								event.output.revision === context.observation?.revision
									? event.output
									: context.observation
						})
					},
					onError: { target: 'failed', actions: assign({ result: () => prewriteFailure }) }
				},
				on: { OBSERVE: { actions: observe } }
			},
			checkingScope: {
				always: [
					{
						guard: ({ context }) =>
							context.request === undefined || context.observation === undefined,
						target: 'failed',
						actions: assign({ result: () => prewriteFailure })
					},
					{
						guard: ({ context }) =>
							!options.sameScope(
								request(context).scope,
								options.scopeOf(observation(context).facts)
							),
						target: 'scopeChanged'
					},
					{ target: 'authorizing' }
				]
			},
			authorizing: {
				initial: 'pending',
				states: {
					pending: {},
					checkingError: {
						always: [
							{
								guard: ({ context }) =>
									context.assessmentError?.generation === context.assessmentGeneration,
								target: '#scoped-form-write.failed',
								actions: assign({ result: () => prewriteFailure })
							},
							{ target: 'pending' }
						]
					}
				},
				entry: assign({
					assessmentGeneration: ({ context }) => context.assessmentGeneration + 1,
					assessmentError: undefined,
					capability: undefined
				}),
				invoke: {
					id: 'review',
					src: 'review',
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
					onDone: [
						{
							guard: ({ context, event }) =>
								event.output.token !== undefined &&
								event.output.token.generation < context.assessmentGeneration
						},
						{
							guard: ({ context, event }) =>
								event.output.kind === 'assessed' &&
								event.output.token.requestId === request(context).id &&
								event.output.token.scopeRevision === request(context).scopeRevision &&
								event.output.token.generation === context.assessmentGeneration &&
								event.output.capability.revision === observation(context).revision &&
								options.sameScope(event.output.capability.scope, request(context).scope),
							target: 'deciding',
							actions: assign({
								capability: ({ event }) =>
									event.output.kind === 'assessed' ? event.output.capability : undefined
							})
						},
						{ target: 'failed', actions: assign({ result: () => prewriteFailure }) }
					],
					onError: { target: '.checkingError', actions: 'observeAssessmentError' }
				},
				on: { OBSERVE: { target: 'checkingScope', actions: observe } }
			},
			deciding: {
				always: [
					{
						guard: ({ context }) =>
							context.request === undefined || context.observation === undefined,
						target: 'failed',
						actions: assign({ result: () => prewriteFailure })
					},
					{
						guard: ({ context }) => context.capability?.readiness.kind === 'ready',
						target: 'writing'
					},
					{
						guard: ({ context }) => {
							const readiness = context.capability?.readiness
							return (
								readiness?.kind === 'blocked' &&
								options.classifyBlocked(readiness.reason) === 'denied'
							)
						},
						target: 'denied'
					},
					{
						guard: ({ context }) => context.capability?.readiness.kind === 'blocked',
						target: 'unavailable'
					},
					{ target: 'failed', actions: assign({ result: () => prewriteFailure }) }
				]
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
					onDone: [
						{
							guard: 'closing',
							target: 'closed',
							actions: assign({ result: ({ event }) => interruptedResult('closed', event.output) })
						},
						{
							guard: 'invalidated',
							target: 'scopeChanged',
							actions: assign({
								result: ({ event }) => interruptedResult('scopeChanged', event.output)
							})
						},
						{
							guard: 'cancelling',
							target: 'cancelled',
							actions: assign({
								result: ({ event }) => interruptedResult('cancelled', event.output)
							})
						},
						{
							target: 'settled',
							actions: assign({ result: ({ event }) => event.output ?? failure('failed') })
						}
					],
					onError: [
						{
							guard: 'closing',
							target: 'closed',
							actions: assign({ result: () => failure('closed') })
						},
						{
							guard: 'invalidated',
							target: 'scopeChanged',
							actions: assign({ result: () => failure('scopeChanged') })
						},
						{
							guard: 'cancelling',
							target: 'cancelled',
							actions: assign({ result: () => failure('cancelled') })
						},
						{ target: 'failed', actions: assign({ result: () => failure('failed') }) }
					]
				},
				on: {
					CANCEL: {
						target: '.cancelling',
						actions: options.persistence ? form.sendTo('write', ({ event }) => event) : []
					},
					INVALIDATE: {
						target: '.invalidated',
						actions: options.persistence ? form.sendTo('write', ({ event }) => event) : []
					},
					SHUTDOWN: {
						target: '.closing',
						actions: options.persistence ? form.sendTo('write', ({ event }) => event) : []
					},
					OBSERVE: [
						{
							guard: ({ context, event }) =>
								!options.sameScope(
									request(context).scope,
									options.scopeOf(event.observation.facts)
								),
							target: '.invalidated',
							actions: [
								observe,
								...(options.persistence ? [form.sendTo('write', { type: 'INVALIDATE' })] : [])
							]
						},
						{
							actions: [
								observe,
								...(options.persistence ? [form.sendTo('write', ({ event }) => event)] : [])
							]
						}
					]
				},
				states: {
					pending: {},
					cancelling: { on: { CANCEL: {} } },
					invalidated: { on: { CANCEL: {}, INVALIDATE: {} } },
					closing: { on: { CANCEL: {}, INVALIDATE: {}, SHUTDOWN: {}, OBSERVE: {} } }
				}
			},
			settled: {
				always: [
					{ guard: ({ context }) => context.result?.outcome === 'succeeded', target: 'succeeded' },
					{ guard: ({ context }) => context.result?.outcome === 'denied', target: 'denied' },
					{
						guard: ({ context }) => context.result?.outcome === 'unavailable',
						target: 'unavailable'
					},
					{ guard: ({ context }) => context.result?.outcome === 'cancelled', target: 'cancelled' },
					{ guard: ({ context }) => context.result?.outcome === 'closed', target: 'closed' },
					{
						guard: ({ context }) => context.result?.outcome === 'scopeChanged',
						target: 'scopeChanged'
					},
					{ guard: ({ context }) => context.result?.outcome === 'partial', target: 'partial' },
					{ target: 'failed' }
				]
			},
			partial: { type: 'final', entry: clear },
			succeeded: { type: 'final', entry: clear },
			denied: blocked('denied'),
			unavailable: blocked('unavailable'),
			failed: { type: 'final', entry: clear },
			cancelled: interrupted('cancelled'),
			scopeChanged: interrupted('scopeChanged'),
			closed: interrupted('closed')
		}
	})
}
