import { createWorkspaceSelectionMachine } from 'delightful-local-first/workspace/workflow'
import type {
	WorkspaceSelectionEvent,
	WorkspaceSelectionOutput,
	WorkspaceSelectionReport,
	WorkspaceSelectionScope
} from 'delightful-local-first/workspace/contracts'
import { required } from '../bank-sync/identity.js'
import { setup, types, matchesState } from 'xstate'
import type { ActorRef, Snapshot } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'

export type WorkspaceSelectionBinding = Readonly<{
	scope: WorkspaceSelectionScope
	revision: number
}>
type Failure =
	| { reason: 'unresolved'; result: Extract<WorkspaceSelectionOutput, { outcome: 'unresolved' }> }
	| { reason: 'childCrashed' | 'unexpectedClosure' }
export type WorkspaceSelectionAttachmentReport =
	| WorkspaceSelectionReport
	| {
			type: 'WORKSPACE_SELECTION_ATTACHED'
			binding: WorkspaceSelectionBinding
	  }
	| { type: 'WORKSPACE_SELECTION_RELEASED'; binding: WorkspaceSelectionBinding }
	| {
			type: 'WORKSPACE_SELECTION_ATTACHMENT_FAILED'
			binding: WorkspaceSelectionBinding
			failure: Failure
	  }
type Command = Exclude<WorkspaceSelectionEvent, { type: 'BIND' | 'SHUTDOWN' }>
export type WorkspaceSelectionAttachmentEvent =
	| { type: 'ATTACH'; binding: WorkspaceSelectionBinding }
	| { type: 'DETACH'; binding: WorkspaceSelectionBinding }
	| { type: 'SELECTION_COMMAND'; binding: WorkspaceSelectionBinding; command: Command }
	| { type: 'SHUTDOWN' }
type Input = {
	reportTo: ActorRef<Snapshot<unknown>, WorkspaceSelectionAttachmentReport>
}
type Context = Input & {
	binding: WorkspaceSelectionBinding | undefined
	pending: WorkspaceSelectionBinding | undefined
	revision: number
	usedAttachments: WeakSet<object>
	failure: Failure | undefined
}
export type WorkspaceSelectionAttachmentOutput =
	| { outcome: 'closed' }
	| { outcome: 'failed'; binding: WorkspaceSelectionBinding; failure: Failure }

function sameBinding(
	left: WorkspaceSelectionBinding,
	right: WorkspaceSelectionBinding | undefined
) {
	return (
		left.revision === right?.revision &&
		left.scope.binding === right.scope.binding &&
		left.scope.attachment === right.scope.attachment
	)
}
function capture(binding: WorkspaceSelectionBinding): WorkspaceSelectionBinding {
	return { revision: binding.revision, scope: { ...binding.scope } }
}

