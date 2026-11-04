import { createReadStream } from 'node:fs'
import { ArchivePayloadError } from 'delightful-local-first/backup/archive'
import { createArchiveInspectionError } from 'delightful-local-first/backup/inspection'

/**
 * One bounded native read; file mode settles only after descriptor close.
 * @param {import('node:stream').Readable} stream
 * @param {number} maximum
 * @param {AbortSignal} signal
 * @param {boolean} waitForClose
 * @returns {Promise<Uint8Array>}
 */
function boundedRead(stream, maximum, signal, waitForClose) {
	return new Promise((resolve, reject) => {
		/** @type {Uint8Array[]} */
		const chunks = []
		let total = 0
		let ended = false
		let settled = false
		/** @type {Error | undefined} */
		let failure
		function finish() {
			if (settled) return
			settled = true
			signal.removeEventListener('abort', abort)
			stream.removeListener('data', data)
			stream.removeListener('end', end)
			stream.removeListener('error', error)
			stream.removeListener('close', close)
			stream.pause()
			try {
				if (failure || !ended) {
					reject(failure ?? createArchiveInspectionError('fileReadFailed'))
					return
				}
				const bytes = new Uint8Array(total)
				let offset = 0
				for (const chunk of chunks) {
					bytes.set(chunk, offset)
					offset += chunk.length
				}
				resolve(bytes)
			} catch {
				reject(createArchiveInspectionError('fileReadFailed'))
			} finally {
				for (const chunk of chunks) chunk.fill(0)
				chunks.length = 0
			}
		}
		function abort() {
			failure = createArchiveInspectionError('fileReadFailed')
			stream.destroy(failure)
		}
		/** @param {Uint8Array} chunk */
		function data(chunk) {
			if (failure) {
				chunk.fill(0)
				return
			}
			total += chunk.length
			if (total > maximum) {
				chunk.fill(0)
				failure = new ArchivePayloadError('limitExceeded')
				stream.destroy(failure)
				return
			}
			chunks.push(chunk)
		}
		function end() {
			ended = true
			if (!waitForClose) finish()
		}
		function error() {
			failure ??= createArchiveInspectionError('fileReadFailed')
			if (!waitForClose) finish()
		}
		function close() {
			finish()
		}
		stream.on('data', data)
		stream.once('end', end)
		stream.on('error', error)
		stream.once('close', close)
		signal.addEventListener('abort', abort, { once: true })
		if (signal.aborted) abort()
	})
}

/** @param {string} path @returns {import('delightful-local-first/backup/inspection').ArchiveInspectionSource} */
export function fileSource(path) {
	return {
		read: (signal, maximum) => {
			if (signal.aborted) return Promise.reject(createArchiveInspectionError('fileReadFailed'))
			// Inclusive end permits exactly one oversize detection byte; no unbounded readFile/stat race.
			return boundedRead(createReadStream(path, { start: 0, end: maximum }), maximum, signal, true)
		}
	}
}

/** @returns {import('delightful-local-first/backup/inspection').ArchivePasswordSource} */
export function stdinPassword() {
	return {
		read: (signal) =>
			boundedRead(process.stdin, 1024, signal, false).then((bytes) => {
				try {
					return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
				} catch {
					throw createArchiveInspectionError('passwordReadFailed')
				} finally {
					bytes.fill(0)
				}
			})
	}
}
