import { types, createAsyncLogic, setup, type ActorLogic, type Snapshot } from 'xstate'

import type { EventPayload } from '../../contracts/machine-events.js'
import {
	assertJazzExportCurrent,
	prepareJazzReaderInput,
	activateJazzReader,
	endJazzReader,
	jazzExportFailure,
	type JazzArchiveExportRequest,
	type JazzArchiveReaderInput,
	type JazzArchiveReaderResult
} from '../../backend/jazz/backup.js'
export type JazzArchiveReader<ReaderSnapshot extends Snapshot<JazzArchiveReaderResult>> =
	ActorLogic<
		ReaderSnapshot,
		{
			type: 'CANCEL' | 'SHUTDOWN'
		},
		JazzArchiveReaderInput
	>
type Input = {
	request: JazzArchiveExportRequest
	mode: JazzArchiveReaderInput['mode']
}
type Context = Input & {
	readerInput: JazzArchiveReaderInput | undefined
	result: JazzArchiveReaderResult | undefined
}
/** Owns capability admission, the consumer's finite read and capability revocation. */
export function createJazzArchiveReaderMachine<
	ReaderSnapshot extends Snapshot<JazzArchiveReaderResult>
>(reader: JazzArchiveReader<ReaderSnapshot>) {
	const actors = {
		check: createAsyncLogic<void, Input>({
			run: ({ input }) => Promise.resolve().then(() => assertJazzExportCurrent(input.request))
		}),
		prepare: createAsyncLogic<JazzArchiveReaderInput, Input>({
			run: ({ input }) =>
				Promise.resolve().then(() => prepareJazzReaderInput(input.request, input.mode))
		}),
		reader
	}
	const patches = {
		fail: ({
			event
		}: {
			context: Context
			event:
				| {
						type: 'CANCEL' | 'SHUTDOWN'
				  }
				| {
						type: 'xstate.error.actor'
						error: unknown
				  }
		}): Partial<Context> => ({
			result: {
				outcome: 'failed',
				code: jazzExportFailure('error' in event ? event.error : undefined)
			}
		})
	}
	const model = setup({
		schemas: {
			context: types<Context>(),
			events: {
				CANCEL: types<
					EventPayload<
						{
							type: 'CANCEL' | 'SHUTDOWN'
						},
						'CANCEL'
					>
				>(),
				SHUTDOWN: types<
					EventPayload<
						{
							type: 'CANCEL' | 'SHUTDOWN'
						},
						'SHUTDOWN'
					>
				>()
			},
			input: types<Input>(),
			output: types<JazzArchiveReaderResult>()
		},
		actors,
		actions: {}
	})
	const reading = model.createStateConfig({
		invoke: model.createInvoke<typeof actors.reader, Context>({
			src: actors.reader,
			input: ({ context }) => {
				if (!context.readerInput) throw new Error('Missing reader capabilities')
				return context.readerInput
			},
			onDone: (args) => {
				return {
					target: 'revoking',
					context: {
						result: args.event.output ?? { outcome: 'failed', code: 'failed' }
					} satisfies Partial<Context>
				}
			},
			onError: (args) => {
				return {
					target: 'revoking',
					context: ((args) => patches.fail(args))(args) satisfies Partial<Context>
				}
			}
		})
	})
	return model.createMachine({
		initial: 'checkingBinding',
		context: ({ input }) => ({ ...input, readerInput: undefined, result: undefined }),
		output: ({ context }) => context.result ?? { outcome: 'failed', code: 'failed' },
		on: {
			CANCEL: (_args) => {
				return {
					target: '.revoking',
					context: { result: { outcome: 'cancelled' } } satisfies Partial<Context>
				}
			},
			SHUTDOWN: (_args) => {
				return {
					target: '.revoking',
					context: { result: { outcome: 'cancelled' } } satisfies Partial<Context>
				}
			}
		},
		states: {
			checkingBinding: {
				invoke: model.createInvoke<typeof actors.check, Context>({
					src: actors.check,
					input: ({ context }) => context,
					onDone: { target: 'preparing' },
					onError: (args) => {
						return {
							target: 'revoking',
							context: ((args) => patches.fail(args))(args) satisfies Partial<Context>
						}
					}
				})
			},
			preparing: {
				invoke: model.createInvoke<typeof actors.prepare, Context>({
					src: actors.prepare,
					input: ({ context }) => context,
					onDone: (args, enq) => {
						const { event } = args
						let context = args.context
						let patch = {}
						patch = { ...patch, readerInput: event.output }
						context = { ...args.context, ...patch }
						enq(() => activateJazzReader(context.request, event.output))
						return { target: 'reading', context: patch satisfies Partial<Context> }
					},
					onError: (args) => {
						return {
							target: 'revoking',
							context: ((args) => patches.fail(args))(args) satisfies Partial<Context>
						}
					}
				})
			},
			reading,
			revoking: {
				entry: ({ context }) => endJazzReader(context.request),
				always: { target: 'complete' }
			},
			complete: { type: 'final' }
		}
	})
}
