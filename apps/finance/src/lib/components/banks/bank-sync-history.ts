import type { SyncAttempt, SyncAccountResult } from '#lib/schema.js'
import type { Connection } from '#lib/machines/bank-sync/types.js'

type ScopedSelection = { scope: string; id: string }
type HistoryPage = { scope: string; limit: number }
const pageSize = 20

export function initialHistoryPage(scope = ''): HistoryPage {
	return { scope, limit: pageSize }
}

export function selectHistoryConnection(
	connections: readonly Connection[],
	organizationId: string | undefined,
	selection: ScopedSelection,
	scope: string,
	currentConnectionId: string | undefined
) {
	const available = connections.filter((row) => row.organizationId === organizationId)
	const selected = selection.scope === scope && available.some((row) => row.id === selection.id)
	return {
		connections: available,
		connectionId: selected
			? selection.id
			: (available.find((row) => row.id === currentConnectionId)?.id ?? available[0]?.id)
	}
}

export function historyPageLimit(page: HistoryPage, scope: string) {
	return page.scope === scope ? page.limit : pageSize
}

export function nextHistoryPage(page: HistoryPage, scope: string): HistoryPage {
	return { scope, limit: historyPageLimit(page, scope) + pageSize }
}

export function selectHistoryPage(
	attempts: readonly SyncAttempt[],
	connections: readonly Connection[],
	organizationId: string | null,
	connectionId: string | undefined,
	limit: number
) {
	const scoped = attempts.filter(
		(row) =>
			Boolean(connectionId) &&
			row.connectionId === connectionId &&
			row.organizationId === organizationId
	)
	const visible = scoped.slice(0, limit)
	return {
		attempts: visible,
		attemptIds: visible.map((row) => row.id),
		hasEarlier: scoped.length > limit,
		initiatorIds: [
			...new Set([
				...visible.map((row) => row.initiatedBy),
				...connections.flatMap((row) => (row.ownerId ? [row.ownerId] : []))
			])
		]
	}
}

export function selectHistoryAccounts(
	accounts: readonly SyncAccountResult[],
	organizationId: string | null,
	attemptIds: readonly string[]
) {
	return accounts.filter(
		(row) => row.organizationId === organizationId && attemptIds.includes(row.attemptId)
	)
}
