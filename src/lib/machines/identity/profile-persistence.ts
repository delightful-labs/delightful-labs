import { assign, fromPromise, setup, stateIn } from 'xstate'
import type { ProfileObservation, ProfileReason, ProfileScope } from '../../contracts/profile.js'
import {
	formInterruptionResult,
	type FormChildEvent,
	type FormOperationInput,
	type FormOperationResult
} from '../../contracts/scoped-form.js'
import { profileScope, sameProfileScope } from '../../contracts/profile.js'

function unavailableReason(facts: ProfileObservation): ProfileReason | undefined {
	if (!facts.sessionReady || !facts.identityId) return 'sessionUnavailable'
	if (facts.failed) return 'loadFailed'
	if (facts.loading) return 'loading'
	if (!facts.profile || facts.profile.userId !== facts.identityId) return 'profileUnavailable'
	return undefined
}

/** Domain admission and draining around exactly one host-owned persistence operation. */
export function createProfilePersistenceMachine<Values>(options: {
	save: (profileId: string, identityId: string, values: Values) => Promise<unknown>
	settlement: 'locallyPersisted' | 'confirmed'
}) {
	type Input = FormOperationInput<Values, ProfileScope, ProfileObservation>
	type Output = FormOperationResult<void, ProfileReason>
	type Context = {
		request: Input['request'] | undefined
		observation: Input['observation'] | undefined
		result: Output
	}
	const failure: Output = { outcome: 'failed', code: 'operationFailed', settlement: 'notStarted' }
	const actors = {
		// The machine admits scope first; this final argument check cannot issue an invalid save.
		save: fromPromise<'saved' | 'notIssued', Context>(({ input }) => {
			const request = input.request
			if (!request || request.scope.identityId === null || request.scope.profileId === null)
				return Promise.resolve('notIssued')
			return options
				.save(request.scope.profileId, request.scope.identityId, request.values)
				.then(() => 'saved')
		})
	}
	const model = setup<
		Context,
		FormChildEvent<ProfileObservation>,
		typeof actors,
		{},
		{},
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
		guards: {
			closing: stateIn({ saving: 'closing' }),
			invalidated: stateIn({ saving: 'invalidated' }),
			cancelling: stateIn({ saving: 'cancelling' })
		}
	})
	const clear = model.assign({ request: undefined, observation: undefined })
	return model.createMachine({
		id: 'profile-persistence',
		initial: 'admitting',
		context: ({ input }) => ({ ...input, result: failure }),
		output: ({ context }) => context.result,
		on: {
			CANCEL: {
				target: '.complete',
				actions: assign({ result: { outcome: 'cancelled', settlement: 'notStarted' } })
			},
			INVALIDATE: {
				target: '.complete',
				actions: assign({ result: { outcome: 'scopeChanged', settlement: 'notStarted' } })
			},
			SHUTDOWN: {
				target: '.complete',
				actions: assign({ result: { outcome: 'closed', settlement: 'notStarted' } })
			}
		},
		states: {
			admitting: {
				always: [
					{
						guard: ({ context }) => context.request?.scope.identityId == null,
						target: 'unavailable',
						actions: assign({
							result: {
								outcome: 'unavailable',
								reason: 'sessionUnavailable',
								settlement: 'notStarted'
							}
						})
					},
					{
						guard: ({ context }) => context.request?.scope.profileId == null,
						target: 'unavailable',
						actions: assign({
							result: {
								outcome: 'unavailable',
								reason: 'profileUnavailable',
								settlement: 'notStarted'
							}
						})
					},
					{
						guard: ({ context }) =>
							context.observation !== undefined &&
							unavailableReason(context.observation.facts) !== undefined,
						target: 'unavailable',
						actions: assign({
							result: ({ context }): Output => ({
								outcome: 'unavailable',
								reason: context.observation
									? (unavailableReason(context.observation.facts) ?? 'profileUnavailable')
									: 'profileUnavailable',
								settlement: 'notStarted'
							})
						})
					},
					{
						guard: ({ context }) =>
							context.request !== undefined &&
							context.observation !== undefined &&
							sameProfileScope(context.request.scope, profileScope(context.observation.facts)),
						target: 'saving'
					},
					{
						target: 'complete',
						actions: assign({ result: { outcome: 'scopeChanged', settlement: 'notStarted' } })
					}
				]
			},
			saving: {
				initial: 'pending',
				invoke: {
					src: 'save',
					input: ({ context }) => context,
					onDone: [
						{
							guard: 'closing',
							target: 'complete',
							actions: assign({
								result: ({ event }): Output => ({
									outcome: 'closed',
									settlement: event.output === 'saved' ? options.settlement : 'notStarted'
								})
							})
						},
						{
							guard: 'invalidated',
							target: 'complete',
							actions: assign({
								result: ({ event }): Output => ({
									outcome: 'scopeChanged',
									settlement: event.output === 'saved' ? options.settlement : 'notStarted'
								})
							})
						},
						{
							guard: 'cancelling',
							target: 'complete',
							actions: assign({
								result: ({ event }): Output => ({
									outcome: 'cancelled',
									settlement: event.output === 'saved' ? options.settlement : 'notStarted'
								})
							})
						},
						{
							guard: ({ event }) => event.output === 'saved',
							target: 'complete',
							actions: assign({
								result: (): Output => ({
									outcome: 'succeeded',
									value: undefined,
									settlement: options.settlement
								})
							})
						},
						{
							target: 'unavailable',
							actions: assign({
								result: {
									outcome: 'unavailable',
									reason: 'profileUnavailable',
									settlement: 'notStarted'
								}
							})
						}
					],
					onError: [
						{
							guard: 'closing',
							target: 'complete',
							actions: assign({ result: () => formInterruptionResult('closed', undefined) })
						},
						{
							guard: 'invalidated',
							target: 'complete',
							actions: assign({ result: () => formInterruptionResult('scopeChanged', undefined) })
						},
						{
							guard: 'cancelling',
							target: 'complete',
							actions: assign({ result: () => formInterruptionResult('cancelled', undefined) })
						},
						{
							target: 'complete',
							actions: assign({
								result: { outcome: 'failed', code: 'operationFailed', settlement: 'unknown' }
							})
						}
					]
				},
				on: {
					CANCEL: '.cancelling',
					INVALIDATE: '.invalidated',
					SHUTDOWN: '.closing',
					OBSERVE: {
						guard: ({ context, event }) =>
							context.request !== undefined &&
							(!sameProfileScope(context.request.scope, profileScope(event.observation.facts)) ||
								unavailableReason(event.observation.facts) !== undefined),
						target: '.invalidated'
					}
				},
				states: {
					pending: {},
					cancelling: { on: { CANCEL: {} } },
					invalidated: { on: { CANCEL: {}, INVALIDATE: {}, OBSERVE: {} } },
					closing: { on: { CANCEL: {}, INVALIDATE: {}, SHUTDOWN: {}, OBSERVE: {} } }
				}
			},
			unavailable: { type: 'final', entry: clear },
			complete: { type: 'final', entry: clear }
		}
	})
}
