import type {
	WorkspaceDrainRequest,
	WorkspaceLease
} from 'delightful-local-first/workspace/contracts'
import type {
	TransferMutationScope,
	TransferScopeDrainResponse
} from '../../contracts/transfer-scope-drain.js'
import type { TransferMutationOwnerEvent } from '../transfers/internal-transfer-mutation-owner.js'
import type {
	SelectedResourceCommand,
	SelectedResourceOutput
} from '../../contracts/workspace-selected-resources.js'
import { sameWorkspaceLease } from '../../contracts/workspace-selected-resources.js'
import {
	retainResourceRelease,
	type WorkspaceResourceRelease
} from '../../contracts/workspace-resource-release.js'
import { setup, types } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'

/** Attachment identity survives workspace switches, but never an identity reattachment. */
export function transferScopeForWorkspaceLease(lease: WorkspaceLease): TransferMutationScope {
	return {
		binding: lease.scope.attachment,
		workspaceId: lease.request.workspaceId,
		generation: lease.epoch
	}
}

type Input = {
	drain: WorkspaceDrainRequest
	transferScope?: TransferMutationScope
	resources: { send: (event: SelectedResourceCommand) => void } | undefined
	transfers: { send: (event: TransferMutationOwnerEvent) => void } | undefined
	transferRelease?: WorkspaceResourceRelease
	resourceRelease?: WorkspaceResourceRelease
}
type Context = Input & {
	transferScope: TransferMutationScope
	release: WorkspaceResourceRelease
}
export type WorkspaceSelectionDrainEvent =
	| { type: 'SELECTED_RESOURCES_RELEASED'; result: SelectedResourceOutput }
	| { type: 'SELECTED_RESOURCES_CRASHED'; lease: WorkspaceLease }
	| TransferScopeDrainResponse
	| { type: 'TRANSFER_OWNER_CRASHED'; drain: WorkspaceDrainRequest }
export type WorkspaceSelectionDrainOutput = {
	drain: WorkspaceDrainRequest
	release: WorkspaceResourceRelease
}

