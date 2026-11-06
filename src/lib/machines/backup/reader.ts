import { assign, fromPromise, setup, type ActorLogic, type Snapshot } from 'xstate'
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
	ActorLogic<ReaderSnapshot, { type: 'CANCEL' | 'SHUTDOWN' }, JazzArchiveReaderInput>
type Input = { request: JazzArchiveExportRequest; mode: JazzArchiveReaderInput['mode'] }
type Context = Input & {
	readerInput: JazzArchiveReaderInput | undefined
	result: JazzArchiveReaderResult | undefined
}

/** Owns capability admission, the consumer's finite read and capability revocation. */
export function createJazzArchiveReaderMachine<
	ReaderSnapshot extends Snapshot<JazzArchiveReaderResult>
>(reader: JazzArchiveReader<ReaderSnapshot>) {
	const actors = {
		check: fromPromise<void, Input>(({ input }) =>
			Promise.resolve().then(() => assertJazzExportCurrent(input.request))
		),
		prepare: fromPromise<JazzArchiveReaderInput, Input>(({ input }) =>
			Promise.resolve().then(() => prepareJazzReaderInput(input.request, input.mode))
		),
		reader
	}
	const model = setup<
		Context,
		{ type: 'CANCEL' | 'SHUTDOWN' },
		typeof actors,
		{},
		{ fail: undefined },
		{},
		never,
		string,
		Input,
		JazzArchiveReaderResult
	>({
		actors,
		actions: {
			fail: assign({
				result: ({ event }): JazzArchiveReaderResult => ({
					outcome: 'failed',
					code: jazzExportFailure('error' in event ? event.error : undefined)
				})
			})
		}
	})
	const failed = { target: 'revoking', actions: 'fail' } satisfies {
		target: string
		actions: 'fail'
	}
	const reading = model.createStateConfig({
		invoke: {
			src: 'reader',
			input: ({ context }) => {
				if (!context.readerInput) throw new Error('Missing reader capabilities')
				return context.readerInput
			},
			onDone: {
				target: 'revoking',
				actions: assign({
					result: ({ event }) => event.output ?? { outcome: 'failed', code: 'failed' }
				})
			},
			onError: failed
		}
	})
	return model.createMachine({
		initial: 'checkingBinding',
		context: ({ input }) => ({ ...input, readerInput: undefined, result: undefined }),
		output: ({ context }) => context.result ?? { outcome: 'failed', code: 'failed' },
		on: {
			CANCEL: { target: '.revoking', actions: assign({ result: { outcome: 'cancelled' } }) },
			SHUTDOWN: { target: '.revoking', actions: assign({ result: { outcome: 'cancelled' } }) }
		},
		states: {
			checkingBinding: {
				invoke: {
					src: 'check',
					input: ({ context }) => context,
					onDone: 'preparing',
					onError: failed
				}
			},
			preparing: {
				invoke: {
					src: 'prepare',
					input: ({ context }) => context,
					onDone: {
						target: 'reading',
						actions: [
							assign({ readerInput: ({ event }) => event.output }),
							({ context, event }) => activateJazzReader(context.request, event.output)
						]
					},
					onError: failed
				}
			},
			reading,
			revoking: {
				entry: ({ context }) => endJazzReader(context.request),
				always: 'complete'
			},
			complete: { type: 'final' }
		}
	})
}
