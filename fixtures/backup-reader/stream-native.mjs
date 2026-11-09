import { createCallbackLogic } from 'xstate'
import { createArchivePayloadError } from 'delightful-local-first/backup/archive'
import { createArchiveInspectionError } from 'delightful-local-first/backup/inspection'

/** @typedef {'fileReadFailed' | 'limitExceeded'} ReadFailure */
/** @typedef {{ type: 'DESTROY'; code: ReadFailure }} StreamCommand */
/** @typedef {{type: 'DATA'; chunk: Uint8Array} | {type: 'EOF' | 'CLOSED' | 'ABORT' | 'STREAM_ERROR' | 'NATIVE_FAILED'}} StreamEvent */
/** @typedef {{chunks: Uint8Array[]; bytes: Uint8Array | undefined}} ReadStorage */
/** @typedef {{stream: import('node:stream').Readable; maximum: number; signal: AbortSignal; waitForClose: boolean; storage: ReadStorage}} ReadInput */

/** @param {ReadStorage} storage */
export function clearChunks(storage) {
	for (const chunk of storage.chunks) chunk.fill(0)
	storage.chunks.length = 0
}
/** One destroy command; callbacks report facts, never choose read/close/limit policy.
 * @type {import('xstate').CallbackLogicFunction<StreamCommand, StreamEvent, ReadInput>}
 */
const observeStream = ({ input, sendBack, receive }) => {
	const { stream, signal, storage } = input
	/** @type {((event: StreamEvent) => void) | undefined} */
	let report = sendBack
	/** @param {Uint8Array} chunk */
	const data = (chunk) => {
		if (report) report({ type: 'DATA', chunk })
		else chunk.fill(0)
	}
	const end = () => report?.({ type: 'EOF' })
	const error = () => report?.({ type: 'STREAM_ERROR' })
	const close = () => report?.({ type: 'CLOSED' })
	const abort = () => report?.({ type: 'ABORT' })
	receive((command) => {
		try {
			stream.destroy(
				command.code === 'limitExceeded'
					? createArchivePayloadError('limitExceeded')
					: createArchiveInspectionError('fileReadFailed')
			)
		} catch {
			report?.({ type: 'NATIVE_FAILED' })
		}
	})
	stream.on('end', end)
	stream.on('error', error)
	stream.on('close', close)
	signal.addEventListener('abort', abort, { once: true })
	if (signal.aborted) abort()
	stream.on('data', data)
	return () => {
		report = undefined
		signal.removeEventListener('abort', abort)
		stream.removeListener('data', data)
		stream.removeListener('end', end)
		stream.removeListener('error', error)
		stream.removeListener('close', close)
		stream.pause()
		clearChunks(storage)
		// File scopes own their descriptor even on abrupt stop. Stdin remains host-owned.
		if (input.waitForClose) stream.destroy()
	}
}
export const streamRead = createCallbackLogic(observeStream)
