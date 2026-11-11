import { createCallbackLogic } from 'xstate'
import { envelopeBytesLimit } from './envelope.js'
import {
	clearInspectionData,
	inspectionData,
	inspectionFailure,
	requireInspectionValue,
	type ArchiveInspectionRequest,
	type ArchiveInspectionResult
} from './inspection.js'

export type InspectionReadCommand = { type: 'READ_SOURCE' | 'READ_PASSWORD' | 'ABORT_READ' }
export type InspectionReadEvent =
	| { type: 'SOURCE_READY' | 'PASSWORD_READY' | 'RELEASE' }
	| { type: 'READ_FAILED'; failure: Extract<ArchiveInspectionResult, { outcome: 'failed' }> }

/** A single read per command. The chart owns parsing, password routing and graceful drain. */
export const inspectionReads = createCallbackLogic<
	InspectionReadCommand,
	{ request: ArchiveInspectionRequest }
>(({ input, receive, sendBack }) => {
	const data = inspectionData(input.request)
	const abort = new AbortController()
	let report: ((event: InspectionReadEvent) => void) | undefined = sendBack
	const release = () => report?.({ type: 'RELEASE' })
	data.releaseControl = release
	receive((command) => {
		if (command.type === 'ABORT_READ') {
			abort.abort()
			return
		}
		try {
			if (command.type === 'READ_SOURCE') {
				const source = requireInspectionValue(data.input).source
				void Promise.resolve()
					.then(() => source.read(abort.signal, envelopeBytesLimit))
					.then((bytes) => {
						if (report) {
							data.bytes = bytes
							report({ type: 'SOURCE_READY' })
						} else if (bytes instanceof Uint8Array) bytes.fill(0)
					})
					.catch((error) =>
						report?.({ type: 'READ_FAILED', failure: inspectionFailure(error, 'fileReadFailed') })
					)
			} else {
				const password = requireInspectionValue(requireInspectionValue(data.input).password)
				void Promise.resolve()
					.then(() => password.read(abort.signal))
					.then((value) => {
						if (report) {
							data.password = value
							report({ type: 'PASSWORD_READY' })
						}
					})
					.catch(() =>
						report?.({
							type: 'READ_FAILED',
							failure: { outcome: 'failed', code: 'passwordReadFailed' }
						})
					)
			}
		} catch (error) {
			report?.({
				type: 'READ_FAILED',
				failure:
					command.type === 'READ_PASSWORD'
						? { outcome: 'failed', code: 'passwordReadFailed' }
						: inspectionFailure(error, 'fileReadFailed')
			})
		}
	})
	return () => {
		report = undefined
		if (data.releaseControl === release) data.releaseControl = undefined
		abort.abort()
		clearInspectionData(input.request)
	}
})
