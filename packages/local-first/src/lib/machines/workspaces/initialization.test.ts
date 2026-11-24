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
type Persistence =
	| { outcome: 'succeeded'; receipt: object }
	| { outcome: 'failed'; settlement: 'rejected' | 'unresolved'; error: unknown }
type Db = { label: string }
const actors = new Set<{ stop(): void }>()
afterEach(() => {
	for (const actor of actors) actor.stop()
	actors.clear()
})
function fixture(
	records: InitializationRecords,
	target: Attempt = { identityId: 'owner', workspaceId: 'owner' },
	reconcileBootstrap?: (result: Persistence) => 'notStarted' | 'rejected' | undefined
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
		transaction,
		...(reconcileBootstrap ? { reconcileBootstrap } : {})
	})
	const actor = createActor(machine, {
		input: { db: { label: 'native-scope' }, userId: 'owner' }
	}).start()
	actors.add(actor)
	return { actor, discover, prepareInitial, persist, completion }
}

it.each(['compatible', 'missing', 'incompatible'] satisfies (
	| 'compatible'
	| 'missing'
	| 'incompatible'
)[])(
	'rediscovers a definitive rejected bootstrap once and admits only the original compatible canonical target: %s',
	async (status) => {
		const f = fixture({ canonicalRoot: { id: 'owner', status: 'missing' } }, undefined, (result) =>
			result.outcome === 'failed' && result.settlement === 'rejected' ? 'rejected' : undefined
		)
		await vi.waitFor(() => expect(f.persist).toHaveBeenCalledOnce())
		f.discover.mockResolvedValue({ canonicalRoot: { id: 'owner', status } })
		const rejected: Persistence = {
			outcome: 'failed',
			settlement: 'rejected',
			error: new Error('concurrent bootstrap')
		}
		f.completion.resolve(rejected)
		const output = await toPromise(f.actor)
		expect(output).toEqual(
			status === 'compatible'
				? { outcome: 'ready', identityId: 'owner', workspaceId: 'owner', persistence: rejected }
				: rejected
		)
		expect(f.discover).toHaveBeenCalledTimes(2)
		expect(f.persist).toHaveBeenCalledOnce()
	}
)

it('does not adopt a different initialization marker during post-conflict rediscovery', async () => {
	const f = fixture(
		{ canonicalRoot: { id: 'owner', status: 'missing' } },
		undefined,
		() => 'rejected'
	)
	await vi.waitFor(() => expect(f.persist).toHaveBeenCalledOnce())
	f.discover.mockResolvedValue({
		identities: [{ id: 'other', initialWorkspaceId: 'other-root' }],
		workspaces: [],
		serverConfigured: true
	})
	const rejected: Persistence = {
		outcome: 'failed',
		settlement: 'rejected',
		error: new Error('concurrent bootstrap')
	}
	f.completion.resolve(rejected)
	expect(await toPromise(f.actor)).toEqual(rejected)
	expect(f.persist).toHaveBeenCalledOnce()
})

it('retains definitive rejection across shutdown during rediscovery and ignores its late answer', async () => {
	const f = fixture(
		{ canonicalRoot: { id: 'owner', status: 'missing' } },
		undefined,
		() => 'rejected'
	)
	await vi.waitFor(() => expect(f.persist).toHaveBeenCalledOnce())
	const answer = deferred<InitializationRecords>()
	f.discover.mockReturnValue(answer.promise)
	const rejected: Persistence = {
		outcome: 'failed',
		settlement: 'rejected',
		error: new Error('concurrent bootstrap')
	}
	f.completion.resolve(rejected)
	await vi.waitFor(() => expect(f.discover).toHaveBeenCalledTimes(2))
	f.actor.send({ type: 'SHUTDOWN' })
	expect(await toPromise(f.actor)).toEqual({
		outcome: 'closed',
		settlement: 'rejected',
		persistence: rejected
	})
	answer.resolve({ canonicalRoot: { id: 'owner', status: 'compatible' } })
	expect(f.actor.getSnapshot().output).toEqual({
		outcome: 'closed',
		settlement: 'rejected',
		persistence: rejected
	})
	expect(f.persist).toHaveBeenCalledOnce()
})

it.each(['SHUTDOWN', 'CANCEL'] satisfies ('SHUTDOWN' | 'CANCEL')[])(
	'does not begin conflict rediscovery after %s while an admitted write settles',
	async (type) => {
		const reconcile = vi.fn((): 'rejected' => 'rejected')
		const f = fixture({ canonicalRoot: { id: 'owner', status: 'missing' } }, undefined, reconcile)
		await vi.waitFor(() => expect(f.persist).toHaveBeenCalledOnce())
		f.actor.send({ type })
		const rejected: Persistence = {
			outcome: 'failed',
			settlement: 'rejected',
			error: new Error('concurrent bootstrap')
		}
		f.completion.resolve(rejected)
		expect(await toPromise(f.actor)).toEqual(rejected)
		expect(reconcile).not.toHaveBeenCalled()
		expect(f.discover).toHaveBeenCalledOnce()
		expect(f.persist).toHaveBeenCalledOnce()
	}
)

it('does not rediscover or reissue a bootstrap whose outcome is unresolved', async () => {
	const f = fixture({ canonicalRoot: { id: 'owner', status: 'missing' } }, undefined, (result) =>
		result.outcome === 'failed' && result.settlement === 'rejected' ? 'rejected' : undefined
	)
	await vi.waitFor(() => expect(f.persist).toHaveBeenCalledOnce())
	const unresolved: Persistence = {
		outcome: 'failed',
		settlement: 'unresolved',
		error: new Error('unknown remote fate')
	}
	f.completion.resolve(unresolved)
	expect(await toPromise(f.actor)).toEqual(unresolved)
	expect(f.discover).toHaveBeenCalledOnce()
	expect(f.persist).toHaveBeenCalledOnce()
})

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
