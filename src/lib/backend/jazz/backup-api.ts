import { createActor, toPromise } from 'xstate'
import { jazzArchiveScopeMachine } from '../../machines/backup/scope.js'
import {
	createJazzArchiveExportRequest,
	attachJazzExportOwner,
	createJazzExportError,
	type ArchiveHandoffObservation
} from './backup.js'

/** Compose the request with its retained finite resource owner before exposing either. */
export function prepareJazzArchiveExport(
	options: Parameters<typeof createJazzArchiveExportRequest>[0]
) {
	const request = createJazzArchiveExportRequest(options)
	const owner = createActor(jazzArchiveScopeMachine, { input: { request } })
	const released = toPromise(owner).then(
		(result) => {
			if (result.outcome === 'failed') throw createJazzExportError('cleanupFailed')
		},
		() => {
			throw createJazzExportError('cleanupFailed')
		}
	)
	attachJazzExportOwner(request, {
		claim: () =>
			owner.getSnapshot().status === 'active'
				? new Promise<boolean>((reply) => owner.send({ type: 'CLAIM', reply }))
				: Promise.resolve(false),
		dispatch: () =>
			new Promise<ArchiveHandoffObservation>((reply, reject) => {
				const refuse = () => reject(createJazzExportError('inUse'))
				if (owner.getSnapshot().status === 'active') owner.send({ type: 'DISPATCH', reply, refuse })
				else refuse()
			}),
		handoff: () => owner.getSnapshot().context.handoff,
		release: () => {
			if (owner.getSnapshot().status === 'active') owner.send({ type: 'RELEASE' })
			return released
		}
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
