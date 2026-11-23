import assert from 'node:assert/strict'
import {
	createActor,
	createAsyncLogic,
	toPromise,
	type EventFromLogic,
	type SnapshotFrom
} from 'xstate'
import { createWorkspaceInitialization } from 'delightful-local-first/workspace/initialization'

type Attempt = { id: string }
type Persistence = { outcome: 'succeeded'; receipt: string }
const statuses: ('compatible' | 'missing')[] = ['compatible', 'missing']
for (const status of statuses) {
	let writes = 0
	const transaction = createAsyncLogic({
		run: async ({ input }: { input: { db: object; attempt: Attempt } }): Promise<Persistence> => {
			assert.equal(input.attempt.id, 'owner')
			writes++
			return { outcome: 'succeeded', receipt: 'local-receipt' }
		}
	})
	const initialize = createWorkspaceInitialization<
		object,
		string,
		Attempt,
		Persistence,
		SnapshotFrom<typeof transaction>,
		EventFromLogic<typeof transaction>
	>({
		tiers: { local: 'local', authority: 'authority' },
		discover: async ({ userId }) => ({ canonicalRoot: { id: userId, status } }),
		prepareInitial: async ({ userId }) => ({ id: userId }),
		selectReady: (attempt) => ({ identityId: attempt.id, workspaceId: attempt.id }),
		transaction
	})
	const actor = createActor(initialize, { input: { db: {}, userId: 'owner' } }).start()
	try {
		assert.deepEqual(await toPromise(actor), {
			outcome: 'ready',
			identityId: 'owner',
			workspaceId: 'owner',
			...(status === 'missing'
				? { persistence: { outcome: 'succeeded', receipt: 'local-receipt' } }
				: {})
		})
		assert.equal(writes, status === 'missing' ? 1 : 0)
	} finally {
		actor.stop()
	}
}
