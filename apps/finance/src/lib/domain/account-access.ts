export const ACCOUNT_ACCESS = Object.freeze({
	ALL: 'all',
	SELECTED: 'selected'
})

export type AccountAccessMode = (typeof ACCOUNT_ACCESS)[keyof typeof ACCOUNT_ACCESS]
