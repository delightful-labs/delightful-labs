import {
	createAsyncLogic,
	type EventFromLogic,
	type InputFrom,
	type OutputFrom,
	type SnapshotFrom
} from 'xstate'
import { createWorkspaceInitialization } from 'delightful-local-first/workspace/initialization'
import { createWorkspaceStartupOwner } from 'delightful-local-first/workspace/startup'
import type { RootAccess, RootWrite } from '../../contracts/account.js'

type Attempt = { id: string }
type Persistence =
	| { outcome: 'succeeded'; write: RootWrite }
	| { outcome: 'failed'; settlement: 'unresolved'; write: RootWrite; error: unknown }

// One canonical upsert and its local durability receipt. Shared initialization owns interruption.
const persistRoot = createAsyncLogic({
	run: async ({ input }: { input: { db: RootAccess; attempt: Attempt } }): Promise<Persistence> => {
		const write = input.db.ensure()
		try {
			await write.local()
			return { outcome: 'succeeded', write }
		} catch (error) {
			return { outcome: 'failed', settlement: 'unresolved', write, error }
		}
	}
})

/** Clipper supplies schema-bound storage leaves; Finance uses this same initializer factory. */
export const rootBootstrapMachine = createWorkspaceInitialization<
	RootAccess,
	undefined,
	Attempt,
	Persistence,
	SnapshotFrom<typeof persistRoot>,
	EventFromLogic<typeof persistRoot>
>({
	tiers: { local: undefined, authority: undefined },
	discover: async ({ db, userId }) => ({
		canonicalRoot: { id: userId, status: await db.read() }
	}),
	prepareInitial: async ({ userId }) => ({ id: userId }),
	selectReady: (attempt) => ({ identityId: attempt.id, workspaceId: attempt.id }),
	transaction: persistRoot
})

export type RootInitializationResult = OutputFrom<typeof rootBootstrapMachine>

/** Startup reports and terminal drain receipts use the same owner as Finance. */
export const rootStartupMachine = createWorkspaceStartupOwner<
	InputFrom<typeof rootBootstrapMachine>,
	RootInitializationResult,
	SnapshotFrom<typeof rootBootstrapMachine>
>({
	initialize: rootBootstrapMachine,
	provenance: (result) =>
		result.outcome === 'ready'
			? { identityId: result.identityId, initialWorkspaceId: result.workspaceId }
			: undefined
})
