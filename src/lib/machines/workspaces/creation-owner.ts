import { matchesState, type StateValue, types, setup, type ActorLogic, type Snapshot } from 'xstate'

import type { EventPayload } from '../../contracts/machine-events.js'
/** Host key includes every identity/profile/backend dimension that invalidates this operation. */
export type CreationBinding = {
	key: string
}
export type CreationRecord = {
	key: string
	attempt: unknown
}
export type CreationRequest<Record> =
	| {
			mode: 'load'
	  }
	| {
			mode: 'create'
			name: string
	  }
	| {
			mode: 'clear'
			record: Record
	  }
	| {
			mode: 'retry'
			record: Record
			settlement: 'notStarted' | 'unresolved'
	  }
export type CreationResult<Record, Workspace> =
	| {
			outcome: 'editing' | 'invalid'
			record: undefined
			settlement: 'notStarted'
	  }
	| {
			outcome: 'recovered'
			record: Record
			settlement: 'notStarted'
	  }
	| {
			outcome: 'complete'
			record: Record
			workspace: Workspace
			settlement: 'locallyPersisted'
	  }
	| {
			outcome: 'conflict'
			record: Record | undefined
			settlement: 'notStarted'
	  }
	| {
			outcome: 'failed'
			record: Record | undefined
			settlement: 'notStarted'
			error: unknown
	  }
	| {
			outcome: 'unresolved'
			record: Record | undefined
			settlement: 'unresolved'
			error: unknown
	  }
	| {
			outcome: 'cancelled' | 'closed'
			record: Record | undefined
			settlement: 'notStarted' | 'locallyPersisted' | 'unresolved'
	  }
export type CreationOperationLogic<
	Record,
	S extends Snapshot<unknown>,
	Binding extends CreationBinding = CreationBinding
> = ActorLogic<
	S,
	{
		type: 'CANCEL' | 'SHUTDOWN'
	},
	{
		binding: Binding
		request: CreationRequest<Record>
	}
>
export function createWorkspaceCreationOwner<
	Record extends CreationRecord,
	Workspace,
	S extends Snapshot<CreationResult<Record, Workspace>>,
	Binding extends CreationBinding = CreationBinding
