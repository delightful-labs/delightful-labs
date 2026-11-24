import { sameTransferMutationScope } from '../../contracts/transfer-scope-drain.js'
import { setup, types } from 'xstate'
import {
	createInternalTransferMutationOwner,
	rejectedTransferMutation,
	type TransferMutationRequest
} from './internal-transfer-mutation-owner.js'
import type {
	TransferMutationScope,
	TransferScopeDrainIdentity,
	TransferScopeDrainResponse
} from '../../contracts/transfer-scope-drain.js'

type Context = {
	desired: TransferMutationScope | undefined
	bound: TransferMutationScope | undefined
	drain: TransferScopeDrainIdentity | undefined
	outcome: 'closed' | 'unresolved'
}
function sameScope(
	left: TransferMutationScope | undefined,
	right: TransferMutationScope | undefined
) {
	return (left === undefined && right === undefined) || sameTransferMutationScope(left, right)
}
function requiredScope(scope: TransferMutationScope | undefined) {
	if (!scope) throw new Error('Missing admitted transfer scope')
	return scope
}

/** Scope changes wait for the existing native owner's drain receipt before rebinding. */
export function createWorkerTransferOwner() {
	const owner = createInternalTransferMutationOwner()
	return setup({
		schemas: {
			input: types<{ scope: TransferMutationScope | undefined }>(),
			context: types<Context>(),
			output: types<{ outcome: 'closed' | 'unresolved' }>(),
			events: {
				OBSERVE: types<{ scope: TransferMutationScope | undefined }>(),
				REQUEST: types<{ request: TransferMutationRequest }>(),
				CANCEL_TRANSFER_MUTATION: types<{ requestId: string }>(),
				TRANSFER_SCOPE_DRAIN_RESULT: types<Omit<TransferScopeDrainResponse, 'type'>>(),
				TRANSFER_MUTATION_OWNER_CLOSED: types(),
				SHUTDOWN: types()
			},
			children: { owner: types<import('xstate').ActorRefFrom<typeof owner>>() }
		},
		actors: { owner },
		guards: {
			matchingDrain: ({ context, event }) =>
				event.type === 'TRANSFER_SCOPE_DRAIN_RESULT' &&
				event.request.token === context.drain?.token &&
				sameScope(event.request.scope, context.bound)
		}
	}).createMachine({
		id: 'finance-worker-transfer-owner',
		context: ({ input }) => ({
			desired: input.scope,
			bound: undefined,
			drain: undefined,
			outcome: 'closed'
		}),
		initial: 'observing',
		output: ({ context }) => ({ outcome: context.outcome }),
		invoke: {
			id: 'owner',
			src: 'owner',
			onDone: ({ event, value }) =>
				value === 'closingOwner' && event.output.outcome === 'closed'
					? { target: '.closed' }
					: { target: '.failed', context: { outcome: 'unresolved' } },
			onError: { target: '.failed', context: { outcome: 'unresolved' } }
		},
		on: {
			OBSERVE: ({ event }) => ({ context: { desired: event.scope } }),
			REQUEST: ({ event }, enq) =>
				enq(() =>
					event.request.recipient.send({
						type: 'TRANSFER_MUTATION_RESULT',
						requestId: event.request.requestId,
						result: rejectedTransferMutation(event.request)
					})
				),
			CANCEL_TRANSFER_MUTATION: ({ event }, enq) => enq.sendTo('owner', event),
			TRANSFER_MUTATION_OWNER_CLOSED: {}
		},
		states: {
			observing: {
				always: ({ context }) =>
					context.desired
						? { target: 'ready', context: { bound: context.desired, drain: undefined } }
						: { target: 'unavailable', context: { bound: undefined, drain: undefined } }
			},
			unavailable: {
				on: {
					OBSERVE: ({ event }) => ({ target: 'observing', context: { desired: event.scope } }),
					SHUTDOWN: { target: 'closingOwner' }
				}
			},
			ready: {
				entry: ({ context }, enq) =>
					enq.sendTo('owner', { type: 'BIND_TRANSFER_SCOPE', scope: requiredScope(context.bound) }),
				on: {
					OBSERVE: ({ context, event }) =>
						sameScope(context.bound, event.scope)
							? undefined
							: { target: 'draining', context: { desired: event.scope } },
					REQUEST: ({ context, event }, enq) => {
						if (sameScope(event.request.scope, context.bound))
							enq.sendTo('owner', { type: 'REQUEST_TRANSFER_MUTATION', request: event.request })
						else
							enq(() =>
								event.request.recipient.send({
									type: 'TRANSFER_MUTATION_RESULT',
									requestId: event.request.requestId,
									result: rejectedTransferMutation(event.request)
								})
							)
					},
					SHUTDOWN: { target: 'closingScope' }
				}
			},
			draining: {
				entry: ({ context, self }, enq) => {
					const drain = { token: {}, scope: requiredScope(context.bound) }
					enq.sendTo('owner', {
						type: 'DRAIN_TRANSFER_SCOPE',
						drain: { request: drain, recipient: { send: (event) => self.send(event) } }
					})
					return { context: { drain } }
				},
				on: {
					TRANSFER_SCOPE_DRAIN_RESULT: (args) => {
						if (!args.guards.matchingDrain(args)) return
						return args.event.outcome === 'released' || args.event.outcome === 'releasedWithFailure'
							? { target: 'observing' }
							: { target: 'failed', context: { outcome: 'unresolved' } }
					},
					SHUTDOWN: { target: 'closingScope', reenter: false }
				}
			},
			closingScope: {
				entry: ({ context, self }, enq) => {
					if (context.drain) return
					const drain = { token: {}, scope: requiredScope(context.bound) }
					enq.sendTo('owner', {
						type: 'DRAIN_TRANSFER_SCOPE',
						drain: { request: drain, recipient: { send: (event) => self.send(event) } }
					})
					return { context: { drain } }
				},
				on: {
					OBSERVE: {},
					SHUTDOWN: {},
					TRANSFER_SCOPE_DRAIN_RESULT: (args) => {
						if (!args.guards.matchingDrain(args)) return
						return args.event.outcome === 'released' || args.event.outcome === 'releasedWithFailure'
							? { target: 'closingOwner' }
							: { target: 'failed', context: { outcome: 'unresolved' } }
					}
				}
			},
			closingOwner: {
				entry: (_, enq) => enq.sendTo('owner', { type: 'SHUTDOWN' }),
				on: { OBSERVE: {}, SHUTDOWN: {} }
			},
			failed: { type: 'final' },
			closed: { type: 'final' }
		}
	})
}
