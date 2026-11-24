import assert from 'node:assert/strict'
import { createActor, setup, types, type EventFromLogic, type SnapshotFrom } from 'xstate'
import { createWorkspaceResourceOwner } from 'delightful-local-first/workspace/resource'
import type { WorkspaceLease } from 'delightful-local-first/workspace/contracts'
import type { WorkspaceResourceInput } from 'delightful-local-first/workspace/resource-contracts'

type Input = { lease: WorkspaceLease; label: string }
const acquired: WorkspaceLease[] = []
const shutdown: WorkspaceLease[] = []
const values: number[] = []
let release = () => {}
const resource = setup({
	schemas: {
		input: types<Input>(),
		context: types<Input & { value: number }>(),
		output: types<{ clean: true }>(),
		events: { SHUTDOWN: types(), RELEASE: types(), VALUE: types<{ value: number }>() }
	}
}).createMachine({
	initial: 'active',
	context: ({ input }) => ({ ...input, value: 0 }),
	output: () => ({ clean: true }),
	entry: ({ context, self }, enq) =>
		enq(() => {
			acquired.push(context.lease)
			release = () => self.send({ type: 'RELEASE' })
		}),
	states: {
		active: {
			on: {
				VALUE: ({ event }, enq) => {
					enq(() => values.push(event.value))
					return { context: { value: event.value } }
				},
				SHUTDOWN: ({ context }, enq) => {
					enq(() => shutdown.push(context.lease))
					return { target: 'draining' }
				}
			}
		},
		draining: { on: { RELEASE: { target: 'closed' }, SHUTDOWN: {} } },
		closed: { type: 'final' }
	}
})
const owner = createWorkspaceResourceOwner<
	{ label: string },
	Input,
	EventFromLogic<typeof resource>,
	SnapshotFrom<typeof resource>,
	{ value: number; label: string }
>({
	resource,
	input: (lease, binding) => ({ lease, label: binding.label }),
	shutdown: { type: 'SHUTDOWN' },
	view: (snapshot) => ({ value: snapshot.context.value, label: snapshot.context.label }),
	failed: (snapshot) => snapshot.status === 'error',
	settlement: (output) => (output?.clean === true ? 'released' : 'unresolved')
})
const scope = { binding: {}, attachment: {} }
const input: WorkspaceResourceInput<{ label: string }> = { scope, binding: { label: 'consumer' } }
const actor = createActor(owner.logic, { input }).start()
let attempt = 0
function select(workspaceId: string) {
	const request = { workspaceId, attempt: ++attempt }
	actor.send({ type: 'SELECT', scope, request })
	actor.send({
		type: 'OBSERVED',
		observation: {
			scope,
			request,
			generation: 0,
			access: 'allowed',
			directory: { status: 'available', entries: [] }
		}
	})
}
select('A')
const a = acquired[0]
if (!a) throw new Error('Missing A')
actor.send({ type: 'RESOURCE_COMMAND', lease: a, command: { type: 'VALUE', value: 9 } })
assert.deepEqual(owner.selectReport(actor.getSnapshot()).view, { label: 'consumer', value: 9 })
select('B')
actor.send({ type: 'RESOURCE_COMMAND', lease: a, command: { type: 'VALUE', value: 10 } })
assert.equal(acquired.length, 1)
assert.deepEqual(shutdown, [a])
release()
assert.equal(acquired.length, 2)
assert.equal(acquired[1]?.request.workspaceId, 'B')
assert.deepEqual(values, [9])
actor.send({ type: 'SHUTDOWN' })
release()
assert.equal(owner.selectReport(actor.getSnapshot()).status, 'closed')
assert.deepEqual(actor.getSnapshot().output, { outcome: 'closed' })

function invalidCommands(lease: WorkspaceLease) {
	// @ts-expect-error A resource command retains its concrete payload type.
	actor.send({ type: 'RESOURCE_COMMAND', lease, command: { type: 'VALUE', value: 'wrong' } })
	// @ts-expect-error The owner alone issues resource shutdown after obtaining its drain token.
	actor.send({ type: 'RESOURCE_COMMAND', lease, command: { type: 'SHUTDOWN' } })
	// @ts-expect-error A caller cannot acknowledge a resource drain on the owner's behalf.
	actor.send({ type: 'DRAINED', drain: { token: {}, lease } })
}
void invalidCommands
actor.stop()
