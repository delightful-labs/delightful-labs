import { assign, fromPromise, setup, stateIn } from 'xstate'
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
	type Assessment = InvitationReadiness | { kind: 'failed' }
	const actors = {
		assess: fromPromise<
			Assessment,
			{ identity: InvitationIdentity<Scope>; capability: InvitationCapability<Scope> }
		>(async ({ input }) => {
			try {
				return input.capability.assess(input.identity)
			} catch {
				return { kind: 'failed' }
			}
		}),
		redeem: fromPromise<Exclude<InvitationSettlement, { kind: 'notStarted' }>, Input>(
			async ({ input }) => {
				try {
					return { kind: 'confirmed', decision: await input.capability.redeem(input.request) }
				} catch {
					return { kind: 'unknown' }
				}
			}
		)
	}
	const model = setup<
		Context,
		InvitationEvent,
		typeof actors,
		{},
		{},
		{ closing: undefined; invalidated: undefined; cancelling: undefined },
		never,
		string,
		Input,
		InvitationResult<Scope>
	>({
		actors,
		guards: {
			closing: stateIn({ redeeming: { control: 'closing' } }),
			invalidated: stateIn({ redeeming: { control: 'invalidated' } }),
			cancelling: stateIn({ redeeming: { control: 'cancelling' } })
		}
	})
	const terminal = (outcome: 'cancelled' | 'scopeChanged' | 'closed') =>
		model.createStateConfig({
			type: 'final',
			entry: assign({
				request: undefined,
				capability: undefined,
				result: ({ context }): InvitationResult<Scope> => ({
					...context.identity,
					outcome,
					settlement: context.settlement
				})
			})
		})
	return model.createMachine({
		id: 'invitation-redemption',
		initial: 'validating',
		context: ({ input }) => ({
			identity: {
				operationId: input.request.operationId,
				invitationId: input.request.invitationId,
				scope: input.request.scope
			},
			request: input.request,
			capability: input.capability,
			settlement: { kind: 'notStarted' },
			result: undefined
		}),
		output: ({ context }) => required(context.result),
		on: { CANCEL: '.cancelled', INVALIDATE: '.scopeChanged', SHUTDOWN: '.closed' },
		states: {
			validating: {
				always: [
					{
						guard: ({ context }) =>
							Boolean(
								context.identity.operationId.trim() &&
								context.identity.invitationId.trim() &&
								context.request?.code.trim()
							),
						target: 'assessing'
					},
					{ target: 'invalid' }
				]
			},
			assessing: {
				invoke: {
					src: 'assess',
					input: ({ context }) => ({
						identity: context.identity,
						capability: required(context.capability)
					}),
					onDone: [
						{ guard: ({ event }) => event.output.kind === 'ready', target: 'redeeming' },
						{
							guard: ({ event }) => event.output.kind === 'blocked',
							target: 'blocked',
							actions: assign({
								request: undefined,
								capability: undefined,
								result: ({ context, event }): InvitationResult<Scope> => {
									if (event.output.kind !== 'blocked')
										throw new Error('Expected blocked invitation readiness')
									return {
										...context.identity,
										outcome: 'blocked',
										reason: event.output.reason,
										settlement: { kind: 'notStarted' }
									}
								}
							})
						},
						{ target: 'failed' }
					],
					onError: 'failed'
				}
			},
			redeeming: {
				type: 'parallel',
				states: {
					control: {
						initial: 'active',
						on: { CANCEL: '.cancelling', INVALIDATE: '.invalidated', SHUTDOWN: '.closing' },
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
									onDone: {
										target: 'resolving',
										actions: assign({ settlement: ({ event }) => event.output })
									},
									onError: {
										target: 'resolving',
										actions: assign({ settlement: { kind: 'unknown' } })
									}
								}
							},
							resolving: {
								always: [
									{ guard: 'closing', target: '#invitation-redemption.closed' },
									{ guard: 'invalidated', target: '#invitation-redemption.scopeChanged' },
									{ guard: 'cancelling', target: '#invitation-redemption.cancelled' },
									{
										guard: ({ context }) => context.settlement.kind === 'confirmed',
										target: '#invitation-redemption.completed'
									},
									{ target: '#invitation-redemption.failed' }
								]
							}
						}
					}
				}
			},
			completed: {
				type: 'final',
				entry: assign({
					request: undefined,
					capability: undefined,
					result: ({ context }): InvitationResult<Scope> => {
						if (context.settlement.kind !== 'confirmed')
							throw new Error('Expected authority confirmation')
						return { ...context.identity, outcome: 'completed', settlement: context.settlement }
					}
				})
			},
			invalid: {
				type: 'final',
				entry: assign({
					request: undefined,
					capability: undefined,
					result: ({ context }): InvitationResult<Scope> => ({
						...context.identity,
						outcome: 'invalid',
						settlement: { kind: 'notStarted' }
					})
				})
			},
			blocked: { type: 'final' },
			failed: {
				type: 'final',
				entry: assign({
					request: undefined,
					capability: undefined,
					result: ({ context }): InvitationResult<Scope> => ({
						...context.identity,
						outcome: 'failed',
						settlement: {
							kind: context.settlement.kind === 'notStarted' ? 'notStarted' : 'unknown'
						}
					})
				})
			},
			cancelled: terminal('cancelled'),
			scopeChanged: terminal('scopeChanged'),
			closed: terminal('closed')
		}
	})
}
