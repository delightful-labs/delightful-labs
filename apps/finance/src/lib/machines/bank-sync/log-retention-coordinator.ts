import {
	createSyncLogRetentionMachine,
	type RetentionScope,
	type RetentionResult
} from './log-retention.js'
import { required } from './identity.js'
import type { Dependencies } from './types.js'
import {
	retainResourceRelease,
	type WorkspaceResourceRelease
} from '../../contracts/workspace-resource-release.js'
import { setup, types, matchesState } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'

type Event =
	| { type: 'CHECK'; scope: RetentionScope | undefined; completion: string | undefined }
	| { type: 'SHUTDOWN' }
type Context = {
	release: WorkspaceResourceRelease
	scope: RetentionScope | undefined
	completion: string | undefined
	result: RetentionResult | undefined
}
function sameScope(left: RetentionScope | undefined, right: RetentionScope | undefined) {
	return (
		left?.connectionId === right?.connectionId &&
		left?.organizationId === right?.organizationId &&
		left?.userId === right?.userId
	)
}

function retentionRelease(result: RetentionResult): WorkspaceResourceRelease {
	if (result.settlement === 'unresolved') return { outcome: 'unresolved' }
	return { outcome: result.kind === 'failed' ? 'releasedWithFailure' : 'released' }
}

/** Rebind only after the previous transaction owner has drained. */
export function createSyncLogRetentionCoordinator(
	dependencies: Pick<Dependencies, 'db' | 'observe'>
) {
	const actors = { retention: createSyncLogRetentionMachine(dependencies) }
	const events0 = {
		CHECK: types<EventPayload<Event, 'CHECK'>>(),
		SHUTDOWN: types<EventPayload<Event, 'SHUTDOWN'>>()
	}
	type NativeEvent0 =
		| import('xstate').InferEvents<typeof events0>
		| import('xstate').DoneActorEvent<import('xstate').OutputFrom<(typeof actors)['retention']>>
		| import('xstate').ErrorActorEvent
	return setup({
		schemas: {
			context: types<Context>(),
			events: events0,
			input: types<undefined>(),
			output: types<WorkspaceResourceRelease>(),
			children: { retention: types<import('xstate').ActorRefFrom<(typeof actors)['retention']>>() }
		},
		actors,
		guards: {
			closing: (args: { value: import('xstate').StateValue }) =>
				matchesState({ working: 'closing' }, args.value),
			replacing: (args: { value: import('xstate').StateValue }) =>
				matchesState({ working: 'replacing' }, args.value),
			hasScope: ({ context }: { context: Context }) => context.scope !== undefined
		},
		delays: { retry: 60_000 }
	}).createMachine({
		id: 'sync-log-retention-coordinator',
		context: {
			scope: undefined,
			completion: undefined,
			result: undefined,
			release: { outcome: 'released' }
		},
		output: ({ context }) => context.release,
		initial: 'idle',
		states: {
			idle: {
				on: {
					CHECK: (args) => {
						const { context, event } = args
						if (!(
							context.result === undefined ||
							!sameScope(context.scope, event.scope) ||
							context.completion !== event.completion
						))
							return
						return {
							target: 'choosing',
							context: { scope: event.scope, completion: event.completion }
						}
					},
					SHUTDOWN: { target: 'closed' }
				},
				after: {
					retry: (args) => {
						if (!args.guards.hasScope(args)) return
						return { target: 'working' }
					}
				}
			},
			choosing: {
				always: (args) => {
					if (args.guards.hasScope(args)) {
						return { target: 'working' }
					}
					return { target: 'idle' }
				}
			},
			working: {
				initial: 'active',
				states: { active: {}, replacing: {}, closing: { on: { CHECK: {}, SHUTDOWN: {} } } },
				on: {
					CHECK: (args, enq) => {
						const { context, event } = args
						if (!(
							!sameScope(context.scope, event.scope) || context.completion !== event.completion
						))
							return
						enq.sendTo('retention', { type: 'CANCEL' })
						return {
							target: '.replacing',
							context: { scope: event.scope, completion: event.completion }
						}
					},
					SHUTDOWN: (args, enq) => {
						enq.sendTo('retention', { type: 'CANCEL' })
						return { target: '.closing' }
					}
				},
				invoke: {
					id: 'retention',
					src: 'retention',
					input: ({ context }) => ({ scope: required(context.scope) }),
					onDone: (args) => {
						const { context, event } = args
						if (matchesState({ working: 'closing' }, args.value)) {
							return {
								target: 'closed',
								context: {
									result: event.output,
									release: retainResourceRelease(context.release, retentionRelease(event.output))
								}
							}
						}
						if (matchesState({ working: 'replacing' }, args.value)) {
							return {
								target: 'choosing',
								context: {
									result: event.output,
									release: retainResourceRelease(context.release, retentionRelease(event.output))
								}
							}
						}
						return {
							target: 'idle',
							context: {
								result: event.output,
								release: retainResourceRelease(context.release, retentionRelease(event.output))
							}
						}
					},
					onError: (args) => {
						if (matchesState({ working: 'closing' }, args.value)) {
							return { target: 'closed', context: { release: { outcome: 'unresolved' } } }
						}
						if (matchesState({ working: 'replacing' }, args.value)) {
							return { target: 'choosing', context: { release: { outcome: 'unresolved' } } }
						}
						return {
							target: 'idle',
							context: {
								result: { kind: 'failed', deletedCount: 0, settlement: 'unresolved' },
								release: { outcome: 'unresolved' }
							}
						}
					}
				}
			},
			closed: {
				type: 'final',
				entry: () => {
					return { context: { scope: undefined, completion: undefined } }
				}
			}
		}
	})
}
