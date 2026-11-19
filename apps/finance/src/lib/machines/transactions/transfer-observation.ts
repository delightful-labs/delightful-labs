import { resolveInternalTransferLinks } from '../../domain/internal-transfer.js'
import type { TransactionEntryObservation } from '../../contracts/transaction-entry-contract.js'
import type { WorkerTransferFacts } from '../../contracts/worker-transfers.js'
import { transactionEntryScope } from './transaction-entry.js'

/** Resolve the same observed endpoint facts for edit, link, unlink and recovery. */
export function transactionTransferObservation(
	facts: WorkerTransferFacts,
	source: TransactionEntryObservation,
	scopeGeneration: number,
	searchEnabled: boolean
) {
	const transaction = source.transaction
	const resolution = resolveInternalTransferLinks(facts.rows, facts.transactions)
	const currentId = transaction?.id
	const effective = resolution.effectiveLinks.find(
		(link) => link.expenseTransactionId === currentId || link.incomeTransactionId === currentId
	)
	const pending = resolution.pendingLinks.find(
		(link) => link.expenseTransactionId === currentId || link.incomeTransactionId === currentId
	)
	const resolved = effective ?? pending
	const relatedIds = new Set([
		currentId,
		resolved?.expenseTransactionId,
		resolved?.incomeTransactionId
	])
	const conflicted =
		!!transaction &&
		!facts.loading &&
		(resolution.conflictedLinks.some(
			(link) =>
				relatedIds.has(link.expenseTransactionId) || relatedIds.has(link.incomeTransactionId)
		) ||
			(transaction.internalTransferId != null &&
				!facts.rows.some(
					(link) =>
						link.id === transaction.internalTransferId &&
						(link.expenseTransactionId === currentId || link.incomeTransactionId === currentId)
				)))
	const linkedTransfer =
		!conflicted && resolved ? (facts.rows.find((link) => link.id === resolved.id) ?? null) : null
	return {
		rows: facts.transactions,
		scope: transactionEntryScope(source),
		scopeGeneration,
		linkedTransactionIds: facts.rows.flatMap((link) => [
			link.expenseTransactionId,
			link.incomeTransactionId
		]),
		linkedTransfer,
		linked: linkedTransfer !== null,
		conflicted,
		searchEnabled,
		pendingUnlink: linkedTransfer !== null && pending?.id === linkedTransfer.id,
		loading: facts.loading,
		failed: facts.failed
	}
}
