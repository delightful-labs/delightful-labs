import { afterEach, expect, it, vi } from 'vitest'
import {
	createActor,
	createAsyncLogic,
	toPromise,
	type EventFromLogic,
	type SnapshotFrom
} from 'xstate'
import { createWorkspaceInitialization, type InitializationRecords } from './initialization.js'
import { deferred } from '../../../../tests/helpers/deferred.js'

type Attempt = { identityId: string; workspaceId: string }
type Persistence = { outcome: 'succeeded'; receipt: object }
type Db = { label: string }
const actors = new Set<{ stop(): void }>()
afterEach(() => {
	for (const actor of actors) actor.stop()
	actors.clear()
})
function fixture(
	records: InitializationRecords,
	target: Attempt = { identityId: 'owner', workspaceId: 'owner' }
) {
	const completion = deferred<Persistence>()
	const discover = vi.fn(async () => records)
	const prepareInitial = vi.fn(async () => target)
	const persist = vi.fn((_input: { db: Db; attempt: Attempt }) => completion.promise)
	const transaction = createAsyncLogic({
		run: ({ input }: { input: { db: Db; attempt: Attempt } }) => persist(input)
	})
	const machine = createWorkspaceInitialization<
		Db,
		string,
		Attempt,
		Persistence,
		SnapshotFrom<typeof transaction>,
		EventFromLogic<typeof transaction>
	>({
		tiers: { local: 'local', authority: 'authority' },
		discover,
		prepareInitial,
		selectReady: (attempt) => attempt,
		transaction
	})
	const actor = createActor(machine, {
		input: { db: { label: 'native-scope' }, userId: 'owner' }
	}).start()
	actors.add(actor)
	return { actor, discover, prepareInitial, persist, completion }
}

it('opens canonical local evidence without preparing a write or querying authority', async () => {
	const f = fixture({ canonicalRoot: { id: 'owner', status: 'compatible' } })
	expect(await toPromise(f.actor)).toEqual({
		outcome: 'ready',
		identityId: 'owner',
		workspaceId: 'owner'
	})
	expect(f.discover).toHaveBeenCalledOnce()
	expect(f.prepareInitial).not.toHaveBeenCalled()
	expect(f.persist).not.toHaveBeenCalled()
})

it('ensures only the canonical root and retains its exact receipt after local settlement', async () => {
	const f = fixture({ canonicalRoot: { id: 'owner', status: 'missing' } })
	await vi.waitFor(() => expect(f.persist).toHaveBeenCalledOnce())
	expect(f.discover).toHaveBeenCalledOnce()
	expect(f.persist.mock.calls[0]?.[0].attempt).toEqual({
		identityId: 'owner',
		workspaceId: 'owner'
	})
	expect(f.actor.getSnapshot().status).toBe('active')
	const persistence: Persistence = { outcome: 'succeeded', receipt: Object.freeze({}) }
	f.completion.resolve(persistence)
	expect(await toPromise(f.actor)).toEqual({
		outcome: 'ready',
		identityId: 'owner',
		workspaceId: 'owner',
		persistence
	})
})

it.each([
	{ id: '', status: 'missing' },
	{ id: 'other', status: 'missing' },
	{ id: 'other', status: 'compatible' },
	{ id: 'owner', status: 'incompatible' }
] satisfies NonNullable<InitializationRecords['canonicalRoot']>[])(
	'refuses canonical root $id/$status without issuing a write',
	async (canonicalRoot) => {
		const f = fixture({ canonicalRoot })
		expect(await toPromise(f.actor)).toEqual({
			outcome: 'unavailable',
			reason: 'canonicalRootConflict'
		})
		expect(f.prepareInitial).not.toHaveBeenCalled()
		expect(f.persist).not.toHaveBeenCalled()
	}
)

it.each([
	{ identityId: 'other', workspaceId: 'owner' },
	{ identityId: 'owner', workspaceId: 'other' }
])('refuses a prepared target outside the native canonical identity: %j', async (target) => {
	const f = fixture({ canonicalRoot: { id: 'owner', status: 'missing' } }, target)
	expect(await toPromise(f.actor)).toEqual({
		outcome: 'unavailable',
		reason: 'canonicalRootConflict'
	})
	expect(f.prepareInitial).toHaveBeenCalledOnce()
	expect(f.persist).not.toHaveBeenCalled()
})

it.each(['SHUTDOWN', 'CANCEL'] satisfies ('SHUTDOWN' | 'CANCEL')[])(
	'retains an admitted noncancelable write and its receipt through %s',
	async (type) => {
		const f = fixture({ canonicalRoot: { id: 'owner', status: 'missing' } })
		await vi.waitFor(() => expect(f.persist).toHaveBeenCalledOnce())
		f.actor.send({ type })
		expect(f.actor.getSnapshot().status).toBe('active')
		const persistence: Persistence = { outcome: 'succeeded', receipt: Object.freeze({}) }
		f.completion.resolve(persistence)
		expect(await toPromise(f.actor)).toEqual({
			outcome: type === 'SHUTDOWN' ? 'closed' : 'cancelled',
			settlement: 'locallyPersisted',
			persistence
		})
	}
)

it('preserves shutdown intent when it follows cancellation and precedes write completion', async () => {
	const f = fixture({ canonicalRoot: { id: 'owner', status: 'missing' } })
	await vi.waitFor(() => expect(f.persist).toHaveBeenCalledOnce())
	f.actor.send({ type: 'CANCEL' })
	f.actor.send({ type: 'SHUTDOWN' })
	f.actor.send({ type: 'CANCEL' })
	f.actor.send({ type: 'SHUTDOWN' })
	const persistence: Persistence = { outcome: 'succeeded', receipt: Object.freeze({}) }
	f.completion.resolve(persistence)
	expect(await toPromise(f.actor)).toEqual({
		outcome: 'closed',
		settlement: 'locallyPersisted',
		persistence
	})
	expect(f.persist).toHaveBeenCalledOnce()
})

it('keeps empty directory replicas conservative when no canonical schema is configured', async () => {
	const f = fixture({ identities: [], workspaces: [], serverConfigured: false })
	expect(await toPromise(f.actor)).toEqual({
		outcome: 'unavailable',
		reason: 'authorityUnavailable'
	})
	expect(f.prepareInitial).not.toHaveBeenCalled()
	expect(f.persist).not.toHaveBeenCalled()
})
