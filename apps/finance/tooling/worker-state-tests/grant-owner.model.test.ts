import { setImmediate } from 'node:timers/promises'
import { expect, it } from 'vitest'
import * as fc from 'fast-check'
import { assertTestCoverage, propertyTest, type TestSut } from '@xstate/test'
import { setup, types, type EventFrom, type SnapshotFrom } from 'xstate'
import { grantFixture } from '../../src/lib/machines/runtime/worker-grant-owner.test-support.js'

// Independent external obligation ledger: accepted resources, public readiness,
// notifications and original deadlines. No production actor states/context.
type Ledger = {
	now: number
	retiredAt: number | undefined
	acquiredAt: number | undefined
	closeAt: number | undefined
	uncertain: boolean
	acquired: number
	available: number
	rejected: number
	issues: string[]
	output: 'closed' | 'not-issued' | undefined
	stopped: boolean
}
const contract = setup({
	schemas: {
		context: types<{ ledger: Ledger }>(),
		events: {
			READY: types<{ current: boolean }>(),
			UNCERTAIN: types<{ current: boolean }>(),
			REFUSE: types<{ current: boolean }>(),
			RETIRE: types(),
			ELAPSE: types<{ ms: number }>(),
			ACK: types<{ current: boolean }>(),
			STOP: types()
		}
	}
}).createMachine({
	context: {
		ledger: {
			now: 0,
			retiredAt: undefined,
			acquiredAt: undefined,
			closeAt: undefined,
			uncertain: false,
			acquired: 0,
			available: 0,
			rejected: 0,
			issues: [],
			output: undefined,
			stopped: false
		}
	},
	initial: 'exercising',
	states: {
		exercising: {
			on: {
				READY: ({ context, event }) => {
					const r = context.ledger
					if (r.output || r.stopped) return
					if (!event.current || r.acquired)
						return { context: { ledger: { ...r, rejected: r.rejected + 1 } } }
					const usable = r.retiredAt === undefined && !r.uncertain && r.now < 10
					return {
						context: {
							ledger: {
								...r,
								acquiredAt: r.now,
								acquired: 1,
								available: usable ? 1 : 0,
								closeAt: usable ? undefined : r.now
							}
						}
					}
				},
				UNCERTAIN: ({ context, event }) => {
					const r = context.ledger
					if (r.output || r.stopped) return
					if (!event.current || r.acquired)
						return { context: { ledger: { ...r, rejected: r.rejected + 1 } } }
					return r.uncertain
						? undefined
						: {
								context: {
									ledger: { ...r, uncertain: true, issues: [...r.issues, 'acquisition-uncertain'] }
								}
							}
				},
				REFUSE: ({ context, event }) => {
					const r = context.ledger
					if (r.output || r.stopped) return
					return !event.current || r.acquired
						? { context: { ledger: { ...r, rejected: r.rejected + 1 } } }
						: {
								context: {
									ledger: {
										...r,
										output: 'not-issued',
										issues: [...r.issues, 'acquisition-refused']
									}
								}
							}
				},
				RETIRE: ({ context }) => {
					const r = context.ledger
					if (r.output || r.stopped) return
					return {
						context: {
							ledger: {
								...r,
								retiredAt: r.retiredAt ?? r.now,
								closeAt: r.acquired ? (r.closeAt ?? r.now) : undefined
							}
						}
					}
				},
				ELAPSE: ({ context, event }) => {
					const r = context.ledger
					if (r.output || r.stopped) return
					const now = r.now + event.ms
					const crossedAcquisition = !r.acquired && r.now < 10 && now >= 10
					const crossedClose =
						r.closeAt !== undefined && r.now < r.closeAt + 7 && now >= r.closeAt + 7
					return {
						context: {
							ledger: {
								...r,
								now,
								issues: [
									...r.issues,
									...(crossedAcquisition ? ['acquisition-overdue'] : []),
									...(crossedClose ? ['channel-overdue'] : [])
								]
							}
						}
					}
				},
				ACK: ({ context, event }) => {
					const r = context.ledger
					if (r.output || r.stopped || !event.current || r.closeAt === undefined) return
					return { context: { ledger: { ...r, output: 'closed' } } }
				},
				STOP: ({ context }) =>
					context.ledger.output
						? undefined
						: { context: { ledger: { ...context.ledger, stopped: true } } }
			}
		}
	}
})
type Observation = {
	acquired: number
	available: number
	rejected: number
	issues: string[]
	output: string | undefined
	closePosts: number
	postCount: number
}
async function flushNative() {
	await setImmediate()
	await setImmediate()
}
const sut: TestSut<SnapshotFrom<typeof contract>, EventFrom<typeof contract>> = {
	async create() {
		const f = grantFixture({ manual: true })
		await flushNative()
		return {
			async send(event) {
				if (f.parent.getSnapshot().status !== 'active') return
				if (event.type === 'READY')
					f.parent.send({
						type: 'GRANT_REPLY',
						reply: {
							...f.ready,
							runtimeId: event.current
								? f.identity.runtimeId
								: '11111111-1111-4111-8111-111111111111'
						}
					})
				else if (event.type === 'UNCERTAIN' || event.type === 'REFUSE')
					f.parent.send({
						type: 'GRANT_REPLY',
						reply: {
							version: 1,
							...f.identity,
							runtimeId: event.current
								? f.identity.runtimeId
								: '11111111-1111-4111-8111-111111111111',
							type: event.type === 'UNCERTAIN' ? 'GRANT_UNCERTAIN' : 'GRANT_REFUSED',
							reason: 'unavailable'
						}
					})
				else if (event.type === 'RETIRE') f.retire()
				else if (event.type === 'ELAPSE') f.clock.increment(event.ms)
				else if (event.type === 'ACK') {
					// A native host can acknowledge only a close request it received.
					if (f.commands.length)
						f.control.port1.postMessage({
							version: 1,
							...f.close,
							type: 'HOST_CLOSED',
							requestId: event.current ? f.close.requestId : '11111111-1111-4111-8111-111111111111'
						})
				} else f.parent.stop()
				await flushNative()
			},
			read(): Observation {
				const reports = f.reports()
				return {
					acquired: reports.filter((r) => r.type === 'GRANT_ACQUIRED').length,
					available: reports.filter((r) => r.type === 'GRANT_AVAILABLE').length,
					rejected: reports.filter((r) => r.type === 'GRANT_REPLY_REJECTED').length,
					issues: f.issues(),
					output: f.parent.getSnapshot().output?.kind,
					closePosts: f.commands.length,
					postCount: f.postAcquire.mock.calls.length
				}
			},
			dispose() {
				f.dispose()
			}
		}
	},
	projectModel: ({ context }): Observation => ({
		acquired: context.ledger.acquired,
		available: context.ledger.available,
		rejected: context.ledger.rejected,
		issues: context.ledger.issues,
		output: context.ledger.output,
		closePosts: context.ledger.closeAt === undefined ? 0 : 1,
		postCount: 1
	})
}
it('matches generated acquisition, retirement, uncertainty, deadline, foreign/duplicate reply and close obligations', async () => {
	const { coverage } = await propertyTest(contract, {
		events: {
			READY: fc.record({ current: fc.boolean() }),
			UNCERTAIN: fc.record({ current: fc.boolean() }),
			REFUSE: fc.record({ current: fc.boolean() }),
			RETIRE: fc.constant({}),
			ELAPSE: fc.record({ ms: fc.integer({ min: 0, max: 12 }) }),
			ACK: fc.record({ current: fc.boolean() }),
			STOP: fc.constant({})
		},
		sut,
		seed: 20261114,
		numRuns: 400,
		maxCommands: 24,
		temporal: [
			{
				type: 'sometimes',
				id: 'late-grant-closes-without-availability',
				predicate: ({ snapshot }) =>
					snapshot.context.ledger.acquired === 1 &&
					snapshot.context.ledger.available === 0 &&
					snapshot.context.ledger.output === 'closed'
			},
			{
				type: 'sometimes',
				id: 'available-grant-closes-after-retirement',
				predicate: ({ snapshot }) =>
					snapshot.context.ledger.available === 1 && snapshot.context.ledger.output === 'closed'
			}
		],
		failures: { key: 'worker-grant-owner' }
	})
	expect(() =>
		assertTestCoverage(coverage, { eventTypes: 1, stateNodes: 1, transitions: 1 })
	).not.toThrow()
})
