import { assign, fromPromise, setup } from 'xstate'
import {
	abortJazzExport,
	drainJazzExport,
	hasJazzExportTransaction,
	rollbackJazzExport,
	forgetJazzExportTransaction,
	clearJazzExport,
	type JazzArchiveExportRequest
} from '../../backend/jazz/backup.js'

type Input = { request: JazzArchiveExportRequest }
type Result = { outcome: 'cleaned' | 'failed' }
type Context = Input & { failure: 'cleanupFailed' | undefined }
const actors = {
	drain: fromPromise<void, Input>(({ input }) => drainJazzExport(input.request)),
	rollback: fromPromise<boolean, Input>(({ input }) => rollbackJazzExport(input.request)),
	clear: fromPromise<void, Input>(({ input }) =>
		Promise.resolve().then(() => clearJazzExport(input.request))
	)
}

/** Request-scoped resource owner; its lifetime survives the export actor. */
export const jazzArchiveReleaseMachine = setup<
	Context,
	{ type: 'RELEASE' },
	typeof actors,
	{},
	{},
	{},
	never,
	string,
	Input,
	Result
>({ actors }).createMachine({
	initial: 'waiting',
	context: ({ input }) => ({ ...input, failure: undefined }),
	output: ({ context }) => ({ outcome: context.failure ? 'failed' : 'cleaned' }),
	states: {
		waiting: {
			on: {
				RELEASE: { target: 'draining', actions: ({ context }) => abortJazzExport(context.request) }
			}
		},
		draining: {
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
