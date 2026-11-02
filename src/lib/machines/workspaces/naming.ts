import { assign, fromPromise, setup, stateIn } from 'xstate'
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
		write: { value: Write } | undefined
		result: Outcome | undefined
	}
	const actors = {
		assess: fromPromise(async ({ input }: { input: Request }) => capability.assess(input)),
		issue: fromPromise(async ({ input }: { input: Request }) => capability.issue(input)),
		persist: fromPromise(async ({ input }: { input: { value: Write } }) =>
			capability.persistLocal(input.value)
		)
	}
	const model = setup<
		Context,
		WorkspaceNamingEvent,
		typeof actors,
		{},
		{},
		{ closing: undefined; invalidated: undefined; cancelling: undefined },
		never,
		string,
		{ request: Request },
		WorkspaceNamingResult<Scope, Settings, Reason>
	>({
		actors,
		guards: {
			closing: stateIn({ writing: { control: 'closing' } }),
			invalidated: stateIn({ writing: { control: 'invalidated' } }),
			cancelling: stateIn({ writing: { control: 'cancelling' } })
		}
	})
	function interrupted(outcome: 'closed' | 'invalidated' | 'cancelled') {
		return model.createStateConfig({
			type: 'final',
			entry: assign({
				result: ({ context }): Outcome => ({
					outcome,
					settlement: context.result?.settlement ?? { kind: 'notStarted' }
				}),
				write: undefined
			})
		})
	}
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
				always: [
					{
						guard: ({ context }) => context.request.name.length === 0,
						target: 'finished',
						actions: assign({ result: { outcome: 'invalid', settlement: { kind: 'notStarted' } } })
					},
					{ target: 'assessing' }
				]
			},
			assessing: {
				on: { CANCEL: 'cancelled', INVALIDATE: 'invalidated', SHUTDOWN: 'closed' },
				invoke: {
					src: 'assess',
					input: ({ context }) => context.request,
					onDone: [
						{
							guard: ({ event }) => event.output.kind === 'blocked',
							target: 'finished',
							actions: assign({
								result: ({ event }): Outcome => {
									if (event.output.kind !== 'blocked') throw new Error('Missing naming restriction')
									return {
										outcome: 'blocked',
										reason: event.output.reason,
										settlement: { kind: 'notStarted' }
									}
								}
							})
						},
						{ target: 'writing' }
					],
					onError: {
						target: 'finished',
						actions: assign({
							result: ({ event }): Outcome => ({
								outcome: 'failed',
								error: event.error,
								settlement: { kind: 'notStarted' }
							})
						})
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
								on: { CANCEL: 'cancelling', INVALIDATE: 'invalidated', SHUTDOWN: 'closing' }
							},
							cancelling: { on: { INVALIDATE: 'invalidated', SHUTDOWN: 'closing' } },
							invalidated: { on: { SHUTDOWN: 'closing' } },
							closing: {}
						}
					},
					work: {
						initial: 'issuing',
						states: {
							issuing: {
								invoke: {
									src: 'issue',
									input: ({ context }) => context.request,
									onDone: {
										target: 'persisting',
										actions: assign({ write: ({ event }) => ({ value: event.output.write }) })
									},
									onError: {
										target: 'resolving',
										actions: assign({
											result: ({ event }): Outcome => ({
												outcome: 'failed',
												error: event.error,
												settlement: { kind: 'unknown', error: event.error }
											})
										})
									}
								}
							},
							persisting: {
								invoke: {
									src: 'persist',
									input: ({ context }) => {
										if (!context.write) throw new Error('Missing issued naming update')
										return context.write
									},
									onDone: {
										target: 'resolving',
										actions: assign({
											result: { outcome: 'succeeded', settlement: { kind: 'locallyPersisted' } }
										})
									},
									onError: {
										target: 'resolving',
										actions: assign({
											result: ({ event }): Outcome => ({
												outcome: 'failed',
												error: event.error,
												settlement: { kind: 'unknown', error: event.error }
											})
										})
									}
								}
							},
							resolving: {
								always: [
									{ guard: 'closing', target: '#workspace-naming.closed' },
									{ guard: 'invalidated', target: '#workspace-naming.invalidated' },
									{ guard: 'cancelling', target: '#workspace-naming.cancelled' },
									{ target: '#workspace-naming.finished' }
								]
							}
						}
					}
				}
			},
			finished: { type: 'final', entry: assign({ write: undefined }) },
			cancelled: interrupted('cancelled'),
			invalidated: interrupted('invalidated'),
			closed: interrupted('closed')
		}
	})
}
