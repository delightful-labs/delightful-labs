import { expect, it } from 'vitest'
import * as fc from 'fast-check'
import { assertTestCoverage, propertyTest, type TestSut } from '@xstate/test'
import { setup, types, waitFor, type EventFrom, type SnapshotFrom } from 'xstate'
import { fixture, roots, selection } from './account-store.test-support.js'
import { WorkerHostError } from '../../src/lib/runtime/worker/host-protocol.js'

// Independent obligation contract. An issued write keeps the lock until its
// acknowledgement or a real closed-host receipt, even through shutdown/drain failure.
const contract = setup({
	schemas: {
		context: types<{ result: 'updated' | 'unknown' | null; stopped: boolean }>(),
		events: {
			SHUTDOWN: types(),
			ACK_WRITE: types(),
			LOSE_ACK: types(),
			ACK_CLOSE: types(),
			FAIL_CLOSE: types(),
			CLOSED_REPORT: types(),
			STALE_CLOSE: types()
		}
	}
}).createMachine({
	initial: 'writing',
	context: { result: null, stopped: false },
	on: { SHUTDOWN: () => ({ context: { stopped: true } }) },
	states: {
		writing: {
			on: {
				ACK_WRITE: { target: 'done', context: { result: 'updated' } },
				LOSE_ACK: { target: 'draining' },
				CLOSED_REPORT: { target: 'done', context: { result: 'unknown' } }
			}
		},
		draining: {
			on: {
				ACK_CLOSE: { target: 'done', context: { result: 'unknown' } },
				FAIL_CLOSE: { target: 'retained' },
				CLOSED_REPORT: { target: 'done', context: { result: 'unknown' } }
			}
		},
		retained: { on: { CLOSED_REPORT: { target: 'done', context: { result: 'unknown' } } } },
		done: {
			on: {
				ACK_WRITE: {},
				LOSE_ACK: {},
				ACK_CLOSE: {},
				FAIL_CLOSE: {},
				CLOSED_REPORT: {},
				STALE_CLOSE: {}
			}
		}
	}
})
const sut: TestSut<SnapshotFrom<typeof contract>, EventFrom<typeof contract>> = {
	create: async () => {
		const f = fixture({ kind: 'update', transform: () => selection([roots[2]!]) })
		await f.enteredWrite.promise
		let settled = false
		return {
			async send(event) {
				if (f.actor.getSnapshot().status === 'done') return
				if (event.type === 'SHUTDOWN') f.actor.send(event)
				else if (event.type === 'STALE_CLOSE')
					f.actor.send({ type: 'HOST_CLOSED', scope: crypto.randomUUID() })
				else if (event.type === 'CLOSED_REPORT') {
					f.closeHost()
					await waitFor(f.actor, (snapshot) => snapshot.status === 'done')
				} else if (event.type === 'ACK_WRITE' && !settled) {
					settled = true
					f.defaultWrite.resolve()
					await waitFor(f.actor, (snapshot) => snapshot.status === 'done')
				} else if (event.type === 'LOSE_ACK' && !settled) {
					settled = true
					f.defaultWrite.reject(new WorkerHostError('timeout', 'unknown'))
					await f.enteredClose.promise
				} else if (
					event.type === 'ACK_CLOSE' &&
					f.storage.closeHostAndDrain.mock.calls.length &&
					f.actor.getSnapshot().matches({ updating: { work: 'draining' } })
				) {
					f.defaultClose.resolve()
					await waitFor(f.actor, (snapshot) => snapshot.status === 'done')
				} else if (
					event.type === 'FAIL_CLOSE' &&
					f.storage.closeHostAndDrain.mock.calls.length &&
					f.actor.getSnapshot().matches({ updating: { work: 'draining' } })
				) {
					f.defaultClose.reject(new Error('unobserved close'))
					await waitFor(f.actor, (snapshot) => snapshot.matches({ updating: { work: 'retained' } }))
				}
			},
			async read() {
				const snapshot = f.actor.getSnapshot(),
					output = snapshot.output
				return {
					held: await f.held(),
					result:
						output?.kind === 'updated'
							? 'updated'
							: output?.kind === 'failed'
								? output.writeOutcome
								: null,
					issued: f.storage.writePrimary.mock.calls.length
				}
			},
			async dispose() {
				if (f.actor.getSnapshot().status !== 'done') {
					f.closeHost()
					await waitFor(f.actor, (snapshot) => snapshot.status === 'done')
				}
				expect(await f.held()).toBe(false)
			}
		}
	},
	projectModel: (snapshot) => ({
		held: !snapshot.matches('done'),
		result: snapshot.context.result,
		issued: 1
	})
}
it('generates cancellation, stale reports, failed drain and unknown-write custody', async () => {
	const empty = fc.constant({})
	const { coverage } = await propertyTest(contract, {
		seed: 60401,
		numRuns: 100,
		maxCommands: 20,
		events: {
			SHUTDOWN: empty,
			ACK_WRITE: empty,
			LOSE_ACK: empty,
			ACK_CLOSE: empty,
			FAIL_CLOSE: empty,
			CLOSED_REPORT: empty,
			STALE_CLOSE: empty
		},
		sut,
		failures: { dir: '.xstate-test', key: 'finance-account-store-custody' },
		temporal: [
			{
				type: 'sometimes',
				id: 'shutdown-with-unknown-result',
				predicate: ({ snapshot }) =>
					snapshot.context.stopped && snapshot.context.result === 'unknown'
			}
		]
	})
	assertTestCoverage(coverage, { stateNodes: 1, eventTypes: 1, transitions: 1 })
})
