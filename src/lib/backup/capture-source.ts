import type { MutationAdmission } from '../machines/data/admission.js'
import {
	createArchiveExportError,
	type ArchiveCaptureSource,
	type BackupBinding
} from './export.js'
import type { PayloadLimits } from './types.js'

/** Shared admission/custody adapter. Domain queries and consistency checks stay consumer-owned.
 * Read capabilities must be leaves; compose a multi-stage graph reader as an invoked actor.
 */
export function createAdmittedArchiveSource(options: {
	admission: MutationAdmission
	checkAuthority: (binding: BackupBinding, signal: AbortSignal) => Promise<boolean>
	/** Omit when supplying an invoked reader to createArchiveExportMachine. */
	read?: (binding: BackupBinding, signal: AbortSignal, limits: PayloadLimits) => Promise<unknown>
	checkConsistency: (binding: BackupBinding, signal: AbortSignal) => Promise<boolean>
}): ArchiveCaptureSource {
	return Object.freeze({
		checkAuthority: options.checkAuthority,
		acquire(binding: BackupBinding, signal: AbortSignal) {
			const admission = options.admission.capture(signal)
			if (admission.outcome === 'denied')
				return Promise.reject(
					createArchiveExportError(
						admission.reason === 'unresolved' ? 'captureInconsistent' : 'exportInUse'
					)
				)
			// The export's signal owns this reservation directly. Even a crashed reader cannot
			// strand admission by failing to acknowledge a release message.
			const lease = {
				drain: () => admission.lease.drain(),
				checkConsistency: (signal: AbortSignal) => options.checkConsistency(binding, signal),
				release() {
					admission.lease.release()
					return Promise.resolve()
				}
			}
			const read = options.read
			return Promise.resolve(
				read === undefined
					? lease
					: {
							...lease,
							read: (signal: AbortSignal, limits: PayloadLimits) => read(binding, signal, limits)
						}
			)
		}
	})
}
