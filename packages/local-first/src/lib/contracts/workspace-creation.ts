import type { RetainDetachedTransaction } from './transaction-custody.js'
export type { DetachedTransaction } from './transaction-custody.js'
/** Prepared explicit intent. Preserve this identity in the host's durable recovery journal. */
export type WorkspaceCreationAttempt<Draft> = Readonly<{
	operationId: string
	workspaceId: string
	membershipId: string
	draft: Draft
}>
export type WorkspaceCreationAssessment =
	| Readonly<{ outcome: 'eligible' }>
	| Readonly<{ outcome: 'blocked'; reason: string }>
export type WorkspaceCreationSettlement<Workspace> =
	| Readonly<{ kind: 'notStarted' }>
	| Readonly<{ kind: 'locallyPersisted'; workspace: Workspace }>
	| Readonly<{ kind: 'authorityAccepted'; workspace: Workspace }>
	| Readonly<{ kind: 'rejected'; error: unknown }>
	| Readonly<{ kind: 'unresolved'; error: unknown }>
export type WorkspaceCreationOutcome<Workspace> =
	| Readonly<{
			outcome: 'succeeded'
			settlement: { kind: 'locallyPersisted' | 'authorityAccepted'; workspace: Workspace }
	  }>
	| Readonly<{ outcome: 'blocked'; reason: string; settlement: { kind: 'notStarted' } }>
	| Readonly<{
			outcome: 'failed'
			error: unknown
			settlement: { kind: 'notStarted' } | { kind: 'unresolved' | 'rejected'; error: unknown }
	  }>
	| Readonly<{
			outcome: 'cancelled' | 'closed'
			settlement: WorkspaceCreationSettlement<Workspace>
	  }>
export type WorkspaceCreationResult<Draft, Workspace> = WorkspaceCreationOutcome<Workspace> &
	Readonly<{ attempt: WorkspaceCreationAttempt<Draft> }>
export type WorkspaceCreationEvent = Readonly<{ type: 'CANCEL' | 'SHUTDOWN' }>
type Leaf<Value> = Value | PromiseLike<Value>
/** Each operation is one leaf; business decisions belong in the owning statechart. */
export type WorkspaceCreationTransactionCapability<Draft, Transaction, Records, Workspace, Write> =
	Readonly<{
		open: (attempt: WorkspaceCreationAttempt<Draft>) => Leaf<Transaction>
		/** Retain uncertain native receipts after abrupt teardown or unresolved completion. */
		retainDetached: (
			receipt: Parameters<RetainDetachedTransaction<Transaction, Write>>[0],
			attempt: WorkspaceCreationAttempt<Draft>
		) => void
		readLocal: (transaction: Transaction, attempt: WorkspaceCreationAttempt<Draft>) => Leaf<Records>
		assess: (
			records: Records,
			attempt: WorkspaceCreationAttempt<Draft>
		) => WorkspaceCreationAssessment
		stage: (transaction: Transaction, attempt: WorkspaceCreationAttempt<Draft>) => Leaf<Workspace>
		commit: (transaction: Transaction) => Leaf<Write>
		rollback: (transaction: Transaction) => Leaf<boolean>
	}> &
		(
			| Readonly<{
					/** Confirm local durability; later authority acceptance is a separate observation. */
					persistLocal: (write: Write) => Leaf<void>
					authority?: never
			  }>
			| Readonly<{
					persistLocal?: never
					/** For authority-required operations, retain custody through the actual global receipt. */
					authority: Readonly<{
						confirm: (write: Write) => Leaf<void>
						isRejected: (error: unknown) => boolean
					}>
			  }>
		)
