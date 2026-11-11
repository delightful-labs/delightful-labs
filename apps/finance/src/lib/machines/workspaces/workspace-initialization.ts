import { createWorkspaceInitialization } from 'delightful-local-first/workspace/initialization'
import { ReadTier } from 'jazz-tools'
import type { getDb } from 'jazz-tools/svelte'
import { app } from '../../schema.js'
import { m } from '#lib/paraglide/messages.js'
import { stableUuid } from '../../domain/stable-uuid.js'
import {
	prepareWorkspaceCreation,
	type WorkspaceCreationAttempt
} from '../../domain/workspace-creation.js'
import {
	workspaceCreationTransaction,
	type WorkspacePersistenceResult
} from './workspace-creation-transaction.js'

type Db = Pick<
	ReturnType<typeof getDb>,
	'all' | 'beginTransaction' | 'beginSerializableTransaction' | 'getConfig'
>
type Input = { db: Db; userId: string }

type ReadInput = Input & { tier: typeof ReadTier.LocalFirst | typeof ReadTier.Remote }
const discover = async (input: ReadInput) => {
	const [profiles, organizations] = await Promise.all([
		input.db.all(app.profiles.where({ userId: input.userId }), { tier: input.tier }),
		// Membership policies, not creator/kind, decide which workspaces are accessible.
		input.db.all(app.organizations.orderBy('id'), { tier: input.tier })
	])
	return {
		identities: profiles,
		workspaces: organizations,
		serverConfigured: Boolean(input.db.getConfig().serverUrl)
	}
}
const prepareInitial = async (input: Input) => {
	const [organizationId, profileId, membershipId] = await Promise.all([
		stableUuid(input.userId, 'personal-organization'),
		stableUuid(input.userId, 'profile'),
		stableUuid(input.userId, 'personal-membership')
	])
	const attempt = await prepareWorkspaceCreation({
		organizationId,
		profileId,
		userId: input.userId,
		name: m['defaults.workspace']()
	})
	// Keep bootstrap membership IDs stable across retries without making this workspace special.
	return { ...attempt, membershipId }
}

export const workspaceInitialization = createWorkspaceInitialization<
	Db,
	ReadInput['tier'],
	WorkspaceCreationAttempt,
	WorkspacePersistenceResult,
	import('xstate').SnapshotFrom<typeof workspaceCreationTransaction>
>({
	tiers: { local: ReadTier.LocalFirst, authority: ReadTier.Remote },
	discover,
	prepareInitial,
	selectReady: (attempt) => ({
		identityId: attempt.profileId,
		workspaceId: attempt.organizationId
	}),
	transaction: workspaceCreationTransaction
})
