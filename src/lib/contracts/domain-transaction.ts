import type { ActorInstance, EnqueueObject, Snapshot, SystemRegistry } from 'xstate'
import type {
	WorkspaceCreationAssessment,
	WorkspaceCreationAttempt,
	WorkspaceCreationResult
} from './workspace-creation.js'
import type { RetainDetachedTransaction } from './transaction-custody.js'

/** Preserve existing workspace attempt identity while exposing domain-neutral composition. */
export type TransactionAttempt<Draft> = WorkspaceCreationAttempt<Draft>
export type TransactionAssessment = WorkspaceCreationAssessment
export type DomainTransactionResult<Draft, Receipt> = WorkspaceCreationResult<Draft, Receipt>
export type TransactionPreparedPort = {
	send: (event: { type: 'PREPARED'; assessment: TransactionAssessment }) => void
}
export type TransactionDomainInput<Draft, Resource> = {
	resource: Resource
	attempt: TransactionAttempt<Draft>
	owner: TransactionPreparedPort
}
/** Concrete producers keep their own full child input and event contracts. */
export type TransactionChildSpawner = EnqueueObject<never, never, SystemRegistry, {}>['spawn']
export type TransactionDomainChild<Receipt> = ActorInstance<
	Snapshot<Receipt>,
	{ type: 'STAGE' } | { type: 'STAGED' }
>
export type TransactionDomainSpawner<Draft, Resource, Receipt> = (
	spawn: TransactionChildSpawner,
	input: TransactionDomainInput<Draft, Resource>
) => TransactionDomainChild<Receipt>
export type DomainTransactionLifecycle<Resource, Write> = {
	retainDetached: RetainDetachedTransaction<Resource, Write>
	open: () => Resource | PromiseLike<Resource>
	commit: (resource: Resource) => Write | PromiseLike<Write>
	persistLocal: (write: Write) => void | PromiseLike<void>
	rollback: (resource: Resource) => boolean | PromiseLike<boolean>
}
