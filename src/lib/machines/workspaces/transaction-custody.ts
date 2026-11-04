import { fromCallback } from 'xstate'
import type { RetainDetachedTransaction } from '../../contracts/transaction-custody.js'

/** Native call receipts only; charts decide when confirmed settlement relinquishes custody. */
export type TransactionCustody<Transaction, Commit> = {
	acquisition: Promise<Transaction> | undefined
	pending: Promise<unknown> | undefined
	commit: Promise<Commit> | undefined
	retain: RetainDetachedTransaction<Transaction, Commit> | undefined
}
export function createTransactionCustody<Transaction, Commit>(
	retain?: RetainDetachedTransaction<Transaction, Commit>
): TransactionCustody<Transaction, Commit> {
	return { acquisition: undefined, pending: undefined, commit: undefined, retain }
}
export function clearTransactionCustody<Transaction, Commit>(
	custody: TransactionCustody<Transaction, Commit>
) {
	custody.acquisition = undefined
	custody.pending = undefined
	custody.commit = undefined
	custody.retain = undefined
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
	custody.pending = call
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
	return fromCallback<
		{ type: string },
		{
			custody: TransactionCustody<Transaction, Commit>
			owner: { subscribe(observer: { error: (error: unknown) => void }): { unsubscribe(): void } }
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
