import { afterEach, expect, it, vi } from 'vitest'
import { createLoggedBankOperationMachine } from './logged-operation.js'
import { createSyncLogMachine } from './sync-log.js'
import { syncAttemptSchema } from '#lib/validation/bank-sync-log.js'
import { importFixture } from './import.fixture.js'
import { dependencies } from './test-fixtures.js'
import type {
	SyncLogStart,
	SyncLogCompletion,
	SyncLogAccountResult
} from '#lib/contracts/bank-sync-log.js'
import {
	createActor,
	setup,
	types,
	type ActorRefFrom,
	createCallbackLogic,
	toPromise,
	waitFor,
	createAsyncLogic
} from 'xstate'
import type { AnyActorRef } from 'xstate'

const parents: { stop: () => void }[] = []
afterEach(() => {
	vi.restoreAllMocks()
	for (const parent of parents.splice(0)) parent.stop()
})
function start(
	options: {
		begin?: (value: SyncLogStart) => Promise<void>
		finish?: (value: SyncLogCompletion) => Promise<void>
		command?: 'SYNC' | 'DISCOVER'
	} = {}
) {
	const f = importFixture(),
		deps = dependencies()
	const starts: SyncLogStart[] = [],
		results: SyncLogCompletion[] = []
	const accounts: SyncLogAccountResult[] = []
	const log = createSyncLogMachine(deps).provide({
		actors: {
			recordStart: createAsyncLogic<void, SyncLogStart>({
				run: async ({ input }) => {
					starts.push(input)
					await options.begin?.(input)
				}
			}),
			recordResult: createAsyncLogic<void, { start: SyncLogStart; result: SyncLogCompletion }>({
				run: async ({ input }) => {
					results.push(input.result)
					await options.finish?.(input.result)
				}
			}),
			recordAccount: createAsyncLogic<
				void,
				{ id: string; values: SyncLogAccountResult & { attemptId: string; organizationId: string } }
			>({
				run: async ({ input }) => {
					accounts.push(input.values)
				}
			})
		}
	})
	const logic = createLoggedBankOperationMachine(deps).provide({
		actors: { operation: f.operation, log }
	})
	const parent = createActor(
		setup({
			actors: { operation: logic },
			schemas: { children: { operation: types<ActorRefFrom<typeof logic>>() } }
		}).createMachine({
			invoke: {
				id: 'operation',
				src: 'operation',
				input: { command: { type: options.command ?? 'SYNC' }, discovered: [] }
			}
		})
	).start()
	parents.push(parent)
	const actor = parent.getSnapshot().children.operation
	if (!actor) throw new Error('Missing supervised bank operation')

	return { ...f, actor, starts, results, accounts }
}
it('records the start before fetching, and records account results only after the lock is released', async () => {
	let ready = false
	const f = start({
		begin: async () => {
			ready = true
		}
	})
	f.fetch.mockImplementation(async () => {
		expect(ready).toBe(true)
		const { response } = await import('./import.fixture.js')
		return response
	})
	const result = await toPromise(f.actor)
	expect(result).toMatchObject({
		kind: 'complete',
		counts: { imported: 3 },
		logging: { kind: 'recorded' }
	})
	expect(f.starts).toHaveLength(1)
	expect(f.results).toMatchObject([
		{ outcome: 'succeeded', importedCount: 3, importSettlement: 'locallyPersisted' }
	])
	expect(f.accounts).toMatchObject([
		{ accountName: 'Checking', importedCount: 1 },
		{ accountName: 'Savings', importedCount: 2 }
	])
	expect(f.release).toHaveBeenCalledOnce()
})
it.each(['write', 'invalid', 'crash'])(
	'imports when start logging fails through %s',
	async (mode) => {
		if (mode !== 'write') {
			const parse = syncAttemptSchema.safeParse.bind(syncAttemptSchema)
			vi.spyOn(syncAttemptSchema, 'safeParse').mockImplementation(() => {
				if (mode === 'crash') throw new Error('Unexpected log guard failure')
				return parse({})
			})
		}
		const f = start({
			begin: async () => {
				if (mode === 'write') throw new Error('write')
			}
		})
		const result = await toPromise(f.actor)
		expect(result).toMatchObject({
			kind: 'complete',
			counts: { imported: 3 },
			logging: {
				kind: 'notStarted',
				reason: mode === 'invalid' ? 'invalidStart' : 'startWriteFailed'
			}
		})
		expect(result.accountResults).toHaveLength(2)
		expect(f.stored.size).toBe(3)
		expect(f.fetch).toHaveBeenCalledOnce()
		expect(f.unlock).toHaveBeenCalledOnce()
		expect(f.acquire).toHaveBeenCalledOnce()
		expect(f.release).toHaveBeenCalledOnce()
		expect(f.starts).toHaveLength(mode === 'write' ? 1 : 0)
		expect(f.results).toHaveLength(0)
		expect(f.accounts).toHaveLength(0)
	}
)
it('preserves a provider failure independently of the failed start log', async () => {
	const f = start({
		begin: async () => {
			throw new Error('write')
		}
	})
	f.fetch.mockRejectedValue(new Error('provider-failure'))
	expect(await toPromise(f.actor)).toMatchObject({
		kind: 'failed',
		counts: { imported: 0 },
		logging: { kind: 'notStarted', reason: 'startWriteFailed' }
	})
	expect(f.fetch).toHaveBeenCalledOnce()
	expect(f.release).toHaveBeenCalledOnce()
	expect(f.results).toHaveLength(0)
})
it('records import failures with retained progress instead of an unexpected-error description', async () => {
	const f = start()
	f.persist.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Storage: failed'))
	await expect(toPromise(f.actor)).resolves.toMatchObject({
		kind: 'failed',
		counts: { imported: 1 },
		settlement: 'unresolved'
	})
	expect(f.results).toMatchObject([{ outcome: 'failed', importedCount: 1, failureCode: 'import' }])
	expect(f.accounts).toMatchObject([
		{ outcome: 'succeeded' },
		{ outcome: 'failed', failureCode: 'import' }
	])
	expect(f.fetch).toHaveBeenCalledOnce()
})
it('preserves specific mapping failures at the attempt level', async () => {
	const f = start()
	f.loadAccount.mockResolvedValue([])
	await expect(toPromise(f.actor)).resolves.toMatchObject({
		kind: 'failed',
		error: new Error('mapping')
	})
	expect(f.results).toMatchObject([{ outcome: 'failed', failureCode: 'mapping', importedCount: 0 }])
	expect(f.persist).not.toHaveBeenCalled()
})
it('drains an issued import on cancellation after start logging failed', async () => {
	const pending = Promise.withResolvers<void>()
	const f = start({
		begin: async () => {
			throw new Error('write')
		}
	})
	f.persist.mockReturnValueOnce(pending.promise)
	await vi.waitFor(() => expect(f.persist).toHaveBeenCalledOnce())
	f.actor.send({ type: 'CANCEL' })
	expect(f.actor.getSnapshot().status).toBe('active')
	expect(f.release).not.toHaveBeenCalled()
	pending.resolve()
	expect(await toPromise(f.actor)).toMatchObject({
		kind: 'cancelled',
		counts: { imported: 1 },
		logging: { kind: 'notStarted', reason: 'startWriteFailed' }
	})
	expect(f.persist).toHaveBeenCalledOnce()
	expect(f.release).toHaveBeenCalledOnce()
	expect(f.fetch).toHaveBeenCalledOnce()
})
it.each(['saved', 'rejected'])(
	'drains a %s start on cancellation without fetching',
	async (status) => {
		const pending = Promise.withResolvers<void>()
		const f = start({ begin: () => pending.promise })
		await vi.waitFor(() => expect(f.starts).toHaveLength(1))
		f.actor.send({ type: 'CANCEL' })
		if (status === 'saved') pending.resolve()
		else pending.reject(new Error('write'))
		expect(await toPromise(f.actor)).toMatchObject({
			kind: 'cancelled',
			error: undefined,
			counts: { imported: 0, existing: 0, omitted: 0 },
			accountResults: [],
			settlement: 'settled',
			logging:
				status === 'saved'
					? {
							kind: 'recorded',
							result: {
								outcome: 'cancelled',
								importSettlement: 'notStarted',
								importedCount: null,
								existingCount: null,
								omittedCount: null
							}
						}
					: { kind: 'notStarted', reason: 'startWriteFailed' }
		})
		expect(f.fetch).not.toHaveBeenCalled()
	}
)
it('preserves unknown counts when cancelled before unlocking finishes', async () => {
	const pending = Promise.withResolvers<string>()
	const f = start()
	f.unlock.mockReturnValue(pending.promise)
	await vi.waitFor(() => expect(f.unlock).toHaveBeenCalledOnce())
	f.actor.send({ type: 'CANCEL' })
	expect(await toPromise(f.actor)).toMatchObject({
		kind: 'cancelled',
		accountResults: [],
		logging: {
			kind: 'recorded',
			result: {
				outcome: 'cancelled',
				importedCount: null,
				existingCount: null,
				omittedCount: null
			}
		}
	})
	expect(f.fetch).not.toHaveBeenCalled()
	pending.resolve('https://unused.example')
})
it('records known zero counts for a completed empty sync', async () => {
	const f = start()
	f.fetch.mockResolvedValue({ errors: [], accounts: [] })
	expect(await toPromise(f.actor)).toMatchObject({
		kind: 'complete',
		accountResults: [],
		logging: {
			kind: 'recorded',
			result: {
				outcome: 'succeeded',
				importedCount: 0,
				existingCount: 0,
				omittedCount: 0
			}
		}
	})
})
it('waits for final logging after bank cleanup and preserves imports when the log write fails', async () => {
	const pending = Promise.withResolvers<void>()
	const f = start({ finish: () => pending.promise })
	await vi.waitFor(() => expect(f.results).toHaveLength(1))
	expect(f.release).toHaveBeenCalledOnce()
	expect(f.actor.getSnapshot().status).toBe('active')
	f.actor.send({ type: 'CANCEL' })
	pending.reject(new Error('write'))
	expect(await toPromise(f.actor)).toMatchObject({
		kind: 'complete',
		counts: { imported: 3 },
		logging: { kind: 'resultUnrecorded', reason: 'resultWriteFailed' }
	})
	expect(f.fetch).toHaveBeenCalledOnce()
})
it('drains an issued import on cancellation and logs its actual partial counts', async () => {
	const pending = Promise.withResolvers<void>()
	const f = start()
	f.persist.mockResolvedValueOnce(undefined).mockReturnValueOnce(pending.promise)
	await vi.waitFor(() => expect(f.persist).toHaveBeenCalledTimes(2))
	f.actor.send({ type: 'CANCEL' })
	expect(f.release).not.toHaveBeenCalled()
	expect(f.results).toHaveLength(0)
	pending.resolve()
	expect(await toPromise(f.actor)).toMatchObject({
		kind: 'cancelled',
		counts: { imported: 2 },
		logging: { kind: 'recorded', result: { outcome: 'cancelled', importedCount: 2 } }
	})
	expect(f.release).toHaveBeenCalledOnce()
})
it('passes discovery through without creating a sync attempt', async () => {
	const f = start({ command: 'DISCOVER' })
	expect(await toPromise(f.actor)).toMatchObject({ kind: 'complete' })
	expect(f.starts).toHaveLength(0)
	expect(f.results).toHaveLength(0)
	expect(f.fetch).toHaveBeenCalledOnce()
})

