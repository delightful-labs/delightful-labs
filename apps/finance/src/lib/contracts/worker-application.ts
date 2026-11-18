import { z } from 'zod'
import { appAccountSchema, persistedAccountSchema } from '../validation/accounts.js'
import { appWorkspaceSchema } from '../validation/identity.js'
import type { SessionRuntimeConnection } from 'delightful-local-first/session/runtime'
import type { ArchiveObservation } from '../machines/accounts/account-archive-operation.js'
import { accountArchiveFeedback } from './account-archive-feedback.js'
import { workerAccountCreationCommand, workerAccountCreationView } from './worker-forms.js'
import type { AccountCreationObservation } from './account-creation-contract.js'
import type { createFinanceFormsMachine } from '../machines/runtime/worker-forms.js'

export const workerSelection = z.strictObject({
	workspaceId: z.uuid().nullable(),
	revision: z.number().int().nonnegative().safe()
})
const sessionRevision = z.number().int().nonnegative().safe()
export const workerAccount = appAccountSchema
	.pick({ name: true, kind: true, currency: true })
	.extend({ id: z.uuid() })
export const workerWorkspace = appWorkspaceSchema
	.pick({ name: true, defaultCurrency: true })
	.extend({ id: z.uuid() })
export const financeWorkerCommand = z.discriminatedUnion('type', [
	z.strictObject({ type: z.literal('SELECT_WORKSPACE'), selection: workerSelection }),
	z.strictObject({
		type: z.literal('ARCHIVE_ACCOUNT'),
		sessionRevision,
		selection: workerSelection,
		accountId: z.uuid()
	}),
	z.strictObject({
		type: z.literal('ACCOUNT_CREATION'),
		sessionRevision,
		selection: workerSelection,
		command: workerAccountCreationCommand
	}),
	z.strictObject({ type: z.literal('CLOSE') })
])
export const financeWorkerOpen = z.strictObject({
	type: z.literal('OPEN'),
	serverUrl: z.url().max(8192),
	scope: z.string().trim().min(1).max(8192),
	environment: z.string().min(1).max(8192)
})
export const financeWorkerView = z.strictObject({
	type: z.literal('VIEW'),
	sessionRevision,
	selection: workerSelection,
	status: z.enum(['starting', 'signed-out', 'loading', 'ready', 'failed', 'closing', 'closed']),
	identityId: z.uuid().nullable(),
	workspaces: z.array(workerWorkspace).nullable(),
	accounts: z.array(
		workerAccount.extend({
			archiveAction: z.enum(['available', 'archiving', 'disabled', 'unavailable'])
		})
	),
	archiveFeedback: accountArchiveFeedback.nullable(),
	accountCreation: workerAccountCreationView.nullable()
})
export const financeWorkerReply = z.discriminatedUnion('type', [
	financeWorkerView,
	z.strictObject({ type: z.literal('CLOSED') }),
	z.strictObject({ type: z.literal('FAILED') })
])
export type WorkerAccount = z.infer<typeof workerAccount>
export type WorkerAccountRecord = z.output<typeof persistedAccountSchema>
export type WorkerWorkspace = z.infer<typeof workerWorkspace>
export type WorkerSelection = z.infer<typeof workerSelection>
export type FinanceWorkerView = z.infer<typeof financeWorkerView>
export type WorkerCommandScope = Pick<FinanceWorkerView, 'sessionRevision' | 'selection'>
export type FinanceWorkerCommand = z.infer<typeof financeWorkerCommand>
export type FinanceWorkerOpen = z.infer<typeof financeWorkerOpen>
export type FinanceWorkerCapabilities = {
	observeWorkspaces(publish: (rows: WorkerWorkspace[]) => void, failed: () => void): () => void
	observeAccounts(
		workspaceId: string,
		publish: (rows: WorkerAccountRecord[]) => void,
		failed: () => void
	): () => void
	observeMembership(
		workspaceId: string,
		publish: (row: ArchiveObservation['membership']) => void,
		failed: () => void
	): () => void
	observeGrants(
		workspaceId: string,
		publish: (rows: ArchiveObservation['grants']) => void,
		failed: () => void
	): () => void
	archiveAccount(accountId: string): Promise<unknown>
	createForms(
		observe: () => AccountCreationObservation
	): ReturnType<typeof createFinanceFormsMachine>
}
export type FinanceWorkerSession = SessionRuntimeConnection<FinanceWorkerCapabilities>
