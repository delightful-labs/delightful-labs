import {
	matchesState,
	setup,
	types,
	type ActorLogic,
	type ActorRef,
	type ActorRefFrom,
	type DoneActorEvent,
	type OutputFrom,
	type Snapshot,
	type SnapshotFrom,
	type StateValue
} from 'xstate'
import type { EventPayload } from '../../contracts/machine-events.js'
import type {
	WorkspaceDrainRequest,
	WorkspaceLease,
	WorkspaceSelectionOutput,
	WorkspaceSelectionReport,
	WorkspaceSelectionScope
} from '../../contracts/workspace-selection.js'
import type {
	WorkspaceResourceCommand,
	WorkspaceResourceCompletion,
	WorkspaceResourceFailure,
	WorkspaceResourceInput,
	WorkspaceResourceReport
} from '../../contracts/workspace-resource.js'
import { createWorkspaceSelectionMachine } from './selection.js'

function required<Value>(value: Value | undefined): Value {
	if (value === undefined) throw new Error('Workspace resource custody unavailable')
	return value
}
function sameScope(left: WorkspaceSelectionScope, right: WorkspaceSelectionScope) {
	return left.binding === right.binding && left.attachment === right.attachment
}
function sameLease(left: WorkspaceLease, right: WorkspaceLease | undefined) {
	return (
		right !== undefined &&
		sameScope(left.scope, right.scope) &&
		left.epoch === right.epoch &&
		left.request.workspaceId === right.request.workspaceId &&
		left.request.attempt === right.request.attempt
	)
}

/** One typed native delivery; the owning state has already selected admission. */
function deliver<S extends Snapshot<unknown>, Event extends { type: string }>(
	resource: ActorRef<S, Event>,
	event: Event
) {
	resource.send(event)
}

/** The selector owns admission; this owner retains resources through their exact drain receipt. */
export function createWorkspaceResourceOwner<
	Binding,
	ResourceInput,
	Event extends { type: string },
	S extends Snapshot<unknown>,
	View,
	CommandEvent extends Event = Event
