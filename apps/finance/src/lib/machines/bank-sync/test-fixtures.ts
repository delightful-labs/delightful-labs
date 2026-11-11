import { vi } from 'vitest'
import type { Account } from '#lib/schema.js'
import type { BankSource, Connection, Dependencies, Observation } from './types.js'

export const id = (value: number) =>
	`00000000-0000-4000-8000-${value.toString(16).padStart(12, '0')}`
export const connection: Connection = {
	id: id(3),
	organizationId: id(2),
	ownerId: id(1),
	status: 'active',
	accessUrl: '',
	credentialVersion: 1,
	credentialId: 'credential',
	prfSalt: 'salt',
	iv: 'iv',
	ciphertext: 'ciphertext',
	lastOutcome: null,
	importedCount: null,
	existingCount: null,
	omittedCount: null,
	lastSyncAt: null,
	lastError: null,
	claimedAt: new Date('2026-10-17T00:00:00Z')
}
export const account: Account = {
	id: id(4),
	organizationId: id(2),
	name: 'Checking',
	kind: 'bank',
	currency: 'USD',
	archivedAt: null
}
export const source: BankSource = {
	userId: id(1),
	organizationId: id(2),
	sessionReady: true,
	membership: {
		id: id(5),
		profileId: null,
		userId: id(1),
		organizationId: id(2),
		role: 'owner',
		accountAccessMode: 'all'
	},
	connections: [connection],
	accounts: [account],
	links: []
}
export const observation: Observation = {
	userId: id(1),
	organizationId: id(2),
	sessionReady: true,
	allowed: true,
	connected: true,
	connection
}
export const dependencies = (observe = () => observation): Dependencies => ({
	db: vi.fn<() => Dependencies['db']>()(),
	observe,
	passkeyName: () => 'Test'
})
