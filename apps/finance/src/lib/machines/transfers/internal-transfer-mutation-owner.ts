import type {
	TransferMutationScope,
	TransferScopeDrainRequest,
	TransferScopeDrainResponse,
	TransferMutationOwnerOutput
} from '../../contracts/transfer-scope-drain.js'
import type {
	InternalTransferCreateInput,
	InternalTransferCreateResult
} from './internal-transfer-create.js'
import type {
	InternalTransferLinkInput,
	InternalTransferLinkResult,
	InternalTransferUnlinkInput,
	InternalTransferUnlinkResult,
	InternalTransferDeleteInput,
	InternalTransferDeleteResult
} from './internal-transfer.js'
import { createInternalTransferCreateMachine } from './internal-transfer-create.js'
import {
	internalTransferDeleteMachine,
	internalTransferLinkMachine,
	internalTransferUnlinkMachine
} from './internal-transfer.js'
import { setup, types, matchesState } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'

export type TransferMutationResult =
	| { operation: 'create'; result: InternalTransferCreateResult }
	| { operation: 'link'; result: InternalTransferLinkResult }
	| { operation: 'unlink'; result: InternalTransferUnlinkResult }
	| { operation: 'delete'; result: InternalTransferDeleteResult }

export type TransferMutationResponse = {
	type: 'TRANSFER_MUTATION_RESULT'
	requestId: string
	result: TransferMutationResult
}

export type TransferMutationRecipient = {
	send: (event: TransferMutationResponse) => void
}

export type TransferMutationRequest = { scope?: TransferMutationScope } & (
	| {
			requestId: string
			workspaceId: string
			operation: 'create'
			input: InternalTransferCreateInput
			recipient: TransferMutationRecipient
	  }
	| {
			requestId: string
			workspaceId: string
			operation: 'link'
			input: InternalTransferLinkInput
			recipient: TransferMutationRecipient
	  }
	| {
			requestId: string
			workspaceId: string
			operation: 'unlink'
			input: InternalTransferUnlinkInput
			recipient: TransferMutationRecipient
	  }
	| {
			requestId: string
			workspaceId: string
			operation: 'delete'
			input: InternalTransferDeleteInput
			recipient: TransferMutationRecipient
	  }
)

export type TransferMutationOwnerEvent =
	| { type: 'REQUEST_TRANSFER_MUTATION'; request: TransferMutationRequest }
	| { type: 'CANCEL_TRANSFER_MUTATION'; requestId: string }
	| { type: 'TRANSFER_SCOPE_CHANGED'; workspaceId: string | undefined }
	| { type: 'BIND_TRANSFER_SCOPE'; scope: TransferMutationScope }
	| { type: 'DRAIN_TRANSFER_SCOPE'; drain: TransferScopeDrainRequest }
	| { type: 'SHUTDOWN' }

type Context = {
	workspaceId: string | undefined
	request: TransferMutationRequest | undefined
	queue: TransferMutationRequest[]
	result: TransferMutationResponse | undefined
	scope: TransferMutationScope | undefined
	drain: TransferScopeDrainRequest | undefined
	drainResult: TransferScopeDrainResponse | undefined
	scopeResult: ScopeOutcome | undefined
	retiredDrains: WeakSet<object>
}
type Event = TransferMutationOwnerEvent | { type: 'SCOPE_RELEASED' }

function required<Value>(value: Value | undefined): Value {
	if (value === undefined) throw new Error('Missing transfer mutation request')
	return value
}

function createRequest(
	request: TransferMutationRequest | undefined
): Extract<TransferMutationRequest, { operation: 'create' }> {
	const value = required(request)
	if (value.operation !== 'create') throw new Error('Unexpected transfer mutation request')
	return value
}

function linkRequest(
	request: TransferMutationRequest | undefined
): Extract<TransferMutationRequest, { operation: 'link' }> {
	const value = required(request)
	if (value.operation !== 'link') throw new Error('Unexpected transfer mutation request')
	return value
}

function unlinkRequest(
	request: TransferMutationRequest | undefined
): Extract<TransferMutationRequest, { operation: 'unlink' }> {
	const value = required(request)
	if (value.operation !== 'unlink') throw new Error('Unexpected transfer mutation request')
	return value
}

function deleteRequest(
	request: TransferMutationRequest | undefined
): Extract<TransferMutationRequest, { operation: 'delete' }> {
	const value = required(request)
	if (value.operation !== 'delete') throw new Error('Unexpected transfer deletion request')
	return value
}

