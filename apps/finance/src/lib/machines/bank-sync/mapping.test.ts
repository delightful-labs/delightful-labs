import { describe, expect, it, vi } from 'vitest'
import { appAccountSchema } from '#lib/validation/accounts.js'
import { createAccountUnlinkMachine } from './account-unlink.js'
import { mappingFixture, provider, work, link } from './mapping.fixture.js'
import { account, id, observation } from './test-fixtures.js'
import type { BankCommand } from './types.js'
import { createActor, toPromise, waitFor, createAsyncLogic } from 'xstate'

const commands: BankCommand[] = [
	work.command,
	{ type: 'MAP', providerId: provider.id, accountId: account.id }
]

describe('bank mapping ownership chain', () => {
	it.each(commands)(
		'retains the lock while $type persistence settles after cancellation',
		async (command) => {
			const f = mappingFixture()
			const pending = Promise.withResolvers<void>()
			f.wait.mockReturnValue(pending.promise)
			const actor = f.operation(command)
			await vi.waitFor(() => expect(f.wait).toHaveBeenCalledOnce())
			actor.send({ type: 'CANCEL' })
			actor.send({ type: 'LOCK_FAILED', error: new Error('late lock error') })
			actor.send({ type: 'CANCEL' })
			expect(actor.getSnapshot().matches({ mapping: 'cancelling' })).toBe(true)
			expect(f.releaseLock).not.toHaveBeenCalled()
			expect(f.rollback).not.toHaveBeenCalled()
			pending.resolve()
			expect(await toPromise(actor)).toMatchObject({ kind: 'cancelled' })
			expect(f.acquireLock).toHaveBeenCalledOnce()
			expect(f.releaseLock).toHaveBeenCalledOnce()
			expect(f.commit).toHaveBeenCalledOnce()
		}
	)
	it('propagates cancellation through creation to the transaction and waits for rollback', async () => {
		const f = mappingFixture()
		const read = Promise.withResolvers<unknown[]>()
		const rollback = Promise.withResolvers<boolean>()
		f.all.mockReset().mockReturnValue(read.promise)
		f.rollback.mockReturnValue(rollback.promise)
		const actor = f.operation()
		await vi.waitFor(() => expect(f.all).toHaveBeenCalledOnce())
		actor.send({ type: 'CANCEL' })
		expect(f.rollback).not.toHaveBeenCalled()
		expect(f.releaseLock).not.toHaveBeenCalled()
		read.resolve([])
		await vi.waitFor(() => expect(f.rollback).toHaveBeenCalledOnce())
		expect(actor.getSnapshot().status).toBe('active')
		expect(f.releaseLock).not.toHaveBeenCalled()
		expect(f.commit).not.toHaveBeenCalled()
		rollback.resolve(true)
		expect(await toPromise(actor)).toMatchObject({ kind: 'cancelled' })
		expect(f.releaseLock).toHaveBeenCalledOnce()
		expect(f.insert).not.toHaveBeenCalled()
	})
	it.each([false, true])(
		'drains mapping after lock failure; cancellation supersedes failure: %s',
		async (cancel) => {
			const f = mappingFixture()
			const pending = Promise.withResolvers<void>()
			f.wait.mockReturnValue(pending.promise)
			const actor = f.operation()
			await vi.waitFor(() => expect(f.wait).toHaveBeenCalledOnce())
			actor.send({ type: 'LOCK_FAILED', error: new Error('locking_unavailable') })
			if (cancel) actor.send({ type: 'CANCEL' })
			expect(f.releaseLock).not.toHaveBeenCalled()
			pending.resolve()
			expect(await toPromise(actor)).toMatchObject({
				kind: cancel ? 'cancelled' : 'failed',
				error: new Error('locking_unavailable')
			})
			expect(f.releaseLock).toHaveBeenCalledOnce()
		}
	)
	it('keeps transaction writes scoped to the original workspace when observations change', async () => {
		const f = mappingFixture()
		const pending = Promise.withResolvers<void>()
		f.wait.mockReturnValue(pending.promise)
		const actor = f.operation()
		await vi.waitFor(() => expect(f.wait).toHaveBeenCalledOnce())
		f.observe.mockReturnValue({ ...observation, organizationId: id(20), userId: id(21) })
		actor.send({ type: 'CANCEL' })
		pending.resolve()
		expect(await toPromise(actor)).toMatchObject({ kind: 'cancelled' })
		expect(f.insert).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ organizationId: id(2), connectionId: work.current.id }),
			expect.anything()
		)
		expect(f.beginTransaction).toHaveBeenCalledOnce()
		expect(f.releaseLock).toHaveBeenCalledOnce()
	})
	it('rejects changed authority before opening a transaction', async () => {
		const f = mappingFixture()
		f.observe.mockReturnValue({ ...observation, allowed: false })
		expect(await toPromise(f.operation())).toMatchObject({ kind: 'failed' })
		expect(f.beginTransaction).not.toHaveBeenCalled()
		expect(f.releaseLock).toHaveBeenCalledOnce()
	})
	it('handles a mapping actor crash during cancellation without awaiting another acknowledgement', async () => {
		const f = mappingFixture()
		const validation = Promise.withResolvers<ReturnType<typeof appAccountSchema.parse>>()
		const entered = Promise.withResolvers<void>()
		const create = f.create.provide({
			actors: {
				validate: createAsyncLogic({
					run: async () => {
						entered.resolve()
						return validation.promise
					}
				})
			}
		})
		const mapping = f.mapping.provide({ actors: { createAccount: create } })
		const transition = mapping.transition.bind(mapping)
		vi.spyOn(mapping, 'transition').mockImplementation((snapshot, event, scope) => {
			if (event.type === 'CANCEL') throw new Error('mapping crashed')
			return transition(snapshot, event, scope)
		})
		const actor = createActor(f.operationMachine.provide({ actors: { mapAccounts: mapping } }), {
			input: { command: work.command, discovered: [provider] }
		}).start()
		await entered.promise
		actor.send({ type: 'CANCEL' })
		expect(await toPromise(actor)).toMatchObject({ kind: 'cancelled' })
		validation.resolve(
			appAccountSchema.parse({ organizationId: id(2), name: provider.name, kind: 'bank' })
		)
		await validation.promise
		expect(f.beginTransaction).not.toHaveBeenCalled()
		expect(f.releaseLock).toHaveBeenCalledOnce()
	})
	it('does not send cancellation to a mapping child whose output is already queued', async () => {
		const f = mappingFixture()
		const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
		const child = f.mapping
		const actor = createActor(f.operationMachine.provide({ actors: { mapAccounts: child } }), {
			input: {
				command: { type: 'MAP', providerId: provider.id, accountId: account.id },
				discovered: [provider]
			}
		})
		let observed = false
		const subscription = actor.subscribe((snapshot) => {
			if (observed) return
			const mapping = snapshot.children.mapping
			if (!mapping) return
			observed = true
			// A child subscriber runs before its parent's queued completion is consumed.
			mapping.subscribe((childSnapshot) => {
				if (childSnapshot.status === 'done') actor.send({ type: 'CANCEL' })
			})
		})
		actor.start()
		expect(await toPromise(actor)).toMatchObject({ kind: 'cancelled' })
		subscription.unsubscribe()
		// XState may also report already-queued completion from the preceding crash test.
		expect(warning).not.toHaveBeenCalledWith(expect.stringMatching(/^Event \"CANCEL\"/))
		expect(f.releaseLock).toHaveBeenCalledOnce()
	})
})

