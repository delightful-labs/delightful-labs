import { describe, expect, it, vi } from 'vitest'
import { createAuthorizationMachine } from './authorization.js'
import { createPreparationMachine } from './preparation.js'
import { connection, dependencies, id, observation, source } from './test-fixtures.js'
import type { OrganizationMember } from '#lib/schema.js'
import type { AuthorizationRequest, Observation } from './types.js'
import { createActor, toPromise, createAsyncLogic } from 'xstate'

const request: AuthorizationRequest = {
	scope: { ownerId: id(1), organizationId: id(2), connectionId: id(3) },
	requireConnection: true,
	expectedCiphertext: 'ciphertext'
}
function authorization(observe = () => observation) {
	return createAuthorizationMachine(dependencies(observe)).provide({
		actors: {
			membership: createAsyncLogic({
				run: async (_args: { input: AuthorizationRequest }) =>
					source.membership ? [source.membership] : []
			}),
			demoId: createAsyncLogic({ run: async (_args: { input: AuthorizationRequest }) => id(99) }),
			connections: createAsyncLogic({
				run: async (_args: { input: AuthorizationRequest }) => [connection]
			}),
			connection: createAsyncLogic({
				run: async (_args: { input: AuthorizationRequest }) => [connection]
			})
		}
	})
}

describe('bank authorization statecharts', () => {
	it('checks identity twice around database authorization', async () => {
		const observe = vi.fn(() => observation)
		const actor = createActor(authorization(observe), { input: request }).start()
		await expect(toPromise(actor)).resolves.toEqual({ error: undefined })
		expect(observe).toHaveBeenCalledTimes(2)
	})

	it.each([
		{ ...observation, sessionReady: false },
		{ ...observation, allowed: false },
		{ ...observation, userId: id(8) },
		{ ...observation, organizationId: id(8) },
		{ ...observation, connection: { ...connection, ownerId: id(8) } }
	])('rejects stale identity/scope before database authorization', async (current) => {
		const membership = vi.fn<() => Promise<OrganizationMember[]>>(async () => [])
		const machine = authorization(() => current).provide({
			actors: { membership: createAsyncLogic({ run: membership }) }
		})
		const actor = createActor(machine, { input: request }).start()
		await expect(toPromise(actor)).resolves.toEqual({ error: new Error('unauthorized') })
		expect(membership).not.toHaveBeenCalled()
	})

	it('rejects a viewer even with the encrypted connection available', async () => {
		const membership = source.membership
		if (!membership) throw new Error('Expected membership')
		const actor = createActor(
			authorization().provide({
				actors: {
					membership: createAsyncLogic<OrganizationMember[], AuthorizationRequest>({
						run: async (_args: { input: AuthorizationRequest }) => [
							{ ...membership, role: 'viewer' }
						]
					})
				}
			}),
			{ input: request }
		).start()
		await expect(toPromise(actor)).resolves.toEqual({ error: new Error('unauthorized') })
	})

	it('rejects credential replacement and demo-mode mismatch', async () => {
		const changed = createActor(authorization(), {
			input: { ...request, expectedCiphertext: 'old-ciphertext' }
		}).start()
		await expect(toPromise(changed)).resolves.toEqual({ error: new Error('disconnected') })
		const demo = createActor(authorization(), {
			input: { ...request, scope: { ...request.scope, connectionId: id(99) } }
		}).start()
		await expect(toPromise(demo)).resolves.toEqual({ error: new Error('mode_mismatch') })
	})

	it('rejects an identity change while authorization was pending', async () => {
		const observe = vi
			.fn<() => Observation>()
			.mockReturnValueOnce(observation)
			.mockReturnValue({ ...observation, userId: id(8) })
		const actor = createActor(authorization(observe), { input: request }).start()
		await expect(toPromise(actor)).resolves.toEqual({ error: new Error('unauthorized') })
	})

	it('models rejected membership I/O as a failed child result', async () => {
		const error = new Error('database-failure')
		const machine = authorization().provide({
			actors: {
				membership: createAsyncLogic<OrganizationMember[], AuthorizationRequest>({
					run: async (_args: { input: AuthorizationRequest }) => {
						throw error
					}
				})
			}
		})
		const actor = createActor(machine, { input: request }).start()
		await expect(toPromise(actor)).resolves.toEqual({ error })
		expect(actor.getSnapshot().matches('failed')).toBe(true)
	})

	it('reuses an existing connection and refuses a missing required connection', async () => {
		const input = { identity: { userId: id(1), organizationId: id(2) }, requireConnection: true }
		const existing = createActor(createPreparationMachine(dependencies()), { input }).start()
		await expect(toPromise(existing)).resolves.toEqual({
			ok: true,
			value: { scope: request.scope, connection }
		})
		const missing = createActor(
			createPreparationMachine(dependencies(() => ({ ...observation, connection: undefined }))),
			{ input }
		).start()
		await expect(toPromise(missing)).resolves.toEqual({
			ok: false,
			error: new Error('disconnected')
		})
	})

	it('rechecks identity after generating a new connection ID', async () => {
		const current = { ...observation, connection: undefined }
		const observe = vi
			.fn<() => Observation>()
			.mockReturnValueOnce(current)
			.mockReturnValue({ ...current, userId: id(8) })
		const machine = createPreparationMachine(dependencies(observe)).provide({
			actors: {
				connectionId: createAsyncLogic({
					run: async (_args: { input: { ownerId: string; organizationId: string } }) => id(9)
				})
			}
		})
		const actor = createActor(machine, {
			input: { identity: { userId: id(1), organizationId: id(2) }, requireConnection: false }
		}).start()
		await expect(toPromise(actor)).resolves.toEqual({ ok: false, error: new Error('unauthorized') })
		expect(observe).toHaveBeenCalledTimes(2)
	})
})
