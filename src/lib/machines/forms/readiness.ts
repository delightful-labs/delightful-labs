import { types, setup, type ActorLogic, type ActorRef, type Snapshot } from 'xstate'

import type { EventPayload } from '../../contracts/machine-events.js'
import type {
	FormAssessmentToken,
	FormCapability,
	FormCapabilityReportEvent,
	FormChildEvent,
	FormObservation,
	FormReadinessResult
} from '../../contracts/scoped-form.js'
/** Delivery and correlation belong to the invoking form; policy state paths stay private. */
export type ScopedFormReadinessDelivery<Scope, Reason> =
	| {
			kind: 'watch'
			generation: number
			recipient: ActorRef<Snapshot<unknown>, FormCapabilityReportEvent<Scope, Reason>>
	  }
	| {
			kind: 'assessment'
			token: FormAssessmentToken
	  }
export type ScopedFormReadinessInput<Scope, Reason, Observation> = {
	observation: FormObservation<Observation>
	delivery: ScopedFormReadinessDelivery<Scope, Reason>
}
export type ScopedFormAvailabilityLogic<
	AvailabilitySnapshot extends Snapshot<unknown>,
	Observation
> = ActorLogic<AvailabilitySnapshot, FormChildEvent<Observation>, FormObservation<Observation>>
/** Adapts the domain's public projection; domain policy and write resources remain elsewhere. */
export function createScopedFormReadinessMachine<
	Scope,
	Reason,
	Observation,
	AvailabilitySnapshot extends Snapshot<unknown>
>(options: {
	availability: ScopedFormAvailabilityLogic<AvailabilitySnapshot, Observation>
	selectAvailability: (snapshot: AvailabilitySnapshot) => FormCapability<Scope, Reason>
	scopeOf: (facts: Observation) => Scope
	sameScope: (left: Scope, right: Scope) => boolean
}) {
	type Input = ScopedFormReadinessInput<Scope, Reason, Observation>
	type Context = Input & {
		capability: FormCapability<Scope, Reason> | undefined
	}
	type Event =
		| FormChildEvent<Observation>
		| {
				type: 'PROJECTED'
				capability: FormCapability<Scope, Reason>
		  }
	const actors = { source: options.availability }
	const workflow = setup({
		schemas: {
			context: types<Context>(),
			events: {
				CANCEL: types<EventPayload<Event, 'CANCEL'>>(),
				SHUTDOWN: types<EventPayload<Event, 'SHUTDOWN'>>(),
				INVALIDATE: types<EventPayload<Event, 'INVALIDATE'>>(),
				OBSERVE: types<EventPayload<Event, 'OBSERVE'>>()
			},
			internalEvents: { PROJECTED: types<EventPayload<Event, 'PROJECTED'>>() },
			input: types<Input>(),
			output: types<FormReadinessResult<Scope, Reason>>()
		},
		actors
	})
	return workflow.createMachine({
		id: 'scoped-form-readiness',
		initial: 'observing',
		context: ({ input }) => ({ ...input, capability: undefined }),
		output: ({ context }) => {
			if (context.delivery.kind === 'assessment' && context.capability)
				return { kind: 'assessed', token: context.delivery.token, capability: context.capability }
			return context.delivery.kind === 'assessment'
				? { kind: 'failed', token: context.delivery.token }
				: { kind: 'failed' }
		},
		states: {
			observing: {
				initial: 'selecting',
				invoke: {
					id: 'source',
					src: actors.source,
					input: ({ context }) => context.observation,
					onSnapshot: (args, enq) => {
						const { event } = args
						if (!(event.snapshot.status === 'active')) return
						enq.raise({
							type: 'PROJECTED',
							capability: options.selectAvailability(event.snapshot)
						})
					},
					onError: { target: '#scoped-form-readiness.failed' },
					onDone: { target: '#scoped-form-readiness.failed' }
				},
				states: {
					selecting: {
						type: 'choice',
						choice: (args) => {
							if (args.context.delivery.kind === 'watch') {
								return { target: 'watching' }
							}
							return { target: 'assessing' }
						}
					},
					watching: {
						on: {
							OBSERVE: (args, enq) => {
								enq.sendTo('source', args.event)
								return {
									context: { observation: args.event.observation } satisfies Partial<Context>
								}
							},
							PROJECTED: ({ context, event }, enq) => {
								if (
									event.capability.revision !== context.observation.revision ||
									!options.sameScope(
										event.capability.scope,
										options.scopeOf(context.observation.facts)
									)
								)
									return
								if (context.delivery.kind === 'watch')
									enq.sendTo(context.delivery.recipient, {
										type: 'FORM_CAPABILITY_REPORTED',
										generation: context.delivery.generation,
										capability: event.capability
									})
							}
						}
					},
					assessing: {
						on: {
							PROJECTED: (args) => {
								const { context, event } = args
								if (
									!(
										event.capability.revision === context.observation.revision &&
										options.sameScope(
											event.capability.scope,
											options.scopeOf(context.observation.facts)
										)
									)
								)
									return
								return {
									target: '#scoped-form-readiness.assessed',
									context: { capability: event.capability } satisfies Partial<Context>
								}
							}
						}
					}
				}
			},
			assessed: { type: 'final' },
			failed: { type: 'final' }
		}
	})
}
