import { types, createAsyncLogic, setup } from 'xstate'

import type { EventPayload } from '../../contracts/machine-events.js'
import {
	abortJazzExport,
	drainJazzExport,
	hasJazzExportTransaction,
	rollbackJazzExport,
	forgetJazzExportTransaction,
	clearJazzExport,
	dispatchJazzExport,
	type ArchiveHandoffObservation,
	type JazzArchiveExportRequest
} from '../../backend/jazz/backup.js'
type Input = {
	request: JazzArchiveExportRequest
}
type Result = {
	outcome: 'cleaned' | 'failed'
}
type Context = Input & {
	failure: 'cleanupFailed' | undefined
	handoff: ArchiveHandoffObservation | 'notStarted'
	reply: ((observation: ArchiveHandoffObservation) => void) | undefined
}
type Event =
	| {
			type: 'RELEASE' | 'HANDOFF_SETTLED'
	  }
	| {
			type: 'CLAIM'
			reply(accepted: boolean): void
	  }
	| {
			type: 'DISPATCH'
			reply(observation: ArchiveHandoffObservation): void
			refuse(): void
	  }
const actors = {
	dispatch: createAsyncLogic<ArchiveHandoffObservation, Input>({
		run: ({ input }) => dispatchJazzExport(input.request)
	}),
	drain: createAsyncLogic<void, Input>({ run: ({ input }) => drainJazzExport(input.request) }),
	rollback: createAsyncLogic<boolean, Input>({
		run: ({ input }) => rollbackJazzExport(input.request)
	}),
	clear: createAsyncLogic<void, Input>({
		run: ({ input }) => Promise.resolve().then(() => clearJazzExport(input.request))
	})
}
/** Request-scoped resource owner; its lifetime survives the export actor. */
const patches = {
	rememberReply: ({ event }: { context: Context; event: Event }): Partial<Context> => ({
		reply: event.type === 'DISPATCH' ? event.reply : undefined
	}),
	recordHandoff: ({
		event
	}: {
		context: Context
		event: {
			type: string
			output?: unknown
		}
	}): Partial<Context> => ({
		handoff: event.output === 'dispatched' || event.output === 'rejected' ? event.output : 'unknown'
	})
}
export const jazzArchiveScopeMachine = setup({
	schemas: {
		context: types<Context>(),
		events: {
			RELEASE: types<EventPayload<Event, 'RELEASE'>>(),
			CLAIM: types<EventPayload<Event, 'CLAIM'>>(),
			DISPATCH: types<EventPayload<Event, 'DISPATCH'>>()
		},
		internalEvents: { HANDOFF_SETTLED: types<EventPayload<Event, 'HANDOFF_SETTLED'>>() },
		input: types<Input>(),
		output: types<Result>()
	},
	actors,
	actions: {
		report: ({ context }: { context: Context }) => {
			context.reply?.(context.handoff === 'notStarted' ? 'unknown' : context.handoff)
		}
	}
}).createMachine({
	id: 'jazz-archive-scope',
	initial: 'available',
	context: ({ input }) => ({
		...input,
		failure: undefined,
		handoff: 'notStarted',
		reply: undefined
	}),
	output: ({ context }) => ({ outcome: context.failure ? 'failed' : 'cleaned' }),
	on: {
		CLAIM: (args, enq) => {
			enq(() => args.event.reply(false))
		},
		DISPATCH: (args, enq) => {
			enq(() => args.event.refuse())
		},
		RELEASE: (args, enq) => {
			enq(() => abortJazzExport(args.context.request))
			return { target: '.draining' }
		}
	},
	states: {
		available: {
			on: {
				CLAIM: (args, enq) => {
					enq(() => args.event.reply(true))
					return { target: 'claimed' }
				}
			}
		},
		claimed: {
			on: {
				DISPATCH: (args) => {
					return {
						target: 'handingOff',
						context: patches.rememberReply(args) satisfies Partial<Context>
					}
				}
			}
		},
		handingOff: {
			initial: 'dispatching',
			invoke: {
				src: actors.dispatch,
				input: ({ context }) => context,
				onDone: (args, enq) => {
					let context = args.context
					let patch = {}
					patch = { ...patch, ...patches.recordHandoff(args) }
					context = { ...args.context, ...patch }
					enq(args.actions.report, { ...args, context })
					patch = { ...patch, reply: undefined }
					context = { ...args.context, ...patch }
					enq.raise({ type: 'HANDOFF_SETTLED' })
					return { context: patch satisfies Partial<Context> }
				},
				onError: (args, enq) => {
					let context = args.context
					let patch = {}
					patch = { ...patch, handoff: 'unknown' }
					context = { ...args.context, ...patch }
					enq(args.actions.report, { ...args, context })
					patch = { ...patch, reply: undefined }
					context = { ...args.context, ...patch }
					enq.raise({ type: 'HANDOFF_SETTLED' })
					return { context: patch satisfies Partial<Context> }
				}
			},
			states: {
				dispatching: {
					on: {
						HANDOFF_SETTLED: { target: '#jazz-archive-scope.handoffSettled' },
						RELEASE: (args, enq) => {
							enq(() => abortJazzExport(args.context.request))
							return { target: 'releasing' }
						}
					}
				},
				releasing: {
					on: {
						RELEASE: {},
						HANDOFF_SETTLED: { target: '#jazz-archive-scope.draining' }
					}
				}
			}
		},
		handoffSettled: {},
		draining: {
			on: { RELEASE: {} },
			invoke: {
				src: actors.drain,
				input: ({ context }) => context,
				onDone: (args) => {
					if (hasJazzExportTransaction(args.context.request)) {
						return { target: 'rollingBack' }
					}
					return { target: 'clearing' }
				},
				onError: (_args) => {
					return {
						target: 'clearing',
						context: { failure: 'cleanupFailed' } satisfies Partial<Context>
					}
				}
			}
		},
		rollingBack: {
			on: { RELEASE: {} },
			invoke: {
				src: actors.rollback,
				input: ({ context }) => context,
				onDone: (args, enq) => {
					if (args.event.output) {
						enq(() => forgetJazzExportTransaction(args.context.request))
						return { target: 'clearing' }
					}
					return {
						target: 'clearing',
						context: { failure: 'cleanupFailed' } satisfies Partial<Context>
					}
				},
				onError: (_args) => {
					return {
						target: 'clearing',
						context: { failure: 'cleanupFailed' } satisfies Partial<Context>
					}
				}
			}
		},
		clearing: {
			on: { RELEASE: {} },
			invoke: {
				src: actors.clear,
				input: ({ context }) => context,
				onDone: (args) => {
					if (args.context.failure !== undefined) {
						return { target: 'failed' }
					}
					return { target: 'cleaned' }
				},
				onError: (_args) => {
					return {
						target: 'failed',
						context: { failure: 'cleanupFailed' } satisfies Partial<Context>
					}
				}
			}
		},
		cleaned: { type: 'final' },
		failed: { type: 'final' }
	}
})
