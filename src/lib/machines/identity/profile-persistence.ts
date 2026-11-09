import { matchesState, type StateValue, types, createAsyncLogic, setup } from 'xstate'

import type { EventPayload } from '../../contracts/machine-events.js'
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
		save: createAsyncLogic<'saved' | 'notIssued', Context>({
			run: ({ input }) => {
				const request = input.request
				if (!request || request.scope.identityId === null || request.scope.profileId === null)
					return Promise.resolve('notIssued')
				return options
					.save(request.scope.profileId, request.scope.identityId, request.values)
					.then(() => 'saved')
			}
		})
	}
	const model = setup({
		schemas: {
			context: types<Context>(),
			events: {
				CANCEL: types<EventPayload<FormChildEvent<ProfileObservation>, 'CANCEL'>>(),
				SHUTDOWN: types<EventPayload<FormChildEvent<ProfileObservation>, 'SHUTDOWN'>>(),
				INVALIDATE: types<EventPayload<FormChildEvent<ProfileObservation>, 'INVALIDATE'>>(),
				OBSERVE: types<EventPayload<FormChildEvent<ProfileObservation>, 'OBSERVE'>>()
			},
			input: types<Input>(),
			output: types<Output>()
		},
		actors,
		guards: {
			closing: ({ value }: { value: StateValue }) => matchesState({ saving: 'closing' }, value),
			invalidated: ({ value }: { value: StateValue }) =>
				matchesState({ saving: 'invalidated' }, value),
			cancelling: ({ value }: { value: StateValue }) =>
				matchesState({ saving: 'cancelling' }, value)
		}
	})
	type CompletionEntry = Extract<
		NonNullable<Parameters<typeof model.createStateConfig>[0]['entry']>,
		(...args: never[]) => unknown
	>
	type CompletionArgs = Pick<Parameters<CompletionEntry>[0], 'context' | 'actions'>
	type CompletionQueue = Parameters<CompletionEntry>[1]
	const finalizers = {
		unavailable: (_args) => {
			return {
				context: { request: undefined, observation: undefined } satisfies Partial<Context>
			}
		},
		complete: (_args) => {
			return {
				context: { request: undefined, observation: undefined } satisfies Partial<Context>
			}
		}
	} satisfies Record<
		string,
		(args: CompletionArgs, enq: CompletionQueue) => void | { context?: Partial<Context> }
	>

	return model.createMachine({
		id: 'profile-persistence',
		initial: 'admitting',
		context: ({ input }) => ({ ...input, result: failure }),
		output: ({ context }) => context.result,
		on: {
			CANCEL: (_args) => {
				return {
					target: '.complete',
					context: {
						result: { outcome: 'cancelled', settlement: 'notStarted' }
					} satisfies Partial<Context>
				}
			},
			INVALIDATE: (_args) => {
				return {
					target: '.complete',
					context: {
						result: { outcome: 'scopeChanged', settlement: 'notStarted' }
					} satisfies Partial<Context>
				}
			},
			SHUTDOWN: (_args) => {
				return {
					target: '.complete',
					context: {
						result: { outcome: 'closed', settlement: 'notStarted' }
					} satisfies Partial<Context>
				}
			}
		},
		states: {
			admitting: {
				always: (args) => {
					const { context } = args
					if (context.request?.scope.identityId == null) {
						return {
							target: 'unavailable',
							context: {
								result: {
									outcome: 'unavailable',
									reason: 'sessionUnavailable',
									settlement: 'notStarted'
								}
							} satisfies Partial<Context>
						}
					}
					if (context.request?.scope.profileId == null) {
						return {
							target: 'unavailable',
							context: {
								result: {
									outcome: 'unavailable',
									reason: 'profileUnavailable',
									settlement: 'notStarted'
								}
							} satisfies Partial<Context>
						}
					}
					if (
						context.observation !== undefined &&
						unavailableReason(context.observation.facts) !== undefined
					) {
						return {
							target: 'unavailable',
							context: {
								result: {
									outcome: 'unavailable',
									reason: context.observation
										? (unavailableReason(context.observation.facts) ?? 'profileUnavailable')
										: 'profileUnavailable',
									settlement: 'notStarted'
								}
							} satisfies Partial<Context>
						}
					}
					if (
						context.request !== undefined &&
						context.observation !== undefined &&
						sameProfileScope(context.request.scope, profileScope(context.observation.facts))
					) {
						return { target: 'saving' }
					}

					return {
						target: 'complete',
						context: {
							result: { outcome: 'scopeChanged', settlement: 'notStarted' }
						} satisfies Partial<Context>
					}
				}
			},
			saving: {
				initial: 'pending',
				invoke: {
					src: actors.save,
					input: ({ context }) => context,
					onDone: (args) => {
						const { event } = args
						if (matchesState({ saving: 'closing' }, args.value)) {
							return {
								target: 'complete',
								context: {
									result: {
										outcome: 'closed',
										settlement: event.output === 'saved' ? options.settlement : 'notStarted'
									}
								} satisfies Partial<Context>
							}
						}
						if (matchesState({ saving: 'invalidated' }, args.value)) {
							return {
								target: 'complete',
								context: {
									result: {
										outcome: 'scopeChanged',
										settlement: event.output === 'saved' ? options.settlement : 'notStarted'
									}
								} satisfies Partial<Context>
							}
						}
						if (matchesState({ saving: 'cancelling' }, args.value)) {
							return {
								target: 'complete',
								context: {
									result: {
										outcome: 'cancelled',
										settlement: event.output === 'saved' ? options.settlement : 'notStarted'
									}
								} satisfies Partial<Context>
							}
						}
						if (event.output === 'saved') {
							return {
								target: 'complete',
								context: {
									result: {
										outcome: 'succeeded',
										value: undefined,
										settlement: options.settlement
									}
								} satisfies Partial<Context>
							}
						}

						return {
							target: 'unavailable',
							context: {
								result: {
									outcome: 'unavailable',
									reason: 'profileUnavailable',
									settlement: 'notStarted'
								}
							} satisfies Partial<Context>
						}
					},
					onError: (args) => {
						if (matchesState({ saving: 'closing' }, args.value)) {
							return {
								target: 'complete',
								context: {
									result: formInterruptionResult('closed', undefined)
								} satisfies Partial<Context>
							}
						}
						if (matchesState({ saving: 'invalidated' }, args.value)) {
							return {
								target: 'complete',
								context: {
									result: formInterruptionResult('scopeChanged', undefined)
								} satisfies Partial<Context>
							}
						}
						if (matchesState({ saving: 'cancelling' }, args.value)) {
							return {
								target: 'complete',
								context: {
									result: formInterruptionResult('cancelled', undefined)
								} satisfies Partial<Context>
							}
						}

						return {
							target: 'complete',
							context: {
								result: { outcome: 'failed', code: 'operationFailed', settlement: 'unknown' }
							} satisfies Partial<Context>
						}
					}
				},
				on: {
					CANCEL: { target: '.cancelling' },
					INVALIDATE: { target: '.invalidated' },
					SHUTDOWN: { target: '.closing' },
					OBSERVE: (args) => {
						const { context, event } = args
						if (
							!(
								context.request !== undefined &&
								(!sameProfileScope(context.request.scope, profileScope(event.observation.facts)) ||
									unavailableReason(event.observation.facts) !== undefined)
							)
						)
							return
						return { target: '.invalidated' }
					}
				},
				states: {
					pending: {},
					cancelling: { on: { CANCEL: {} } },
					invalidated: { on: { CANCEL: {}, INVALIDATE: {}, OBSERVE: {} } },
					closing: { on: { CANCEL: {}, INVALIDATE: {}, SHUTDOWN: {}, OBSERVE: {} } }
				}
			},
			unavailable: {
				type: 'final',
				entry: finalizers.unavailable
			},
			complete: {
				type: 'final',
				entry: finalizers.complete
			}
		}
	})
}
