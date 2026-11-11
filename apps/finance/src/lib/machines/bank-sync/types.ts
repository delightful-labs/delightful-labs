export { bankObservation } from './availability.js'
import type { schema } from 'jazz-tools'
import type { getDb } from 'jazz-tools/svelte'
import type { Account, OrganizationMember, app } from '#lib/schema.js'
import type { BankTrace } from '#lib/integrations/diagnostics.js'
import type { CredentialScope } from '#lib/validation/integrations.js'
import type { fetchAccounts } from '#lib/integrations/simplefin.js'

export type Connection = schema.RowOf<typeof app.simplefinConnections>
export type ProviderSummary = {
	id: string
	name: string
	currency: string
	availableBalance?: string
	balanceDate?: Date
}
export type ImportCounts = { imported: number; existing: number; omitted: number }
export type ImportSettlement = 'settled' | 'unresolved'
export type AccountImportReport = {
	account: Pick<Account, 'id' | 'name'> | undefined
	kind: 'complete' | 'failed' | 'cancelled'
	counts: ImportCounts
	settlement: ImportSettlement
}
export type ImportOutcome =
	| { kind: 'complete'; counts: ImportCounts; error: undefined; settlement: 'settled' }
	| {
			kind: 'cancelled' | 'failed'
			counts: ImportCounts
			error: unknown
			settlement: ImportSettlement
	  }

export type ImportResult = ImportOutcome & { accountResults: readonly AccountImportReport[] }
export type ProviderResponse = Awaited<ReturnType<typeof fetchAccounts>>
export type BankCommand =
	| { type: 'DISCOVER' }
	| { type: 'SYNC' }
	| { type: 'RECONNECT' }
	| { type: 'MAP'; providerId: string; accountId: string }
	| { type: 'CREATE_ACCOUNT'; providerId: string }
	| { type: 'DISCONNECT' }
export type BankEvent =
	| BankCommand
	| { type: 'CONNECT'; token: string }
	| { type: 'TEST_ENCRYPTION' }
	| { type: 'VERIFY_DECRYPTION' }
	| { type: 'SAVE_CONNECTION' }
	| { type: 'CANCEL' }
	| { type: 'RESET' }
export type ProgressEvent = { type: 'IMPORT_PROGRESS'; counts: ImportCounts }
export { bankSetupSteps } from '#lib/contracts/bank-presentation-contract.js'
export type {
	BankSetupView,
	BankStatus,
	BankStatusKey,
	LastSync
} from '#lib/contracts/bank-presentation-contract.js'
import type { BankSetupView, BankStatus } from '#lib/contracts/bank-presentation-contract.js'
export type BankViewMeta = {
	status?: BankStatus
	setupStep?: number
	setupView?: BankSetupView
	loadingProvider?: boolean
}
// Metadata is a presentation projection of active states, never stored workflow state.
export function bankViewMetadata(
	...snapshots: ({ getMeta: () => Record<string, BankViewMeta | undefined> } | undefined)[]
): BankViewMeta {
	return snapshots.reduce<BankViewMeta>(
		(view, snapshot) =>
			Object.values(snapshot?.getMeta() ?? {}).reduce<BankViewMeta>(
				(combined, metadata) => ({ ...combined, ...metadata }),
				view
			),
		{}
	)
}
export type LockEvent = { type: 'LOCK_ACQUIRED' } | { type: 'LOCK_FAILED'; error: unknown }
export type Result<Value> = { ok: true; value: Value } | { ok: false; error: unknown }
export type Observation = {
	organizationId: string | null
	userId: string | undefined
	allowed: boolean
	connected: boolean
	sessionReady: boolean
	connection: Connection | undefined
}
export type RequestIdentity = Pick<Observation, 'userId' | 'organizationId'>
export type Dependencies = {
	db: ReturnType<typeof getDb>
	observe: () => Observation
	passkeyName: () => string
}
export type OperationWork = {
	command: BankCommand
	current: Connection
	scope: CredentialScope
	trace: BankTrace
	attemptAt: Date
}
export type AuthorizationRequest = {
	scope: CredentialScope
	requireConnection: boolean
	expectedCiphertext: string | undefined
}
export function credentialAuthorization(work: OperationWork): AuthorizationRequest {
	return {
		scope: work.scope,
		requireConnection: true,
		expectedCiphertext: work.current.ciphertext ?? undefined
	}
}
export function emptyCounts(): ImportCounts {
	return { imported: 0, existing: 0, omitted: 0 }
}
export function bankErrorCode(error: unknown) {
	return error instanceof Error &&
		[
			'mode_mismatch',
			'passkey_failure',
			'claim_failure',
			'invalid_setup_token',
			'account_already_linked',
			'save_failure',
			'other_tab',
			'locking_unavailable',
			'unlock_failure',
			'provider_failure',
			'mapping'
		].includes(error.message)
		? error.message
		: 'failure'
}

