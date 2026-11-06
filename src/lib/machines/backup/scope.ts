import { assign, fromPromise, raise, setup } from 'xstate'
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

type Input = { request: JazzArchiveExportRequest }
type Result = { outcome: 'cleaned' | 'failed' }
type Context = Input & {
	failure: 'cleanupFailed' | undefined
	handoff: ArchiveHandoffObservation | 'notStarted'
	reply: ((observation: ArchiveHandoffObservation) => void) | undefined
}
type Event =
	| { type: 'RELEASE' | 'HANDOFF_SETTLED' }
	| { type: 'CLAIM'; reply(accepted: boolean): void }
	| { type: 'DISPATCH'; reply(observation: ArchiveHandoffObservation): void; refuse(): void }
const actors = {
	dispatch: fromPromise<ArchiveHandoffObservation, Input>(({ input }) =>
		dispatchJazzExport(input.request)
	),
	drain: fromPromise<void, Input>(({ input }) => drainJazzExport(input.request)),
	rollback: fromPromise<boolean, Input>(({ input }) => rollbackJazzExport(input.request)),
	clear: fromPromise<void, Input>(({ input }) =>
		Promise.resolve().then(() => clearJazzExport(input.request))
	)
}

/** Request-scoped resource owner; its lifetime survives the export actor. */
export const jazzArchiveScopeMachine = setup<
	Context,
	Event,
	typeof actors,
	{},
	{ report: undefined; recordHandoff: undefined; rememberReply: undefined },
	{},
	never,
	string,
	Input,
	Result
>({
	actors,
	actions: {
		rememberReply: assign(({ event }) => ({
			reply: event.type === 'DISPATCH' ? event.reply : undefined
		})),
		recordHandoff: assign({
			handoff: ({ event }) => {
				const observed: unknown = 'output' in event ? event.output : undefined
				return observed === 'dispatched' || observed === 'rejected' ? observed : 'unknown'
			}
		}),
		report: ({ context }) => {
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
		CLAIM: { actions: ({ event }) => event.reply(false) },
		DISPATCH: { actions: ({ event }) => event.refuse() },
		RELEASE: { target: '.draining', actions: ({ context }) => abortJazzExport(context.request) }
	},
	states: {
		available: { on: { CLAIM: { target: 'claimed', actions: ({ event }) => event.reply(true) } } },
		claimed: {
			on: {
				DISPATCH: { target: 'handingOff', actions: 'rememberReply' }
			}
		},
		handingOff: {
			initial: 'dispatching',
			invoke: {
				src: 'dispatch',
				input: ({ context }) => context,
				onDone: {
					actions: [
						'recordHandoff',
						'report',
						assign({ reply: undefined }),
						raise({ type: 'HANDOFF_SETTLED' })
					]
				},
				onError: {
					actions: [
						assign({ handoff: 'unknown' }),
						'report',
						assign({ reply: undefined }),
						raise({ type: 'HANDOFF_SETTLED' })
					]
				}
			},
			states: {
				dispatching: {
					on: {
						HANDOFF_SETTLED: '#jazz-archive-scope.handoffSettled',
						RELEASE: {
							target: 'releasing',
							actions: ({ context }) => abortJazzExport(context.request)
						}
					}
				},
				releasing: {
					on: {
						RELEASE: {},
						HANDOFF_SETTLED: '#jazz-archive-scope.draining'
					}
				}
			}
		},
		handoffSettled: {},
		draining: {
			on: { RELEASE: {} },
			invoke: {
				src: 'drain',
				input: ({ context }) => context,
				onDone: [
					{
						guard: ({ context }) => hasJazzExportTransaction(context.request),
						target: 'rollingBack'
					},
					{ target: 'clearing' }
				],
				onError: { target: 'clearing', actions: assign({ failure: 'cleanupFailed' }) }
			}
		},
		rollingBack: {
			on: { RELEASE: {} },
			invoke: {
				src: 'rollback',
				input: ({ context }) => context,
				onDone: [
					{
						guard: ({ event }) => event.output,
						target: 'clearing',
						actions: ({ context }) => forgetJazzExportTransaction(context.request)
					},
					{ target: 'clearing', actions: assign({ failure: 'cleanupFailed' }) }
				],
				onError: { target: 'clearing', actions: assign({ failure: 'cleanupFailed' }) }
			}
		},
		clearing: {
			on: { RELEASE: {} },
			invoke: {
				src: 'clear',
				input: ({ context }) => context,
				onDone: [
					{ guard: ({ context }) => context.failure !== undefined, target: 'failed' },
					{ target: 'cleaned' }
				],
				onError: { target: 'failed', actions: assign({ failure: 'cleanupFailed' }) }
			}
		},
		cleaned: { type: 'final' },
		failed: { type: 'final' }
	}
})
