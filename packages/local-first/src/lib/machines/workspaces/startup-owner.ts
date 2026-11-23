import { matchesState, setup, types, type ActorLogic, type Snapshot } from 'xstate'
import type {
	WorkspaceInitializationProvenance,
	WorkspaceInitializationSettlement,
	WorkspaceStartupInput,
	WorkspaceStartupResult
} from '../../contracts/workspace-startup.js'
import type { InitializationEvent } from './initialization.js'

/** One native binding owns initialization, its report and its terminal drain receipt. */
export function createWorkspaceStartupOwner<
	Input,
	Result extends { outcome: string; settlement?: WorkspaceInitializationSettlement },
	S extends Snapshot<Result>
>(options: {
	initialize: ActorLogic<S, InitializationEvent, Input>
	/** Pure projection; initialization provenance is independent of selected workspace access. */
	provenance: (result: Result) => WorkspaceInitializationProvenance | undefined
}) {
	type Context = {
		request: WorkspaceStartupInput<Input, Result>
		completion: {
			initialization: Result | undefined
			provenance: WorkspaceInitializationProvenance | undefined
		}
		outcome: 'closed' | 'unresolved'
	}
	function unresolved(result: Result | undefined) {
		return result === undefined || result.settlement === 'unresolved'
	}
	const model = setup({
		schemas: {
			input: types<WorkspaceStartupInput<Input, Result>>(),
			context: types<Context>(),
			events: { SHUTDOWN: types() }
		},
		actors: { initialize: options.initialize }
	})
	return model.createMachine({
		id: 'workspace-startup-owner',
		context: ({ input }) => ({
			request: input,
			completion: { initialization: undefined, provenance: undefined },
			outcome: 'closed'
		}),
		initial: 'initializing',
		output: ({ context }): WorkspaceStartupResult<Result> => ({
			outcome: context.outcome,
			...context.completion
		}),
		states: {
			initializing: {
				initial: 'active',
				invoke: model.createInvoke<typeof options.initialize, Context>({
					id: 'initialize',
					src: options.initialize,
					input: ({ context }) => context.request.initialization,
					onDone: ({ event, value }) => {
						const result = event.output
						if (result === undefined)
							return { target: 'closed', context: { outcome: 'unresolved' } }
						if (matchesState({ initializing: 'closing' }, value))
							return {
								target: 'closed',
								context: {
									completion: { initialization: result, provenance: undefined },
									outcome: unresolved(result) ? 'unresolved' : 'closed'
								}
							}
						return {
							target: 'settled',
							context: {
								completion: {
									initialization: result,
									provenance: options.provenance(result)
								}
							}
						}
					},
					onError: { target: 'closed', context: { outcome: 'unresolved' } }
				}),
				states: {
					active: {
						on: {
							SHUTDOWN: (_, enq) => {
								enq.sendTo('initialize', { type: 'SHUTDOWN' })
								return { target: 'closing' }
							}
						}
					},
					closing: { on: { SHUTDOWN: {} } }
				}
			},
			settled: {
				entry: ({ context }, enq) => {
					const initialization = context.completion.initialization
					if (initialization === undefined) throw new Error('Missing initialization result')
					enq.sendTo(context.request.recipient, {
						type: 'WORKSPACE_INITIALIZATION_RESULT',
						binding: context.request.binding,
						initialization,
						provenance: context.completion.provenance
					})
				},
				on: {
					SHUTDOWN: ({ context }) => ({
						target: 'closed',
						context: {
							outcome: unresolved(context.completion.initialization) ? 'unresolved' : 'closed'
						}
					})
				}
			},
			closed: { type: 'final' }
		}
	})
}
