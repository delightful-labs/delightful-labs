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
	| Readonly<{ kind: 'unresolved'; error: unknown }>
export type WorkspaceCreationOutcome<Workspace> =
	| Readonly<{
			outcome: 'succeeded'
			settlement: { kind: 'locallyPersisted'; workspace: Workspace }
	  }>
	| Readonly<{ outcome: 'blocked'; reason: string; settlement: { kind: 'notStarted' } }>
	| Readonly<{
			outcome: 'failed'
			error: unknown
			settlement: { kind: 'notStarted' } | { kind: 'unresolved'; error: unknown }
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
		open: () => Leaf<Transaction>
		/** Retain uncertain native receipts after abrupt teardown or unresolved completion. */
		retainDetached: RetainDetachedTransaction<Transaction, Write>
		readLocal: (transaction: Transaction, attempt: WorkspaceCreationAttempt<Draft>) => Leaf<Records>
		assess: (
			records: Records,
			attempt: WorkspaceCreationAttempt<Draft>
		) => WorkspaceCreationAssessment
		stage: (transaction: Transaction, attempt: WorkspaceCreationAttempt<Draft>) => Leaf<Workspace>
		commit: (transaction: Transaction) => Leaf<Write>
		/** Must confirm local durability only; authority acceptance is a separate observation. */
		persistLocal: (write: Write) => Leaf<void>
		rollback: (transaction: Transaction) => Leaf<boolean>
	}>