/** Owns fixed-scope selection replacement; the application owns and acknowledges resource drain. */
export function createWorkspaceSelectionAttachmentMachine() {
	const actors = { selection: createWorkspaceSelectionMachine() }
	const events0 = {
		ATTACH: types<EventPayload<WorkspaceSelectionAttachmentEvent, 'ATTACH'>>(),
		DETACH: types<EventPayload<WorkspaceSelectionAttachmentEvent, 'DETACH'>>(),
		SELECTION_COMMAND:
			types<EventPayload<WorkspaceSelectionAttachmentEvent, 'SELECTION_COMMAND'>>(),
		SHUTDOWN: types<EventPayload<WorkspaceSelectionAttachmentEvent, 'SHUTDOWN'>>()
	}
	type NativeEvent0 =
		| import('xstate').InferEvents<typeof events0>
		| import('xstate').DoneActorEvent<import('xstate').OutputFrom<(typeof actors)['selection']>>
		| import('xstate').ErrorActorEvent
	const model = setup({
		schemas: {
			context: types<Context>(),
			events: events0,
			input: types<Input>(),
			output: types<WorkspaceSelectionAttachmentOutput>(),
			children: { selection: types<import('xstate').ActorRefFrom<(typeof actors)['selection']>>() }
		},
		actors,
		actions: {},
		guards: {
			freshBinding: ({ context, event }: { context: Context; event: NativeEvent0 }) =>
				event.type === 'ATTACH' &&
				Number.isSafeInteger(event.binding.revision) &&
				event.binding.revision >= 0 &&
				event.binding.revision > context.revision &&
				!context.usedAttachments.has(event.binding.scope.attachment),
			currentBinding: ({ context, event }: { context: Context; event: NativeEvent0 }) =>
				(event.type === 'DETACH' || event.type === 'SELECTION_COMMAND') &&
				sameBinding(event.binding, context.binding),
			closing: (args: { value: import('xstate').StateValue }) =>
				matchesState({ holding: 'closing' }, args.value)
		}
	})
	const drainCommands = model.createStateConfig({
		on: {
			SELECTION_COMMAND: (args, enq) => {
				const { event } = args
				if (!(
					sameBinding(event.binding, args.context.binding) &&
					(event.command.type === 'DRAINED' || event.command.type === 'DRAIN_FAILED')
				))
					return
				enq.sendTo(
					'selection',
					(({ event }) => {
						if (event.type !== 'SELECTION_COMMAND') throw new Error('Missing selection command')
						return event.command
					})(args)
				)
			}
		}
	})
	return model.createMachine({
		id: 'workspace-selection-attachment',
		initial: 'unbound',
		context: ({ input }) => ({
			...input,
			binding: undefined,
			pending: undefined,
			revision: -1,
			usedAttachments: new WeakSet(),
			failure: undefined
		}),
		output: ({ context }) =>
			context.failure
				? { outcome: 'failed', binding: required(context.binding), failure: context.failure }
				: { outcome: 'closed' },
		states: {
			unbound: {
				entry: () => {
					return { context: { binding: undefined, pending: undefined } }
				},
				on: {
					ATTACH: (args) => {
						if (!args.guards.freshBinding(args)) return
						return {
							target: 'installing',
							context: (({ event }) => {
								if (event.type !== 'ATTACH') throw new Error('Missing selection attachment')
								return { pending: capture(event.binding), revision: event.binding.revision }
							})(args)
						}
					},
					SHUTDOWN: { target: 'closed' }
				}
			},
			installing: {
				entry: ({ context }, enq) => {
					const binding = required(context.pending)
					enq(() => {
						context.usedAttachments.add(binding.scope.attachment)
					})
					return { context: { binding, pending: undefined } }
				},
				always: { target: 'holding' }
			},
			holding: {
				initial: 'active',
				invoke: {
					id: 'selection',
					src: 'selection',
					input: ({ context }) => ({ reportTo: context.reportTo }),
					onDone: (args, enq) => {
						const { context, event } = args
						if (event.output.outcome === 'unresolved') {
							return {
								target: 'failed',
								context: (({ event }) => {
									if (event.output.outcome !== 'unresolved') throw new Error('Missing failure')
									return {
										failure: { reason: 'unresolved', result: event.output } satisfies Failure
									}
								})(args)
							}
						}
						if (matchesState({ holding: 'closing' }, args.value)) {
							enq.sendTo(context.reportTo, {
								type: 'WORKSPACE_SELECTION_RELEASED',
								binding: required(context.binding)
							})
							return { target: 'closed' }
						}
						if (matchesState({ holding: 'replacing' }, args.value)) {
							enq.sendTo(context.reportTo, {
								type: 'WORKSPACE_SELECTION_RELEASED',
								binding: required(context.binding)
							})
							return { target: 'released' }
						}
						return { target: 'failed', context: { failure: { reason: 'unexpectedClosure' } } }
					},
					onError: () => {
						return { target: 'failed', context: { failure: { reason: 'childCrashed' } } }
					}
				},
				states: {
					active: {
						entry: (args, enq) => {
							const { context } = args
							enq.sendTo(context.reportTo, {
								type: 'WORKSPACE_SELECTION_ATTACHED',
								binding: required(context.binding)
							})
							enq.sendTo('selection', {
								type: 'BIND',
								scope: required(context.binding).scope
							})
						},
						on: {
							ATTACH: (args) => {
								if (!args.guards.freshBinding(args)) return
								return {
									target: 'replacing',
									context: (({ event }) => {
										if (event.type !== 'ATTACH') throw new Error('Missing selection attachment')
										return { pending: capture(event.binding), revision: event.binding.revision }
									})(args)
								}
							},
							DETACH: (args) => {
								if (!args.guards.currentBinding(args)) return
								return { target: 'replacing' }
							},
							SELECTION_COMMAND: (args, enq) => {
								if (!args.guards.currentBinding(args)) return
								enq.sendTo(
									'selection',
									(({ event }) => {
										if (event.type !== 'SELECTION_COMMAND')
											throw new Error('Missing selection command')
										return event.command
									})(args)
								)
							},
							SHUTDOWN: { target: 'closing' }
						}
					},
					replacing: {
						...drainCommands,
						entry: (args, enq) => {
							enq.sendTo('selection', { type: 'SHUTDOWN' })
						},
						on: {
							...drainCommands.on,
							ATTACH: (args) => {
								if (!args.guards.freshBinding(args)) return
								return {
									context: (({ event }) => {
										if (event.type !== 'ATTACH') throw new Error('Missing selection attachment')
										return { pending: capture(event.binding), revision: event.binding.revision }
									})(args)
								}
							},
							DETACH: (args) => {
								if (!sameBinding(args.event.binding, args.context.pending)) return
								return { context: { pending: undefined } }
							},
							SHUTDOWN: { target: 'closing' }
						}
					},
					closing: {
						...drainCommands,
						entry: (args, enq) => {
							enq.sendTo('selection', { type: 'SHUTDOWN' })
							return { context: { pending: undefined } }
						}
					}
				}
			},
			released: {
				always: (args) => {
					if (args.context.pending !== undefined) {
						return { target: 'installing' }
					}
					return { target: 'unbound' }
				}
			},
			closed: {
				type: 'final',
				entry: () => {
					return { context: { binding: undefined, pending: undefined } }
				}
			},
			failed: {
				type: 'final',
				entry: (args, enq) => {
					let context = args.context
					let patch = {}
					patch = { ...patch, pending: undefined }
					context = { ...args.context, ...patch }
					enq.sendTo(context.reportTo, {
						type: 'WORKSPACE_SELECTION_ATTACHMENT_FAILED',
						binding: required(context.binding),
						failure: required(context.failure)
					})
					return { context: patch }
				}
			}
		}
	})
}
