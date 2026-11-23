import { createActor, toPromise, waitFor } from 'xstate'
import { expect, it, vi } from 'vitest'
import { rootBootstrapMachine } from './root-bootstrap.js'

it('drains a write when shutdown arrives between issue and its receipt handoff', async () => {
	const pending = Promise.withResolvers<void>()
	const local = vi.fn(() => pending.promise)
	const write = { local, global: async () => {} }
	const ensure = vi.fn(() => {
		actor.send({ type: 'SHUTDOWN' })
		return write
	})
	const actor = createActor(rootBootstrapMachine, {
		input: { db: { read: async () => 'missing', ensure }, userId: 'owner' }
	})
	actor.start()
	await vi.waitFor(() => expect(local).toHaveBeenCalledOnce())
	expect(ensure).toHaveBeenCalledOnce()
	expect(actor.getSnapshot().status).toBe('active')
	pending.resolve()
	await waitFor(actor, (snapshot) => snapshot.status === 'done')
	expect(actor.getSnapshot().output).toEqual({
		outcome: 'closed',
		settlement: 'locallyPersisted',
		persistence: { outcome: 'succeeded', write }
	})
})

it('does not issue a write when shutdown interrupts the initial read', async () => {
	const pending = Promise.withResolvers<'compatible'>()
	const ensure = vi.fn(() => ({ local: async () => {}, global: async () => {} }))
	const actor = createActor(rootBootstrapMachine, {
		input: { db: { read: () => pending.promise, ensure }, userId: 'owner' }
	}).start()
	actor.send({ type: 'SHUTDOWN' })
	pending.resolve('compatible')
	await waitFor(actor, (snapshot) => snapshot.status === 'done')
	expect(ensure).not.toHaveBeenCalled()
	expect(actor.getSnapshot().output).toEqual({ outcome: 'closed', settlement: 'notStarted' })
})

it('opens a compatible persisted library without issuing or waiting for a write', async () => {
	const ensure = vi.fn(() => {
		throw new Error('Unexpected startup write')
	})
	const actor = createActor(rootBootstrapMachine, {
		input: { db: { read: async () => 'compatible', ensure }, userId: 'owner' }
	}).start()
	await waitFor(actor, (s) => s.status === 'done')
	expect(actor.getSnapshot().output).toEqual({
		outcome: 'ready',
		identityId: 'owner',
		workspaceId: 'owner'
	})
	expect(ensure).not.toHaveBeenCalled()
})

it('preserves the exact receipt when local bootstrap settlement fails', async () => {
	const error = new Error('Local receipt unavailable')
	const write = {
		local: async () => {
			throw error
		},
		global: async () => {}
	}
	const actor = createActor(rootBootstrapMachine, {
		input: { db: { read: async () => 'missing', ensure: () => write }, userId: 'owner' }
	}).start()
	expect(await toPromise(actor)).toEqual({
		outcome: 'failed',
		settlement: 'unresolved',
		write,
		error
	})
})
