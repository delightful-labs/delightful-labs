export const TRANSACTION_SOURCE = Object.freeze({
	MANUAL: 'manual',
	SIMPLEFIN: 'simplefin'
})

export type TransactionSource = (typeof TRANSACTION_SOURCE)[keyof typeof TRANSACTION_SOURCE]
