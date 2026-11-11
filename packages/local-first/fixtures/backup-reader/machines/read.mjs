import { setup, types, createCallbackLogic } from 'xstate'
import { streamRead } from '../stream-native.mjs'

/** @typedef {import('../stream-native.mjs').ReadInput} ReadInput */
/** @typedef {import('../stream-native.mjs').ReadFailure} ReadFailure */
/** @typedef {{outcome: 'read'; bytes: Uint8Array} | {outcome: 'failed'; code: ReadFailure}} ReadResult */
/** @typedef {ReadInput & {total: number; failure: ReadFailure | undefined}} ReadContext */
/** @type {import('xstate').TypeSchema<ReadContext>} */
const contextSchema = types()
/** @type {import('xstate').TypeSchema<ReadInput>} */
const inputSchema = types()
/** @type {import('xstate').TypeSchema<ReadResult>} */
const outputSchema = types()
/** @type {import('xstate').TypeSchema<{chunk: Uint8Array}>} */
const dataSchema = types()
/** @type {import('xstate').TypeSchema<{failure: ReadFailure | undefined}>} */
const assembledSchema = types()
/** @type {import('xstate').TypeSchema<import('xstate').ActorRefFrom<typeof streamRead>>} */
const streamSchema = types()

/** One bounded native transform; the chart chooses lifecycle and settlement.
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
/** @type {import('xstate').CallbackLogicFunction<{type:string}, {type:'ASSEMBLED';failure:ReadFailure|undefined}, ReadContext>} */
const assembleNative = ({ input, sendBack }) => {
	sendBack({ type: 'ASSEMBLED', failure: assemble(input) })
}
const assembly = createCallbackLogic(assembleNative)

/** Fixture-owned finite root. EOF and descriptor close are distinct observations. */
export const boundedReadMachine = setup({
	schemas: {
		context: contextSchema,
		input: inputSchema,
		output: outputSchema,
		children: { stream: streamSchema },
		events: {
			DATA: dataSchema,
			EOF: types(),
			CLOSED: types(),
			ABORT: types(),
			STREAM_ERROR: types(),
			NATIVE_FAILED: types(),
			ASSEMBLED: assembledSchema
		}
	},
	actors: { stream: streamRead, assembly }
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
				onError: ({ context }) => ({
					target: '#bounded-reader.failed',
					context: { failure: context.failure ?? 'fileReadFailed' }
				})
			},
			on: {
				DATA: ({ event }, enq) => {
					enq(() => event.chunk.fill(0))
				},
				ABORT: ({ context }) => ({
					target: '.destroying',
					context: { failure: context.failure ?? 'fileReadFailed' }
				}),
				STREAM_ERROR: ({ context }) => ({
					target: context.waitForClose ? '.awaitingFailureClose' : '#bounded-reader.failed',
					context: { failure: context.failure ?? 'fileReadFailed' }
				}),
				NATIVE_FAILED: ({ context }) => ({
					target: '#bounded-reader.failed',
					context: { failure: context.failure ?? 'fileReadFailed' }
				}),
				CLOSED: ({ context }) => ({
					target: '#bounded-reader.failed',
					context: { failure: context.failure ?? 'fileReadFailed' }
				})
			},
			states: {
				reading: {
					on: {
						DATA: ({ context, event }, enq) => {
							if (context.total + event.chunk.length <= context.maximum) {
								enq(() => context.storage.chunks.push(event.chunk))
								return { context: { total: context.total + event.chunk.length } }
							}
							enq(() => event.chunk.fill(0))
							return { target: 'destroying', context: { failure: 'limitExceeded' } }
						},
						EOF: ({ context }) => ({
							target: context.waitForClose ? 'awaitingSuccessClose' : 'assembling'
						})
					}
				},
				awaitingSuccessClose: { on: { CLOSED: { target: 'assembling' } } },
				destroying: {
					entry: ({ context, children }, enq) => {
						enq.sendTo(children.stream, {
							type: 'DESTROY',
							code: context.failure ?? 'fileReadFailed'
						})
					},
					on: { ABORT: {} }
				},
				awaitingFailureClose: { on: { ABORT: {} } },
				assembling: {
					invoke: { src: 'assembly', input: ({ context }) => context },
					on: {
						ASSEMBLED: ({ event }) => ({
							target:
								event.failure === undefined
									? '#bounded-reader.succeeded'
									: '#bounded-reader.failed',
							context: { failure: event.failure }
						})
					}
				}
			}
		},
		succeeded: { type: 'final' },
		failed: { type: 'final' }
	}
})