export function rejectedTransferMutation(request: TransferMutationRequest): TransferMutationResult {
	if (request.operation === 'create')
		return { operation: 'create', result: { outcome: 'scopeChanged', settlement: 'notStarted' } }
	if (request.operation === 'link')
		return { operation: 'link', result: { outcome: 'unavailable', settlement: 'notStarted' } }
	if (request.operation === 'unlink')
		return { operation: 'unlink', result: { outcome: 'unavailable', settlement: 'notStarted' } }
	return { operation: 'delete', result: { outcome: 'unavailable', settlement: 'notStarted' } }
}

function cancelled(request: TransferMutationRequest): TransferMutationResult {
	if (request.operation === 'create')
		return { operation: 'create', result: { outcome: 'cancelled', settlement: 'notStarted' } }
	if (request.operation === 'link')
		return { operation: 'link', result: { outcome: 'cancelled', settlement: 'notStarted' } }
	if (request.operation === 'unlink')
		return { operation: 'unlink', result: { outcome: 'cancelled', settlement: 'notStarted' } }
	return { operation: 'delete', result: { outcome: 'cancelled', settlement: 'notStarted' } }
}

function failure(request: TransferMutationRequest): TransferMutationResult {
	if (request.operation === 'create')
		return { operation: 'create', result: { outcome: 'unavailable', settlement: 'unresolved' } }
	if (request.operation === 'link')
		return { operation: 'link', result: { outcome: 'unavailable', settlement: 'unresolved' } }
	if (request.operation === 'unlink')
		return { operation: 'unlink', result: { outcome: 'unavailable', settlement: 'unresolved' } }
	return { operation: 'delete', result: { outcome: 'unavailable', settlement: 'unresolved' } }
}

type ScopeOutcome = Readonly<{
	outcome: TransferMutationResult['result']['outcome']
	settlement: TransferMutationResult['result']['settlement']
}>
/** Aggregate only finite outcome facts; never retain raw operation errors or SDK resources. */
function retainScopeResult(
	previous: ScopeOutcome | undefined,
	current: ScopeOutcome | undefined
): ScopeOutcome | undefined {
	if (previous?.settlement === 'unresolved') return previous
	if (current?.settlement === 'unresolved')
		return { outcome: current.outcome, settlement: current.settlement }
	if (previous?.outcome === 'recoveryRequired') return previous
	return current ? { outcome: current.outcome, settlement: current.settlement } : previous
}

