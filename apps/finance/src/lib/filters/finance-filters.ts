export type FinanceFilters = {
	readonly activeOrganizationId: string | null
	selectedAccountIds: string[] | null
}

export const financeFiltersKey = Symbol('finance-filters')

export type AccountOrder = { readonly ids: readonly string[] }

export const accountOrderKey = Symbol('account-order')

export type AccountBalances = { readonly current: ReadonlyMap<string, bigint> | null }

export const accountBalancesKey = Symbol('account-balances')

/** Preserve all-account selection as null so newly observed accounts remain included. */
export function toggleSelectedAccount(
	current: readonly string[] | null,
	accounts: readonly { id: string }[],
	accountId: string,
	checked: boolean
): string[] | null {
	if (checked && current === null) return null
	const selected = new Set(current ?? accounts.map((account) => account.id))
	if (checked) selected.add(accountId)
	else selected.delete(accountId)
	return [...selected]
}
