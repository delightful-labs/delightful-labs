import type { getDb } from 'jazz-tools/svelte'
import {
	sameIntegrityRequest,
	type IntegrityRequest,
	type IntegrityStatus,
	type IntegrityRecipient,
	type IntegrityStatusEvent
} from '../../contracts/workspace-integrity-contract.js'
import type { IntegrityResult } from './workspace-integrity-transaction.js'
import { workspaceIntegrity } from './workspace-integrity.js'
import {
	retainResourceRelease,
	type WorkspaceResourceRelease
} from '../../contracts/workspace-resource-release.js'
import { setup, types, matchesState } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'

export type {
	IntegrityBinding,
	WorkspaceIntegrityView
} from '../../contracts/workspace-integrity-contract.js'
type Input = { request: IntegrityRequest; recipient: IntegrityRecipient }
type Context = Input & {
	release: WorkspaceResourceRelease
	operation: IntegrityRequest | undefined
	result: IntegrityResult | undefined
}
type Event = { type: 'OBSERVED'; request: IntegrityRequest } | { type: 'REEVALUATE' | 'SHUTDOWN' }
type Db = Pick<ReturnType<typeof getDb>, 'all' | 'beginTransaction' | 'getConfig'>

function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Missing integrity operation result')
	return value
}

function integrityRelease(result: IntegrityResult): WorkspaceResourceRelease {
	if (result.settlement === 'unresolved') return { outcome: 'unresolved' }
	return {
		outcome: ['failed', 'partial', 'conflict', 'unavailable'].includes(result.outcome)
			? 'releasedWithFailure'
			: 'released'
	}
}