it('preserves successful imports when the logging actor unexpectedly crashes at completion', async () => {
	const parse = syncAttemptSchema.safeParse.bind(syncAttemptSchema)
	vi.spyOn(syncAttemptSchema, 'safeParse').mockImplementation((value) => {
		if (
			typeof value === 'object' &&
			value !== null &&
			'outcome' in value &&
			value.outcome !== 'unfinished'
		)
			throw new Error('Unexpected log guard failure')
		return parse(value)
	})
	const f = start()
	expect(await toPromise(f.actor)).toMatchObject({
		kind: 'complete',
		counts: { imported: 3 },
		logging: { kind: 'resultUnrecorded', reason: 'resultWriteFailed' }
	})
	expect(f.release).toHaveBeenCalledOnce()
	expect(f.fetch).toHaveBeenCalledOnce()
})
it('drains an issued import after the logging actor crashes, including later cancellation', async () => {
	const pending = Promise.withResolvers<void>(),
		f = start()
	f.persist.mockResolvedValueOnce(undefined).mockReturnValueOnce(pending.promise)
	await vi.waitFor(() => expect(f.persist).toHaveBeenCalledTimes(2))
	const log = f.actor.getSnapshot().children.log
	if (!log) throw new Error('Missing log actor')
	log.send({
		type: 'FINISH',
		result: {
			get outcome(): 'succeeded' {
				throw new Error('Unexpected log guard failure')
			},
			finishedAt: new Date(),
			importSettlement: 'locallyPersisted',
			failureCode: null,
			importedCount: 2,
			existingCount: 0,
			omittedCount: 0
		}
	})
	await waitFor(f.actor, (snapshot) => snapshot.matches({ logged: { operating: 'logFailed' } }))
	expect(f.release).not.toHaveBeenCalled()
	f.actor.send({ type: 'CANCEL' })
	expect(f.release).not.toHaveBeenCalled()
	pending.resolve()
	expect(await toPromise(f.actor)).toMatchObject({
		kind: 'cancelled',
		counts: { imported: 2 },
		logging: { kind: 'resultUnrecorded', result: { outcome: 'cancelled', importedCount: 2 } }
	})
	expect(f.release).toHaveBeenCalledOnce()
})
