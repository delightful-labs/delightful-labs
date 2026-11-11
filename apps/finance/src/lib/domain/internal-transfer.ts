import { EXPENSE, INCOME } from './transaction-kind.js'
import type { InternalTransfer, TransactionRow } from '#lib/schema.js'

const MATCH_WINDOW_DAYS = 7
const MILLISECONDS_PER_DAY = 86_400_000

type TransferLink = Pick<InternalTransfer, 'id' | 'expenseTransactionId' | 'incomeTransactionId'>
type TransferMarker = Pick<TransactionRow, 'id' | 'internalTransferId'>

export type InternalTransferResolution = {
	effectiveLinks: readonly TransferLink[]
	pendingLinks: readonly TransferLink[]
	conflictedLinks: readonly TransferLink[]
	suppressedTransactionIds: ReadonlySet<string>
}

/**
 * A relationship is effective only while both endpoint markers agree with it.
 * Keep every referenced or marked transaction out of totals until conflicts are repaired.
 */
export function resolveInternalTransferLinks(
	links: readonly TransferLink[],
	transactions: readonly TransferMarker[]
): InternalTransferResolution {
	const transferIdByTransactionId = new Map(
		transactions.map(({ id, internalTransferId }) => [id, internalTransferId])
	)
	const effectiveLinks = links
		.filter(
			({ id, expenseTransactionId, incomeTransactionId }) =>
				transferIdByTransactionId.get(expenseTransactionId) === id &&
				transferIdByTransactionId.get(incomeTransactionId) === id
		)
		.sort((first, second) => compareText(first.id, second.id))
	const effectiveIds = new Set(effectiveLinks.map(({ id }) => id))
	const relationshipCountByTransactionId = new Map<string, number>()
	for (const { expenseTransactionId, incomeTransactionId } of links) {
		for (const transactionId of [expenseTransactionId, incomeTransactionId])
			relationshipCountByTransactionId.set(
				transactionId,
				(relationshipCountByTransactionId.get(transactionId) ?? 0) + 1
			)
	}
	const pendingLinks = links
		.filter(
			({ expenseTransactionId, incomeTransactionId }) =>
				transferIdByTransactionId.get(expenseTransactionId) === null &&
				transferIdByTransactionId.get(incomeTransactionId) === null &&
				relationshipCountByTransactionId.get(expenseTransactionId) === 1 &&
				relationshipCountByTransactionId.get(incomeTransactionId) === 1
		)
		.slice()
		.sort((first, second) => compareText(first.id, second.id))
	const pendingIds = new Set(pendingLinks.map(({ id }) => id))
	const conflictedLinks = links
		.filter(({ id }) => !effectiveIds.has(id) && !pendingIds.has(id))
		.slice()
		.sort((first, second) => compareText(first.id, second.id))
	const suppressedTransactionIds = new Set<string>()
	for (const link of links) {
		suppressedTransactionIds.add(link.expenseTransactionId)
		suppressedTransactionIds.add(link.incomeTransactionId)
	}
	for (const transaction of transactions)
		if (transaction.internalTransferId != null) suppressedTransactionIds.add(transaction.id)
	return { effectiveLinks, pendingLinks, conflictedLinks, suppressedTransactionIds }
}

export type InternalTransferCandidate = Pick<
	TransactionRow,
	| 'id'
	| 'organizationId'
	| 'accountId'
	| 'kind'
	| 'amountMinor'
	| 'currency'
	| 'bookedOn'
	| 'internalTransferId'
>
type TransferSource = InternalTransferCandidate

export type InternalTransferMatchChecks = {
	sameWorkspace: boolean
	differentAccount: boolean
	oppositeKind: boolean
	sameAmount: boolean
	sameCurrency: boolean
	withinDateWindow: boolean
	sourceHasNoTransferMarker: boolean
	sourceNotLinkedByTransferRecord: boolean
	candidateHasNoTransferMarker: boolean
	candidateNotLinkedByTransferRecord: boolean
}

export type InternalTransferMatchDiagnostic = {
	candidate: InternalTransferCandidate
	checks: InternalTransferMatchChecks
	eligible: boolean
}

export function inspectInternalTransferCounterparts(
	source: TransferSource,
	candidates: readonly InternalTransferCandidate[],
	linkedTransactionIds: ReadonlySet<string>
): InternalTransferMatchDiagnostic[] {
	const sourceDay = calendarDay(source.bookedOn)
	const oppositeKind = source.kind === EXPENSE ? INCOME : EXPENSE
	return candidates.map((candidate) => {
		const checks: InternalTransferMatchChecks = {
			sameWorkspace: candidate.organizationId === source.organizationId,
			differentAccount: candidate.accountId !== source.accountId,
			oppositeKind: candidate.kind === oppositeKind,
			sameAmount: candidate.amountMinor === source.amountMinor,
			sameCurrency: candidate.currency === source.currency,
			withinDateWindow: Math.abs(calendarDay(candidate.bookedOn) - sourceDay) <= MATCH_WINDOW_DAYS,
			sourceHasNoTransferMarker: !source.internalTransferId,
			sourceNotLinkedByTransferRecord: !linkedTransactionIds.has(source.id),
			candidateHasNoTransferMarker: !candidate.internalTransferId,
			candidateNotLinkedByTransferRecord: !linkedTransactionIds.has(candidate.id)
		}
		return {
			candidate,
			checks,
			eligible: Object.values(checks).every(Boolean)
		}
	})
}

export function findInternalTransferCounterparts(
	source: TransferSource,
	candidates: readonly InternalTransferCandidate[],
	linkedTransactionIds: ReadonlySet<string>
): InternalTransferCandidate[] {
	return inspectInternalTransferCounterparts(source, candidates, linkedTransactionIds)
		.filter(({ eligible }) => eligible)
		.map(({ candidate }) => candidate)
		.sort((firstCandidate, secondCandidate) => {
			const sourceDay = calendarDay(source.bookedOn)
			const firstCandidateDay = calendarDay(firstCandidate.bookedOn)
			const secondCandidateDay = calendarDay(secondCandidate.bookedOn)
			const distanceOrder =
				Math.abs(firstCandidateDay - sourceDay) - Math.abs(secondCandidateDay - sourceDay)
			const dateOrder = compareText(firstCandidate.bookedOn, secondCandidate.bookedOn)
			return distanceOrder || dateOrder || compareText(firstCandidate.id, secondCandidate.id)
		})
}

function compareText(firstValue: string, secondValue: string): number {
	return firstValue < secondValue ? -1 : firstValue > secondValue ? 1 : 0
}

function calendarDay(dateOnly: string): number {
	return Date.parse(`${dateOnly}T00:00:00.000Z`) / MILLISECONDS_PER_DAY
}
