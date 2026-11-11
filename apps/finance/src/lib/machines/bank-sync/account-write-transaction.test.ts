import { describe, expect, it } from 'vitest'
import { app } from '#lib/schema.js'
import { accountWriteTransaction } from './account-write-transaction.js'
import { mappingFixture, link, request, provider } from './mapping.fixture.js'
import { account, id } from './test-fixtures.js'
import type { AccountWrite } from './account-write.js'
import { toPromise, waitFor, createAsyncLogic } from 'xstate'

const map: AccountWrite = { kind: 'map', work: request.work, provider, accountId: account.id }

describe('mapping transaction policy and atomic writes', () => {
	it('stages the account and link in one transaction and awaits local persistence', async () => {
		const f = mappingFixture()
		f.records([], [], null)
		const pending = Promise.withResolvers<void>()
		f.wait.mockReturnValue(pending.promise)
		const actor = f.transaction()
		await waitFor(actor, (s) => s.matches({ running: { work: 'settling' } }))
		expect(f.beginTransaction).toHaveBeenCalledOnce()
		expect(f.insert).toHaveBeenCalledTimes(2)
		expect(f.insert).toHaveBeenNthCalledWith(
			1,
			app.accounts,
			request.kind === 'create' ? request.values : undefined,
			{ id: account.id }
		)
		expect(f.insert).toHaveBeenNthCalledWith(
			2,
			app.simplefinAccountLinks,
			{
				organizationId: id(2),
				connectionId: request.work.current.id,
				simplefinAccountId: provider.id,
				accountId: account.id,
				availableBalance: provider.availableBalance,
				balanceDate: provider.balanceDate
			},
			{ id: link.id }
		)
		expect(f.commit).toHaveBeenCalledOnce()
		expect(f.wait).toHaveBeenCalledExactlyOnceWith({ tier: 'local' })
		expect(actor.getSnapshot().status).toBe('active')
		pending.resolve()
		expect(await toPromise(actor)).toEqual({ outcome: 'succeeded', settlement: 'locallyPersisted' })
		expect(f.rollback).not.toHaveBeenCalled()
	})
	it.each(['create', 'map'] satisfies AccountWrite['kind'][])(
		'reuses an existing eligible account for %s',
		async (kind) => {
			const f = mappingFixture()
			expect(await toPromise(f.transaction(kind === 'create' ? request : map))).toMatchObject({
				outcome: 'succeeded'
			})
			expect(f.insert).toHaveBeenCalledOnce()
			expect(f.insert).toHaveBeenCalledWith(
				app.simplefinAccountLinks,
				expect.objectContaining({ accountId: account.id }),
				{ id: link.id }
			)
		}
	)
	it('updates an existing provider link when remapping', async () => {
		const f = mappingFixture()
		f.records([{ ...link, accountId: id(20) }])
		expect(await toPromise(f.transaction(map))).toMatchObject({ outcome: 'succeeded' })
		expect(f.insert).not.toHaveBeenCalled()
		expect(f.update).toHaveBeenCalledExactlyOnceWith(
			app.simplefinAccountLinks,
			link.id,
			expect.objectContaining({ accountId: account.id })
		)
	})
	it('closes an already satisfied creation without writing or committing', async () => {
		const f = mappingFixture()
		f.records([link])
		expect(await toPromise(f.transaction())).toEqual({
			outcome: 'unchanged',
			settlement: 'rolledBack'
		})
		expect(f.all).toHaveBeenCalledOnce()
		expect(f.rollback).toHaveBeenCalledOnce()
		expect(f.insert).not.toHaveBeenCalled()
		expect(f.commit).not.toHaveBeenCalled()
	})
	it.each([
		{
			reason: 'duplicate provider links',
			links: [link, { ...link, id: id(7) }],
			destination: [],
			current: account,
			input: request,
			error: 'mapping'
		},
		{
			reason: 'occupied destination',
			links: [],
			destination: [{ ...link, simplefinAccountId: 'another-provider' }],
			current: account,
			input: map,
			error: 'account_already_linked'
		},
		{
			reason: 'foreign account',
			links: [],
			destination: [],
			current: { ...account, organizationId: id(20) },
			input: map,
			error: 'mapping'
		},
		{
			reason: 'archived account',
			links: [],
			destination: [],
			current: { ...account, archivedAt: new Date() },
			input: map,
			error: 'mapping'
		},
		{
			reason: 'currency mismatch during creation',
			links: [],
			destination: [],
			current: { ...account, currency: 'EUR' },
			input: request,
			error: 'mapping'
		},
		{
			reason: 'missing mapping destination',
			links: [],
			destination: [],
			current: null,
			input: map,
			error: 'mapping'
		}
	])('rolls back $reason before writes', async ({ links, destination, current, input, error }) => {
		const f = mappingFixture()
		f.records(links, destination, current)
		expect(await toPromise(f.transaction(input))).toEqual({
			outcome: 'failed',
			settlement: 'rolledBack',
			error: new Error(error)
		})
		expect(f.rollback).toHaveBeenCalledOnce()
		expect(f.insert).not.toHaveBeenCalled()
		expect(f.update).not.toHaveBeenCalled()
		expect(f.commit).not.toHaveBeenCalled()
	})
	it('reports acquisition failure without rolling back an unowned transaction', async () => {
		const f = mappingFixture()
		const error = new Error('cannot open')
		f.beginTransaction.mockImplementationOnce(() => {
			throw error
		})
		expect(await toPromise(f.transaction())).toEqual({
			outcome: 'failed',
			settlement: 'notStarted',
			error
		})
		expect(f.rollback).not.toHaveBeenCalled()
	})
	it('rolls back staged account creation when link staging fails', async () => {
		const f = mappingFixture()
		f.records([], [], null)
		const error = new Error('link staging failed')
		f.insert
			.mockImplementationOnce(() => account)
			.mockImplementationOnce(() => {
				throw error
			})
		expect(await toPromise(f.transaction())).toEqual({
			outcome: 'failed',
			settlement: 'rolledBack',
			error
		})
		expect(f.rollback).toHaveBeenCalledOnce()
		expect(f.commit).not.toHaveBeenCalled()
	})
	it('rolls back a rejected transaction read', async () => {
		const f = mappingFixture()
		const error = new Error('read failed')
		f.all.mockReset().mockRejectedValue(error)
		expect(await toPromise(f.transaction())).toEqual({
			outcome: 'failed',
			settlement: 'rolledBack',
			error
		})
		expect(f.commit).not.toHaveBeenCalled()
	})
	it('cleans up after commit request failure', async () => {
		const f = mappingFixture()
		const error = new Error('commit failed')
		f.commit.mockImplementationOnce(() => {
			throw error
		})
		expect(await toPromise(f.transaction())).toEqual({
			outcome: 'failed',
			settlement: 'rolledBack',
			error
		})
		expect(f.rollback).toHaveBeenCalledOnce()
	})
	it.each(['false', 'reject'])(
		'reports unresolved settlement when rollback returns %s',
		async (failure) => {
			const f = mappingFixture()
			f.records([link])
			if (failure === 'false') f.rollback.mockResolvedValue(false)
			else f.rollback.mockRejectedValue(new Error('rollback failed'))
			expect(await toPromise(f.transaction())).toMatchObject({
				outcome: 'failed',
				settlement: 'unresolved'
			})
			expect(f.commit).not.toHaveBeenCalled()
		}
	)
	it('does not report rollback when local persistence fails and cleanup is unconfirmed', async () => {
		const f = mappingFixture()
		const error = new Error('local persistence failed')
		f.wait.mockRejectedValue(error)
		f.rollback.mockResolvedValue(false)
		expect(await toPromise(f.transaction())).toEqual({
			outcome: 'failed',
			settlement: 'unresolved',
			error
		})
		expect(f.rollback).toHaveBeenCalledOnce()
	})
})

