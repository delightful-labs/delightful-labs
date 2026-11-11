export type FinanceFilters = {
	readonly activeOrganizationId: string | null
	selectedAccountIds: string[] | null
}

export const financeFiltersKey = Symbol('finance-filters')

export type AccountOrder = { readonly ids: readonly string[] }

export const accountOrderKey = Symbol('account-order')

export type AccountBalances = { readonly current: ReadonlyMap<string, bigint> | null }

export const accountBalancesKey = Symbol('account-balances')
