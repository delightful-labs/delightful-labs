import { createCallbackLogic } from 'xstate'

import type { RetainDetachedTransaction } from '../../contracts/transaction-custody.js'
/** Native call receipts only; charts decide when confirmed settlement relinquishes custody. */
export type TransactionCustody<Transaction, Commit> = {
	readonly acquisition: Promise<Transaction> | undefined
	readonly pending: Promise<unknown> | undefined
	readonly commit: Promise<Commit> | undefined
	readonly retain: RetainDetachedTransaction<Transaction, Commit> | undefined
	recordAcquisition: (receipt: Promise<Transaction>) => void
	recordPending: (receipt: Promise<unknown>) => void
	recordCommit: (receipt: Promise<Commit>) => void
	bindRetainer: (retain: RetainDetachedTransaction<Transaction, Commit>) => void
	clear: () => void
}
export function createTransactionCustody<Transaction, Commit>(
	retain?: RetainDetachedTransaction<Transaction, Commit>
): TransactionCustody<Transaction, Commit> {
	let acquisition: Promise<Transaction> | undefined
	let pending: Promise<unknown> | undefined
	let commit: Promise<Commit> | undefined
	let retainer = retain
	// Native receipts live in this private closure. Freezing a snapshot cannot
	// freeze or rewrite resource bookkeeping while an issued call is settling.
	return Object.freeze({
		get acquisition() {
			return acquisition
		},
		get pending() {
			return pending
		},
		get commit() {
			return commit
		},
		get retain() {
			return retainer
		},
		recordAcquisition: (receipt: Promise<Transaction>) => {
			acquisition = receipt
		},
		recordPending: (receipt: Promise<unknown>) => {
			pending = receipt
		},
		recordCommit: (receipt: Promise<Commit>) => {
			commit = receipt
		},
		bindRetainer: (next: RetainDetachedTransaction<Transaction, Commit>) => {
			retainer = next
		},
		clear: () => {
			acquisition = undefined
			pending = undefined
			commit = undefined
			retainer = undefined
		}
	})
}
export function clearTransactionCustody<Transaction, Commit>(
	custody: TransactionCustody<Transaction, Commit>
) {
	custody.clear()
}
/** Capture a synchronous throw as a receipt too: issue may have had side effects before throwing. */
export function transactionCall<Transaction, Commit, Value>(
	custody: TransactionCustody<Transaction, Commit>,
	run: () => Value | PromiseLike<Value>
): Promise<Value> {
	let call: Promise<Value>
	try {
		call = Promise.resolve(run())
	} catch (error) {
		call = Promise.reject(error)
	}
	custody.recordPending(call)
	// A detached receipt may reject before the host attaches its recovery observer.
	void call.catch(() => {})
	return call
}
function handoff<Transaction, Commit>(input: TransactionCustody<Transaction, Commit>) {
	if (input.acquisition === undefined) return
	if (input.retain === undefined) throw new Error('Missing transaction custody recipient')
	input.retain({ acquisition: input.acquisition, pending: input.pending, commit: input.commit })
	clearTransactionCustody(input)
}
export function transactionCustodian<Transaction, Commit>() {
	return createCallbackLogic<
		{
			type: string
		},
		{
			custody: TransactionCustody<Transaction, Commit>
			owner: {
				subscribe(observer: { error: (error: unknown) => void }): {
					unsubscribe(): void
				}
			}
		}
	>(({ input }) => {
		// XState 5.33.2 may orphan invoked children when a machine transition throws.
		// Observe that terminal fact directly; do not depend on a disposer running afterward.
		const subscription = input.owner.subscribe({ error: () => handoff(input.custody) })
		return () => {
			subscription.unsubscribe()
			handoff(input.custody)
		}
	})
}
