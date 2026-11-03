import { assign, raise, sendTo, setup, stateIn, type ActorLogic, type Snapshot } from 'xstate'
/** Host key includes every identity/profile/backend dimension that invalidates this operation. */
export type CreationBinding = { key: string }
export type CreationRecord = {
	key: string
	attempt: unknown
}
export type CreationRequest<Record> =
	| { mode: 'load' }
	| { mode: 'create'; name: string }
	| { mode: 'clear'; record: Record }
	| { mode: 'retry'; record: Record; settlement: 'notStarted' | 'unresolved' }
export type CreationResult<Record, Workspace> =
	| { outcome: 'editing' | 'invalid'; record: undefined; settlement: 'notStarted' }
	| { outcome: 'recovered'; record: Record; settlement: 'notStarted' }
	| {
			outcome: 'complete'
			record: Record
			workspace: Workspace
			settlement: 'locallyPersisted'
	  }
	| { outcome: 'conflict'; record: Record | undefined; settlement: 'notStarted' }
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
	{ type: 'CANCEL' | 'SHUTDOWN' },
	{ binding: Binding; request: CreationRequest<Record> }
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
		binding: Binding | undefined
		operation: Binding | undefined
		request: CreationRequest
		record: WorkspaceJournalRecord | undefined
		result: Result | undefined
	}
	type Event =
		| { type: 'OBSERVED'; binding: Binding | undefined }
		| { type: 'SUBMIT'; name: string }
		| { type: 'REEVALUATE' | 'RETRY' | 'NEW' | 'CANCEL' | 'SHUTDOWN' }
	function completed(output: Result | undefined, context: Context) {
		const result: Result = output ?? {
			outcome: 'unresolved',
			settlement: 'unresolved',
			record: context.record,
			error: new Error('Creation operation returned no result')
		}
		return { result, record: result.record }
	}
	return setup<
		Context,
		Event,
		{ operation: typeof operation },
		{},
		{},
		{ changed: undefined; replacing: undefined; closing: undefined },
		never,
		string,
		{ binding: Binding | undefined },
		{ binding: Binding | undefined; result: Result | undefined }
	>({
		actors: { operation },
		guards: {
			changed: ({ context }) => context.binding?.key !== context.operation?.key,
			replacing: stateIn({ operating: 'replacing' }),
			closing: stateIn({ operating: 'closing' })
		}
	}).createMachine({
		id: 'workspace-creation',
		initial: 'checking',
		context: ({ input }) => ({
			...input,
			draftRevision: 0,
			operation: undefined,
			request: { mode: 'load' },
			record: undefined,
			result: undefined
		}),
		output: ({ context }) => ({ binding: context.operation, result: context.result }),
		on: {
			OBSERVED: {
				actions: [assign({ binding: ({ event }) => event.binding }), raise({ type: 'REEVALUATE' })]
			},
			REEVALUATE: { guard: 'changed', target: '.checking' },
			SHUTDOWN: '.closed',
			RETRY: [
				{
					guard: ({ context }) => context.binding !== undefined && context.record !== undefined,
					target: '.operating',
					actions: assign({
						request: ({ context }): CreationRequest => {
							if (!context.record) throw new Error('Missing retry attempt')
							return {
								mode: 'retry',
								record: context.record,
								settlement:
									context.result?.settlement === 'notStarted' ? 'notStarted' : 'unresolved'
							}
						}
					})
				},
				{ target: '.checking' }
			]
		},
		states: {
			checking: {
				entry: assign({ record: undefined, result: undefined, request: { mode: 'load' } }),
				always: [
					{ guard: ({ context }) => context.binding !== undefined, target: 'operating' },
					{ target: 'unavailable' }
				]
			},
			unavailable: { entry: assign({ operation: undefined }) },
			editing: {
				entry: assign({ draftRevision: ({ context }) => context.draftRevision + 1 }),
				on: {
					SUBMIT: {
						target: 'operating',
						actions: assign({ request: ({ event }) => ({ mode: 'create', name: event.name }) })
					}
				}
			},
			invalid: {
				on: {
					SUBMIT: {
						target: 'operating',
						actions: assign({ request: ({ event }) => ({ mode: 'create', name: event.name }) })
					}
				}
			},
			operating: {
				initial: 'active',
				entry: assign({ operation: ({ context }) => context.binding }),
				on: {
					REEVALUATE: {
						guard: 'changed',
						target: '.replacing',
						actions: sendTo('operation', { type: 'SHUTDOWN' })
					},
					SHUTDOWN: { target: '.closing', actions: sendTo('operation', { type: 'SHUTDOWN' }) },
					CANCEL: { actions: sendTo('operation', { type: 'CANCEL' }) },
					RETRY: {},
					SUBMIT: {},
					NEW: {}
				},
				states: {
					active: {},
					replacing: { on: { REEVALUATE: {}, RETRY: {}, CANCEL: {} } },
					closing: { on: { REEVALUATE: {}, RETRY: {}, CANCEL: {}, SHUTDOWN: {} } }
				},
				invoke: {
					id: 'operation',
					src: 'operation',
					input: ({ context }) => {
						if (!context.operation) throw new Error('Missing creation binding')
						return { binding: context.operation, request: context.request }
					},
					onDone: [
						{
							guard: ({ event }) =>
								event.output === undefined || event.output.settlement === 'unresolved',
							target: 'unresolved',
							actions: assign(({ context, event }) => completed(event.output, context))
						},
						{
							guard: 'closing',
							target: 'closed',
							actions: assign(({ context, event }) => completed(event.output, context))
						},
						{ guard: 'replacing', target: 'checking' },
						{
							target: 'classifying',
							actions: assign(({ context, event }) => completed(event.output, context))
						}
					],
					onError: {
						target: 'unresolved',
						actions: assign({
							result: ({ context, event }): Result => ({
								outcome: 'unresolved',
								settlement: 'unresolved',
								record: context.record,
								error: event.error
							})
						})
					}
				}
			},
			classifying: {
				always: [
					{ guard: ({ context }) => context.result?.outcome === 'complete', target: 'complete' },
					{ guard: ({ context }) => context.result?.outcome === 'editing', target: 'editing' },
					{ guard: ({ context }) => context.result?.outcome === 'invalid', target: 'invalid' },
					{
						guard: ({ context }) =>
							context.result?.outcome === 'recovered' ||
							(context.result?.outcome === 'cancelled' && context.record !== undefined),
						target: 'recovered'
					},
					{
						guard: ({ context }) =>
							context.result?.outcome === 'cancelled' && context.request.mode === 'load',
						target: 'checking'
					},
					{ guard: ({ context }) => context.result?.outcome === 'cancelled', target: 'editing' },
					{ guard: ({ context }) => context.result?.outcome === 'conflict', target: 'conflict' },
					{
						guard: ({ context }) => context.result?.outcome === 'unresolved',
						target: 'unresolved'
					},
					{ target: 'failed' }
				]
			},
			complete: {
				on: {
					NEW: {
						target: 'operating',
						actions: assign({
							request: ({ context }): CreationRequest => {
								if (!context.record) throw new Error('Missing completed attempt')
								return { mode: 'clear', record: context.record }
							}
						})
					}
				}
			},
			recovered: {},
			conflict: { on: { RETRY: 'checking' } },
			failed: {},
			unresolved: {
				on: {
					REEVALUATE: {},
					SHUTDOWN: {},
					RETRY: {
						guard: ({ context }) =>
							context.binding !== undefined && context.binding.key === context.operation?.key,
						target: 'operating',
						actions: assign({
							request: ({ context }): CreationRequest => {
								return context.record
									? { mode: 'retry', record: context.record, settlement: 'unresolved' }
									: { mode: 'load' }
							}
						})
					}
				}
			},
			closed: { type: 'final', on: { OBSERVED: {}, REEVALUATE: {}, RETRY: {}, SHUTDOWN: {} } }
		}
	})
}
