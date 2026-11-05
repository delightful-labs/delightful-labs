import {
	forwardTo,
	raise,
	assign,
	setup,
	type ActorLogic,
	type ActorRef,
	type Snapshot
} from 'xstate'
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
	| { kind: 'assessment'; token: FormAssessmentToken }
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
	type Context = Input & { capability: FormCapability<Scope, Reason> | undefined }
	type Event =
		| FormChildEvent<Observation>
		| { type: 'PROJECTED'; capability: FormCapability<Scope, Reason> }
	const actors = { source: options.availability }
	const workflow = setup<
		Context,
		Event,
		typeof actors,
		{},
		{},
		{},
		never,
		string,
		Input,
		FormReadinessResult<Scope, Reason>
	>({ actors })
	const publish = workflow.enqueueActions(({ context, event, enqueue }) => {
		if (context.delivery.kind !== 'watch' || event.type !== 'PROJECTED') return
		enqueue.sendTo(context.delivery.recipient, {
			type: 'FORM_CAPABILITY_REPORTED',
			generation: context.delivery.generation,
			capability: event.capability
		})
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
					src: 'source',
					input: ({ context }) => context.observation,
					onSnapshot: {
						guard: ({ event }) => event.snapshot.status === 'active',
						actions: raise(({ event }) => ({
							type: 'PROJECTED',
							capability: options.selectAvailability(event.snapshot)
						}))
					},
					onError: '#scoped-form-readiness.failed',
					onDone: '#scoped-form-readiness.failed'
				},
				states: {
					selecting: {
						always: [
							{ guard: ({ context }) => context.delivery.kind === 'watch', target: 'watching' },
							{ target: 'assessing' }
						]
					},
					watching: {
						on: {
							OBSERVE: {
								actions: [
									assign({ observation: ({ event }) => event.observation }),
									forwardTo('source')
								]
							},
							PROJECTED: {
								guard: ({ context, event }) =>
									event.capability.revision === context.observation.revision &&
									options.sameScope(
										event.capability.scope,
										options.scopeOf(context.observation.facts)
									),
								actions: publish
							}
						}
					},
					assessing: {
						on: {
							PROJECTED: {
								guard: ({ context, event }) =>
									event.capability.revision === context.observation.revision &&
									options.sameScope(
										event.capability.scope,
										options.scopeOf(context.observation.facts)
									),
								target: '#scoped-form-readiness.assessed',
								actions: assign({ capability: ({ event }) => event.capability })
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
