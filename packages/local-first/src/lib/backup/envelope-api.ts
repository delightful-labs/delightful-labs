/** Preparation is synchronous; execute each request once through backup/envelope/workflow. */
export { prepareArchiveSeal, prepareArchiveOpen } from './envelope-operation.js'
export { createArchiveEnvelopeError, isArchiveEnvelopeError } from './envelope.js'
export type {
	ArchiveEnvelopeRequest,
	ArchiveEnvelopeResult,
	ArchiveProtection,
	SealedArchive,
	IntegrityCheckedArchive
} from './envelope-operation.js'
export type { EnvelopeErrorCode } from './envelope.js'