describe('mapping transaction interruption', () => {
	it('retains ownership when shutdown races acquisition and ignores later cancellation', async () => {
		const f = mappingFixture()
		const actor = f.transaction()
		actor.send({ type: 'SHUTDOWN' })
		actor.send({ type: 'CANCEL' })
		expect(await toPromise(actor)).toEqual({ outcome: 'closed', settlement: 'rolledBack' })
		expect(f.all).not.toHaveBeenCalled()
		expect(f.rollback).toHaveBeenCalledOnce()
	})
	it.each(['provider', 'destination'])(
		'waits for the pending %s read before rollback',
		async (stage) => {
			const f = mappingFixture()
			const pending = Promise.withResolvers<unknown[]>()
			if (stage === 'provider')
				f.all.mockReset().mockReturnValueOnce(pending.promise).mockResolvedValue([])
			else
				f.all
					.mockReset()
					.mockResolvedValueOnce([])
					.mockReturnValueOnce(pending.promise)
					.mockResolvedValue([account])
			const actor = f.transaction()
			await waitFor(actor, (s) =>
				s.matches({
					running: { work: stage === 'provider' ? 'loadingProviderLinks' : 'loadingDestination' }
				})
			)
			actor.send({ type: 'CANCEL' })
			expect(actor.getSnapshot().status).toBe('active')
			expect(f.rollback).not.toHaveBeenCalled()
			pending.resolve([])
			expect(await toPromise(actor)).toEqual({ outcome: 'cancelled', settlement: 'rolledBack' })
			expect(f.insert).not.toHaveBeenCalled()
			expect(f.commit).not.toHaveBeenCalled()
		}
	)
	it.each(['account', 'link'])('rolls back when cancelled during %s staging', async (stage) => {
		const f = mappingFixture()
		f.records([], [], stage === 'account' ? null : account)
		const actor = f.transaction()
		f.insert.mockImplementationOnce(() => {
			actor.send({ type: 'CANCEL' })
			return account
		})
		expect(await toPromise(actor)).toEqual({ outcome: 'cancelled', settlement: 'rolledBack' })
		expect(f.insert).toHaveBeenCalledOnce()
		expect(f.commit).not.toHaveBeenCalled()
	})
	it('retains an in-flight commit and waits for settlement after cancellation', async () => {
		const f = mappingFixture()
		const gate = Promise.withResolvers<void>()
		const pending = Promise.withResolvers<void>()
		f.wait.mockReturnValue(pending.promise)
		const machine = accountWriteTransaction.provide({
			actors: {
				commit: createAsyncLogic({
					run: async () => {
						await gate.promise
						return f.tx.commit()
					}
				})
			}
		})
		const actor = f.transaction(request, machine)
		await waitFor(actor, (s) => s.matches({ running: { work: 'committing' } }))
		actor.send({ type: 'CANCEL' })
		expect(actor.getSnapshot().status).toBe('active')
		expect(f.rollback).not.toHaveBeenCalled()
		gate.resolve()
		await waitFor(actor, (s) => s.matches({ running: { work: 'settling' } }))
		expect(actor.getSnapshot().status).toBe('active')
		pending.resolve()
		expect(await toPromise(actor)).toEqual({ outcome: 'cancelled', settlement: 'locallyPersisted' })
		expect(f.commit).toHaveBeenCalledOnce()
		expect(f.rollback).not.toHaveBeenCalled()
	})
	it.each(['resolve', 'reject'])(
		'preserves shutdown during local settlement on %s',
		async (result) => {
			const f = mappingFixture()
			const pending = Promise.withResolvers<void>()
			f.wait.mockReturnValue(pending.promise)
			f.rollback.mockResolvedValue(false)
			const actor = f.transaction()
			await waitFor(actor, (s) => s.matches({ running: { work: 'settling' } }))
			actor.send({ type: 'CANCEL' })
			actor.send({ type: 'SHUTDOWN' })
			actor.send({ type: 'CANCEL' })
			expect(actor.getSnapshot().status).toBe('active')
			if (result === 'resolve') pending.resolve()
			else pending.reject(new Error('late local failure'))
			expect(await toPromise(actor)).toEqual({
				outcome: 'closed',
				settlement: result === 'resolve' ? 'locallyPersisted' : 'unresolved'
			})
		}
	)
	it('waits for rollback acknowledgement and preserves cancellation over a read failure', async () => {
		const f = mappingFixture()
		const pending = Promise.withResolvers<boolean>()
		f.all.mockReset().mockRejectedValue(new Error('read failed'))
		f.rollback.mockReturnValue(pending.promise)
		const actor = f.transaction()
		await waitFor(actor, (s) => s.matches({ running: { work: 'rollingBack' } }))
		actor.send({ type: 'CANCEL' })
		expect(actor.getSnapshot().status).toBe('active')
		pending.resolve(false)
		expect(await toPromise(actor)).toEqual({ outcome: 'cancelled', settlement: 'unresolved' })
		expect(f.commit).not.toHaveBeenCalled()
	})
})
