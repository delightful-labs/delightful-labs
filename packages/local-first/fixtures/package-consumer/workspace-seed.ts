import assert from 'node:assert/strict'
import { createActor, createAsyncLogic, setup, toPromise, types, type SnapshotFrom } from 'xstate'
import { createWorkspaceSeedOwner } from 'delightful-local-first/workspace/startup'

type Input = { identityId: string }
type SeedInput = Input & { workspaceId: string }
type Result = { settlement: 'confirmed' | 'unresolved' }
let finish: ((result: Result) => void) | undefined
const completion = new Promise<Result>((resolve) => {
	finish = resolve
})
const inputs: SeedInput[] = []
let shutdowns = 0
const work = createAsyncLogic({
	run: ({ input }: { input: SeedInput }) => {
		inputs.push(input)
		return completion
	}
})
const seed = setup({
	schemas: {
		input: types<SeedInput>(),
		context: types<{ input: SeedInput; result: Result }>(),
		events: { CANCEL: types(), SHUTDOWN: types() },
		output: types<Result>()
	},
	actors: { work }
}).createMachine({
	context: ({ input }) => ({ input, result: { settlement: 'unresolved' } }),
	initial: 'working',
	output: ({ context }) => context.result,
	states: {
		working: {
			on: { SHUTDOWN: (_, enq) => enq(() => shutdowns++) },
			invoke: {
				src: 'work',
				input: ({ context }) => context.input,
				onDone: ({ event }) => ({ target: 'done', context: { result: event.output } })
			}
		},
		done: { type: 'final' }
	}
})
const owner = createWorkspaceSeedOwner<Input, SeedInput, Result, SnapshotFrom<typeof seed>>({
	seed,
	input: (input, workspaceId) => ({ ...input, workspaceId })
})
const actor = createActor(owner, { input: { identityId: 'identity' } }).start()
try {
	assert.equal(inputs.length, 0)
	actor.send({ type: 'INITIALIZED', workspaceId: 'admitted' })
	actor.send({ type: 'INITIALIZED', workspaceId: 'other' })
	assert.deepEqual(inputs, [{ identityId: 'identity', workspaceId: 'admitted' }])
	actor.send({ type: 'SHUTDOWN' })
	actor.send({ type: 'SHUTDOWN' })
	assert.equal(shutdowns, 1)
	assert.equal(actor.getSnapshot().status, 'active')
	if (!finish) throw new Error('Missing seed completion')
	finish({ settlement: 'confirmed' })
	assert.deepEqual(await toPromise(actor), { outcome: 'closed' })
} finally {
	actor.stop()
}
