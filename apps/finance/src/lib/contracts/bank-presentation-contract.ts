import type { SyncLogOutput } from './bank-sync-log.js'
import { m } from '#lib/paraglide/messages.js'
import type { Account, SyncAttempt, SyncAccountResult } from '../queries.js'
import type { Connection } from '../machines/bank-sync/types.js'
export type BankSetupView =
	| 'creating'
	| 'test-encryption'
	| 'encrypting'
	| 'test-decryption'
	| 'verifying'
	| 'save'
	| 'saving'
import type { z } from 'zod'
import type { bankStatusKey, bankMessage } from './worker-banks.js'
export type BankStatusKey = z.output<typeof bankStatusKey>
type SetupStep = { id: string; label: () => string }
export const bankSetupSteps = [
	{ id: 'token', label: () => m['bank.step_token']() },
	{
		id: 'create',
		label: () => m['actions.create_subject']({ subject: m['nouns.passkey']({ count: 1 }) })
	},
	{ id: 'encrypt', label: () => m['bank.step_encrypt']() },
	{ id: 'verify', label: () => m['bank.step_verify']() },
	{ id: 'connect', label: () => m['bank.step_connect']() }
] satisfies [SetupStep, ...SetupStep[]]
export type BankMessage = z.output<typeof bankMessage>
export type BankStatus = { key: BankStatusKey }
export type LastSync = {
	time: Date
	outcomeKey: 'bank.succeeded' | 'bank.partial' | 'bank.failed'
	imported: number
	existing: number
	omitted: number
}

export type ProviderAccountView = {
	id: string
	name: string
	currency: string
	mapping: { kind: 'linked'; account: Account } | { kind: 'broken' } | { kind: 'unmapped' }
	selectedAccountId: string
	availableAccounts: readonly Account[]
	showExisting: boolean
}
export type BankPresentation = {
	logging?: SyncLogOutput | undefined
	mode:
		| { kind: 'restricted' }
		| { kind: 'setup'; step: number; stage: BankSetupView | null }
		| { kind: 'connected'; recovery: 'available' }
	activity: { kind: 'idle' } | { kind: 'working'; indicator: 'provider' | 'general' }
	status: BankStatus | undefined
	history: LastSync | undefined
	providerAccounts: readonly ProviderAccountView[]
}

export type BankLogPresentation = {
	connections: readonly (Pick<Connection, 'id' | 'ownerId' | 'claimedAt'> & {
		status: BankMessage
	})[]
	attempts: readonly (Omit<SyncAttempt, 'outcome' | 'importSettlement' | 'failureCode'> & {
		outcome: BankMessage
		importSettlement: BankMessage
		failure: BankMessage | undefined
	})[]
	accounts: readonly (Omit<SyncAccountResult, 'outcome' | 'failureCode'> & {
		outcome: BankMessage
		failure: BankMessage | undefined
	})[]
}
