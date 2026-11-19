import type { FinanceQueryFacts } from './worker-queries.js'
/** Ready empty native observations; each scenario supplies its own domain records. */
export function queryFacts(overrides: Partial<FinanceQueryFacts> = {}): FinanceQueryFacts {
	return {
		binding: {},
		status: 'ready',
		bankConnections: [],
		bankLinks: [],
		transfers: [],
		workspaceMembers: [],
		accountGrants: [],
		profile: null,
		workspace: null,
		workspaces: [],
		accounts: [],
		membership: null,
		grants: [],
		categories: [],
		tags: [],
		transaction: undefined,
		transactions: [],
		...overrides
	}
}
