import { it } from 'vitest'
import * as fc from 'fast-check'
import { assertTestCoverage, propertyTest, type TestSut } from '@xstate/test'
import {
	createActor,
	SimulatedClock,
	setup,
	types,
	waitFor,
	type EventFrom,
	type SnapshotFrom
} from 'xstate'
import { createOrderedSignOutMachine } from './ordered-sign-out.js'
import type { OrderedSignOutResult, SignOutStage } from '../../contracts/sign-out.js'

// Independent receipt ledger: only acknowledged provider success authorizes the
// second call. Feedback expiry and shutdown are never operation receipts.
const contract = setup({
	schemas: {
		context: types<{
			calls: number
			receipts: number
			reports: SignOutStage[]
			result: OrderedSignOutResult | undefined
		}>(),
		events: { SUCCEED: types(), REJECT: types(), EXPIRE: types(), SHUTDOWN: types() }
	}
}).createMachine({
	context: { calls: 1, receipts: 0, reports: [], result: undefined },
	initial: 'first',
	states: {
		first: {
			on: {
				SUCCEED: { target: 'second', context: { calls: 2, receipts: 1 } },
				REJECT: {
					target: 'settled',
					context: { result: { outcome: 'failed', stage: 'provider' } }
				},
				EXPIRE: ({ context }) => ({
					context: {
						reports: context.reports.includes('provider')
							? context.reports
							: [...context.reports, 'provider']
					}
				}),
				SHUTDOWN: {}
			}
		},
		second: {
			on: {
				SUCCEED: { target: 'settled', context: { receipts: 2, result: { outcome: 'completed' } } },
				REJECT: { target: 'settled', context: { result: { outcome: 'failed', stage: 'session' } } },
				EXPIRE: ({ context }) => ({
					context: {
						reports: context.reports.includes('session')
							? context.reports
							: [...context.reports, 'session']
					}
				}),
				SHUTDOWN: {}
			}
		},
		settled: { on: { SUCCEED: {}, REJECT: {}, EXPIRE: {}, SHUTDOWN: {} } }
	}
})
const sut: TestSut<SnapshotFrom<typeof contract>, EventFrom<typeof contract>> = {
	create: () => {
		const first = deferred(),
			second = deferred(),
			clock = new SimulatedClock()
		const reports: SignOutStage[] = []
		let calls = 0,
			receipts = 0
		const actor = createActor(createOrderedSignOutMachine(), {
			clock,
			input: {
				provider: () => {
					calls++
					return first.promise.then(() => {
						receipts++
					})
				},
				session: () => {
					calls++
					return second.promise.then(() => {
						receipts++
					})
				},
				providerDeadlineMs: 5,
				sessionDeadlineMs: 5,
				onOverdue: (stage) => reports.push(stage)
			}
		}).start()
		return {
			async send(event) {
				if (event.type === 'EXPIRE') clock.increment(5)
				else if (event.type === 'SHUTDOWN') actor.send(event)
				else if (actor.getSnapshot().status === 'active') {
					const call = calls === 1 ? first : second,
						before = calls
					if (event.type === 'SUCCEED') call.resolve()
					else call.reject(new Error('Selected native rejection'))
					await waitFor(actor, (s) => s.status === 'done' || calls > before, { timeout: 1000 })
				}
			},
			read: () => ({ calls, receipts, reports, result: actor.getSnapshot().output }),
			dispose: () => {
				actor.stop()
				first.resolve()
				second.resolve()
			}
		}
	},
	projectModel: (snapshot) => snapshot.context
}
it('generates provider/native settlement, expiry and shutdown schedules without false success or replay', async () => {
	const { coverage } = await propertyTest(contract, {
		seed: 20261117,
		numRuns: 120,
		maxCommands: 12,
		events: {
			SUCCEED: fc.constant({}),
			REJECT: fc.constant({}),
			EXPIRE: fc.constant({}),
			SHUTDOWN: fc.constant({})
		},
		sut,
		failures: { dir: '.xstate-test', key: 'ordered-sign-out' }
	})
	assertTestCoverage(coverage, { stateNodes: 1, eventTypes: 1, transitions: 1 })
})

function deferred() {
	let resolve!: () => void, reject!: (error: Error) => void
	const promise = new Promise<void>((accept, refuse) => {
		resolve = accept
		reject = refuse
	})
	return { promise, resolve, reject }
}
