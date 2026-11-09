import {
	matchesState,
	type StateValue,
	types,
	setup,
	type ActorRef,
	type Snapshot,
	type SnapshotFrom
} from 'xstate'
import { createFinalTransitions } from '../finalize.js'

import type { EventPayload } from '../../contracts/machine-events.js'
import type {
	WorkspaceDrainRequest,
	WorkspaceLease,
	WorkspaceSelectionEvent,
	WorkspaceSelectionObservation,
	WorkspaceSelectionOutput,
	WorkspaceSelectionReport,
	WorkspaceSelectionRequest,
	WorkspaceSelectionScope
} from '../../contracts/workspace-selection.js'
export type WorkspaceSelectionInput = Readonly<{
	reportTo: ActorRef<Snapshot<unknown>, WorkspaceSelectionReport>
}>
type Context = {
	reportTo: WorkspaceSelectionInput['reportTo']
	scope: WorkspaceSelectionScope | undefined
	request: WorkspaceSelectionRequest | undefined
	observation: WorkspaceSelectionObservation | undefined
	lease: WorkspaceLease | undefined
	drain: WorkspaceDrainRequest | undefined
	epoch: number
}
function required<Value>(value: Value | undefined): Value {
	if (value === undefined) throw new Error('Workspace selection binding unavailable')
	return value
}
function sameScope(left: WorkspaceSelectionScope, right: WorkspaceSelectionScope | undefined) {
	return left.binding === right?.binding && left.attachment === right.attachment
}
function sameRequest(
	left: WorkspaceSelectionRequest,
	right: WorkspaceSelectionRequest | undefined
) {
	return left.workspaceId === right?.workspaceId && left.attempt === right.attempt
}
function observationFrom(event: WorkspaceSelectionEvent) {
	return event.type === 'OBSERVED' || event.type === 'RESUME' || event.type === 'RETRY'
		? event.observation
		: undefined
}
/** Host owns all resources and acknowledges drain; this actor owns only scoped selection decisions. */
export function createWorkspaceSelectionMachine() {
	const patches = {
		selectRequest: ({
			event
		}: {
			context: Context
			event: WorkspaceSelectionEvent
		}): Partial<Context> => {
			if (event.type !== 'SELECT') throw new Error('Missing workspace selection intent')
			return { request: { ...event.request }, observation: undefined }
		},
		observe: ({
			event
		}: {
			context: Context
			event: WorkspaceSelectionEvent
		}): Partial<Context> => {
			const value = required(observationFrom(event))
			return {
				observation: { ...value, scope: { ...value.scope }, request: { ...value.request } }
			}
		},
		clearReleased: (_args: { context: Context }): Partial<Context> => ({
			lease: undefined,
			drain: undefined
		})
	}
	const model = setup({
		schemas: {
			context: types<Context>(),
			events: {
				BIND: types<EventPayload<WorkspaceSelectionEvent, 'BIND'>>(),
				SELECT: types<EventPayload<WorkspaceSelectionEvent, 'SELECT'>>(),
				OBSERVED: types<EventPayload<WorkspaceSelectionEvent, 'OBSERVED'>>(),
				SUSPEND: types<EventPayload<WorkspaceSelectionEvent, 'SUSPEND'>>(),
				RETRY: types<EventPayload<WorkspaceSelectionEvent, 'RETRY'>>(),
				RESUME: types<EventPayload<WorkspaceSelectionEvent, 'RESUME'>>(),
				DRAINED: types<EventPayload<WorkspaceSelectionEvent, 'DRAINED'>>(),
				DRAIN_FAILED: types<EventPayload<WorkspaceSelectionEvent, 'DRAIN_FAILED'>>(),
				SHUTDOWN: types<EventPayload<WorkspaceSelectionEvent, 'SHUTDOWN'>>()
			},
			input: types<WorkspaceSelectionInput>(),
			output: types<WorkspaceSelectionOutput>()
		},
		guards: {
			currentScope: ({ context, event }: { context: Context; event: WorkspaceSelectionEvent }) =>
				(event.type === 'SELECT' || event.type === 'SUSPEND') &&
				sameScope(event.scope, context.scope),
			freshSelection: ({ context, event }: { context: Context; event: WorkspaceSelectionEvent }) =>
				event.type === 'SELECT' &&
				sameScope(event.scope, context.scope) &&
				event.request.workspaceId.trim().length > 0 &&
				Number.isSafeInteger(event.request.attempt) &&
				event.request.attempt > (context.request?.attempt ?? 0),
			freshObservation: ({
				context,
				event
			}: {
				context: Context
				event: WorkspaceSelectionEvent
			}) => {
				const value = observationFrom(event)
				return (
					value !== undefined &&
					sameScope(value.scope, context.scope) &&
					sameRequest(value.request, context.request) &&
					Number.isSafeInteger(value.generation) &&
					value.generation >= 0 &&
					value.generation > (context.observation?.generation ?? -1)
				)
			},
			matchingDrain: ({ context, event }: { context: Context; event: WorkspaceSelectionEvent }) =>
				(event.type === 'DRAINED' || event.type === 'DRAIN_FAILED') &&
				event.drain.token === context.drain?.token &&
				sameScope(event.drain.lease.scope, context.scope) &&
				event.drain.lease.epoch === context.drain.lease.epoch &&
				sameRequest(event.drain.lease.request, context.drain.lease.request),
			unresolvedDrain: ({ event }: { event: WorkspaceSelectionEvent }) =>
				event.type === 'DRAIN_FAILED' && event.outcome === 'unresolved',
			closing: ({ value }: { value: StateValue }) =>
				matchesState({ bound: { draining: 'closing' } }, value),
			suspending: ({ value }: { value: StateValue }) =>
				matchesState({ bound: { draining: 'suspending' } }, value),
			locallyAllowed: ({ context }: { context: Context }) =>
				context.request !== undefined &&
				context.observation !== undefined &&
				sameRequest(context.observation.request, context.request) &&
				context.observation.access === 'allowed',
			canActivate: ({ context }: { context: Context }) => context.epoch < Number.MAX_SAFE_INTEGER
		},
		actions: {}
	})
	const report = (
		status: 'waiting' | 'denied' | 'unavailable' | 'failed' | 'suspended' | 'drainFailed'
	) =>
		model.createStateConfig({
			entry: ({ context }, enq) => {
				enq.sendTo(context.reportTo, {
					type: 'WORKSPACE_SELECTION',
					scope: required(context.scope),
					request: context.request,
					status,
					directory: context.observation?.directory
				})
			}
		}).entry
	const select = model.createStateConfig({
		on: {
			SELECT: (args) => {
				if (!args.guards.freshSelection(args)) return
				return {
					target: '.assessing',
					context: patches.selectRequest(args) satisfies Partial<Context>
				}
			},
			OBSERVED: (args) => {
				if (!args.guards.freshObservation(args)) return
				return {
					target: '.assessing',
					context: patches.observe(args) satisfies Partial<Context>
				}
			},
			SUSPEND: (args) => {
				if (!args.guards.currentScope(args)) return
				return { target: '.suspended' }
			},
			SHUTDOWN: { target: '#workspace-selection.closed' }
		}
	})
	const retainedFacts = model.createStateConfig({
		on: {
			SELECT: (args) => {
				if (!args.guards.freshSelection(args)) return
				return { context: patches.selectRequest(args) satisfies Partial<Context> }
			},
			OBSERVED: (args) => {
				if (!args.guards.freshObservation(args)) return
				return { context: patches.observe(args) satisfies Partial<Context> }
			}
		}
	})
	type CompletionEntry = Extract<
		NonNullable<Parameters<typeof model.createStateConfig>[0]['entry']>,
		(...args: never[]) => unknown
	>
	type CompletionArgs = Pick<Parameters<CompletionEntry>[0], 'context' | 'actions'>
	type CompletionQueue = Parameters<CompletionEntry>[1]
	const finalizers = {
		closed: (_args, _enq) => {
			return {
				context: {
					scope: undefined,
					request: undefined,
					observation: undefined,
					lease: undefined,
					drain: undefined
				} satisfies Partial<Context>
			}
		},
		unresolved: (_args, _enq) => {
			return {
				context: {
					request: undefined,
					observation: undefined,
					lease: undefined
				} satisfies Partial<Context>
			}
		}
	} satisfies Record<
		string,
		(args: CompletionArgs, enq: CompletionQueue) => void | { context?: Partial<Context> }
	>
	const complete = createFinalTransitions<
		Context,
		CompletionArgs,
		CompletionQueue,
		keyof typeof finalizers
	>(finalizers)

	return model.createMachine({
		id: 'workspace-selection',
		initial: 'unbound',
		context: ({ input }) => ({
			reportTo: input.reportTo,
			scope: undefined,
			request: undefined,
			observation: undefined,
			lease: undefined,
			drain: undefined,
			epoch: 0
		}),
		output: ({ context }) =>
			context.drain ? { outcome: 'unresolved', drain: context.drain } : { outcome: 'closed' },
		states: {
			unbound: {
				on: {
					BIND: (args) => {
						return {
							target: 'bound',
							context: { scope: { ...args.event.scope } } satisfies Partial<Context>
						}
					},
					SHUTDOWN: (args, enq) => {
						return complete('closed', args, enq, { target: 'closed' })
					}
				}
			},
			bound: {
				...select,
				initial: 'assessing',
				states: {
					assessing: {
						always: (args) => {
							const { context } = args
							if (
								!context.request ||
								!context.observation ||
								context.observation.access === 'unknown'
							) {
								return { target: 'waiting' }
							}
							if (context.observation?.access === 'denied') {
								return { target: 'denied' }
							}
							if (context.observation?.access === 'unavailable') {
								return { target: 'unavailable' }
							}
							if (context.observation?.access === 'failed') {
								return { target: 'failed' }
							}
							if (args.guards.locallyAllowed(args) && args.guards.canActivate(args)) {
								return { target: 'selected' }
							}
							return { target: 'failed' }
						}
					},
					waiting: { entry: report('waiting') },
					denied: { entry: report('denied') },
					unavailable: { entry: report('unavailable') },
					failed: { entry: report('failed') },
					selected: {
						entry: (args, enq) => {
							let context = args.context
							let patch = {}
							patch = {
								...patch,
								epoch: context.epoch + 1,
								lease: {
									scope: required(context.scope),
									request: required(context.request),
									epoch: context.epoch + 1
								}
							}
							context = { ...args.context, ...patch }
							enq.sendTo(context.reportTo, {
								type: 'WORKSPACE_SELECTION',
								status: 'selected',
								lease: required(context.lease),
								directory: required(context.observation).directory
							})
							return { context: patch satisfies Partial<Context> }
						},
						always: (args) => {
							if (!(args.context.observation?.access !== 'allowed')) return
							return { target: 'draining' }
						},
						on: {
							SELECT: (args) => {
								if (!args.guards.freshSelection(args)) return
								return {
									target: 'draining',
									context: patches.selectRequest(args) satisfies Partial<Context>
								}
							},
							OBSERVED: (args, enq) => {
								const { context: _context } = args
								if (
									args.guards.freshObservation(args) &&
									args.event.observation.access === 'allowed'
								) {
									let context = args.context
									let patch = {}
									patch = { ...patch, ...patches.observe(args) }
									context = { ...args.context, ...patch }
									enq.sendTo(context.reportTo, {
										type: 'WORKSPACE_SELECTION',
										status: 'selected',
										lease: required(context.lease),
										directory: required(context.observation).directory
									})
									return { context: patch satisfies Partial<Context> }
								}
								if (args.guards.freshObservation(args)) {
									return {
										context: patches.observe(args) satisfies Partial<Context>
									}
								}
							},
							SUSPEND: (args) => {
								if (!args.guards.currentScope(args)) return
								return { target: 'draining.suspending' }
							},
							SHUTDOWN: { target: 'draining.closing' }
						}
					},
					suspended: {
						entry: report('suspended'),
						on: {
							...retainedFacts.on,
							SUSPEND: {},
							RESUME: (args) => {
								if (!args.guards.freshObservation(args)) return
								return {
									target: 'assessing',
									context: patches.observe(args) satisfies Partial<Context>
								}
							}
						}
					},
					drainFailed: {
						entry: report('drainFailed'),
						on: {
							...retainedFacts.on,
							SUSPEND: {},
							RETRY: (args) => {
								if (!args.guards.freshObservation(args)) return
								return {
									target: 'assessing',
									context: patches.observe(args) satisfies Partial<Context>
								}
							}
						}
					},
					draining: {
						initial: 'switching',
						entry: (args, enq) => {
							let context = args.context
							let patch = {}
							patch = {
								...patch,
								drain: { token: Object.freeze({}), lease: required(context.lease) }
							}
							context = { ...args.context, ...patch }
							enq.sendTo(context.reportTo, {
								type: 'WORKSPACE_SCOPE_INVALIDATED',
								lease: required(context.lease)
							})
							enq.sendTo(context.reportTo, {
								type: 'WORKSPACE_DRAIN_REQUESTED',
								drain: required(context.drain)
							})
							return { context: patch satisfies Partial<Context> }
						},
						on: {
							...retainedFacts.on,
							DRAINED: (args, enq) => {
								if (
									args.guards.matchingDrain(args) &&
									matchesState({ bound: { draining: 'closing' } }, args.value)
								) {
									{
										return complete('closed', args, enq, {
											target: '#workspace-selection.closed',
											context: patches.clearReleased(args) satisfies Partial<Context>
										})
									}
								}
								if (
									args.guards.matchingDrain(args) &&
									matchesState({ bound: { draining: 'suspending' } }, args.value)
								) {
									return {
										target: '#workspace-selection.bound.suspended',
										context: patches.clearReleased(args) satisfies Partial<Context>
									}
								}
								if (args.guards.matchingDrain(args)) {
									return {
										target: '#workspace-selection.bound.assessing',
										context: patches.clearReleased(args) satisfies Partial<Context>
									}
								}
							},
							DRAIN_FAILED: (args, enq) => {
								const { context } = args
								if (args.guards.matchingDrain(args) && args.guards.unresolvedDrain(args)) {
									enq.sendTo(
										context.reportTo,
										(({ context, event }): WorkspaceSelectionReport => {
											if (event.type !== 'DRAIN_FAILED')
												throw new Error('Missing workspace drain failure')
											return {
												type: 'WORKSPACE_DRAIN_FAILED',
												drain: required(context.drain),
												outcome: event.outcome
											}
										})(args)
									)
									{
										return complete('unresolved', args, enq, {
											target: '#workspace-selection.unresolved'
										})
									}
								}
								if (
									args.guards.matchingDrain(args) &&
									matchesState({ bound: { draining: 'closing' } }, args.value)
								) {
									enq.sendTo(
										context.reportTo,
										(({ context, event }): WorkspaceSelectionReport => {
											if (event.type !== 'DRAIN_FAILED')
												throw new Error('Missing workspace drain failure')
											return {
												type: 'WORKSPACE_DRAIN_FAILED',
												drain: required(context.drain),
												outcome: event.outcome
											}
										})(args)
									)
									{
										return complete('closed', args, enq, {
											target: '#workspace-selection.closed',
											context: patches.clearReleased(args) satisfies Partial<Context>
										})
									}
								}
								if (args.guards.matchingDrain(args)) {
									enq.sendTo(
										context.reportTo,
										(({ context, event }): WorkspaceSelectionReport => {
											if (event.type !== 'DRAIN_FAILED')
												throw new Error('Missing workspace drain failure')
											return {
												type: 'WORKSPACE_DRAIN_FAILED',
												drain: required(context.drain),
												outcome: event.outcome
											}
										})(args)
									)
									return {
										target: '#workspace-selection.bound.drainFailed',
										context: patches.clearReleased(args) satisfies Partial<Context>
									}
								}
							},
							SUSPEND: (args) => {
								if (!args.guards.currentScope(args)) return
								return { target: '.suspending' }
							},
							SHUTDOWN: { target: '.closing' }
						},
						states: {
							switching: {},
							suspending: {},
							closing: { on: { SELECT: {}, OBSERVED: {}, SUSPEND: {}, SHUTDOWN: {} } }
						}
					}
				}
			},
			closed: {
				type: 'final'
			},
			unresolved: {
				type: 'final'
			}
		}
	})
}
/** Public resource selector. Invalidated/draining/terminal scopes never remain usable. */
export function selectWorkspaceLease(
	snapshot: SnapshotFrom<ReturnType<typeof createWorkspaceSelectionMachine>>
) {
	return snapshot.status === 'active' && snapshot.matches({ bound: 'selected' })
		? snapshot.context.lease
		: undefined
}
