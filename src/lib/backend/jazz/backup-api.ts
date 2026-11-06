import { createActor, toPromise } from 'xstate'
import { jazzArchiveReleaseMachine } from '../../machines/backup/release.js'
import {
	createJazzArchiveExportRequest,
	attachJazzExportRelease,
	createJazzExportError
} from './backup.js'

/** Compose the request with its retained finite resource owner before exposing either. */
export function prepareJazzArchiveExport(
	options: Parameters<typeof createJazzArchiveExportRequest>[0]
) {
	const request = createJazzArchiveExportRequest(options)
	const owner = createActor(jazzArchiveReleaseMachine, { input: { request } })
	const released = toPromise(owner).then(
		(result) => {
			if (result.outcome === 'failed') throw createJazzExportError('cleanupFailed')
		},
		() => {
			throw createJazzExportError('cleanupFailed')
		}
	)
	attachJazzExportRelease(request, () => {
		if (owner.getSnapshot().status === 'active') owner.send({ type: 'RELEASE' })
		return released
	})
	owner.start()
	return request
}
export { jazzExportFailure as classifyJazzArchiveFailure } from './backup.js'
export type {
	ArchiveFileHandoff,
	ArchiveHandoffFile,
	ArchiveHandoffObservation,
	JazzArchiveExportRequest,
	JazzArchiveExportResult,
	JazzArchiveReaderInput,
	JazzArchiveReaderResult,
	JazzExportErrorCode
} from './backup.js'
