import { afterEach, vi } from 'vitest'
import { Transaction } from 'jazz-tools'
import { workspaceCreationTransaction } from './workspace-creation-transaction.js'
import { createAdditionalWorkspaceTransaction } from './workspace-additional-creation-transaction.js'
import { workspaceInitialization } from './workspace-initialization.js'
import { createWorkspacePersistence } from './workspace-creation-persistence.js'
import type { WorkspaceCreationAttempt } from '../../domain/workspace-creation.js'
import { type Organization } from '../../schema.js'
import { createActor } from 'xstate'

export const userId = '11111111-1111-4111-8111-111111111111'
export const profileId = '22222222-2222-4222-8222-222222222222'
export const attempt: WorkspaceCreationAttempt = {
	organizationId: '33333333-3333-4333-8333-333333333333',
	membershipId: '44444444-4444-4444-8444-444444444444',
	profileId,
	workspace: { name: 'Household', kind: 'personal', defaultCurrency: 'USD', ownerId: userId },
	categories: [
		{
			id: '55555555-5555-4555-8555-555555555555',
			name: 'Uncategorized',
			kind: 'expense',
			isSystem: true
		},
		{
			id: '66666666-6666-4666-8666-666666666666',
			name: 'Uncategorized',
			kind: 'income',
			isSystem: true
		}
	]
}
export const workspace: Organization = { ...attempt.workspace, id: attempt.organizationId }
const cleanups: (() => void)[] = []
afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup()
	vi.restoreAllMocks()
})

export function creationFixture() {
	const tx = new Transaction('mergeable', () => {
		throw new Error('Unit fixture must not open a Jazz runtime')
	})
	const one = vi.spyOn(tx, 'one').mockResolvedValue(null)
	one.mockResolvedValueOnce({
		id: profileId,
		userId,
		initialWorkspaceId: null,
		displayName: null,
		avatarData: null,
		avatarMimeType: null
	})
	const all = vi.spyOn(tx, 'all').mockResolvedValue([])
	const insert = vi.spyOn(tx, 'insert').mockReturnValue(workspace)
	const update = vi.spyOn(tx, 'update').mockImplementation(() => {})
	const rollback = vi.spyOn(tx, 'rollback').mockResolvedValue(true)
	// The SDK commit handle is opaque; mock this I/O boundary, not the machine states.
	const wait = vi.fn(async (_options: { tier: 'local' }) => {})
	const commit = vi.spyOn(tx, 'commit').mockImplementation(vi.fn().mockReturnValue({ wait }))
	const beginTransaction = vi.fn(() => tx)
	const beginSerializableTransaction = vi.fn(() => {
		throw new Error('Automatic fake data must be disabled in workspace fixtures')
	})
	const readScope = new Transaction('mergeable', () => {
		throw new Error('Unit fixture must not open a Jazz runtime')
	})
	const hydrate = vi.spyOn(readScope, 'all').mockResolvedValue([])
	hydrate.mockResolvedValueOnce([{ id: profileId, userId }])
	const db = { beginTransaction, beginSerializableTransaction, all: readScope.all.bind(readScope) }
	function transaction(purpose: 'additional' | 'bootstrap' = 'additional') {
		const actor = createActor(workspaceCreationTransaction, { input: { db, attempt, purpose } })
		cleanups.push(() => actor.stop())
		actor.start()
		return actor
	}
	function additionalTransaction() {
		const actor = createActor(createAdditionalWorkspaceTransaction(db), { input: { attempt } })
		cleanups.push(() => actor.stop())
		actor.start()
		return actor
	}
	function persistence(input = attempt) {
		const actor = createActor(createWorkspacePersistence(db), {
			input: { attempt: input, issuance: 'new' }
		})
		cleanups.push(() => actor.stop())
		actor.start()
		return actor
	}
	function initialization() {
		const discover = vi.fn().mockResolvedValue([])
		const getConfig = vi.fn().mockReturnValue({ serverUrl: 'https://unused.invalid' })
		const actor = createActor(workspaceInitialization, {
			input: {
				db: { beginTransaction, beginSerializableTransaction, all: discover, getConfig },
				userId
			}
		})
		cleanups.push(() => actor.stop())
		return { actor, discover, getConfig }
	}

	return {
		initialization,
		update,
		tx,
		one,
		all,
		insert,
		rollback,
		wait,
		commit,
		beginTransaction,
		hydrate,
		db,
		transaction,
		additionalTransaction,
		persistence
	}
}
