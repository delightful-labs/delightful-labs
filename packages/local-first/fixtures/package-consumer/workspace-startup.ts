import assert from 'node:assert/strict'
import {
	createActor,
	createAsyncLogic,
	createStepLogic,
	setup,
	toPromise,
	types,
	waitFor,
	type SnapshotFrom
} from 'xstate'
import { createWorkspaceStartupOwner } from 'delightful-local-first/workspace/startup'
import type { WorkspaceInitializationReport } from 'delightful-local-first/workspace/startup-contracts'

type Result =
	| { outcome: 'ready'; identityId: string; workspaceId: string }
	| { outcome: 'failed'; settlement: 'unresolved' }
type Input = { result: Result }
type Report = WorkspaceInitializationReport<Result>
const work = createAsyncLogic({ run: async ({ input }: { input: Input }) => input.result })
const initialize = setup({
	schemas: {
		input: types<Input>(),
		context: types<Input>(),
		events: { CANCEL: types(), SHUTDOWN: types() },
		output: types<Result>()
	},
	actors: { work }
}).createMachine({
	context: ({ input }) => input,
	initial: 'working',
	output: ({ context }) => context.result,
	states: {
		working: {
			invoke: {
				src: 'work',
				input: ({ context }) => context,
				onDone: ({ event }) => ({ target: 'done', context: { result: event.output } })
			}
		},
		done: { type: 'final' }
	}
})
const startup = createWorkspaceStartupOwner<Input, Result, SnapshotFrom<typeof initialize>>({
	initialize,
	provenance: (result) =>
		result.outcome === 'ready'
			? { identityId: result.identityId, initialWorkspaceId: result.workspaceId }
			: undefined
})
const cases: Result[] = [
	{ outcome: 'ready', identityId: 'profile', workspaceId: 'initial-workspace' },
	{ outcome: 'failed', settlement: 'unresolved' }
]
for (const result of cases) {
	const recipient = createActor(
		createStepLogic({
			context: (): Report[] => [],
			run: ({ context, event }: { context: Report[]; event: Report }) => ({
				context: event.type === 'WORKSPACE_INITIALIZATION_RESULT' ? [...context, event] : context
			})
		})
	).start()
	const binding = Object.freeze({})
	const actor = createActor(startup, {
		input: { binding, initialization: { result }, recipient }
	}).start()
	try {
		await waitFor(recipient, (snapshot) => snapshot.context.length === 1)
		const report = recipient.getSnapshot().context[0]
		assert.equal(report?.binding, binding)
		assert.deepEqual(report?.initialization, result)
		assert.deepEqual(
			report?.provenance,
			result.outcome === 'ready'
				? { identityId: 'profile', initialWorkspaceId: 'initial-workspace' }
				: undefined
		)
		assert.equal(actor.getSnapshot().status, 'active')
		actor.send({ type: 'SHUTDOWN' })
		const output = await toPromise(actor)
		assert.equal(output.outcome, result.outcome === 'ready' ? 'closed' : 'unresolved')
		assert.deepEqual(output.initialization, result)
		assert.equal(recipient.getSnapshot().context.length, 1)
	} finally {
		actor.stop()
		recipient.stop()
	}
}