function sameScope(
	left: TransferMutationScope | undefined,
	right: TransferMutationScope | undefined
) {
	return (
		left !== undefined &&
		right !== undefined &&
		left.binding === right.binding &&
		left.workspaceId === right.workspaceId &&
		left.generation === right.generation
	)
}
export function createInternalTransferMutationOwner() {
	const actors = {
		create: createInternalTransferCreateMachine(),
		link: internalTransferLinkMachine,
		unlink: internalTransferUnlinkMachine,
		delete: internalTransferDeleteMachine
	}
	const patchFinishFailure = ({ context }: { context: Context }): Partial<Context> => {
		const request = required(context.request)
		return {
			result: {
				type: 'TRANSFER_MUTATION_RESULT',
				requestId: request.requestId,
				result: failure(request)
			}
		}
	}
	const patchSetWorkspace = ({ event }: { event: Event }): Partial<Context> => ({
		workspaceId: event.type === 'TRANSFER_SCOPE_CHANGED' ? event.workspaceId : undefined
	})
	const patchStartNext = ({ context }: { context: Context }): Partial<Context> => ({
		request: context.queue[0],
		queue: context.queue.slice(1),
		result: undefined
	})
	const patchRemoveCancelled = ({
		context,
		event
	}: {
		context: Context
		event: Event
	}): Partial<Context> => ({
		queue:
			event.type === 'CANCEL_TRANSFER_MUTATION'
				? context.queue.filter((item) => item.requestId !== event.requestId)
				: context.queue
	})
	const patchQueueRequest = ({
		context,
		event
	}: {
		context: Context
		event: Event
	}): Partial<Context> => ({
		queue:
			event.type === 'REQUEST_TRANSFER_MUTATION' ? [...context.queue, event.request] : context.queue
	})
	const patchClearCurrent = (): Partial<Context> => ({
		request: undefined,
		result: undefined,
		queue: []
	})
	const patchRememberDrain = ({ event }: { event: Event }): Partial<Context> => {
		if (event.type !== 'DRAIN_TRANSFER_SCOPE') throw new Error('Missing scoped transfer drain')
		return {
			drain: {
				request: { token: event.drain.request.token, scope: { ...event.drain.request.scope } },
				recipient: event.drain.recipient
			},
			drainResult: undefined,
			workspaceId: undefined,
			queue: []
		}
	}
	const patchBindScope = ({ event }: { event: Event }): Partial<Context> => {
		if (event.type !== 'BIND_TRANSFER_SCOPE') throw new Error('Missing transfer scope binding')
		return {
			scope: { ...event.scope },
			workspaceId: event.scope.workspaceId,
			drain: undefined,
			drainResult: undefined,
			scopeResult: undefined
		}
	}
	const patchRecordScopeResult = ({ context }: { context: Context }): Partial<Context> => ({
		scopeResult: retainScopeResult(context.scopeResult, context.result?.result.result)
	})
	const events0 = {
		REQUEST_TRANSFER_MUTATION: types<EventPayload<Event, 'REQUEST_TRANSFER_MUTATION'>>(),
		CANCEL_TRANSFER_MUTATION: types<EventPayload<Event, 'CANCEL_TRANSFER_MUTATION'>>(),
		TRANSFER_SCOPE_CHANGED: types<EventPayload<Event, 'TRANSFER_SCOPE_CHANGED'>>(),
		BIND_TRANSFER_SCOPE: types<EventPayload<Event, 'BIND_TRANSFER_SCOPE'>>(),
		DRAIN_TRANSFER_SCOPE: types<EventPayload<Event, 'DRAIN_TRANSFER_SCOPE'>>(),
		SHUTDOWN: types<EventPayload<Event, 'SHUTDOWN'>>(),
		SCOPE_RELEASED: types<EventPayload<Event, 'SCOPE_RELEASED'>>()
	}
	type NativeEvent0 =
		| import('xstate').InferEvents<typeof events0>
		| import('xstate').DoneActorEvent<
				| import('xstate').OutputFrom<(typeof actors)['create']>
				| import('xstate').OutputFrom<(typeof actors)['link']>
				| import('xstate').OutputFrom<(typeof actors)['unlink']>
				| import('xstate').OutputFrom<(typeof actors)['delete']>
				| import('xstate').OutputFrom<(typeof actors)['create']>
				| import('xstate').OutputFrom<(typeof actors)['link']>
				| import('xstate').OutputFrom<(typeof actors)['unlink']>
				| import('xstate').OutputFrom<(typeof actors)['delete']>
		  >
		| import('xstate').ErrorActorEvent
	const machine = setup({
		schemas: {
			context: types<Context>(),
			events: events0,
			input: types<undefined>(),
			output: types<TransferMutationOwnerOutput>(),
			children: {
				create: types<import('xstate').ActorRefFrom<(typeof actors)['create']>>(),
				link: types<import('xstate').ActorRefFrom<(typeof actors)['link']>>(),
				unlink: types<import('xstate').ActorRefFrom<(typeof actors)['unlink']>>(),
				delete: types<import('xstate').ActorRefFrom<(typeof actors)['delete']>>(),
				createOperation: types<import('xstate').ActorRefFrom<(typeof actors)['create']>>(),
				linkOperation: types<import('xstate').ActorRefFrom<(typeof actors)['link']>>(),
				unlinkOperation: types<import('xstate').ActorRefFrom<(typeof actors)['unlink']>>(),
				deleteOperation: types<import('xstate').ActorRefFrom<(typeof actors)['delete']>>()
			}
		},
		actors,
		guards: {
			legacyMode: ({ context }: { context: Context }) => context.scope === undefined,
			freshScope: ({ context, event }: { context: Context; event: NativeEvent0 }) =>
				event.type === 'BIND_TRANSFER_SCOPE' &&
				event.scope.workspaceId.trim().length > 0 &&
				Number.isSafeInteger(event.scope.generation) &&
				event.scope.generation >= 0 &&
				context.scopeResult?.settlement !== 'unresolved' &&
				(!context.scope || event.scope.generation > context.scope.generation),
			matchingScope: ({ context, event }: { context: Context; event: NativeEvent0 }) =>
				event.type === 'DRAIN_TRANSFER_SCOPE' &&
				sameScope(event.drain.request.scope, context.scope),
			freshDrain: (args: { context: Context; event: Event; value: import('xstate').StateValue }) =>
				(({ context, event }) =>
					event.type === 'DRAIN_TRANSFER_SCOPE' &&
					sameScope(event.drain.request.scope, context.scope))(args) &&
				(({ context, event }) =>
					event.type === 'DRAIN_TRANSFER_SCOPE' &&
					!context.retiredDrains.has(event.drain.request.token))(args),
			sameDrain: ({ context, event }: { context: Context; event: NativeEvent0 }) =>
				event.type === 'DRAIN_TRANSFER_SCOPE' &&
				event.drain.request.token === context.drain?.request.token &&
				event.drain.recipient === context.drain.recipient &&
				sameScope(event.drain.request.scope, context.drain.request.scope),
			pendingDrain: ({ context }: { context: Context }) =>
				context.drain !== undefined && context.drainResult === undefined,
			unresolvedResult: ({ context }: { context: Context }) =>
				context.scopeResult?.settlement === 'unresolved',
			unresolvedBound: ({ context }: { context: Context }) =>
				context.scope !== undefined && context.scopeResult?.settlement === 'unresolved',
			recoveryRequiredResult: ({ context }: { context: Context }) =>
				context.scopeResult?.outcome === 'recoveryRequired',
			creating: ({ context }: { context: Context }) => context.request?.operation === 'create',
			linking: ({ context }: { context: Context }) => context.request?.operation === 'link',
			unlinking: ({ context }: { context: Context }) => context.request?.operation === 'unlink',
			deleting: ({ context }: { context: Context }) => context.request?.operation === 'delete',
			cancelsCurrent: ({ context, event }: { context: Context; event: NativeEvent0 }) =>
				event.type === 'CANCEL_TRANSFER_MUTATION' && context.request?.requestId === event.requestId
		},
		actions: {
			rejectDrain: ({ context, event }: { context: Context; event: NativeEvent0 }) => {
				if (event.type !== 'DRAIN_TRANSFER_SCOPE') return
				event.drain.recipient.send({
					type: 'TRANSFER_SCOPE_DRAIN_RESULT',
					request: event.drain.request,
					outcome: 'rejected',
					reason: !sameScope(event.drain.request.scope, context.scope)
						? 'scopeMismatch'
						: context.retiredDrains.has(event.drain.request.token)
							? 'retired'
							: 'busy'
				})
			},
			replayDrain: ({ context }: { context: Context }) => {
				if (context.drainResult) context.drain?.recipient.send(context.drainResult)
			},
			reportDrain: ({ context }: { context: Context }) => {
				context.retiredDrains.add(required(context.drain).request.token)
				required(context.drain).recipient.send(required(context.drainResult))
			},
			rejectRequest: ({ event }: { event: NativeEvent0 }) => {
				if (event.type !== 'REQUEST_TRANSFER_MUTATION') return
				event.request.recipient.send({
					type: 'TRANSFER_MUTATION_RESULT',
					requestId: event.request.requestId,
					result: rejectedTransferMutation(event.request)
				})
			},
			rejectQueue: ({ context }: { context: Context }) =>
				context.queue.forEach((request) =>
					request.recipient.send({
						type: 'TRANSFER_MUTATION_RESULT',
						requestId: request.requestId,
						result: rejectedTransferMutation(request)
					})
				),
			cancelQueued: ({ context, event }: { context: Context; event: NativeEvent0 }) => {
				if (event.type !== 'CANCEL_TRANSFER_MUTATION') return
				const request = context.queue.find((item) => item.requestId === event.requestId)
				if (request)
					request.recipient.send({
						type: 'TRANSFER_MUTATION_RESULT',
						requestId: request.requestId,
						result: cancelled(request)
					})
			},
			reportResult: ({ context }: { context: Context }) => {
				if (context.result) context.request?.recipient.send(context.result)
			}
		}
	})

	return machine.createMachine({
		id: 'internal-transfer-mutation-owner',
		context: () => ({
			workspaceId: undefined,
			request: undefined,
			queue: [],
			result: undefined,
			scope: undefined,
			drain: undefined,
			drainResult: undefined,
			scopeResult: undefined,
			retiredDrains: new WeakSet<object>()
		}),
		initial: 'running',
		output: ({ context }): TransferMutationOwnerOutput =>
			context.scope
				? { outcome: 'unresolved', scope: context.scope, drain: context.drainResult?.request }
				: { outcome: 'closed' },
		states: {
			running: {
				type: 'parallel',
				on: {
					DRAIN_TRANSFER_SCOPE: (args, enq) => {
						if (args.guards.sameDrain(args)) {
							enq(args.actions.replayDrain, args)
							return {}
						}
						if (args.guards.freshDrain(args) && args.context.drain === undefined) {
							enq(args.actions.rejectQueue, args)
							const patchRememberDrainResult22 = patchRememberDrain(args)
							{
								const children = args.children
								for (const actor of [
									children.createOperation,
									children.linkOperation,
									children.unlinkOperation,
									children.deleteOperation
								])
									if (actor?.getSnapshot().status === 'active')
										enq.sendTo(actor, { type: 'SHUTDOWN' })
							}
							return {
								context: patchRememberDrainResult22
							}
						}
						enq(args.actions.rejectDrain, args)
						return {}
					}
				},
				onDone: { target: 'closed' },
				states: {
					control: {
						initial: 'active',
						on: { SHUTDOWN: { target: '.closing' } },
						states: {
							active: {
								on: {
									BIND_TRANSFER_SCOPE: (args) => {
										if (!(
											args.guards.legacyMode(args) &&
											matchesState({ running: { work: 'idle' } }, args.value) &&
											args.guards.freshScope(args)
										))
											return
										return { context: patchBindScope(args) }
									},
									DRAIN_TRANSFER_SCOPE: (args, enq) => {
										if (args.guards.freshDrain(args)) {
											enq(args.actions.rejectQueue, args)
											const patchRememberDrainResult21 = patchRememberDrain(args)
											{
												const children = args.children
												for (const actor of [
													children.createOperation,
													children.linkOperation,
													children.unlinkOperation,
													children.deleteOperation
												])
													if (actor?.getSnapshot().status === 'active')
														enq.sendTo(actor, { type: 'SHUTDOWN' })
											}
											return { target: 'draining', context: patchRememberDrainResult21 }
										}
										enq(args.actions.rejectDrain, args)
										return {}
									}
								}
							},
							draining: {
								on: {
									DRAIN_TRANSFER_SCOPE: (args, enq) => {
										if (args.guards.sameDrain(args)) {
											return {}
										}
										enq(args.actions.rejectDrain, args)
										return {}
									},
									SCOPE_RELEASED: { target: 'released' }
								}
							},
							released: {
								on: {
									BIND_TRANSFER_SCOPE: (args) => {
										if (!args.guards.freshScope(args)) return
										return { target: 'active', context: patchBindScope(args) }
									},
									DRAIN_TRANSFER_SCOPE: (args, enq) => {
										if (args.guards.sameDrain(args)) {
											enq(args.actions.replayDrain, args)
											return {}
										}
										enq(args.actions.rejectDrain, args)
										return {}
									}
								}
							},
							closing: {
								type: 'final',
								entry: (args, enq) => {
									{
										const children = args.children
										for (const actor of [
											children.createOperation,
											children.linkOperation,
											children.unlinkOperation,
											children.deleteOperation
										])
											if (actor?.getSnapshot().status === 'active')
												enq.sendTo(actor, { type: 'SHUTDOWN' })
									}
									enq(args.actions.rejectQueue, args)
									return { context: ((args) => ({ queue: [] }))(args) }
								}
							}
						}
					},
					work: {
						initial: 'idle',
						states: {
							idle: {
								always: (args) => {
									if (args.guards.pendingDrain(args)) {
										return { target: 'classifyingDrain' }
									}
									if (
										matchesState({ running: { control: 'closing' } }, args.value) &&
										args.guards.unresolvedBound(args)
									) {
										return { target: '#internal-transfer-mutation-owner.unresolved' }
									}
									if (matchesState({ running: { control: 'closing' } }, args.value)) {
										return { target: 'stopped' }
									}
								},
								on: {
									REQUEST_TRANSFER_MUTATION: (args, enq) => {
										const { context, event } = args
										if (
											matchesState({ running: { control: 'active' } }, args.value) &&
											event.type === 'REQUEST_TRANSFER_MUTATION' &&
											event.request.workspaceId === context.workspaceId &&
											(context.scope
												? sameScope(event.request.scope, context.scope) &&
													context.scopeResult?.settlement !== 'unresolved'
												: event.request.scope === undefined)
										) {
											return { target: 'dispatching', context: { request: event.request } }
										}
										enq(args.actions.rejectRequest, args)
										return {}
									},
									CANCEL_TRANSFER_MUTATION: (args, enq) => {
										enq(args.actions.cancelQueued, args)
										return { context: patchRemoveCancelled(args) }
									},
									TRANSFER_SCOPE_CHANGED: (args) => {
										if (!args.guards.legacyMode(args)) return
										return { context: patchSetWorkspace(args) }
									}
								}
							},
							dispatching: {
								always: (args) => {
									if (args.guards.creating(args)) {
										return { target: 'creating' }
									}
									if (args.guards.linking(args)) {
										return { target: 'linking' }
									}
									if (args.guards.unlinking(args)) {
										return { target: 'unlinking' }
									}
									if (args.guards.deleting(args)) {
										return { target: 'deleting' }
									}
									return { target: 'finishing', context: patchFinishFailure(args) }
								}
							},
							creating: {
								invoke: {
									id: 'createOperation',
									src: 'create',
									input: ({ context }) => createRequest(context.request).input,
									onDone: (args) => {
										return {
											target: 'finishing',
											context: {
												result: {
													type: 'TRANSFER_MUTATION_RESULT',
													requestId: required(args.context.request).requestId,
													result: { operation: 'create', result: args.event.output }
												}
											}
										}
									},
									onError: (args) => {
										return { target: 'finishing', context: patchFinishFailure(args) }
									}
								},
								on: {
									REQUEST_TRANSFER_MUTATION: (args, enq) => {
										const { context, event } = args
										if (
											matchesState({ running: { control: 'active' } }, args.value) &&
											event.type === 'REQUEST_TRANSFER_MUTATION' &&
											event.request.workspaceId === context.workspaceId &&
											(context.scope
												? sameScope(event.request.scope, context.scope) &&
													context.scopeResult?.settlement !== 'unresolved'
												: event.request.scope === undefined)
										) {
											return { context: patchQueueRequest(args) }
										}
										enq(args.actions.rejectRequest, args)
										return {}
									},
									CANCEL_TRANSFER_MUTATION: (args, enq) => {
										if (args.guards.cancelsCurrent(args)) {
											enq.sendTo('createOperation', { type: 'SHUTDOWN' })
											return {}
										}
										enq(args.actions.cancelQueued, args)
										return { context: patchRemoveCancelled(args) }
									},
									TRANSFER_SCOPE_CHANGED: (args, enq) => {
										if (!args.guards.legacyMode(args)) return
										enq.sendTo('createOperation', { type: 'SHUTDOWN' })
										enq(args.actions.rejectQueue, args)
										return { context: { ...patchSetWorkspace(args), queue: [] } }
									}
								}
							},
							linking: {
								invoke: {
									id: 'linkOperation',
									src: 'link',
									input: ({ context }) => linkRequest(context.request).input,
									onDone: (args) => {
										return {
											target: 'finishing',
											context: {
												result: {
													type: 'TRANSFER_MUTATION_RESULT',
													requestId: required(args.context.request).requestId,
													result: { operation: 'link', result: args.event.output }
												}
											}
										}
									},
									onError: (args) => {
										return { target: 'finishing', context: patchFinishFailure(args) }
									}
								},
								on: {
									REQUEST_TRANSFER_MUTATION: (args, enq) => {
										const { context, event } = args
										if (
											matchesState({ running: { control: 'active' } }, args.value) &&
											event.type === 'REQUEST_TRANSFER_MUTATION' &&
											event.request.workspaceId === context.workspaceId &&
											(context.scope
												? sameScope(event.request.scope, context.scope) &&
													context.scopeResult?.settlement !== 'unresolved'
												: event.request.scope === undefined)
										) {
											return { context: patchQueueRequest(args) }
										}
										enq(args.actions.rejectRequest, args)
										return {}
									},
									CANCEL_TRANSFER_MUTATION: (args, enq) => {
										if (args.guards.cancelsCurrent(args)) {
											enq.sendTo('linkOperation', { type: 'SHUTDOWN' })
											return {}
										}
										enq(args.actions.cancelQueued, args)
										return { context: patchRemoveCancelled(args) }
									},
									TRANSFER_SCOPE_CHANGED: (args, enq) => {
										if (!args.guards.legacyMode(args)) return
										enq.sendTo('linkOperation', { type: 'SHUTDOWN' })
										enq(args.actions.rejectQueue, args)
										return { context: { ...patchSetWorkspace(args), queue: [] } }
									}
								}
							},
							unlinking: {
								invoke: {
									id: 'unlinkOperation',
									src: 'unlink',
									input: ({ context }) => unlinkRequest(context.request).input,
									onDone: (args) => {
										return {
											target: 'finishing',
											context: {
												result: {
													type: 'TRANSFER_MUTATION_RESULT',
													requestId: required(args.context.request).requestId,
													result: { operation: 'unlink', result: args.event.output }
												}
											}
										}
									},
									onError: (args) => {
										return { target: 'finishing', context: patchFinishFailure(args) }
									}
								},
								on: {
									REQUEST_TRANSFER_MUTATION: (args, enq) => {
										const { context, event } = args
										if (
											matchesState({ running: { control: 'active' } }, args.value) &&
											event.type === 'REQUEST_TRANSFER_MUTATION' &&
											event.request.workspaceId === context.workspaceId &&
											(context.scope
												? sameScope(event.request.scope, context.scope) &&
													context.scopeResult?.settlement !== 'unresolved'
												: event.request.scope === undefined)
										) {
											return { context: patchQueueRequest(args) }
										}
										enq(args.actions.rejectRequest, args)
										return {}
									},
									CANCEL_TRANSFER_MUTATION: (args, enq) => {
										if (args.guards.cancelsCurrent(args)) {
											enq.sendTo('unlinkOperation', { type: 'SHUTDOWN' })
											return {}
										}
										enq(args.actions.cancelQueued, args)
										return { context: patchRemoveCancelled(args) }
									},
									TRANSFER_SCOPE_CHANGED: (args, enq) => {
										if (!args.guards.legacyMode(args)) return
										enq.sendTo('unlinkOperation', { type: 'SHUTDOWN' })
										enq(args.actions.rejectQueue, args)
										return { context: { ...patchSetWorkspace(args), queue: [] } }
									}
								}
							},
							deleting: {
								invoke: {
									id: 'deleteOperation',
									src: 'delete',
									input: ({ context }) => deleteRequest(context.request).input,
									onDone: (args) => {
										return {
											target: 'finishing',
											context: {
												result: {
													type: 'TRANSFER_MUTATION_RESULT',
													requestId: required(args.context.request).requestId,
													result: { operation: 'delete', result: args.event.output }
												}
											}
										}
									},
									onError: (args) => {
										return { target: 'finishing', context: patchFinishFailure(args) }
									}
								},
								on: {
									REQUEST_TRANSFER_MUTATION: (args, enq) => {
										const { context, event } = args
										if (
											matchesState({ running: { control: 'active' } }, args.value) &&
											event.type === 'REQUEST_TRANSFER_MUTATION' &&
											event.request.workspaceId === context.workspaceId &&
											(context.scope
												? sameScope(event.request.scope, context.scope) &&
													context.scopeResult?.settlement !== 'unresolved'
												: event.request.scope === undefined)
										) {
											return { context: patchQueueRequest(args) }
										}
										enq(args.actions.rejectRequest, args)
										return {}
									},
									CANCEL_TRANSFER_MUTATION: (args, enq) => {
										if (args.guards.cancelsCurrent(args)) {
											enq.sendTo('deleteOperation', { type: 'SHUTDOWN' })
											return {}
										}
										enq(args.actions.cancelQueued, args)
										return { context: patchRemoveCancelled(args) }
									},
									TRANSFER_SCOPE_CHANGED: (args, enq) => {
										if (!args.guards.legacyMode(args)) return
										enq.sendTo('deleteOperation', { type: 'SHUTDOWN' })
										enq(args.actions.rejectQueue, args)
										return { context: { ...patchSetWorkspace(args), queue: [] } }
									}
								}
							},
							finishing: {
								entry: (args, enq) => {
									let context = args.context
									let patch = {}
									patch = { ...patch, ...patchRecordScopeResult(args) }
									context = { ...args.context, ...patch }
									enq(args.actions.reportResult, { ...args, context })
									return { context: patch }
								},
								always: (args, enq) => {
									const { context } = args
									if (args.guards.pendingDrain(args)) {
										return { target: 'classifyingDrain' }
									}
									if (
										matchesState({ running: { control: 'closing' } }, args.value) &&
										args.guards.unresolvedBound(args)
									) {
										return {
											target: '#internal-transfer-mutation-owner.unresolved',
											context: patchClearCurrent()
										}
									}
									if (matchesState({ running: { control: 'closing' } }, args.value)) {
										return { target: 'stopped', context: patchClearCurrent() }
									}
									if (args.guards.unresolvedBound(args)) {
										enq(args.actions.rejectQueue, args)
										return { target: 'idle', context: patchClearCurrent() }
									}
									if (
										matchesState({ running: { control: 'active' } }, args.value) &&
										context.queue[0] !== undefined &&
										context.queue[0].workspaceId === context.workspaceId &&
										(context.scope
											? sameScope(context.queue[0].scope, context.scope)
											: context.queue[0].scope === undefined)
									) {
										return { target: 'dispatching', context: patchStartNext(args) }
									}
									return { target: 'idle', context: { request: undefined, result: undefined } }
								},
								on: {
									REQUEST_TRANSFER_MUTATION: (args, enq) => {
										const { context, event } = args
										if (
											matchesState({ running: { control: 'active' } }, args.value) &&
											event.type === 'REQUEST_TRANSFER_MUTATION' &&
											event.request.workspaceId === context.workspaceId &&
											(context.scope
												? sameScope(event.request.scope, context.scope) &&
													context.scopeResult?.settlement !== 'unresolved'
												: event.request.scope === undefined)
										) {
											return { context: patchQueueRequest(args) }
										}
										enq(args.actions.rejectRequest, args)
										return {}
									}
								}
							},
							classifyingDrain: {
								always: (args) => {
									if (args.guards.unresolvedResult(args)) {
										return { target: 'unresolvedDrain' }
									}
									if (args.guards.recoveryRequiredResult(args)) {
										return { target: 'partialDrain' }
									}
									return { target: 'releasedDrain' }
								}
							},
							unresolvedDrain: {
								entry: (args, enq) => {
									let context = args.context
									let patch = {}
									patch = {
										...patch,
										drainResult: {
											type: 'TRANSFER_SCOPE_DRAIN_RESULT',
											request: required(context.drain).request,
											outcome: 'unresolved'
										}
									}
									context = { ...args.context, ...patch }
									enq(args.actions.reportDrain, { ...args, context })
									patch = { ...patch, ...patchClearCurrent() }
									context = { ...args.context, ...patch }
									return { context: patch }
								},
								always: { target: '#internal-transfer-mutation-owner.unresolved' }
							},
							partialDrain: {
								entry: (args, enq) => {
									let context = args.context
									let patch = {}
									patch = {
										...patch,
										drainResult: {
											type: 'TRANSFER_SCOPE_DRAIN_RESULT',
											request: required(context.drain).request,
											outcome: 'releasedWithFailure'
										}
									}
									context = { ...args.context, ...patch }
									enq(args.actions.reportDrain, { ...args, context })
									patch = { ...patch, ...patchClearCurrent() }
									context = { ...args.context, ...patch }
									enq.raise({ type: 'SCOPE_RELEASED' })
									return { context: patch }
								},
								always: (args) => {
									if (matchesState({ running: { control: 'closing' } }, args.value)) {
										return { target: 'stopped' }
									}
									return { target: 'idle' }
								}
							},
							releasedDrain: {
								entry: (args, enq) => {
									let context = args.context
									let patch = {}
									patch = {
										...patch,
										drainResult: {
											type: 'TRANSFER_SCOPE_DRAIN_RESULT',
											request: required(context.drain).request,
											outcome: 'released'
										}
									}
									context = { ...args.context, ...patch }
									enq(args.actions.reportDrain, { ...args, context })
									patch = { ...patch, ...patchClearCurrent() }
									context = { ...args.context, ...patch }
									enq.raise({ type: 'SCOPE_RELEASED' })
									return { context: patch }
								},
								always: (args) => {
									if (matchesState({ running: { control: 'closing' } }, args.value)) {
										return { target: 'stopped' }
									}
									return { target: 'idle' }
								}
							},
							stopped: { type: 'final' }
						}
					}
				}
			},
			unresolved: {
				type: 'final',
				entry: () => {
					return {
						context: {
							request: undefined,
							queue: [],
							result: undefined,
							scopeResult: undefined,
							drain: undefined
						}
					}
				}
			},
			closed: {
				type: 'final',
				entry: (args, enq) => {
					enq.sendTo(args.parent, { type: 'TRANSFER_MUTATION_OWNER_CLOSED' })
					return {
						context: {
							workspaceId: undefined,
							scope: undefined,
							request: undefined,
							queue: [],
							result: undefined,
							scopeResult: undefined,
							drain: undefined,
							drainResult: undefined
						}
					}
				}
			}
		}
	})
}
