import { matchesState, type StateValue, types, createAsyncLogic, setup } from 'xstate'
import { createFinalTransitions } from '../finalize.js'

import type { EventPayload } from '../../contracts/machine-events.js'
import type {
	WorkspaceNamingCapability,
	WorkspaceNamingEvent,
	WorkspaceNamingOutcome,
	WorkspaceNamingRequest,
	WorkspaceNamingResult
} from '../../contracts/workspace-naming.js'
/** One fixed-scope operation. Hosts drain it before releasing an issued update. */
export function createWorkspaceNamingOperation<Scope, Settings, Reason, Write>(
	capability: WorkspaceNamingCapability<Scope, Settings, Reason, Write>
) {
	type Request = WorkspaceNamingRequest<Scope, Settings>
	type Outcome = WorkspaceNamingOutcome<Reason>
	type Context = {
		request: Request
		write:
			| {
					value: Write
			  }
			| undefined
		result: Outcome | undefined
	}
	const actors = {
		assess: createAsyncLogic({
			run: async ({ input }: { input: Request }) => capability.assess(input)
		}),
		issue: createAsyncLogic({
			run: async ({ input }: { input: Request }) => capability.issue(input)
		}),
		persist: createAsyncLogic({
			run: async ({
				input
			}: {
				input: {
					value: Write
				}
			}) => capability.persistLocal(input.value)
		})
	}
	const model = setup({
		schemas: {
			context: types<Context>(),
			events: {
				CANCEL: types<EventPayload<WorkspaceNamingEvent, 'CANCEL'>>(),
				SHUTDOWN: types<EventPayload<WorkspaceNamingEvent, 'SHUTDOWN'>>(),
				INVALIDATE: types<EventPayload<WorkspaceNamingEvent, 'INVALIDATE'>>()
			},
			input: types<{
				request: Request
			}>(),
			output: types<WorkspaceNamingResult<Scope, Settings, Reason>>()
		},
		actors,
		guards: {
			closing: ({ value }: { value: StateValue }) =>
				matchesState({ writing: { control: 'closing' } }, value),
			invalidated: ({ value }: { value: StateValue }) =>
				matchesState({ writing: { control: 'invalidated' } }, value),
			cancelling: ({ value }: { value: StateValue }) =>
				matchesState({ writing: { control: 'cancelling' } }, value)
		}
	})

	type CompletionEntry = Extract<
		NonNullable<Parameters<typeof model.createStateConfig>[0]['entry']>,
		(...args: never[]) => unknown
	>
	type CompletionArgs = Pick<Parameters<CompletionEntry>[0], 'context' | 'actions'>
	type CompletionQueue = Parameters<CompletionEntry>[1]
	const finalizers = {
		finished: (_args, _enq) => {
			return { context: { write: undefined } satisfies Partial<Context> }
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

	const interruptionFinalizers = {
		cancelled: (args, _enq) => ({
			context: {
				result: {
					outcome: 'cancelled',
					settlement: args.context.result?.settlement ?? { kind: 'notStarted' }
				},
				write: undefined
			} satisfies Partial<Context>
		}),
		invalidated: (args, _enq) => ({
			context: {
				result: {
					outcome: 'invalidated',
					settlement: args.context.result?.settlement ?? { kind: 'notStarted' }
				},
				write: undefined
			} satisfies Partial<Context>
		}),
		closed: (args, _enq) => ({
			context: {
				result: {
					outcome: 'closed',
					settlement: args.context.result?.settlement ?? { kind: 'notStarted' }
				},
				write: undefined
			} satisfies Partial<Context>
		})
	} satisfies Record<
		string,
		(args: CompletionArgs, enq: CompletionQueue) => void | { context?: Partial<Context> }
	>
	const completeInterruption = createFinalTransitions<
		Context,
		CompletionArgs,
		CompletionQueue,
		keyof typeof interruptionFinalizers
	>(interruptionFinalizers)

	return model.createMachine({
		id: 'workspace-naming',
		initial: 'validating',
		context: ({ input }) => ({
			request: { ...input.request, name: input.request.name.trim() },
			write: undefined,
			result: undefined
		}),
		output: ({ context }) => {
			if (!context.result) throw new Error('Missing naming outcome')
			return { ...context.result, request: context.request }
		},
		states: {
			validating: {
				always: (args, enq) => {
					if (args.context.request.name.length === 0) {
						{
							return complete('finished', args, enq, {
								target: 'finished',
								context: {
									result: { outcome: 'invalid', settlement: { kind: 'notStarted' } }
								} satisfies Partial<Context>
							})
						}
					}
					return { target: 'assessing' }
				}
			},
			assessing: {
				on: {
					CANCEL: (args, enq) => {
						return completeInterruption('cancelled', args, enq, { target: 'cancelled' })
					},
					INVALIDATE: (args, enq) => {
						return completeInterruption('invalidated', args, enq, { target: 'invalidated' })
					},
					SHUTDOWN: (args, enq) => {
						return completeInterruption('closed', args, enq, { target: 'closed' })
					}
				},
				invoke: {
					src: actors.assess,
					input: ({ context }) => context.request,
					onDone: (args, enq) => {
						const { event } = args
						if (event.output.kind === 'blocked') {
							{
								return complete('finished', args, enq, {
									target: 'finished',
									context: {
										result: (({ event }): Outcome => {
											if (event.output.kind !== 'blocked')
												throw new Error('Missing naming restriction')
											return {
												outcome: 'blocked',
												reason: event.output.reason,
												settlement: { kind: 'notStarted' }
											}
										})(args)
									} satisfies Partial<Context>
								})
							}
						}
						return { target: 'writing' }
					},
					onError: (args, enq) => {
						{
							return complete('finished', args, enq, {
								target: 'finished',
								context: {
									result: {
										outcome: 'failed',
										error: args.event.error,
										settlement: { kind: 'notStarted' }
									}
								} satisfies Partial<Context>
							})
						}
					}
				}
			},
			writing: {
				type: 'parallel',
				states: {
					control: {
						initial: 'active',
						states: {
							active: {
								on: {
									CANCEL: { target: 'cancelling' },
									INVALIDATE: { target: 'invalidated' },
									SHUTDOWN: { target: 'closing' }
								}
							},
							cancelling: {
								on: { INVALIDATE: { target: 'invalidated' }, SHUTDOWN: { target: 'closing' } }
							},
							invalidated: { on: { SHUTDOWN: { target: 'closing' } } },
							closing: {}
						}
					},
					work: {
						initial: 'issuing',
						states: {
							issuing: {
								invoke: {
									src: actors.issue,
									input: ({ context }) => context.request,
									onDone: (args) => {
										return {
											target: 'persisting',
											context: {
												write: { value: args.event.output.write }
											} satisfies Partial<Context>
										}
									},
									onError: (args) => {
										const { event } = args
										return {
											target: 'resolving',
											context: {
												result: {
													outcome: 'failed',
													error: event.error,
													settlement: { kind: 'unknown', error: event.error }
												}
											} satisfies Partial<Context>
										}
									}
								}
							},
							persisting: {
								invoke: {
									src: actors.persist,
									input: ({ context }) => {
										if (!context.write) throw new Error('Missing issued naming update')
										return context.write
									},
									onDone: (_args) => {
										return {
											target: 'resolving',
											context: {
												result: { outcome: 'succeeded', settlement: { kind: 'locallyPersisted' } }
											} satisfies Partial<Context>
										}
									},
									onError: (args) => {
										const { event } = args
										return {
											target: 'resolving',
											context: {
												result: {
													outcome: 'failed',
													error: event.error,
													settlement: { kind: 'unknown', error: event.error }
												}
											} satisfies Partial<Context>
										}
									}
								}
							},
							resolving: {
								always: (args, enq) => {
									if (matchesState({ writing: { control: 'closing' } }, args.value)) {
										{
											return completeInterruption('closed', args, enq, {
												target: '#workspace-naming.closed'
											})
										}
									}
									if (matchesState({ writing: { control: 'invalidated' } }, args.value)) {
										{
											return completeInterruption('invalidated', args, enq, {
												target: '#workspace-naming.invalidated'
											})
										}
									}
									if (matchesState({ writing: { control: 'cancelling' } }, args.value)) {
										{
											return completeInterruption('cancelled', args, enq, {
												target: '#workspace-naming.cancelled'
											})
										}
									}
									{
										return complete('finished', args, enq, { target: '#workspace-naming.finished' })
									}
								}
							}
						}
					}
				}
			},
			finished: {
				type: 'final'
			},
			cancelled: { type: 'final' },
			invalidated: { type: 'final' },
			closed: { type: 'final' }
		}
	})
}
