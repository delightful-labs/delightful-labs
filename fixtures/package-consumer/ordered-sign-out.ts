import assert from 'node:assert/strict'
import { createActor, SimulatedClock, toPromise } from 'xstate'
import { createOrderedSignOutMachine } from 'delightful-local-first/session/sign-out/workflow'
import type {
	OrderedSignOutInput,
	SignOutStage
} from 'delightful-local-first/session/sign-out/contracts'

let settle!: () => void
const pending = new Promise<void>((resolve) => {
	settle = resolve
})
const reports: SignOutStage[] = [],
	calls: string[] = []
const input: OrderedSignOutInput = {
	observeSession: () => 'current',
	provider: () => {
		calls.push('provider')
		return pending
	},
	session: async () => {
		calls.push('session')
	},
	providerDeadlineMs: 5,
	onOverdue: (stage) => reports.push(stage)
}
const clock = new SimulatedClock(),
	actor = createActor(createOrderedSignOutMachine(), { input, clock }).start()
clock.increment(5)
actor.send({ type: 'SHUTDOWN' })
assert.deepEqual(calls, ['provider'])
assert.deepEqual(reports, ['provider'])
assert.equal(actor.getSnapshot().status, 'active')
settle()
assert.deepEqual(await toPromise(actor), { outcome: 'completed' })
assert.deepEqual(calls, ['provider', 'session'])
