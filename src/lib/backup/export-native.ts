import { fromCallback } from 'xstate'
import {
	clearExportData,
	createArchiveExportError,
	exportData,
	publishExportCleanup,
	requireExportValue,
	type ArchiveCaptureLease,
	type ArchiveExportRequest,
	type ArchiveHandoffFile,
	type ArchiveHandoffObservation
} from './export.js'

/** Exactly one issued native call. Its promise is a resource receipt the chart may drain. */
function issue<T, Output>(
	request: ArchiveExportRequest,
	run: () => Promise<T>,
	accept: (value: T) => Output | Promise<Output>,
	settle: () => void | Promise<void> = () => {},
	eligible = true
): Promise<Output> {
	const data = exportData(request)
	if (data.issued !== undefined) throw createArchiveExportError('exportInUse')
	const call = Promise.resolve()
		.then(() => {
			if (eligible && (data.input === undefined || data.abort.signal.aborted))
				throw createArchiveExportError('exportReleased')
			return run()
		})
		.then(accept)
		.finally(settle)
		.finally(() => {
			if (data.issued === call) data.issued = undefined
			publishExportCleanup(request)
		})
	data.issued = call
	return call
}
/** One native disposal; failed custody is retained, never automatically retried. */
function disposeLease(request: ArchiveExportRequest, lease: ArchiveCaptureLease): Promise<void> {
	return Promise.resolve()
		.then(() => lease.release())
		.catch(() => {
			exportData(request).failedLease = lease
			throw createArchiveExportError('captureCleanupFailed')
		})
}
export function abortExport(request: ArchiveExportRequest) {
	exportData(request).abort.abort()
}
export function drainExport(request: ArchiveExportRequest): Promise<void> {
	abortExport(request)
	return (exportData(request).issued ?? Promise.resolve()).then(
		() => {},
		() => {}
	)
}
export function observeExportAuthority(request: ArchiveExportRequest): Promise<boolean> {
	const data = exportData(request)
	const source = requireExportValue(data.input).source
	return issue(
		request,
		() => source.checkAuthority(data.binding, data.abort.signal),
		(value) => value
	)
}
export function acquireExportLease(request: ArchiveExportRequest): Promise<void> {
	const data = exportData(request)
	const source = requireExportValue(data.input).source
	return issue(
		request,
		() => source.acquire(data.binding, data.abort.signal),
		(lease) => {
			if (data.input !== undefined) {
				data.lease = lease
				return
			}
			return disposeLease(request, lease)
		}
	)
}
/** Loan the actual lease into this one call; no idle owner may release a borrowed resource. */
function leaseCall<T, Output>(
	request: ArchiveExportRequest,
	run: (lease: ArchiveCaptureLease) => Promise<T>,
	accept: (value: T) => Output
): Promise<Output> {
	const data = exportData(request)
	const lease = requireExportValue(data.lease)
	if (data.issued !== undefined) throw createArchiveExportError('exportInUse')
	data.lease = undefined
	return issue(
		request,
		() => run(lease),
		accept,
		() => {
			if (data.input !== undefined) {
				data.lease = lease
				return
			}
			return disposeLease(request, lease)
		}
	)
}
export function drainExportWriters(request: ArchiveExportRequest): Promise<void> {
	return leaseCall(
		request,
		(lease) => lease.drain(exportData(request).abort.signal),
		() => {}
	)
}
export function readExportGraph(request: ArchiveExportRequest): Promise<void> {
	const data = exportData(request)
	return leaseCall(
		request,
		(lease) => lease.read(data.abort.signal, data.limits),
		(value) => {
			if (data.input !== undefined && !data.abort.signal.aborted) data.captured = value
		}
	)
}
export function observeExportConsistency(request: ArchiveExportRequest): Promise<boolean> {
	return leaseCall(
		request,
		(lease) => lease.checkConsistency(exportData(request).abort.signal),
		(value) => value
	)
}
export function releaseExportLease(request: ArchiveExportRequest): Promise<void> {
	const data = exportData(request)
	if (data.failedLease !== undefined)
		return Promise.reject(createArchiveExportError('captureCleanupFailed'))
	const lease = data.lease
	if (lease === undefined) return Promise.resolve()
	if (data.issued !== undefined) throw createArchiveExportError('exportInUse')
	data.lease = undefined
	return issue(
		request,
		() => disposeLease(request, lease),
		() => {},
		() => {},
		false
	)
}
export function dispatchExportFile(
	request: ArchiveExportRequest
): Promise<ArchiveHandoffObservation> {
	const data = exportData(request)
	const handoff = requireExportValue(data.input).handoff
	const archive = requireExportValue(data.sealed)
	if (data.issued !== undefined) throw createArchiveExportError('exportInUse')
	data.sealed = undefined
	const file: ArchiveHandoffFile = Object.freeze({
		copyBytes: () => archive.copyBytes(),
		toJSON: (): { kind: 'sealedArchive' } => ({ kind: 'sealedArchive' })
	})
	return issue(
		request,
		() => handoff.dispatch(file, data.binding, data.abort.signal),
		(value): ArchiveHandoffObservation =>
			value === 'dispatched' || value === 'rejected' ? value : 'unknown',
		() => {
			if (data.input !== undefined) data.sealed = archive
			else archive.release()
		}
	).catch((): ArchiveHandoffObservation => 'unknown')
}
export function finishExport(request: ArchiveExportRequest) {
	abortExport(request)
	clearExportData(request)
	// A borrowed lease is absent here and is disposed only by its native call's finalizer.
	if (exportData(request).lease !== undefined) void releaseExportLease(request).catch(() => {})
	publishExportCleanup(request)
}
/** Fixed native teardown scope. It starts no child actor and makes no workflow decisions. */
export const exportResources = fromCallback<{ type: string }, { request: ArchiveExportRequest }>(
	({ input, sendBack }) => {
		const data = exportData(input.request)
		const release = () => sendBack({ type: 'RELEASE' })
		data.releaseControl = release
		return () => {
			if (data.releaseControl === release) data.releaseControl = undefined
			finishExport(input.request)
		}
	}
)
