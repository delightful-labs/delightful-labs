import type { Db as JazzDb } from 'jazz-tools'
import { debugEnabled } from '../../diagnostics/logger.js'
import { fakeTransactionDescription } from '../../domain/fake-data.js'
import { PAYMENT_METHOD } from '../../domain/payment-method.js'
import type { TransactionKind } from '../../domain/transaction-kind.js'
import type { FinanceFormsObservation } from '../../contracts/worker-forms.js'
import { independentTransactionFormSchema } from '../../validation/transactions.js'
import {
	createTransactionEntryFormOptions,
	transactionEntryScope,
	sameTransactionEntryScope,
	writableTransactionAccounts,
	applicableTransactionCategories
} from '../transactions/transaction-entry.js'
import { createSampleTransactionsMachine } from './sample-transactions.js'

/** Bind the existing batch chart to the same SDK and current authorization facts as manual entry. */
export function createWorkerSamples(
	db: Pick<JazzDb, 'all' | 'beginTransaction'>,
	kind: TransactionKind,
	observe: () => FinanceFormsObservation
) {
	const facts = () => ({ ...observe().transaction, kind })
	const creation = createTransactionEntryFormOptions({ binding: db, db, observe: facts })
	return createSampleTransactionsMachine({
		logic: creation.operation,
		prepare: (index, scope) => {
			const observation = facts(),
				selected = observe().sampleSelectedAccounts
			if (
				!debugEnabled ||
				!scope ||
				!sameTransactionEntryScope(transactionEntryScope(observation), scope) ||
				JSON.stringify(scope.accountIds) !== JSON.stringify(selected)
			)
				throw new Error('Sample scope changed')
			const account = writableTransactionAccounts(observation).find(
				(account) => selected === null || selected.includes(account.id)
			)
			const category = applicableTransactionCategories(observation)[0]
			const date = new Date()
			date.setDate(date.getDate() - Math.floor(index / 5))
			const bookedOn = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
			const values = independentTransactionFormSchema(() => ({
				...observation,
				accounts: writableTransactionAccounts(observation)
			})).parse({
				accountId: account?.id,
				categoryId: category?.id,
				bookedOn,
				amount: `${Math.floor((100 + index * 137) / 100)}.${String((100 + index * 137) % 100).padStart(2, '0')}`,
				paymentMethod: PAYMENT_METHOD.CASH,
				description: fakeTransactionDescription(),
				tags: []
			})
			return {
				request: { id: index, scopeRevision: 0, scope: transactionEntryScope(observation), values },
				observation: { revision: index, facts: observation }
			}
		},
		result: (output) => output,
		recipient: (actor) => actor
	})
}
