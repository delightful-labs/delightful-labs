export const ACCOUNT_KIND = Object.freeze({
	CASH: 'cash',
	BANK: 'bank',
	CARD: 'card'
})

export type AccountKind = (typeof ACCOUNT_KIND)[keyof typeof ACCOUNT_KIND]