/** Joins actual cleanup evidence; a failed leg never abandons the other owner. */
export function createWorkspaceSelectionDrainMachine() {
	const patchUnresolved = (): Partial<Context> => ({ release: { outcome: 'unresolved' } })
	const events0 = {
		SELECTED_RESOURCES_RELEASED:
			types<EventPayload<WorkspaceSelectionDrainEvent, 'SELECTED_RESOURCES_RELEASED'>>(),
		SELECTED_RESOURCES_CRASHED:
			types<EventPayload<WorkspaceSelectionDrainEvent, 'SELECTED_RESOURCES_CRASHED'>>(),
		TRANSFER_SCOPE_DRAIN_RESULT:
			types<EventPayload<WorkspaceSelectionDrainEvent, 'TRANSFER_SCOPE_DRAIN_RESULT'>>(),
		TRANSFER_OWNER_CRASHED:
			types<EventPayload<WorkspaceSelectionDrainEvent, 'TRANSFER_OWNER_CRASHED'>>()
	}
	type NativeEvent0 =
		| import('xstate').InferEvents<typeof events0>
		| import('xstate').DoneActorEvent<never>
		| import('xstate').ErrorActorEvent
	const model = setup({
		schemas: {
			context: types<Context>(),
			events: events0,
			input: types<Input>(),
			output: types<WorkspaceSelectionDrainOutput>()
		},
		guards: {
			matchingResources: ({ context, event }: { context: Context; event: NativeEvent0 }) =>
				event.type === 'SELECTED_RESOURCES_RELEASED' &&
				sameWorkspaceLease(event.result.lease, context.drain.lease) &&
				// The owner may finish its own shutdown before receiving our drain command.
				(event.result.drain === undefined ||
					(event.result.drain.token === context.drain.token &&
						sameWorkspaceLease(event.result.drain.lease, context.drain.lease))),
			matchingResourceCrash: ({ context, event }: { context: Context; event: NativeEvent0 }) =>
				event.type === 'SELECTED_RESOURCES_CRASHED' &&
				sameWorkspaceLease(event.lease, context.drain.lease),
			matchingTransfer: ({ context, event }: { context: Context; event: NativeEvent0 }) =>
				event.type === 'TRANSFER_SCOPE_DRAIN_RESULT' &&
				event.request.token === context.drain.token &&
				event.request.scope.binding === context.transferScope.binding &&
				event.request.scope.workspaceId === context.transferScope.workspaceId &&
				event.request.scope.generation === context.transferScope.generation,
			matchingTransferCrash: ({ context, event }: { context: Context; event: NativeEvent0 }) =>
				event.type === 'TRANSFER_OWNER_CRASHED' &&
				event.drain.token === context.drain.token &&
				sameWorkspaceLease(event.drain.lease, context.drain.lease)
		},
		actions: {}
	})
	return model.createMachine({
		id: 'workspace-selection-drain',
		context: ({ input }) => ({
			...input,
			drain: Object.freeze({
				token: input.drain.token,
				lease: Object.freeze({
					...input.drain.lease,
					scope: Object.freeze({ ...input.drain.lease.scope }),
					request: Object.freeze({ ...input.drain.lease.request })
				})
			}),
			transferScope: Object.freeze({
				...(input.transferScope ?? transferScopeForWorkspaceLease(input.drain.lease))
			}),
			release: retainResourceRelease(
				input.resourceRelease ?? { outcome: 'released' },
				input.transferRelease ?? { outcome: 'released' }
			)
		}),
		initial: 'draining',
		output: ({ context }) => ({ drain: context.drain, release: context.release }),
		states: {
			draining: {
				type: 'parallel',
				states: {
					resources: {
						initial: 'checking',
						states: {
							checking: {
								always: (args) => {
									const { context } = args
									if (context.resources !== undefined) {
										return { target: 'waiting' }
									}
									if (context.resourceRelease?.outcome === 'unresolved') {
										return { target: 'unresolved' }
									}
									if (context.resourceRelease?.outcome === 'releasedWithFailure') {
										return { target: 'releasedWithFailure' }
									}
									return { target: 'released' }
								}
							},
							waiting: {
								entry: ({ context }) =>
									context.resources?.send({ type: 'DRAIN', drain: context.drain }),
								on: {
									SELECTED_RESOURCES_RELEASED: (args) => {
										const { event } = args
										if (
											args.guards.matchingResources(args) &&
											event.result.release.outcome === 'unresolved'
										) {
											return {
												target: 'unresolved',
												context: (({ context, event }) => {
													if (event.type !== 'SELECTED_RESOURCES_RELEASED')
														throw new Error('Missing resource result')
													return {
														release: retainResourceRelease(context.release, event.result.release)
													}
												})(args)
											}
										}
										if (
											args.guards.matchingResources(args) &&
											event.result.release.outcome === 'releasedWithFailure'
										) {
											return {
												target: 'releasedWithFailure',
												context: (({ context, event }) => {
													if (event.type !== 'SELECTED_RESOURCES_RELEASED')
														throw new Error('Missing resource result')
													return {
														release: retainResourceRelease(context.release, event.result.release)
													}
												})(args)
											}
										}
										if (args.guards.matchingResources(args)) {
											return {
												target: 'released',
												context: (({ context, event }) => {
													if (event.type !== 'SELECTED_RESOURCES_RELEASED')
														throw new Error('Missing resource result')
													return {
														release: retainResourceRelease(context.release, event.result.release)
													}
												})(args)
											}
										}
									},
									SELECTED_RESOURCES_CRASHED: (args) => {
										if (!args.guards.matchingResourceCrash(args)) return
										return { target: 'unresolved', context: patchUnresolved() }
									}
								}
							},
							released: { type: 'final' },
							releasedWithFailure: { type: 'final' },
							unresolved: { type: 'final' }
						}
					},
					transfers: {
						initial: 'checking',
						states: {
							checking: {
								always: (args) => {
									const { context } = args
									if (context.transfers !== undefined) {
										return { target: 'waiting' }
									}
									if (context.transferRelease?.outcome === 'unresolved') {
										return { target: 'unresolved' }
									}
									if (context.transferRelease?.outcome === 'releasedWithFailure') {
										return { target: 'releasedWithFailure' }
									}
									return { target: 'released' }
								}
							},
							waiting: {
								entry: ({ context, self }) =>
									context.transfers?.send({
										type: 'DRAIN_TRANSFER_SCOPE',
										drain: {
											request: { token: context.drain.token, scope: context.transferScope },
											recipient: self
										}
									}),
								on: {
									TRANSFER_SCOPE_DRAIN_RESULT: (args) => {
										const { event } = args
										if (
											args.guards.matchingTransfer(args) &&
											(event.outcome === 'unresolved' || event.outcome === 'rejected')
										) {
											return {
												target: 'unresolved',
												context: (({ context, event }) => {
													if (event.type !== 'TRANSFER_SCOPE_DRAIN_RESULT')
														throw new Error('Missing transfer result')
													return {
														release: retainResourceRelease(context.release, {
															outcome: event.outcome === 'rejected' ? 'unresolved' : event.outcome
														})
													}
												})(args)
											}
										}
										if (
											args.guards.matchingTransfer(args) &&
											event.outcome === 'releasedWithFailure'
										) {
											return {
												target: 'releasedWithFailure',
												context: (({ context, event }) => {
													if (event.type !== 'TRANSFER_SCOPE_DRAIN_RESULT')
														throw new Error('Missing transfer result')
													return {
														release: retainResourceRelease(context.release, {
															outcome: event.outcome === 'rejected' ? 'unresolved' : event.outcome
														})
													}
												})(args)
											}
										}
										if (args.guards.matchingTransfer(args)) {
											return {
												target: 'released',
												context: (({ context, event }) => {
													if (event.type !== 'TRANSFER_SCOPE_DRAIN_RESULT')
														throw new Error('Missing transfer result')
													return {
														release: retainResourceRelease(context.release, {
															outcome: event.outcome === 'rejected' ? 'unresolved' : event.outcome
														})
													}
												})(args)
											}
										}
									},
									TRANSFER_OWNER_CRASHED: (args) => {
										if (!args.guards.matchingTransferCrash(args)) return
										return { target: 'unresolved', context: patchUnresolved() }
									}
								}
							},
							released: { type: 'final' },
							releasedWithFailure: { type: 'final' },
							unresolved: { type: 'final' }
						}
					}
				},
				onDone: { target: 'complete' }
			},
			complete: { type: 'final' }
		}
	})
}
