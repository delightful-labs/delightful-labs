import type {
	WorkspaceCreationEvidence,
	WorkspaceCreationIdentity,
	WorkspaceCreationJournalKey,
	WorkspaceCreationJournalRecord,
	WorkspaceCreationJournalRead
} from '../../contracts/workspace-creation-journal.js'

function object(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function keys(value: object, names: readonly string[]) {
	return (
		Object.keys(value).length === names.length && names.every((name) => Object.hasOwn(value, name))
	)
}
function identifier(value: unknown): value is string {
	return typeof value === 'string' && value.trim().length > 0
}
export function validJournalKey(value: unknown): value is WorkspaceCreationJournalKey {
	return (
		object(value) &&
		identifier(value.hostId) &&
		identifier(value.accountId) &&
		identifier(value.operationId)
	)
}
export function validCreationIdentity(value: unknown): value is WorkspaceCreationIdentity {
	return (
		object(value) &&
		identifier(value.hostId) &&
		identifier(value.accountId) &&
		identifier(value.operationId) &&
		identifier(value.workspaceId) &&
		identifier(value.requestFingerprint)
	)
}
export function copyCreationIdentity(value: WorkspaceCreationIdentity): WorkspaceCreationIdentity {
	return {
		hostId: value.hostId,
		accountId: value.accountId,
		operationId: value.operationId,
		workspaceId: value.workspaceId,
		requestFingerprint: value.requestFingerprint
	}
}
export function validCreationEvidence(value: unknown): value is WorkspaceCreationEvidence {
	if (!object(value)) return false
	if (value.kind === 'authorityRejected') {
		return (
			keys(value, ['kind', 'reason']) && (value.reason === 'denied' || value.reason === 'conflict')
		)
	}
	return (
		keys(value, ['kind']) &&
		(value.kind === 'intent' ||
			value.kind === 'commitPossible' ||
			value.kind === 'authorityAccepted' ||
			value.kind === 'abortedBeforeCommit')
	)
}
export function copyCreationEvidence(value: WorkspaceCreationEvidence): WorkspaceCreationEvidence {
	if (value.kind === 'authorityRejected') return { kind: value.kind, reason: value.reason }
	return { kind: value.kind }
}
export function matchesJournalKey(
	identity: WorkspaceCreationIdentity,
	key: WorkspaceCreationJournalKey
) {
	return (
		identity.hostId === key.hostId &&
		identity.accountId === key.accountId &&
		identity.operationId === key.operationId
	)
}
export function sameCreationIdentity(a: WorkspaceCreationIdentity, b: WorkspaceCreationIdentity) {
	return (
		matchesJournalKey(a, b) &&
		a.workspaceId === b.workspaceId &&
		a.requestFingerprint === b.requestFingerprint
	)
}
function validEvidenceRevision(evidence: WorkspaceCreationEvidence, revision: number) {
	if (evidence.kind === 'intent') return revision === 1
	if (evidence.kind === 'commitPossible') return revision === 2
	if (evidence.kind === 'abortedBeforeCommit') return revision === 2 || revision === 3
	return revision === 3
}
export function allowsCreationEvidence(
	previous: WorkspaceCreationEvidence,
	next: WorkspaceCreationEvidence
) {
	if (previous.kind === 'intent')
		return next.kind === 'commitPossible' || next.kind === 'abortedBeforeCommit'
	if (previous.kind === 'commitPossible')
		return (
			next.kind === 'authorityAccepted' ||
			next.kind === 'authorityRejected' ||
			next.kind === 'abortedBeforeCommit'
		)
	return false
}
export function decodeCreationRecord(
	value: unknown,
	key: WorkspaceCreationJournalKey
): Exclude<WorkspaceCreationJournalRead, { kind: 'missing' }> {
	if (!object(value) || !('version' in value))
		return { kind: 'unavailable', reason: 'invalidRecord' }
	if (
		typeof value.version !== 'number' ||
		!Number.isSafeInteger(value.version) ||
		value.version < 1
	)
		return { kind: 'unavailable', reason: 'invalidRecord' }
	if (value.version !== 1) return { kind: 'unavailable', reason: 'unsupportedVersion' }
	if (
		!keys(value, ['version', 'identity', 'revision', 'evidence']) ||
		!validCreationIdentity(value.identity) ||
		!keys(value.identity, [
			'hostId',
			'accountId',
			'operationId',
			'workspaceId',
			'requestFingerprint'
		]) ||
		!matchesJournalKey(value.identity, key) ||
		typeof value.revision !== 'number' ||
		!Number.isSafeInteger(value.revision) ||
		value.revision < 1 ||
		!validCreationEvidence(value.evidence) ||
		!validEvidenceRevision(value.evidence, value.revision)
	) {
		return { kind: 'unavailable', reason: 'invalidRecord' }
	}
	const record: WorkspaceCreationJournalRecord = {
		version: 1,
		identity: copyCreationIdentity(value.identity),
		revision: value.revision,
		evidence: copyCreationEvidence(value.evidence)
	}
	return { kind: 'found', record }
}
