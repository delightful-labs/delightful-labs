import { matchesState, type StateValue, types, createAsyncLogic, setup } from 'xstate'

import type { EventPayload } from '../../contracts/machine-events.js'
import type {
	InvitationCapability,
	InvitationEvent,
	InvitationIdentity,
	InvitationReadiness,
	InvitationRequest,
	InvitationResult,
	InvitationSettlement
} from '../../contracts/workspace-invitation.js'
type InvitationInput<Scope> = {
	request: InvitationRequest<Scope>
	capability: InvitationCapability<Scope>
}
type InvitationContext<Scope> = {
	identity: InvitationIdentity<Scope>
	request: InvitationRequest<Scope> | undefined
	capability: InvitationCapability<Scope> | undefined
	settlement: InvitationSettlement
	result: InvitationResult<Scope> | undefined
}
function required<Value>(value: Value | undefined): Value {
	if (value === undefined) throw new Error('Missing invitation operation resource')
	return value
}
/** One explicit online administration operation; never a startup or ordinary local-read dependency. */
export function createInvitationRedemptionMachine<Scope>() {
	type Context = InvitationContext<Scope>
	type Input = InvitationInput<Scope>
	type Assessment =
		| InvitationReadiness
		| {
				kind: 'failed'
		  }
	const actors = {
		assess: createAsyncLogic<
			Assessment,
			{
				identity: InvitationIdentity<Scope>
				capability: InvitationCapability<Scope>
			}
		>({
			run: async ({ input }) => {
				try {
					return input.capability.assess(input.identity)
				} catch {
					return { kind: 'failed' }
				}
			}
		}),
		redeem: createAsyncLogic<
			Exclude<
				InvitationSettlement,
				{
					kind: 'notStarted'
				}
			>,
			Input
		>({
			run: async ({ input }) => {
				try {
					return { kind: 'confirmed', decision: await input.capability.redeem(input.request) }
				} catch {
					return { kind: 'unknown' }
				}
			}
		})
	}
	const model = setup({
		schemas: {
			context: types<Context>(),
			events: {
				CANCEL: types<EventPayload<InvitationEvent, 'CANCEL'>>(),
				SHUTDOWN: types<EventPayload<InvitationEvent, 'SHUTDOWN'>>(),
				INVALIDATE: types<EventPayload<InvitationEvent, 'INVALIDATE'>>()
			},
			input: types<Input>(),
			output: types<InvitationResult<Scope>>()
		},
		actors,
		guards: {
			closing: ({ value }: { value: StateValue }) =>
				matchesState({ redeeming: { control: 'closing' } }, value),
			invalidated: ({ value }: { value: StateValue }) =>
				matchesState({ redeeming: { control: 'invalidated' } }, value),
			cancelling: ({ value }: { value: StateValue }) =>
				matchesState({ redeeming: { control: 'cancelling' } }, value)
		}
	})

	type CompletionEntry = Extract<
		NonNullable<Parameters<typeof model.createStateConfig>[0]['entry']>,
		(...args: never[]) => unknown
	>
	type CompletionArgs = Pick<Parameters<CompletionEntry>[0], 'context' | 'actions'>
	type CompletionQueue = Parameters<CompletionEntry>[1]
	const finalizers = {
		completed: (args) => {
			return {
				context: {
					request: undefined,
					capability: undefined,
					result: (({ context }): InvitationResult<Scope> => {
						if (context.settlement.kind !== 'confirmed')
							throw new Error('Expected authority confirmation')
						return {
							...context.identity,
							outcome: 'completed',
							settlement: context.settlement
						}
					})(args)
				} satisfies Partial<Context>
			}
		},
		invalid: (args) => {
			return {
				context: {
					request: undefined,
					capability: undefined,
					result: {
						...args.context.identity,
						outcome: 'invalid',
						settlement: { kind: 'notStarted' }
					}
				} satisfies Partial<Context>
			}
		},
		failed: (args) => {
			const { context } = args
			return {
				context: {
					request: undefined,
					capability: undefined,
					result: {
						...context.identity,
						outcome: 'failed',
						settlement: {
							kind: context.settlement.kind === 'notStarted' ? 'notStarted' : 'unknown'
						}
					}
				} satisfies Partial<Context>
			}
		},
		cancelled: (args) => {
			const { context } = args
			return {
				context: {
					request: undefined,
					capability: undefined,
					result: {
						...context.identity,
						outcome: 'cancelled',
						settlement: context.settlement
					}
				} satisfies Partial<Context>
			}
		},
		scopeChanged: (args) => {
			const { context } = args
			return {
				context: {
					request: undefined,
					capability: undefined,
					result: {
						...context.identity,
						outcome: 'scopeChanged',
						settlement: context.settlement
					}
				} satisfies Partial<Context>
			}
		},
		closed: (args) => {
			const { context } = args
			return {
				context: {
					request: undefined,
					capability: undefined,
					result: {
						...context.identity,
						outcome: 'closed',
						settlement: context.settlement
					}
				} satisfies Partial<Context>
			}
		}
	} satisfies Record<
		string,
		(args: CompletionArgs, enq: CompletionQueue) => void | { context?: Partial<Context> }
	>

	return model.createMachine({
		id: 'invitation-redemption',
		initial: 'validating',
		context: ({ input }) => ({
			identity: {
				operationId: input.request.operationId,
				invitationId: input.request.invitationId,
				scope: input.request.scope
			},
			request: { ...input.request },
			capability: input.capability,
			settlement: { kind: 'notStarted' },
			result: undefined
		}),
		output: ({ context }) => required(context.result),
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
			validating: {
				always: (args) => {
					const { context } = args
					if (
						context.identity.operationId.trim() &&
						context.identity.invitationId.trim() &&
						context.request?.code.trim()
					) {
						return { target: 'assessing' }
					}

					return { target: 'invalid' }
				}
			},
			assessing: {
				invoke: {
					src: actors.assess,
					input: ({ context }) => ({
						identity: context.identity,
						capability: required(context.capability)
					}),
					onDone: (args) => {
						const { event } = args
						if (event.output.kind === 'ready') {
							return { target: 'redeeming' }
						}
						if (event.output.kind === 'blocked') {
							return {
								target: 'blocked',
								context: {
									request: undefined,
									capability: undefined,
									result: (({ context, event }): InvitationResult<Scope> => {
										if (event.output.kind !== 'blocked')
											throw new Error('Expected blocked invitation readiness')
										return {
											...context.identity,
											outcome: 'blocked',
											reason: event.output.reason,
											settlement: { kind: 'notStarted' }
										}
									})(args)
								} satisfies Partial<Context>
							}
						}

						return { target: 'failed' }
					},
					onError: (_args) => {
						return { target: 'failed' }
					}
				}
			},
			redeeming: {
				type: 'parallel',
				states: {
					control: {
						initial: 'active',
						on: {
							CANCEL: { target: '.cancelling' },
							INVALIDATE: { target: '.invalidated' },
							SHUTDOWN: { target: '.closing' }
						},
						states: {
							active: {},
							cancelling: { on: { CANCEL: {} } },
							invalidated: { on: { CANCEL: {}, INVALIDATE: {} } },
							closing: { on: { CANCEL: {}, INVALIDATE: {}, SHUTDOWN: {} } }
						}
					},
					request: {
						initial: 'pending',
						states: {
							pending: {
								invoke: {
									src: 'redeem',
									input: ({ context }) => ({
										request: required(context.request),
										capability: required(context.capability)
									}),
									onDone: (args) => {
										return {
											target: 'resolving',
											context: { settlement: args.event.output } satisfies Partial<Context>
										}
									},
									onError: (_args) => {
										return {
											target: 'resolving',
											context: { settlement: { kind: 'unknown' } } satisfies Partial<Context>
										}
									}
								}
							},
							resolving: {
								always: (args) => {
									if (matchesState({ redeeming: { control: 'closing' } }, args.value)) {
										return {
											target: '#invitation-redemption.closed'
										}
									}
									if (matchesState({ redeeming: { control: 'invalidated' } }, args.value)) {
										return {
											target: '#invitation-redemption.scopeChanged'
										}
									}
									if (matchesState({ redeeming: { control: 'cancelling' } }, args.value)) {
										return {
											target: '#invitation-redemption.cancelled'
										}
									}
									if (args.context.settlement.kind === 'confirmed') {
										return {
											target: '#invitation-redemption.completed'
										}
									}

									return {
										target: '#invitation-redemption.failed'
									}
								}
							}
						}
					}
				}
			},
			completed: {
				type: 'final',
				entry: finalizers.completed
			},
			invalid: {
				type: 'final',
				entry: finalizers.invalid
			},
			blocked: { type: 'final' },
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
