import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { seedFixture } from '../samples/fake-data.fixture.js'
import { createActor, toPromise, waitFor } from 'xstate'

const environment = vi.hoisted(() => ({ PUBLIC_FAKE_DATA: 'false', PUBLIC_DEBUG: 'false' }))
vi.mock('$app/env/public', () => environment)
beforeEach(() => vi.resetModules())
afterEach(() => vi.restoreAllMocks())

it.each([
	{ seed: 'false', debug: 'false', writes: 0 },
	{ seed: 'false', debug: 'true', writes: 0 },
	{ seed: 'true', debug: 'false', writes: 123 },
	{ seed: 'true', debug: 'true', writes: 123 }
])('seeding=$seed is independent of debugging=$debug', async ({ seed, debug, writes }) => {
	environment.PUBLIC_FAKE_DATA = seed
	environment.PUBLIC_DEBUG = debug
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
	environment.PUBLIC_FAKE_DATA = 'true'
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
	environment.PUBLIC_FAKE_DATA = 'true'
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
