import { afterEach, describe, expect, it, vi } from 'vitest'
import { createActor, createAsyncLogic, setup, toPromise, types, type SnapshotFrom } from 'xstate'
import * as fc from 'fast-check'
import { createWorkspaceSeedOwner } from './startup.js'
import { deferred } from '../../../../tests/helpers/deferred.js'

type Input = { identityId: string }
type SeedInput = Input & { workspaceId: string }
type Result = { settlement: 'notStarted' | 'confirmed' | 'unresolved' }
const actors = new Set<{ stop(): void }>()
afterEach(() => {
	for (const actor of actors) actor.stop()
	actors.clear()
})

function fixture() {
	const completion = deferred<Result>()
	const seed = vi.fn((_input: SeedInput) => completion.promise)
	const shutdown = vi.fn()
	const work = createAsyncLogic({ run: ({ input }: { input: SeedInput }) => seed(input) })
	const child = setup({
		schemas: {
			input: types<SeedInput>(),
			context: types<{ input: SeedInput; result: Result }>(),
			events: { CANCEL: types(), SHUTDOWN: types() },
			output: types<Result>()
		},
		actors: { work }
	}).createMachine({
		context: ({ input }) => ({ input, result: { settlement: 'notStarted' } }),
		initial: 'working',
		output: ({ context }) => context.result,
		states: {
			working: {
				on: { SHUTDOWN: (_, enq) => enq(() => shutdown()) },
				invoke: {
					src: 'work',
					input: ({ context }) => context.input,
					onDone: ({ event }) => ({ target: 'done', context: { result: event.output } })
				}
			},
			done: { type: 'final' }
		}
	})
	const owner = createWorkspaceSeedOwner<Input, SeedInput, Result, SnapshotFrom<typeof child>>({
		seed: child,
		input: (input, workspaceId) => ({ ...input, workspaceId })
	})
	const actor = createActor(owner, { input: { identityId: 'identity' } }).start()
	actors.add(actor)
	return { actor, seed, shutdown, completion }
}

describe('optional workspace seed ownership', () => {
	it('closes without seed work when shutdown precedes initialization', async () => {
		const f = fixture()
		expect(f.seed).not.toHaveBeenCalled()
		f.actor.send({ type: 'SHUTDOWN' })
		expect(await toPromise(f.actor)).toEqual({ outcome: 'closed' })
		expect(f.seed).not.toHaveBeenCalled()
		expect(f.shutdown).not.toHaveBeenCalled()
	})

	it('binds one invocation to the first initialized workspace', async () => {
		const f = fixture()
		f.actor.send({ type: 'INITIALIZED', workspaceId: 'first' })
		f.actor.send({ type: 'INITIALIZED', workspaceId: 'other' })
		expect(f.seed).toHaveBeenCalledExactlyOnceWith({ identityId: 'identity', workspaceId: 'first' })
		f.completion.resolve({ settlement: 'confirmed' })
		expect(await toPromise(f.actor)).toEqual({ outcome: 'closed' })
	})

	it('retains issued work through duplicate shutdown and late initialization', async () => {
		const f = fixture()
		f.actor.send({ type: 'INITIALIZED', workspaceId: 'first' })
		f.actor.send({ type: 'SHUTDOWN' })
		f.actor.send({ type: 'SHUTDOWN' })
		f.actor.send({ type: 'INITIALIZED', workspaceId: 'other' })
		expect(f.shutdown).toHaveBeenCalledOnce()
		expect(f.seed).toHaveBeenCalledOnce()
		expect(f.actor.getSnapshot().status).toBe('active')
		f.completion.resolve({ settlement: 'confirmed' })
		expect(await toPromise(f.actor)).toEqual({ outcome: 'closed' })
	})

	it.each([false, true])('preserves unresolved settlement with shutdown=%s', async (closing) => {
		const f = fixture()
		f.actor.send({ type: 'INITIALIZED', workspaceId: 'workspace' })
		if (closing) f.actor.send({ type: 'SHUTDOWN' })
		f.completion.resolve({ settlement: 'unresolved' })
		expect(await toPromise(f.actor)).toEqual({ outcome: 'unresolved' })
	})

	it.each([false, true])('reports child failure with shutdown=%s', async (closing) => {
		const f = fixture()
		f.actor.send({ type: 'INITIALIZED', workspaceId: 'workspace' })
		if (closing) f.actor.send({ type: 'SHUTDOWN' })
		f.completion.reject(new Error('Seed failed'))
		expect(await toPromise(f.actor)).toEqual({ outcome: 'unresolved' })
	})

	it('closes when the seed policy declines work', async () => {
		const f = fixture()
		f.actor.send({ type: 'INITIALIZED', workspaceId: 'workspace' })
		f.completion.resolve({ settlement: 'notStarted' })
		expect(await toPromise(f.actor)).toEqual({ outcome: 'closed' })
	})

	it('admits at most the first workspace before shutdown across generated event sequences', async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.array(fc.constantFrom('first', 'other', 'shutdown'), { maxLength: 20 }),
				async (commands) => {
					const f = fixture()
					try {
						for (const command of commands) {
							if (command === 'shutdown') f.actor.send({ type: 'SHUTDOWN' })
							else f.actor.send({ type: 'INITIALIZED', workspaceId: command })
						}
						const admitted = commands[0]
						if (admitted !== undefined && admitted !== 'shutdown') {
							expect(f.seed).toHaveBeenCalledExactlyOnceWith({
								identityId: 'identity',
								workspaceId: admitted
							})
							expect(f.shutdown).toHaveBeenCalledTimes(commands.includes('shutdown') ? 1 : 0)
							expect(f.actor.getSnapshot().status).toBe('active')
							f.completion.resolve({ settlement: 'confirmed' })
						} else {
							expect(f.seed).not.toHaveBeenCalled()
							f.actor.send({ type: 'SHUTDOWN' })
						}
						expect(await toPromise(f.actor)).toEqual({ outcome: 'closed' })
					} finally {
						f.actor.stop()
						actors.delete(f.actor)
					}
				}
			),
			{ seed: 20261123, numRuns: 100 }
		)
	})
})
