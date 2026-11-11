import { createActor, toPromise } from 'xstate'
import { boundedReadMachine } from './machines/read.mjs'
import { createReadStream } from 'node:fs'
import { createArchivePayloadError } from 'delightful-local-first/backup/archive'
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
	// The independent CLI adapter owns this finite root; its native observer is invoked by the chart.
	const actor = createActor(boundedReadMachine, {
		input: { stream, maximum, signal, waitForClose, storage: { chunks: [], bytes: undefined } }
	})
	actor.start()
	return toPromise(actor).then((result) => {
		if (result.outcome === 'read') return result.bytes
		throw result.code === 'limitExceeded'
			? createArchivePayloadError('limitExceeded')
			: createArchiveInspectionError('fileReadFailed')
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
