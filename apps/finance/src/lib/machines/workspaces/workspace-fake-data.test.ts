import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { seedFixture } from '../samples/fake-data.fixture.js'
import { createActor, toPromise, waitFor } from 'xstate'

beforeEach(() => vi.resetModules())
afterEach(() => vi.restoreAllMocks())

it.each([
	{ seed: 'false', debug: 'false', writes: 0 },
	{ seed: 'false', debug: 'true', writes: 0 },
	{ seed: 'true', debug: 'false', writes: 123 },
	{ seed: 'true', debug: 'true', writes: 123 }
])('seeding=$seed is independent of debugging=$debug', async ({ seed, debug, writes }) => {
	vi.stubEnv('PUBLIC_FAKE_DATA', seed)
	vi.stubEnv('PUBLIC_DEBUG', debug)
	const { workspaceFakeData } = await import('./workspace-fake-data.js')
	const f = seedFixture()
	expect(await toPromise(createActor(workspaceFakeData, { input: f.input }).start())).toEqual(
		writes === 0
			? { outcome: 'skipped', settlement: 'notStarted' }
			: { outcome: 'seeded', settlement: 'confirmed', accountCount: 3, transactionCount: 120 }
	)
	expect(f.insert).toHaveBeenCalledTimes(writes)
	if (writes === 0) expect(f.all).not.toHaveBeenCalled()
})

it('preserves confirmed settlement while draining shutdown through the child', async () => {
	vi.stubEnv('PUBLIC_FAKE_DATA', 'true')
	const { workspaceFakeData } = await import('./workspace-fake-data.js')
	const f = seedFixture()
	const confirmation = Promise.withResolvers<void>()
	f.wait.mockReturnValue(confirmation.promise)
	const actor = createActor(workspaceFakeData, { input: f.input }).start()
	await vi.waitFor(() => expect(f.wait).toHaveBeenCalledOnce())
	actor.send({ type: 'SHUTDOWN' })
	expect(actor.getSnapshot().status).toBe('active')
	confirmation.resolve()
	expect(await toPromise(actor)).toEqual({ outcome: 'closed', settlement: 'confirmed' })
})

it('returns child failure without disguising it as initialized', async () => {
	vi.stubEnv('PUBLIC_FAKE_DATA', 'true')
	const { workspaceFakeData } = await import('./workspace-fake-data.js')
	const f = seedFixture()
	const failure = new Error('Read failed')
	f.all.mockReset().mockRejectedValue(failure)
	const actor = createActor(workspaceFakeData, { input: f.input }).start()
	await waitFor(actor, (snapshot) => snapshot.status === 'done')
	expect(await toPromise(actor)).toEqual({
		outcome: 'failed',
		settlement: 'notStarted',
		error: failure
	})
})

it('keeps the shared worker seed owner idle until initialization and honors disabled seed policy', async () => {
	vi.stubEnv('PUBLIC_FAKE_DATA', 'false')
	const { workerWorkspaceSeed } = await import('./workspace-fake-data.js')
	const f = seedFixture()
	const actor = createActor(workerWorkspaceSeed, {
		input: { db: f.input.db, userId: f.input.userId }
	}).start()
	try {
		expect(f.all).not.toHaveBeenCalled()
		actor.send({ type: 'INITIALIZED', workspaceId: f.input.organizationId })
		expect(await toPromise(actor)).toEqual({ outcome: 'closed' })
		expect(f.all).not.toHaveBeenCalled()
		expect(f.insert).not.toHaveBeenCalled()
	} finally {
		actor.stop()
	}
})

it('maps the workspace into Finance seeding and retains its commit receipt until confirmation', async () => {
	vi.stubEnv('PUBLIC_FAKE_DATA', 'true')
	const { workerWorkspaceSeed } = await import('./workspace-fake-data.js')
	const f = seedFixture()
	const confirmation = Promise.withResolvers<void>()
	f.wait.mockReturnValue(confirmation.promise)
	const actor = createActor(workerWorkspaceSeed, {
		input: { db: f.input.db, userId: f.input.userId }
	}).start()
	try {
		actor.send({ type: 'INITIALIZED', workspaceId: f.input.organizationId })
		await vi.waitFor(() => expect(f.wait).toHaveBeenCalledOnce())
		expect(f.insert).toHaveBeenCalledTimes(123)
		actor.send({ type: 'SHUTDOWN' })
		expect(actor.getSnapshot().status).toBe('active')
		confirmation.resolve()
		expect(await toPromise(actor)).toEqual({ outcome: 'closed' })
	} finally {
		confirmation.resolve()
		actor.stop()
	}
})

afterEach(() => vi.unstubAllEnvs())
