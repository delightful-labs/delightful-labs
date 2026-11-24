import { expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import { createJazz, createJazzClient, memory, acceptDeviceAccounts } from 'jazz-tools/backend'
import { ReadTier, type Db, type QueryBuilder, type QueryOptions } from 'jazz-tools'
import type { AccountStore } from 'jazz-tools/client'
import { createActor, waitFor, type InputFrom } from 'xstate'
import { workspaceInitialization } from './workspace-initialization.js'
import { stableUuid } from '../../domain/stable-uuid.js'
import { app } from '../../queries.js'
import permissions from '../../jazz.permissions.json' with { type: 'json' }

function accountStore(): AccountStore {
	let value: string | null = null
	return {
		read: async () => value,
		update: async (transform) => {
			value = transform(value)
		}
	}
}
function initializer(input: InputFrom<typeof workspaceInitialization>) {
	return createActor(workspaceInitialization, { input })
}

it.each(['concurrent', 'edited-after-discovery', 'occupied-workspace'])(
	'independent native replicas converge empty initialization without resetting the Finance graph: %s',
	async (schedule) => {
		const authority = createJazz({
			app,
			permissions,
			store: memory(),
			authenticate: acceptDeviceAccounts
		})
		const server = createServer((request, response) => authority.nodeHandler(request, response))
		const sessions: Awaited<ReturnType<typeof createJazzClient>>[] = []
		const actors: ReturnType<typeof initializer>[] = []
		const gate = Promise.withResolvers<void>()
		const snapshots = [Promise.withResolvers<void>(), Promise.withResolvers<void>()]
		const transactionReads = [0, 0]
		let editedCategoryId: string | undefined
		try {
			await authority.attach(server)
			await authority.ready()
			await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
			const address = server.address()
			if (!address || typeof address === 'string') throw new Error('Native listener unavailable')
			const serverUrl = `http://127.0.0.1:${address.port}/jazz`
			const seed = await createJazzClient({
				app,
				permissions,
				serverUrl,
				driver: { type: 'memory' },
				store: accountStore(),
				initial: 'device'
			})
			sessions.push(seed)
			const userId = seed.getSnapshot().user?.accountId
			if (!userId) throw new Error('Native identity unavailable')
			const key = seed.exportDeviceKey()
			await seed.close()
			const canonicalWorkspace = await stableUuid(userId, 'personal-organization')
			if (schedule === 'occupied-workspace') {
				await authority.db
					.insert(
						app.organizations,
						{
							ownerId: userId,
							name: 'Existing occupied workspace',
							kind: 'personal',
							defaultCurrency: 'USD'
						},
						{ id: canonicalWorkspace }
					)
					.wait({ tier: 'global' })
			}
			const observed = [0, 0]
			const errors: unknown[] = []
			for (const index of [0, 1]) {
				const session = await createJazzClient({
					app,
					permissions,
					serverUrl,
					driver: { type: 'memory' },
					store: accountStore()
				})
				sessions.push(session)
				await session.restoreDeviceAccount(key)
				const client = session.getSnapshot().client
				if (!client) throw new Error('Native replica unavailable')
				const native: Db = client.db
				native.onMutationError((error) => errors.push(error))
				const db: InputFrom<typeof workspaceInitialization>['db'] = {
					all: async <T>(query: QueryBuilder<T>, options?: QueryOptions) => {
						const rows = await native.all(query, options)
						if (options?.tier === ReadTier.Remote && (observed[index] ?? 0) < 2) {
							expect(rows).toEqual([])
							observed[index] = (observed[index] ?? 0) + 1
							await gate.promise
						}
						return rows
					},
					beginSerializableTransaction: () => {
						const transaction = native.beginSerializableTransaction()
						const one = transaction.one.bind(transaction)
						vi.spyOn(transaction, 'one').mockImplementation(
							async <T>(query: QueryBuilder<T>, options?: QueryOptions) => {
								const row = await one(query, options)
								expect(row).toBeNull()
								transactionReads[index] = (transactionReads[index] ?? 0) + 1
								await snapshots[index]?.promise
								return row
							}
						)
						return transaction
					},
					getConfig: native.getConfig.bind(native)
				}
				actors.push(initializer({ db, userId }).start())
			}
			await expect.poll(() => observed).toEqual([2, 2])
			gate.resolve()
			await expect.poll(() => transactionReads).toEqual([1, 1])
			snapshots[0]?.resolve()
			if (schedule === 'edited-after-discovery') {
				const firstActor = actors[0]
				if (!firstActor) throw new Error('First initializer unavailable')
				const first = (await waitFor(firstActor, (snapshot) => snapshot.status === 'done')).output
				if (!first || first.outcome !== 'ready')
					throw new Error('First initializer did not become ready')
				await authority.db
					.update(app.organizations, first.workspaceId, { name: 'Edited after discovery' })
					.wait({ tier: 'global' })
				await authority.db
					.update(app.profiles, first.identityId, { displayName: 'Edited identity' })
					.wait({ tier: 'global' })
				const category = (
					await authority.db.all(app.categories.where({ organizationId: first.workspaceId }), {
						tier: ReadTier.Remote
					})
				)[0]
				if (!category) throw new Error('Initial starter category unavailable')
				editedCategoryId = category.id
				await authority.db
					.update(app.categories, category.id, { name: 'Edited starter category' })
					.wait({ tier: 'global' })
			}
			snapshots[1]?.resolve()
			const results = await Promise.all(
				actors.map(
					async (actor) => (await waitFor(actor, (snapshot) => snapshot.status === 'done')).output
				)
			)
			if (schedule === 'occupied-workspace') {
				for (const result of results) {
					if (!result || result.outcome !== 'failed')
						throw new Error('Occupied workspace was not refused')
					expect(['notStarted', 'rejected']).toContain(result.settlement)
					expect(result.error).toBeInstanceOf(Error)
					if (!(result.error instanceof Error)) throw new Error('Native rejection unavailable')
					expect(result.error.message).toMatch(/already exists/i)
				}
				for (const session of sessions.slice(1)) await session.close()
				expect(errors).toEqual([])
				expect(
					await authority.db.all(app.profiles.where({ userId }), { tier: ReadTier.Remote })
				).toEqual([])
				expect(
					await authority.db.all(app.organizationMembers.where({ userId }), {
						tier: ReadTier.Remote
					})
				).toEqual([])
				expect(
					await authority.db.all(app.categories.where({ organizationId: canonicalWorkspace }), {
						tier: ReadTier.Remote
					})
				).toEqual([])
				expect(
					await authority.db.one(app.organizations.where({ id: canonicalWorkspace }), {
						tier: ReadTier.Remote
					})
				).toMatchObject({ ownerId: userId, name: 'Existing occupied workspace' })
				return
			}
			for (const result of results) expect(result?.outcome).toBe('ready')
			const first = results[0]
			if (!first || first.outcome !== 'ready') throw new Error('Native initialization unavailable')
			expect(results[1]).toMatchObject({
				outcome: 'ready',
				identityId: first.identityId,
				workspaceId: first.workspaceId
			})
			// The native close API waits for these independent memory replicas' uploads.
			for (const session of sessions.slice(1)) await session.close()
			expect(errors).toEqual([])
			const profiles = await authority.db.all(app.profiles.where({ userId }), {
				tier: ReadTier.Remote
			})
			const workspaces = await authority.db.all(app.organizations.where({ ownerId: userId }), {
				tier: ReadTier.Remote
			})
			const members = await authority.db.all(app.organizationMembers.where({ userId }), {
				tier: ReadTier.Remote
			})
			expect(profiles).toHaveLength(1)
			expect(workspaces).toHaveLength(1)
			expect(members).toHaveLength(1)
			const categories = await authority.db.all(
				app.categories.where({ organizationId: first.workspaceId }),
				{ tier: ReadTier.Remote }
			)
			expect(categories.filter((row) => row.kind === 'expense')).toHaveLength(5)
			expect(categories.filter((row) => row.kind === 'income')).toHaveLength(3)
			expect(new Set(categories.map((row) => `${row.kind}:${row.name}`)).size).toBe(8)
			expect(profiles[0]).toMatchObject({
				id: first.identityId,
				initialWorkspaceId: first.workspaceId
			})
			expect(workspaces[0]).toMatchObject({ id: first.workspaceId, ownerId: userId })
			if (schedule === 'edited-after-discovery') {
				expect(workspaces[0]?.name).toBe('Edited after discovery')
				expect(profiles[0]?.displayName).toBe('Edited identity')
				expect(categories.find((row) => row.id === editedCategoryId)?.name).toBe(
					'Edited starter category'
				)
			}
			expect(members[0]).toMatchObject({
				organizationId: first.workspaceId,
				profileId: first.identityId,
				role: 'owner'
			})
		} finally {
			gate.resolve()
			for (const snapshot of snapshots) snapshot.resolve()
			for (const actor of actors) actor.stop()
			for (const session of sessions) await session.close()
			await authority.close()
			server.closeAllConnections()
			await new Promise<void>((resolve) => server.close(() => resolve()))
		}
	},
	30000
)
