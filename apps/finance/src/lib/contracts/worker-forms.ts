import { z } from 'zod'
import { createWorkerFormViewSchema } from 'delightful-local-first/forms/worker'
import { persistedAccountSchema } from '../validation/accounts.js'
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