/** The database binding is fixed; its parent drains this owner before replacing the database. */
export function createWorkspaceIntegrityOwner(db: Db) {
	const events0 = {
		OBSERVED: types<EventPayload<Event, 'OBSERVED'>>(),
		REEVALUATE: types<EventPayload<Event, 'REEVALUATE'>>(),
		SHUTDOWN: types<EventPayload<Event, 'SHUTDOWN'>>()
	}
	type NativeEvent0 =
		| import('xstate').InferEvents<typeof events0>
		| import('xstate').DoneActorEvent<import('xstate').OutputFrom<typeof workspaceIntegrity>>
		| import('xstate').ErrorActorEvent
	const model = setup({
		schemas: {
			context: types<Context>(),
			events: events0,
			input: types<Input>(),
			output: types<WorkspaceResourceRelease>(),
			children: {
				repair:
					types<import('xstate').ActorRefFrom<{ repair: typeof workspaceIntegrity }['repair']>>()
			}
		},
		actors: { repair: workspaceIntegrity },
		guards: {
			bindingChanged: ({ context }: { context: Context }) =>
				context.operation === undefined ||
				!sameIntegrityRequest(context.request, context.operation),
			closing: (args: { value: import('xstate').StateValue }) =>
				matchesState({ running: 'closing' }, args.value),
			replacing: (args: { value: import('xstate').StateValue }) =>
				matchesState({ running: 'replacing' }, args.value)
		}
	})
	const settlement = (context: Context) => required(context.result).settlement
	return model.createMachine({
		id: 'workspace-integrity-owner',
		context: ({ input }) => ({
			...input,
			operation: undefined,
			result: undefined,
			release: { outcome: 'released' }
		}),
		output: ({ context }) => context.release,
		initial: 'checking',
		on: {
			OBSERVED: (args, enq) => {
				enq.raise({ type: 'REEVALUATE' })
				return { context: { request: args.event.request } }
			},
			REEVALUATE: (args) => {
				if (!args.guards.bindingChanged(args)) return
				return { target: '.checking' }
			},
			SHUTDOWN: { target: '.closed' }
		},
		states: {
			checking: {
				always: (args) => {
					if (args.context.request.binding !== undefined) {
						return { target: 'running' }
					}
					return { target: 'waiting' }
				}
			},
			waiting: {
				tags: ['integrity-waiting'],
				entry: (args, enq) => {
					let context = args.context
					let patch = {}
					patch = { ...patch, ...((args) => ({ operation: undefined, result: undefined }))(args) }
					context = { ...args.context, ...patch }
					enq.sendTo(context.recipient, {
						type: 'INTEGRITY_STATUS',
						report: {
							request: context.operation ?? context.request,
							status: ((): IntegrityStatus => ({ kind: 'waiting' }))()
						}
					})
					return { context: patch }
				}
			},
			running: {
				tags: ['integrity-working'],
				initial: 'active',
				entry: (args, enq) => {
					let context = args.context
					let patch = {}
					patch = {
						...patch,
						...((args) => ({
							operation: (({ context }) => context.request)(args),
							result: undefined
						}))(args)
					}
					context = { ...args.context, ...patch }
					enq.sendTo(context.recipient, {
						type: 'INTEGRITY_STATUS',
						report: {
							request: context.operation ?? context.request,
							status: ((): IntegrityStatus => ({ kind: 'checking' }))()
						}
					})
					return { context: patch }
				},
				on: {
					REEVALUATE: (args, enq) => {
						if (!args.guards.bindingChanged(args)) return
						enq.sendTo('repair', { type: 'SHUTDOWN' })
						return { target: '.replacing' }
					},
					SHUTDOWN: (args, enq) => {
						enq.sendTo('repair', { type: 'SHUTDOWN' })
						return { target: '.closing' }
					}
				},
				states: {
					active: {},
					replacing: {
						entry: (args, enq) => {
							const { context } = args
							enq.sendTo(context.recipient, {
								type: 'INTEGRITY_STATUS',
								report: {
									request: context.operation ?? context.request,
									status: ((): IntegrityStatus => ({ kind: 'waiting' }))()
								}
							})
						},
						on: { REEVALUATE: {} }
					},
					closing: {
						entry: (args, enq) => {
							const { context } = args
							enq.sendTo(context.recipient, {
								type: 'INTEGRITY_STATUS',
								report: {
									request: context.operation ?? context.request,
									status: ((): IntegrityStatus => ({ kind: 'waiting' }))()
								}
							})
						},
						on: { REEVALUATE: {}, SHUTDOWN: {} }
					}
				},
				invoke: {
					id: 'repair',
					src: 'repair',
					input: ({ context }) => {
						if (!context.request?.binding)
							throw new Error('Integrity repair requires a bound workspace')
						return { ...context.request.binding, db }
					},
					onDone: (args) => {
						const { context, event } = args
						if (matchesState({ running: 'closing' }, args.value)) {
							return {
								target: 'closed',
								context: {
									result: event.output,
									release: retainResourceRelease(context.release, integrityRelease(event.output))
								}
							}
						}
						if (matchesState({ running: 'replacing' }, args.value)) {
							return {
								target: 'checking',
								context: {
									release: retainResourceRelease(context.release, integrityRelease(event.output))
								}
							}
						}
						return {
							target: 'classifying',
							context: {
								result: event.output,
								release: retainResourceRelease(context.release, integrityRelease(event.output))
							}
						}
					},
					onError: (args) => {
						const { event } = args
						if (matchesState({ running: 'closing' }, args.value)) {
							return {
								target: 'closed',
								context: {
									release: { outcome: 'unresolved' },
									result: {
										outcome: 'failed',
										settlement: 'unresolved',
										error: event.error
									}
								}
							}
						}
						if (matchesState({ running: 'replacing' }, args.value)) {
							return { target: 'checking', context: { release: { outcome: 'unresolved' } } }
						}
						return {
							target: 'unresolved',
							context: {
								release: { outcome: 'unresolved' },
								result: {
									outcome: 'failed',
									settlement: 'unresolved',
									error: event.error
								}
							}
						}
					}
				}
			},
			classifying: {
				always: (args) => {
					const { context } = args
					if (context.result?.outcome === 'complete') {
						return { target: 'complete' }
					}
					if (context.result?.outcome === 'partial') {
						return { target: 'partial' }
					}
					if (context.result?.outcome === 'unavailable') {
						return { target: 'unavailable' }
					}
					if (context.result?.outcome === 'conflict') {
						return { target: 'conflict' }
					}
					if (context.result?.settlement === 'unresolved') {
						return { target: 'unresolved' }
					}
					return { target: 'failed' }
				}
			},
			complete: {
				tags: ['integrity-complete', 'integrity-finance-ready'],
				entry: (args, enq) => {
					const { context } = args
					enq.sendTo(context.recipient, {
						type: 'INTEGRITY_STATUS',
						report: {
							request: context.operation ?? context.request,
							status: ((context): IntegrityStatus => ({
								kind: 'complete',
								settlement: settlement(context)
							}))(context)
						}
					})
				}
			},
			partial: {
				tags: ['integrity-partial', 'integrity-finance-ready'],
				entry: (args, enq) => {
					const { context } = args
					enq.sendTo(context.recipient, {
						type: 'INTEGRITY_STATUS',
						report: {
							request: context.operation ?? context.request,
							status: ((context): IntegrityStatus => {
								const result = required(context.result)
								if (result.outcome !== 'partial')
									throw new Error('Expected partial integrity result')
								return {
									kind: 'partial',
									issues: result.issues,
									settlement: result.settlement,
									access: 'usable'
								}
							})(context)
						}
					})
				}
			},
			unavailable: {
				tags: ['integrity-unavailable'],
				entry: (args, enq) => {
					const { context } = args
					enq.sendTo(context.recipient, {
						type: 'INTEGRITY_STATUS',
						report: {
							request: context.operation ?? context.request,
							status: ((context): IntegrityStatus => ({
								kind: 'unavailable',
								settlement: settlement(context)
							}))(context)
						}
					})
				}
			},
			conflict: {
				tags: ['integrity-conflict'],
				entry: (args, enq) => {
					const { context } = args
					enq.sendTo(context.recipient, {
						type: 'INTEGRITY_STATUS',
						report: {
							request: context.operation ?? context.request,
							status: ((context): IntegrityStatus => ({
								kind: 'conflict',
								settlement: settlement(context)
							}))(context)
						}
					})
				}
			},
			failed: {
				tags: ['integrity-failed'],
				entry: (args, enq) => {
					const { context } = args
					enq.sendTo(context.recipient, {
						type: 'INTEGRITY_STATUS',
						report: {
							request: context.operation ?? context.request,
							status: ((context): IntegrityStatus => ({
								kind: 'failed',
								settlement: settlement(context)
							}))(context)
						}
					})
				}
			},
			unresolved: {
				tags: ['integrity-unresolved'],
				entry: (args, enq) => {
					const { context } = args
					enq.sendTo(context.recipient, {
						type: 'INTEGRITY_STATUS',
						report: {
							request: context.operation ?? context.request,
							status: ((): IntegrityStatus => ({ kind: 'unresolved', settlement: 'unresolved' }))()
						}
					})
				}
			},
			closed: {
				type: 'final',
				entry: (args, enq) => {
					const { context } = args
					enq.sendTo(context.recipient, {
						type: 'INTEGRITY_STATUS',
						report: {
							request: context.operation ?? context.request,
							status: ((context): IntegrityStatus => ({
								kind: 'closed',
								settlement: context.result?.settlement ?? 'notStarted'
							}))(context)
						}
					})
				}
			}
		}
	})
}
