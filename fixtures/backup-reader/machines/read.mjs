import { assign, sendTo, setup } from 'xstate'
import { streamRead } from '../stream-native.mjs'

/** @typedef {import('../stream-native.mjs').ReadInput} ReadInput */
/** @typedef {import('../stream-native.mjs').StreamEvent} ReadEvent */
/** @typedef {import('../stream-native.mjs').ReadFailure} ReadFailure */
/** @typedef {{outcome: 'read'; bytes: Uint8Array} | {outcome: 'failed'; code: ReadFailure}} ReadResult */
/** @typedef {ReadInput & {total: number; failure: ReadFailure | undefined}} ReadContext */
/** @type {import('xstate').SetupTypes<ReadContext, ReadEvent, {}, string, ReadInput, ReadResult, import('xstate').EventObject, {}>} */
const types = {}

/** One bounded transform; it does not choose stream lifecycle or settlement.
 * @param {ReadContext} context
 * @returns {ReadFailure | undefined}
 */
function assemble(context) {
	try {
		const bytes = new Uint8Array(context.total)
		let offset = 0
		for (const chunk of context.storage.chunks) {
			bytes.set(chunk, offset)
			offset += chunk.length
		}
		context.storage.bytes = bytes
		return undefined
	} catch {
		return 'fileReadFailed'
	}
}

/** Fixture-owned finite root. File EOF and descriptor close are distinct observations. */
export const boundedReadMachine = setup({
	types,
	actors: { stream: streamRead },
	actions: {
		append: assign({
			total: ({ context, event }) => {
				if (event.type !== 'DATA') throw new Error('Expected stream chunk')
				context.storage.chunks.push(event.chunk)
				return context.total + event.chunk.length
			}
		}),
		discard: ({ event }) => {
			if (event.type === 'DATA') event.chunk.fill(0)
		},
		readFailed: assign({ failure: ({ context }) => context.failure ?? 'fileReadFailed' }),
		assemble: assign({ failure: ({ context }) => assemble(context) })
	}
}).createMachine({
	id: 'bounded-reader',
	context: ({ input }) => ({ ...input, total: 0, failure: undefined }),
	initial: 'active',
	output: ({ context }) =>
		context.failure === undefined && context.storage.bytes !== undefined
			? { outcome: 'read', bytes: context.storage.bytes }
			: { outcome: 'failed', code: context.failure ?? 'fileReadFailed' },
	states: {
		active: {
			initial: 'reading',
			invoke: {
				id: 'stream',
				src: 'stream',
				input: ({ context }) => context,
				onError: { target: '#bounded-reader.failed', actions: 'readFailed' }
			},
			on: {
				DATA: { actions: 'discard' },
				ABORT: { target: '.destroying', actions: 'readFailed' },
				STREAM_ERROR: [
					{
						guard: ({ context }) => context.waitForClose,
						target: '.awaitingFailureClose',
						actions: 'readFailed'
					},
					{ target: '#bounded-reader.failed', actions: 'readFailed' }
				],
				NATIVE_FAILED: { target: '#bounded-reader.failed', actions: 'readFailed' },
				CLOSED: { target: '#bounded-reader.failed', actions: 'readFailed' }
			},
			states: {
				reading: {
					on: {
						DATA: [
							{
								guard: ({ context, event }) =>
									context.total + event.chunk.length <= context.maximum,
								actions: 'append'
							},
							{ target: 'destroying', actions: ['discard', assign({ failure: 'limitExceeded' })] }
						],
						EOF: [
							{ guard: ({ context }) => context.waitForClose, target: 'awaitingSuccessClose' },
							{ target: 'assembling' }
						]
					}
				},
				awaitingSuccessClose: { on: { CLOSED: 'assembling' } },
				destroying: {
					entry: sendTo('stream', ({ context }) => ({
						type: 'DESTROY',
						code: context.failure ?? 'fileReadFailed'
					})),
					on: { ABORT: {} }
				},
				awaitingFailureClose: { on: { ABORT: {} } },
				assembling: {
					entry: 'assemble',
					always: [
						{
							guard: ({ context }) => context.failure === undefined,
							target: '#bounded-reader.succeeded'
						},
						{ target: '#bounded-reader.failed' }
					]
				}
			}
		},
		succeeded: { type: 'final' },
		failed: { type: 'final' }
	}
})
