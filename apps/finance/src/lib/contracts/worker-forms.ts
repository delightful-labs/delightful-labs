import { z } from 'zod'
import { createWorkerFormViewSchema } from 'delightful-local-first/forms/worker'
import { persistedAccountSchema } from '../validation/accounts.js'
import {
	TRANSACTION_ENTRY_REASON,
	type TransactionEntryObservation
} from './transaction-entry-contract.js'
import type { ArchiveObservation } from '../machines/accounts/account-archive-operation.js'
import type { AccountCreationObservation } from './account-creation-contract.js'
import { appTagSchema } from '../validation/tags.js'
import { appCategorySchema } from '../validation/categories.js'
import { ACCOUNT_CREATION_REASON } from './account-creation-contract.js'

export const workerAccountCreationView = createWorkerFormViewSchema(
	persistedAccountSchema,
	z.enum(ACCOUNT_CREATION_REASON)
)
export type WorkerAccountCreationView = z.output<typeof workerAccountCreationView>
export const workerAccountCreationCommand = z.discriminatedUnion('type', [
	z.strictObject({ type: z.enum(['OPEN', 'RESET', 'CANCEL', 'RETRY_READINESS']) }),
	z.strictObject({ type: z.enum(['SUBMIT', 'CHANGE']), values: z.record(z.string(), z.unknown()) })
])
export type WorkerAccountCreationCommand = z.output<typeof workerAccountCreationCommand>

export const workerTransactionEntryView = createWorkerFormViewSchema(
	z.undefined(),
	z.enum(TRANSACTION_ENTRY_REASON)
)
export type WorkerTransactionEntryView = z.output<typeof workerTransactionEntryView>
export const workerTransactionEntryCommand = z.discriminatedUnion('type', [
	z.strictObject({ type: z.enum(['OPEN', 'RESET', 'CANCEL', 'RETRY_READINESS']) }),
	z.strictObject({
		type: z.enum(['SUBMIT', 'CHANGE']),
		values: z.record(z.string(), z.union([z.string(), z.array(z.string())]))
	})
])
export type WorkerTransactionEntryCommand = z.output<typeof workerTransactionEntryCommand>
export type FinanceFormsObservation = {
	archive: ArchiveObservation
	creation: AccountCreationObservation
	transaction: TransactionEntryObservation
	edit: TransactionEntryObservation
}
export const workerTransactionCategory = appCategorySchema.extend({ id: z.uuid() })

export const workerTagRecord = appTagSchema.extend({ id: z.uuid() })
