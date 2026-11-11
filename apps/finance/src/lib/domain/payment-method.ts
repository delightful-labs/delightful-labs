export const PAYMENT_METHOD = Object.freeze({
	CASH: 'cash',
	CHECK: 'check',
	TRANSFER: 'transfer',
	ELECTRONIC: 'electronic'
})

export type PaymentMethod = (typeof PAYMENT_METHOD)[keyof typeof PAYMENT_METHOD]