export type BankEnvironment = {
	scopeKey: string
	credentialFingerprint: string
	allowed: boolean
	connected: boolean
	connectionActive: boolean
}
export function bankCredentialFingerprint(connection: BankCredential | undefined): string {
	return JSON.stringify([
		connection?.id,
		connection?.status,
		connection?.ciphertext,
		connection?.credentialId,
		connection?.prfSalt,
		connection?.iv,
		connection?.credentialVersion
	])
}
export function bankEnvironment(
	current: Omit<Observation, 'connection'> & { connection: BankCredential | undefined }
): BankEnvironment {
	const connection = current.connection
	return {
		scopeKey: JSON.stringify([
			current.userId,
			current.organizationId,
			current.allowed,
			current.sessionReady
		]),
		credentialFingerprint: bankCredentialFingerprint(connection),
		allowed: current.allowed,
		connected: current.connected,
		connectionActive: current.connection?.status === 'active'
	}
}

export type BankSource = {
	organizationId: string | null
	userId: string | undefined
	sessionReady: boolean
	membership: OrganizationMember | null | undefined
	connections: readonly Connection[]
	accounts: readonly Account[]
	links: readonly schema.RowOf<typeof app.simplefinAccountLinks>[]
}
export type BankSyncDependencies = Omit<Dependencies, 'observe'> & { read: () => BankSource }
export type BankCredential = Pick<
	Connection,
	| 'id'
	| 'organizationId'
	| 'ownerId'
	| 'status'
	| 'ciphertext'
	| 'credentialId'
	| 'prfSalt'
	| 'iv'
	| 'credentialVersion'
>
export type BankHistoryRecord = Pick<
	Connection,
	'id' | 'lastSyncAt' | 'lastOutcome' | 'importedCount' | 'existingCount' | 'omittedCount'
>
export type BankAccess =
	| {
			kind: 'allowed'
			organizationId: string
			userId: string
	  }
	| { kind: 'waiting' | 'restricted'; organizationId: string | null; userId: string | undefined }
export type BankObservationEvent =
	| { type: 'WORKSPACE_ACCESS_CHANGED'; revision: number; access: BankAccess }
	| { type: 'CONNECTIONS_CHANGED'; revision: number; connections: readonly BankCredential[] }
	| { type: 'MAPPING_DATA_CHANGED'; revision: number; data: BankData }
	| { type: 'HISTORY_CHANGED'; revision: number; records: readonly BankHistoryRecord[] }
export type BankData = {
	accounts: readonly Account[]
	mappings: ReadonlyMap<string, string>
}
export function bankData(
	source: Pick<BankSource, 'organizationId' | 'accounts' | 'links'>
): BankData {
	return {
		accounts: source.accounts.filter(
			(account) => account.organizationId === source.organizationId && !account.archivedAt
		),
		mappings: new Map(
			source.links
				.filter((link) => link.organizationId === source.organizationId)
				.map((link) => [link.simplefinAccountId, link.accountId])
		)
	}
}
