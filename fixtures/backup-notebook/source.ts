import {
	encodeArchivePayload,
	parseArchivePayload,
	type ArchivePayload,
	type PayloadLimits
} from 'delightful-local-first/backup/archive'
import {
	sameBackupBinding,
	type ArchiveCaptureSource,
	type ArchiveCaptureLease,
	type BackupBinding
} from 'delightful-local-first/backup/export'
import { notebookProfile } from './profile.js'

function detach(payload: unknown, limits?: PayloadLimits): ArchivePayload {
	const bytes = encodeArchivePayload(payload, limits)
	try {
		const result = parseArchivePayload(bytes, limits)
		if (!notebookProfile.validate(result)) throw new Error('Invalid notebook profile')
		return result
	} finally {
		bytes.fill(0)
	}
}

/** Disposable fixture only: exclusive synchronous writers, no persistence or remote acceptance.
 * Capture orchestration is the invoked DLF capture machine, never hidden in these leaf methods.
 */
export class NotebookSource implements ArchiveCaptureSource {
	#payload: ArchivePayload
	#binding: BackupBinding
	#owner: object | undefined
	constructor(payload: unknown, binding: BackupBinding) {
		this.#payload = detach(payload)
		this.#binding = Object.freeze({ ...binding })
	}
	observeBinding(binding: BackupBinding) {
		this.#binding = Object.freeze({ ...binding })
	}
	/** Synchronous fixture writer. A lease blocks changes, rather than pretending to drain Jazz. */
	replace(payload: unknown) {
		if (this.#owner) throw new Error('Notebook capture owns the source')
		this.#payload = detach(payload)
	}
	#allowed(binding: BackupBinding, signal: AbortSignal): boolean {
		return (
			!signal.aborted &&
			sameBackupBinding(this.#binding, binding) &&
			this.#payload.source.applicationId === binding.applicationId &&
			this.#payload.source.workspaceId === binding.workspaceId
		)
	}
	checkAuthority(binding: BackupBinding, signal: AbortSignal): Promise<boolean> {
		return Promise.resolve(this.#allowed(binding, signal))
	}
	acquire(binding: BackupBinding, signal: AbortSignal): Promise<ArchiveCaptureLease> {
		if (!this.#allowed(binding, signal) || this.#owner)
			throw new Error('Notebook capture unavailable')
		const owner = Object.freeze({})
		this.#owner = owner
		const current = (signal: AbortSignal) => this.#owner === owner && this.#allowed(binding, signal)
		const lease: ArchiveCaptureLease = Object.freeze({
			drain: (signal: AbortSignal) => {
				if (!current(signal)) throw new Error('Notebook capture invalidated')
				// All fixture writers are synchronous and excluded by the acquired lease.
				return Promise.resolve()
			},
			read: (signal: AbortSignal, limits: PayloadLimits) => {
				if (!current(signal)) throw new Error('Notebook capture invalidated')
				return Promise.resolve(
					detach(
						{
							...this.#payload,
							archiveId: crypto.randomUUID(),
							capturedAt: new Date().toISOString()
						},
						limits
					)
				)
			},
			checkConsistency: (signal: AbortSignal) => Promise.resolve(current(signal)),
			release: () => {
				if (this.#owner === owner) this.#owner = undefined
				return Promise.resolve()
			}
		})
		return Promise.resolve(lease)
	}
}
