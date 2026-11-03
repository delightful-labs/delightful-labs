/** Supplemental internal journal contract; separate from the public creation workflow contracts. */
export type WorkspaceCreationScope = Readonly<{
	binding: object
	attachment: object
	generation: number
}>

/** Stable, non-secret identity; never reuse an operation ID for different intended content. */
export type WorkspaceCreationIdentity = Readonly<{
	hostId: string
	accountId: string
	operationId: string
	workspaceId: string
	requestFingerprint: string
}>

/** Account-bound persistence key; live attachment tokens do not survive a process restart. */
export type WorkspaceCreationJournalKey = Readonly<{
	hostId: string
	accountId: string
	operationId: string
}>

/** Evidence only: actor states, rather than journal fields, own the live operation lifecycle. */
export type WorkspaceCreationEvidence =
	| Readonly<{ kind: 'intent' }>
	/** Must be durable BEFORE commit is issued, not afterwards. Absence never authorizes replay. */
	| Readonly<{ kind: 'commitPossible' }>
	| Readonly<{ kind: 'authorityAccepted' }>
	| Readonly<{ kind: 'authorityRejected'; reason: 'denied' | 'conflict' }>
	/** Positive evidence from the live owner that commit was never issued and resources released. */
	| Readonly<{ kind: 'abortedBeforeCommit' }>

export type WorkspaceCreationJournalRecord = Readonly<{
	version: 1
	identity: WorkspaceCreationIdentity
	/** Positive safe integer; advance exactly once per atomic compare-and-set. */
	revision: number
	evidence: WorkspaceCreationEvidence
}>

export type WorkspaceCreationJournalRead =
	| Readonly<{ kind: 'missing' }>
	| Readonly<{ kind: 'found'; record: WorkspaceCreationJournalRecord }>
	/** Corrupt/unsupported records must not be treated as missing or silently replaced. */
	| Readonly<{
			kind: 'unavailable'
			reason: 'storageFailed' | 'invalidRecord' | 'unsupportedVersion'
	  }>

export type WorkspaceCreationJournalWrite =
	/** Returned only after the actual local persistence transaction completes. */
	| Readonly<{ kind: 'persisted'; record: WorkspaceCreationJournalRecord }>
	/** Another writer changed the revision or fixed identity. Re-read; do not overwrite. */
	| Readonly<{ kind: 'conflict' }>
	/** storageFailed may hide completion; read the same key before another transition. */
	| Readonly<{
			kind: 'unavailable'
			reason: 'storageFailed' | 'invalidRecord' | 'unsupportedVersion'
	  }>

/** Individual persistence leaves. No SDK handles, credentials, creation writes or replay here. */
export type WorkspaceCreationJournal = Readonly<{
	read: (key: WorkspaceCreationJournalKey) => Promise<WorkspaceCreationJournalRead>
	/** Insert intent at revision 1 iff absent. Existing identical intent is still a conflict. */
	insertIntent: (identity: WorkspaceCreationIdentity) => Promise<WorkspaceCreationJournalWrite>
	/**
	 * Atomically require the exact identity and expectedRevision, validate the evidence transition,
	 * and persist revision + 1. The journal does not choose what the next evidence should be.
	 */
	advance: (
		identity: WorkspaceCreationIdentity,
		expectedRevision: number,
		evidence: WorkspaceCreationEvidence
	) => Promise<WorkspaceCreationJournalWrite>
}>

/** Positive matching-record evidence is distinct from incomplete absence and integrity failure. */
export type WorkspaceCreationReconciliation =
	| Readonly<{ kind: 'authorityAccepted'; identity: WorkspaceCreationIdentity }>
	| Readonly<{
			kind: 'authorityRejected'
			identity: WorkspaceCreationIdentity
			reason: 'denied' | 'conflict'
	  }>
	| Readonly<{ kind: 'integrityFailure'; identity: WorkspaceCreationIdentity }>
	| Readonly<{ kind: 'unknown'; identity: WorkspaceCreationIdentity }>