>(options: {
	resource: ActorLogic<S, Event, ResourceInput>
	input: (lease: WorkspaceLease, binding: Binding) => ResourceInput
	shutdown: NoInfer<Extract<CommandEvent, { type: 'SHUTDOWN' }>>
	view: (snapshot: NoInfer<S>) => View
	failed: (snapshot: NoInfer<S>) => boolean
	settlement: (
		output: OutputFrom<ActorLogic<S, Event, ResourceInput>> | undefined
	) => 'released' | 'unresolved'
	/** Release/reject an app-owned payload when its lease cannot admit the command. */
	refused?: (
		command: NoInfer<Exclude<CommandEvent, { type: 'SHUTDOWN' }>>,
		binding: Binding
	) => void
}) {
	type Result = OutputFrom<typeof options.resource>
	type Command = WorkspaceResourceCommand<CommandEvent>
	type Context = {
		record: {
			input: WorkspaceResourceInput<Binding>
			lease: WorkspaceLease | undefined
			drain: WorkspaceDrainRequest | undefined
			view: View | undefined
			selection: WorkspaceSelectionReport | undefined
			completion: WorkspaceResourceCompletion<Result> | undefined
			failure: WorkspaceResourceFailure | undefined
		}
	}
	const selection = createWorkspaceSelectionMachine()
	const model = setup({
		schemas: {
			input: types<WorkspaceResourceInput<Binding>>(),
			context: types<Context>(),
			output: types<{ outcome: 'closed' }>(),
			events: {
				SELECT: types<EventPayload<Command, 'SELECT'>>(),
				OBSERVED: types<EventPayload<Command, 'OBSERVED'>>(),
				SUSPEND: types<EventPayload<Command, 'SUSPEND'>>(),
				RESUME: types<EventPayload<Command, 'RESUME'>>(),
				RETRY: types<EventPayload<Command, 'RETRY'>>(),
				SHUTDOWN: types(),
				RESOURCE_COMMAND: types<EventPayload<Command, 'RESOURCE_COMMAND'>>(),
				WORKSPACE_SELECTION: types<EventPayload<WorkspaceSelectionReport, 'WORKSPACE_SELECTION'>>(),
				WORKSPACE_SCOPE_INVALIDATED:
					types<EventPayload<WorkspaceSelectionReport, 'WORKSPACE_SCOPE_INVALIDATED'>>(),
				WORKSPACE_DRAIN_REQUESTED:
					types<EventPayload<WorkspaceSelectionReport, 'WORKSPACE_DRAIN_REQUESTED'>>(),
				WORKSPACE_DRAIN_FAILED:
					types<EventPayload<WorkspaceSelectionReport, 'WORKSPACE_DRAIN_FAILED'>>()
			},
			internalEvents: {
				SELECTOR_FINISHED: types<{ output: WorkspaceSelectionOutput }>(),
				SELECTOR_FAILED: types()
			},
			children: {
				selection: types<ActorRefFrom<typeof selection>>(),
				resource: types<ActorRefFrom<typeof options.resource>>()
			}
		},
		actors: { selection, resource: options.resource }
	})
	type Entry = Extract<
		NonNullable<Parameters<typeof model.createStateConfig>[0]['entry']>,
		(...args: never[]) => unknown
	>
	type Queue = Parameters<Entry>[1]
	const ignoredIntent = model.createStateConfig({
		on: {
			SELECT: {},
			OBSERVED: {},
			SUSPEND: {},
			RESUME: {},
			RETRY: {},
			SHUTDOWN: {}
		}
	}).on
	const logic = model.createMachine({
		id: 'workspace-resource',
		initial: 'waiting',
		context: ({ input }) => ({
			record: {
				input: { ...input, scope: { ...input.scope } },
				lease: undefined,
				drain: undefined,
				view: undefined,
				selection: undefined,
				completion: undefined,
				failure: undefined
			} satisfies Context['record']
		}),
		output: () => ({ outcome: 'closed' }),
		entry: ({ context: { record: context } }, enq) =>
			enq.sendTo('selection', { type: 'BIND', scope: context.input.scope }),
		invoke: {
			id: 'selection',
			src: 'selection',
			input: ({ self }) => ({ reportTo: self }),
			onDone: ({ event }: { event: DoneActorEvent<WorkspaceSelectionOutput> }, enq: Queue) =>
				enq.raise({ type: 'SELECTOR_FINISHED', output: event.output }),
			onError: (_: unknown, enq: Queue) => enq.raise({ type: 'SELECTOR_FAILED' })
		},
		on: {
			SELECT: ({ event }, enq) => enq.sendTo('selection', event),
			OBSERVED: ({ event }, enq) => enq.sendTo('selection', event),
			SUSPEND: ({ event }, enq) => enq.sendTo('selection', event),
			RESUME: ({ event }, enq) => enq.sendTo('selection', event),
			RETRY: ({ event }, enq) => enq.sendTo('selection', event),
			RESOURCE_COMMAND: ({ context: { record: context }, event }, enq) => {
				if (options.refused) enq(options.refused, event.command, context.input.binding)
			},
			SHUTDOWN: (_, enq) => {
				enq.sendTo('selection', { type: 'SHUTDOWN' })
				return { target: '.closing' }
			},
			WORKSPACE_SELECTION: ({ context: { record: context }, event }) => {
				if (event.status === 'selected') {
					if (!sameScope(event.lease.scope, context.input.scope)) return
					return {
						target: '.holding',
						context: {
							record: {
								...context,
								lease: event.lease,
								selection: event,
								view: undefined,
								drain: undefined,
								completion: undefined,
								failure: undefined
							} satisfies Context['record']
						}
					}
				}
				if (!sameScope(event.scope, context.input.scope)) return
				return { context: { record: { ...context, selection: event } satisfies Context['record'] } }
			},
			WORKSPACE_SCOPE_INVALIDATED: {},
			WORKSPACE_DRAIN_REQUESTED: {},
			WORKSPACE_DRAIN_FAILED: {},
			SELECTOR_FINISHED: ({ context: { record: context }, event, value }) =>
				event.output.outcome === 'closed' && matchesState('closing', value)
					? { target: '.closed' }
					: {
							target: '.unresolved',
							context: {
								record: {
									...context,
									drain: event.output.outcome === 'unresolved' ? event.output.drain : undefined,
									failure: {
										reason:
											event.output.outcome === 'unresolved'
												? 'selectorUnresolved'
												: 'selectorClosed'
									}
								} satisfies Context['record']
							}
						},
			SELECTOR_FAILED: ({ context: { record: context } }) => ({
				target: '.unresolved',
				context: {
					record: { ...context, failure: { reason: 'selectorFailed' } } satisfies Context['record']
				}
			})
		},
		states: {
			waiting: {},
			holding: {
				initial: 'active',
				invoke: {
					id: 'resource',
					src: 'resource',
					input: ({ context: { record: context } }) =>
						options.input(required(context.lease), context.input.binding),
					onSnapshot: ({ context: { record: context }, event, value }, enq) => {
						if (event.snapshot.status === 'done' || matchesState({ holding: 'unresolved' }, value))
							return
						if (
							event.snapshot.status === 'error' ||
							event.snapshot.status === 'stopped' ||
							options.failed(event.snapshot)
						) {
							if (context.failure) return
							if (context.drain)
								enq.sendTo('selection', {
									type: 'DRAIN_FAILED',
									drain: context.drain,
									outcome: 'unresolved'
								})
							else enq.sendTo('selection', { type: 'SUSPEND', scope: context.input.scope })
							return {
								target: context.drain ? '.unresolved' : '.faulted',
								context: {
									record: {
										...context,
										view: undefined,
										failure: { reason: 'resourceFailed' }
									} satisfies Context['record']
								}
							}
						}
						if (matchesState({ holding: 'active' }, value))
							return {
								context: {
									record: {
										...context,
										view: options.view(event.snapshot)
									} satisfies Context['record']
								}
							}
					},
					onDone: (
						{
							context: { record: context },
							event,
							value
						}: { context: Context; event: DoneActorEvent<Result>; value: StateValue },
						enq: Queue
					) => {
						const completion: WorkspaceResourceCompletion<Result> = {
							output: event.output,
							settlement: options.settlement(event.output)
						}
						if (matchesState({ holding: 'unresolved' }, value))
							return { context: { record: { ...context, completion } satisfies Context['record'] } }
						if (!context.drain) {
							enq.sendTo('selection', { type: 'SUSPEND', scope: context.input.scope })
							return {
								target: matchesState({ holding: 'closing' }, value)
									? '.closingCompleted'
									: '.completed',
								context: {
									record: {
										...context,
										completion,
										view: undefined,
										failure: { reason: 'unexpectedCompletion' }
									} satisfies Context['record']
								}
							}
						}
						if (completion.settlement === 'unresolved') {
							enq.sendTo('selection', {
								type: 'DRAIN_FAILED',
								drain: context.drain,
								outcome: 'unresolved'
							})
							return {
								target: '.unresolved',
								context: {
									record: {
										...context,
										completion,
										view: undefined,
										failure: { reason: 'unresolvedReceipt' }
									} satisfies Context['record']
								}
							}
						}
						enq.sendTo('selection', { type: 'DRAINED', drain: context.drain })
						return {
							target: matchesState({ holding: 'closing' }, value)
								? '#workspace-resource.closing'
								: '#workspace-resource.waiting',
							context: {
								record: {
									...context,
									completion,
									lease: undefined,
									drain: undefined,
									view: undefined
								} satisfies Context['record']
							}
						}
					},
					onError: (
						{ context: { record: context }, value }: { context: Context; value: StateValue },
						enq: Queue
					) => {
						if (matchesState({ holding: 'unresolved' }, value)) return
						if (context.drain)
							enq.sendTo('selection', {
								type: 'DRAIN_FAILED',
								drain: context.drain,
								outcome: 'unresolved'
							})
						else enq.sendTo('selection', { type: 'SUSPEND', scope: context.input.scope })
						return {
							target: context.drain ? '.unresolved' : '.faulted',
							context: {
								record: {
									...context,
									view: undefined,
									failure: { reason: 'resourceCrashed' }
								} satisfies Context['record']
							}
						}
					}
				},
				on: {
					SHUTDOWN: ({ context: { record: context } }, enq) => {
						enq.sendTo('selection', { type: 'SHUTDOWN' })
						return { target: context.completion ? '.closingCompleted' : '.closing' }
					},
					WORKSPACE_SELECTION: ({ context: { record: context }, event }) =>
						event.status === 'selected' && sameLease(event.lease, context.lease)
							? {
									context: { record: { ...context, selection: event } satisfies Context['record'] }
								}
							: undefined,
					WORKSPACE_SCOPE_INVALIDATED: ({ context: { record: context }, event, value }) =>
						sameLease(event.lease, context.lease) && matchesState({ holding: 'active' }, value)
							? {
									target: '.invalidated',
									context: { record: { ...context, view: undefined } satisfies Context['record'] }
								}
							: undefined,
					WORKSPACE_DRAIN_REQUESTED: (
						{ context: { record: context }, event, value, self },
						enq
					) => {
						if (!sameLease(event.drain.lease, context.lease) || context.drain) return
						if (context.completion) {
							enq.sendTo('selection', {
								type: 'DRAIN_FAILED',
								drain: event.drain,
								outcome: context.completion.settlement
							})
							return context.completion.settlement === 'released'
								? {
										target: matchesState({ holding: 'closingCompleted' }, value)
											? '#workspace-resource.closing'
											: '#workspace-resource.waiting',
										context: {
											record: {
												...context,
												lease: undefined,
												drain: undefined,
												view: undefined
											} satisfies Context['record']
										}
									}
								: {
										target: '.unresolved',
										context: {
											record: {
												...context,
												drain: event.drain,
												view: undefined
											} satisfies Context['record']
										}
									}
						}
						if (context.failure) {
							enq.sendTo('selection', {
								type: 'DRAIN_FAILED',
								drain: event.drain,
								outcome: 'unresolved'
							})
							return {
								target: '.unresolved',
								context: {
									record: {
										...context,
										drain: event.drain,
										view: undefined
									} satisfies Context['record']
								}
							}
						}
						enq(deliver<S, Event>, required(self.getSnapshot().children.resource), options.shutdown)
						return {
							target: matchesState({ holding: 'closing' }, value) ? '.closing' : '.draining',
							context: {
								record: {
									...context,
									drain: event.drain,
									view: undefined
								} satisfies Context['record']
							}
						}
					},
					SELECTOR_FINISHED: ({ context: { record: context }, event }) => ({
						target: '.unresolved',
						context: {
							record: {
								...context,
								view: undefined,
								drain: event.output.outcome === 'unresolved' ? event.output.drain : context.drain,
								failure: context.failure ?? {
									reason:
										event.output.outcome === 'unresolved' ? 'selectorUnresolved' : 'selectorClosed'
								}
							} satisfies Context['record']
						}
					}),
					SELECTOR_FAILED: ({ context: { record: context } }) => ({
						target: '.unresolved',
						context: {
							record: {
								...context,
								view: undefined,
								failure: context.failure ?? { reason: 'selectorFailed' }
							} satisfies Context['record']
						}
					})
				},
				states: {
					active: {
						on: {
							RESOURCE_COMMAND: ({ context: { record: context }, event, self }, enq) => {
								if (event.command.type !== 'SHUTDOWN' && sameLease(event.lease, context.lease))
									enq(
										deliver<S, Event>,
										required(self.getSnapshot().children.resource),
										event.command
									)
								else if (options.refused) enq(options.refused, event.command, context.input.binding)
							}
						}
					},
					invalidated: {},
					draining: {},
					faulted: {},
					completed: {},
					closing: { on: ignoredIntent },
					closingCompleted: { on: ignoredIntent },
					unresolved: { on: ignoredIntent }
				}
			},
			closing: {
				on: {
					...ignoredIntent,
					WORKSPACE_SELECTION: {},
					WORKSPACE_DRAIN_REQUESTED: ({ context: { record: context }, event }, enq) => {
						// Selection may have reported a lease just as shutdown won the mailbox race.
						// This state has no held invocation: none was allocated, or its receipt released it.
						if (
							context.lease === undefined &&
							sameScope(event.drain.lease.scope, context.input.scope)
						)
							enq.sendTo('selection', { type: 'DRAINED', drain: event.drain })
					}
				}
			},
			unresolved: { on: { ...ignoredIntent, WORKSPACE_SELECTION: {} } },
			closed: { type: 'final' }
		}
	})
	function selectReport(
		snapshot: SnapshotFrom<typeof logic>
	): WorkspaceResourceReport<View, Result> {
		const c = snapshot.context.record
		const base = { scope: c.input.scope, selection: c.selection, completion: c.completion }
		if (snapshot.matches('closed') && snapshot.status === 'done')
			return { ...base, status: 'closed', lease: undefined, drain: undefined, view: undefined }
		if (
			snapshot.status !== 'active' ||
			snapshot.matches('unresolved') ||
			snapshot.matches({ holding: 'unresolved' }) ||
			snapshot.matches({ holding: 'faulted' }) ||
			snapshot.matches({ holding: 'completed' }) ||
			snapshot.matches({ holding: 'closingCompleted' })
		)
			return {
				...base,
				status: 'unresolved',
				lease: c.lease,
				drain: c.drain,
				view: undefined,
				failure: c.failure ?? { reason: 'ownerStopped' }
			}
		if (snapshot.matches({ holding: 'active' }))
			return { ...base, status: 'active', lease: required(c.lease), drain: undefined, view: c.view }
		if (snapshot.matches('holding'))
			return {
				...base,
				status: snapshot.matches({ holding: 'closing' }) ? 'closing' : 'draining',
				lease: required(c.lease),
				drain: c.drain,
				view: undefined
			}
		return {
			...base,
			status: snapshot.matches('closing') ? 'closing' : 'waiting',
			lease: undefined,
			drain: undefined,
			view: undefined
		}
	}
	return { logic, selectReport }
}
