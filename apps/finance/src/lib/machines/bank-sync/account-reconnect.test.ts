import { describe, expect, it, vi } from 'vitest'
import { createActor, createAsyncLogic, toPromise, waitFor } from 'xstate'
import type { Account } from '#lib/schema.js'
import { stableUuid } from '#lib/data.js'
import { createAccountReconnectMachine } from './account-reconnect.js'
import { mappingFixture, provider, work, link } from './mapping.fixture.js'
import { account, id } from './test-fixtures.js'
import type { AccountWrite } from './account-write.js'
import type { ProviderSummary, Result } from './types.js'

function fixture() {
	const f = mappingFixture()
	const snapshot = vi.fn<() => Promise<{ account: Account | undefined; links: (typeof link)[] }>>(
		async () => ({ account, links: [] })
	)
	const write = vi.fn(async (_input: AccountWrite): Promise<Result<undefined>> => ({
		ok: true,
		value: undefined
	}))
	const machine = createAccountReconnectMachine(f.deps).provide({
		actors: {
			snapshot: createAsyncLogic({ run: snapshot }),
			write: f.write.provide({
				actors: {
					providerLinks: createAsyncLogic({
						run: async ({ input }: { input: AccountWrite }) => {
							const result = await write(input)
							if (!result.ok) throw result.error
							f.records()
							return [link].slice(0, 0)
						}
					})
				}
			})
		}
	})
	function start(discovered: ProviderSummary[] = [provider]) {
		return createActor(machine, {
			input: { work: { ...work, command: { type: 'RECONNECT' } }, discovered }
		}).start()
	}
	return { ...f, snapshot, writeRequest: write, machine, start }
}

describe('reconnect accounts created by a previous SimpleFIN connection', () => {
	it('uses workspace/provider identity, ignoring a renamed account, and processes all accounts', async () => {
		const f = fixture()
		f.snapshot.mockResolvedValue({ account: { ...account, name: 'Renamed by user' }, links: [] })
		const providers = [provider, { ...provider, id: 'savings', name: 'Savings' }]
		expect(await toPromise(f.start(providers))).toEqual({ ok: true, value: undefined })
		for (const row of providers) {
			expect(f.snapshot).toHaveBeenCalledWith(
				expect.objectContaining({
					input: {
						organizationId: work.scope.organizationId,
						accountId: await stableUuid(work.scope.organizationId, `simplefin-account:${row.id}`)
					}
				}),
				expect.anything()
			)
			expect(f.writeRequest).toHaveBeenCalledWith(
				expect.objectContaining({ kind: 'map', provider: row })
			)
		}
		expect(f.writeRequest).toHaveBeenCalledTimes(2)
	})

	it.each([
		'absent',
		'archived',
		'currency',
		'already-linked',
		'destination-conflict',
		'ambiguous'
	])('skips %s accounts without a write', async (reason) => {
		const f = fixture()
		f.snapshot.mockResolvedValue({
			account:
				reason === 'absent'
					? undefined
					: {
							...account,
							archivedAt: reason === 'archived' ? new Date() : null,
							currency: reason === 'currency' ? 'CAD' : 'USD'
						},
			links:
				reason === 'already-linked'
					? [link]
					: reason === 'destination-conflict'
						? [{ ...link, simplefinAccountId: 'other-provider' }]
						: []
		})
		expect(
			await toPromise(f.start(reason === 'ambiguous' ? [provider, provider] : [provider]))
		).toEqual({ ok: true, value: undefined })
		expect(f.writeRequest).not.toHaveBeenCalled()
	})

	it('does no work for an empty discovery', async () => {
		const f = fixture()
		expect(await toPromise(f.start([]))).toEqual({ ok: true, value: undefined })
		expect(f.snapshot).not.toHaveBeenCalled()
		expect(f.writeRequest).not.toHaveBeenCalled()
	})

	it('stops after a write failure rather than reporting successful recovery', async () => {
		const f = fixture()
		const error = new Error('unauthorized')
		f.writeRequest.mockResolvedValue({ ok: false, error })
		expect(await toPromise(f.start([provider, { ...provider, id: 'savings' }]))).toEqual({
			ok: false,
			error
		})
		expect(f.writeRequest).toHaveBeenCalledOnce()
	})

	it('cancels while reading without beginning a write', async () => {
		const f = fixture()
		const pending = Promise.withResolvers<{ account: typeof account; links: (typeof link)[] }>()
		f.snapshot.mockReturnValue(pending.promise)
		const actor = f.start()
		await waitFor(actor, (state) => state.matches('reading'))
		actor.send({ type: 'CANCEL' })
		expect(await toPromise(actor)).toEqual({ ok: false, error: new Error('disconnected') })
		pending.resolve({ account, links: [] })
		expect(f.writeRequest).not.toHaveBeenCalled()
	})

	it.each<{ type: 'CANCEL' | 'SHUTDOWN' }>([{ type: 'CANCEL' }, { type: 'SHUTDOWN' }])(
		'drains an issued transaction on $type and retains the operation lock',
		async ({ type: interruption }) => {
			const f = mappingFixture()
			const pending = Promise.withResolvers<void>()
			f.wait.mockReturnValue(pending.promise)
			const reconnect = createAccountReconnectMachine(f.deps).provide({
				actors: {
					identity: createAsyncLogic({ run: async () => account.id }),
					snapshot: createAsyncLogic({
						run: async (): Promise<{ account: Account | undefined; links: (typeof link)[] }> => ({
							account,
							links: []
						})
					}),
					write: f.write
				}
			})
			const mapping = f.mapping.provide({ actors: { reconnect } })
			const operation = f.operationMachine.provide({ actors: { mapAccounts: mapping } })
			const actor = createActor(operation, {
				input: { command: { type: 'RECONNECT' }, discovered: [provider] }
			}).start()
			await vi.waitFor(() => expect(f.wait).toHaveBeenCalledOnce())
			// Shutdown is forwarded directly to the mapping child; operation cancellation is the parent path.
			if (interruption === 'SHUTDOWN')
				actor.getSnapshot().children.mapping?.send({ type: 'SHUTDOWN' })
			else actor.send({ type: 'CANCEL' })
			expect(f.releaseLock).not.toHaveBeenCalled()
			expect(f.rollback).not.toHaveBeenCalled()
			pending.resolve()
			const result = await toPromise(actor)
			expect(result.kind).toBe('cancelled')
			expect(f.releaseLock).toHaveBeenCalledOnce()
			expect(f.commit).toHaveBeenCalledOnce()
			expect(f.insert).toHaveBeenCalledWith(
				expect.anything(),
				expect.objectContaining({ accountId: account.id, connectionId: work.current.id }),
				expect.anything()
			)
		}
	)

	it('checks authorization before the reconnection child can write', async () => {
		const f = mappingFixture()
		f.observe.mockReturnValue({ ...f.observation, allowed: false, organizationId: id(20) })
		expect(await toPromise(f.operation({ type: 'RECONNECT' }))).toMatchObject({ kind: 'failed' })
		expect(f.beginTransaction).not.toHaveBeenCalled()
		expect(f.releaseLock).toHaveBeenCalledOnce()
	})
})
