import { expect, it } from 'vitest'
import * as fc from 'fast-check'
import { assertTestCoverage, propertyTest, testPaths, type TestSut } from '@xstate/test'
import {
	createActor,
	createCallbackLogic,
	setup,
	types,
	type EventFrom,
	type SnapshotFrom
} from 'xstate'
import type { SessionReadinessReport, SessionStatus } from '../../contracts/session.js'
import { createSessionReadinessMachine } from './session-readiness.js'

// Independent contract: a bound observer publishes current facts until shutdown;
// foreign scopes/epochs cannot publish, and shutdown releases exactly once.
const contract = setup({
	schemas: {
		context: types<{ statuses: SessionStatus[]; releases: number }>(),
		events: {
			NOTIFY: types<{ status: SessionStatus }>(),
			STALE: types<{ foreignScope: boolean; status: SessionStatus }>(),
			SHUTDOWN: types<{}>()
		}
	}
}).createMachine({
	initial: 'observing',
	context: { statuses: ['ready'], releases: 0 },
	states: {
		observing: {
			on: {
				NOTIFY: ({ context, event }) => ({
					context: { statuses: [...context.statuses, event.status] }
				}),
				STALE: {},
				SHUTDOWN: { target: 'closed', context: { releases: 1 } }
			}
		},
		closed: { type: 'final' }
	}
})

const sut: TestSut<SnapshotFrom<typeof contract>, EventFrom<typeof contract>> = {
	create: () => {
		const reports: SessionReadinessReport[] = []
		const recipient = createActor(
			createCallbackLogic<SessionReadinessReport>(({ receive }) =>
				receive((report) => reports.push(report))
			)
		).start()
		let status: SessionStatus = 'ready'
		let notify = () => {}
		let releases = 0
		const scope = { binding: {}, attachment: {} }
		const capability = {
			readStatus: () => status,
			subscribe: (listener: () => void) => {
				notify = listener
				return () => {
					releases += 1
				}
			},
			retry: async () => {
				throw new Error('Unexpected retry')
			}
		}
		const actor = createActor(createSessionReadinessMachine(), {
			input: { reportTo: recipient }
		}).start()
		actor.send({ type: 'BIND', scope, capability })
		return {
			send(event) {
				if (event.type === 'NOTIFY') {
					status = event.status
					notify()
				}
				if (event.type === 'STALE') {
					actor.send({
						type: 'OBSERVED',
						scope: event.foreignScope ? { ...scope, attachment: {} } : scope,
						observation: event.foreignScope ? 0 : 1,
						status: event.status,
						afterRetry: undefined
					})
				}
				if (event.type === 'SHUTDOWN') {
					actor.send({ type: 'SHUTDOWN' })
					// A callback retained by the backend must be inert after release.
					notify()
				}
			},
			read() {
				const snapshot = actor.getSnapshot()
				expect(reports.every((report) => report.type === 'SESSION_STATUS')).toBe(true)
				if (snapshot.status === 'done') {
					expect(snapshot.output).toEqual({ outcome: 'closed' })
					expect(snapshot.context.capability).toBeUndefined()
					expect(snapshot.context.scope).toBeUndefined()
				} else {
					expect(snapshot.status).toBe('active')
					expect(snapshot.matches({ bound: 'observing' })).toBe(true)
				}
				return {
					phase: snapshot.status === 'done' ? 'closed' : 'observing',
					statuses: reports.flatMap((report) =>
						report.type === 'SESSION_STATUS' ? [report.status] : []
					),
					releases
				}
			},
			dispose() {
				actor.stop()
				recipient.stop()
			}
		}
	},
	projectModel: (snapshot) => ({ phase: snapshot.value, ...snapshot.context })
}
const status = fc.constantFrom<SessionStatus>(
	'ready',
	'signed-out',
	'transitioning',
	'error',
	'closed'
)
const events = {
	NOTIFY: fc.record({ status }),
	STALE: fc.record({ foreignScope: fc.boolean(), status }),
	SHUTDOWN: fc.constant({})
}

it('matches generated observation, stale-report and shutdown sequences', async () => {
	const { coverage } = await propertyTest(contract, {
		events,
		sut,
		seed: 20261109,
		numRuns: 250,
		maxCommands: 50,
		failures: { key: 'session-readiness-observation' }
	})
	assertTestCoverage(coverage, { eventTypes: 1, stateNodes: 1 })
})

it('matches bounded shortest observation and shutdown paths', async () => {
	const { coverage } = await testPaths(contract, {
		events,
		sut,
		limit: 500,
		stopWhen: (snapshot) => snapshot.context.statuses.length >= 3,
		failures: { key: 'session-readiness-observation-paths' }
	})
	assertTestCoverage(coverage, { stateNodes: 1 })
})
