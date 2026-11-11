export const ACCOUNT_CURRENCY = Object.freeze({
	USD: 'USD',
	TZS: 'TZS'
})

export type AccountCurrency = (typeof ACCOUNT_CURRENCY)[keyof typeof ACCOUNT_CURRENCY]