>(operation: CreationOperationLogic<Record, S, Binding>) {
	type WorkspaceJournalRecord = Record
	type CreationRequest = import('./creation-owner.js').CreationRequest<Record>
	type Result = CreationResult<Record, Workspace>
	type Context = {
		draftRevision: number
		request: CreationRequest
		result: Result | undefined
		bindingState: {
			binding: Binding | undefined
			operation: Binding | undefined
			record: WorkspaceJournalRecord | undefined
		}
	}
	type Event =
		| {
				type: 'OBSERVED'
				binding: Binding | undefined
		  }
		| {
				type: 'SUBMIT'
				name: string
		  }
		| {
				type: 'REEVALUATE' | 'RETRY' | 'NEW' | 'CANCEL' | 'SHUTDOWN'
		  }
	function completed(output: Result | undefined, context: Context): Partial<Context> {
		const result: Result = output ?? {
			outcome: 'unresolved',
			settlement: 'unresolved',
			record: context.bindingState.record,
			error: new Error('Creation operation returned no result')
		}
		return { result, bindingState: { ...context.bindingState, record: result.record } }
	}
	const invokeModel = setup({
		schemas: {
			context: types<Context>(),
			events: {
				OBSERVED: types<EventPayload<Event, 'OBSERVED'>>(),
				SUBMIT: types<EventPayload<Event, 'SUBMIT'>>(),
				CANCEL: types<EventPayload<Event, 'CANCEL'>>(),
				SHUTDOWN: types<EventPayload<Event, 'SHUTDOWN'>>(),
				REEVALUATE: types<EventPayload<Event, 'REEVALUATE'>>(),
				RETRY: types<EventPayload<Event, 'RETRY'>>(),
				NEW: types<EventPayload<Event, 'NEW'>>()
			},
			input: types<{
				binding: Binding | undefined
			}>(),
			output: types<{
				binding: Binding | undefined
				result: Result | undefined
			}>()
		},
		actors: { operation },
		guards: {
			changed: ({ context }: { context: Context }) =>
				context.bindingState.binding?.key !== context.bindingState.operation?.key,
			replacing: ({ value }: { value: StateValue }) =>
				matchesState({ operating: 'replacing' }, value),
			closing: ({ value }: { value: StateValue }) => matchesState({ operating: 'closing' }, value)
		}
	})
	return invokeModel.createMachine({
		id: 'workspace-creation',
		initial: 'checking',
		context: ({ input }) => ({
			draftRevision: 0,
			request: { mode: 'load' },
			result: undefined,
			bindingState: {
				binding: input.binding,
				operation: undefined,
				record: undefined
			}
		}),
		output: ({ context }) => ({ binding: context.bindingState.operation, result: context.result }),
		on: {
			OBSERVED: (args, enq) => {
				enq.raise({ type: 'REEVALUATE' })
				return {
					context: {
						bindingState: {
							...args.context.bindingState,
							binding: args.event.binding
						}
					} satisfies Partial<Context>
				}
			},
			REEVALUATE: (args) => {
				if (!args.guards.changed(args)) return
				return { target: '.checking' }
			},
			SHUTDOWN: { target: '.closed' },
			RETRY: (args) => {
				const { context } = args
				if (
					context.bindingState.binding !== undefined &&
					context.bindingState.record !== undefined
				) {
					return {
						target: '.operating',
						context: {
							request: (({ context }): CreationRequest => {
								if (!context.bindingState.record) throw new Error('Missing retry attempt')
								return {
									mode: 'retry',
									record: context.bindingState.record,
									settlement:
										context.result?.settlement === 'notStarted' ? 'notStarted' : 'unresolved'
								}
							})(args)
						} satisfies Partial<Context>
					}
				}
				return { target: '.checking' }
			}
		},
		states: {
			checking: {
				entry: (_args) => {
					return {
						context: {
							result: undefined,
							request: { mode: 'load' },
							bindingState: {
								..._args.context.bindingState,
								record: undefined
							}
						} satisfies Partial<Context>
					}
				},
				always: (args) => {
					if (args.context.bindingState.binding !== undefined) {
						return { target: 'operating' }
					}
					return { target: 'unavailable' }
				}
			},
			unavailable: {
				entry: (_args) => {
					return {
						context: {
							bindingState: {
								..._args.context.bindingState,
								operation: undefined
							}
						} satisfies Partial<Context>
					}
				}
			},
			editing: {
				entry: (args) => {
					return {
						context: { draftRevision: args.context.draftRevision + 1 } satisfies Partial<Context>
					}
				},
				on: {
					SUBMIT: (args) => {
						return {
							target: 'operating',
							context: {
								request: { mode: 'create', name: args.event.name }
							} satisfies Partial<Context>
						}
					}
				}
			},
			invalid: {
				on: {
					SUBMIT: (args) => {
						return {
							target: 'operating',
							context: {
								request: { mode: 'create', name: args.event.name }
							} satisfies Partial<Context>
						}
					}
				}
			},
			operating: {
				initial: 'active',
				entry: (args) => {
					return {
						context: {
							bindingState: {
								...args.context.bindingState,
								operation: args.context.bindingState.binding
							}
						} satisfies Partial<Context>
					}
				},
				on: {
					REEVALUATE: (args, enq) => {
						if (!args.guards.changed(args)) return
						enq.sendTo('operation', { type: 'SHUTDOWN' })
						return { target: '.replacing' }
					},
					SHUTDOWN: (args, enq) => {
						enq.sendTo('operation', { type: 'SHUTDOWN' })
						return { target: '.closing' }
					},
					CANCEL: (args, enq) => {
						enq.sendTo('operation', { type: 'CANCEL' })
					},
					RETRY: {},
					SUBMIT: {},
					NEW: {}
				},
				states: {
					active: {},
					replacing: { on: { REEVALUATE: {}, RETRY: {}, CANCEL: {} } },
					closing: { on: { REEVALUATE: {}, RETRY: {}, CANCEL: {}, SHUTDOWN: {} } }
				},
				invoke: invokeModel.createInvoke<typeof operation, Context>({
					id: 'operation',
					src: operation,
					input: ({ context }) => {
						if (!context.bindingState.operation) throw new Error('Missing creation binding')
						return { binding: context.bindingState.operation, request: context.request }
					},
					onDone: (args) => {
						const { context, event } = args
						if (event.output === undefined || event.output.settlement === 'unresolved') {
							return {
								target: 'unresolved',
								context: completed(event.output, context) satisfies Partial<Context>
							}
						}
						if (matchesState({ operating: 'closing' }, args.value)) {
							return {
								target: 'closed',
								context: completed(event.output, context) satisfies Partial<Context>
							}
						}
						if (matchesState({ operating: 'replacing' }, args.value)) {
							return { target: 'checking' }
						}
						return {
							target: 'classifying',
							context: completed(event.output, context) satisfies Partial<Context>
						}
					},
					onError: (args) => {
						return {
							target: 'unresolved',
							context: {
								result: {
									outcome: 'unresolved',
									settlement: 'unresolved',
									record: args.context.bindingState.record,
									error: args.event.error
								}
							} satisfies Partial<Context>
						}
					}
				})
			},
			classifying: {
				type: 'choice',
				choice: (args) => {
					const { context } = args
					if (context.result?.outcome === 'complete') {
						return { target: 'complete' }
					}
					if (context.result?.outcome === 'editing') {
						return { target: 'editing' }
					}
					if (context.result?.outcome === 'invalid') {
						return { target: 'invalid' }
					}
					if (
						context.result?.outcome === 'recovered' ||
						(context.result?.outcome === 'cancelled' && context.bindingState.record !== undefined)
					) {
						return { target: 'recovered' }
					}
					if (context.result?.outcome === 'cancelled' && context.request.mode === 'load') {
						return { target: 'checking' }
					}
					if (context.result?.outcome === 'cancelled') {
						return { target: 'editing' }
					}
					if (context.result?.outcome === 'conflict') {
						return { target: 'conflict' }
					}
					if (context.result?.outcome === 'unresolved') {
						return { target: 'unresolved' }
					}
					return { target: 'failed' }
				}
			},
			complete: {
				on: {
					NEW: (args) => {
						return {
							target: 'operating',
							context: {
								request: (({ context }): CreationRequest => {
									if (!context.bindingState.record) throw new Error('Missing completed attempt')
									return { mode: 'clear', record: context.bindingState.record }
								})(args)
							} satisfies Partial<Context>
						}
					}
				}
			},
			recovered: {},
			conflict: { on: { RETRY: { target: 'checking' } } },
			failed: {},
			unresolved: {
				on: {
					REEVALUATE: {},
					SHUTDOWN: {},
					RETRY: (args) => {
						const { context } = args
						if (
							context.bindingState.binding !== undefined &&
							context.bindingState.binding.key === context.bindingState.operation?.key
						) {
							return {
								target: 'operating',
								context: {
									request: (({ context }): CreationRequest => {
										return context.bindingState.record
											? {
													mode: 'retry',
													record: context.bindingState.record,
													settlement: 'unresolved'
												}
											: { mode: 'load' }
									})(args)
								} satisfies Partial<Context>
							}
						}
						return {}
					}
				}
			},
			closed: { type: 'final', on: { OBSERVED: {}, REEVALUATE: {}, RETRY: {}, SHUTDOWN: {} } }
		}
	})
}