describe('unlink settlement under the mapping owner', () => {
	it.each(['resolve', 'reject'])(
		'awaits the issued delete on cancellation and %s',
		async (outcome) => {
			const f = mappingFixture()
			const pending = Promise.withResolvers<void>()
			f.remove.mockReturnValueOnce(pending.promise)
			const actor = f.operation({ type: 'MAP', providerId: provider.id, accountId: '' })
			await vi.waitFor(() => expect(f.remove).toHaveBeenCalledOnce())
			actor.send({ type: 'CANCEL' })
			expect(actor.getSnapshot().status).toBe('active')
			expect(f.releaseLock).not.toHaveBeenCalled()
			if (outcome === 'resolve') pending.resolve()
			else pending.reject(new Error('delete settlement failed'))
			expect(await toPromise(actor)).toMatchObject({ kind: 'cancelled' })
			expect(f.remove).toHaveBeenCalledOnce()
			expect(f.releaseLock).toHaveBeenCalledOnce()
			expect(f.beginTransaction).not.toHaveBeenCalled()
		}
	)
	it('does not issue a delete if cancelled during authorization', async () => {
		const f = mappingFixture()
		const pending = Promise.withResolvers<NonNullable<typeof observation.connection>[]>()
		const entered = Promise.withResolvers<void>()
		const authorize = f.authorize.provide({
			actors: {
				connection: createAsyncLogic({
					run: async () => {
						entered.resolve()
						return pending.promise
					}
				})
			}
		})
		// Only unlink's storage and authorization leaves are delayed; mapping remains real.
		const unlink = createAccountUnlinkMachine(f.deps).provide({
			actors: {
				links: createAsyncLogic({ run: async () => [link] }),
				authorize,
				remove: createAsyncLogic({ run: f.remove })
			}
		})
		const mapping = f.mapping.provide({ actors: { unlinkAccount: unlink } })
		const actor = createActor(mapping, {
			input: {
				work: { ...work, command: { type: 'MAP', providerId: provider.id, accountId: '' } },
				discovered: [provider]
			}
		}).start()
		await entered.promise
		actor.send({ type: 'CANCEL' })
		expect(await toPromise(actor)).toMatchObject({ ok: false })
		pending.resolve([work.current])
		expect(f.remove).not.toHaveBeenCalled()
	})
})
