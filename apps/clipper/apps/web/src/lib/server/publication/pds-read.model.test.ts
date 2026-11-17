import { it } from 'vitest'
import * as fc from 'fast-check'
import { assertTestCoverage, propertyTest, type TestSut } from '@xstate/test'
import {
	createActor,
	setup,
	SimulatedClock,
	toPromise,
	types,
	type EventFrom,
	type SnapshotFrom
} from 'xstate'
import { pdsRead } from './pds-read.js'

type Result = 'pending' | 'found' | 'notFound' | 'failed' | 'cancelled' | 'timedOut'
// Independent obligations: one request, one terminal observation, and loss of
// scope forbids acknowledging a later server response. Transport parsing and
// native body cleanup are exercised separately by concrete response fixtures.
const contract = setup({
	schemas: {
		context: types<{ result: Result; current: boolean }>(),
		events: {
			RESPONSE: types<{ outcome: 'found' | 'notFound' | 'failed' }>(),
			SCOPE: types(),
			CANCEL: types(),
			DEADLINE: types(),
			PULSE: types()
		}
	}
}).createMachine({
	initial: 'pending',
	context: { result: 'pending', current: true },
	states: {
		pending: {
			on: {
				RESPONSE: ({ context, event }) => ({
					target: 'settled',
					context: { result: context.current ? event.outcome : 'failed' }
				}),
				SCOPE: { context: { current: false } },
				CANCEL: { target: 'settled', context: { result: 'cancelled' } },
				DEADLINE: { target: 'settled', context: { result: 'timedOut' } },
				PULSE: {}
			}
		},
		settled: { on: { RESPONSE: {}, SCOPE: {}, CANCEL: {}, DEADLINE: {}, PULSE: {} } }
	}
})
const did = 'did:web:owner.example',
	uri = `at://${did}/at.margin.note/3jzfcijpj2z2a`
const record = { uri, value: { $type: 'at.margin.note', retained: true } }
function reply(outcome: 'found' | 'notFound' | 'failed') {
	return outcome === 'found'
		? Response.json(record)
		: outcome === 'notFound'
			? Response.json({ error: 'RecordNotFound' }, { status: 400 })
			: Response.json({ error: 'UpstreamFailure' }, { status: 503 })
}
const sut: TestSut<SnapshotFrom<typeof contract>, EventFrom<typeof contract>> = {
	create: async () => {
		let current = true,
			reads = 0,
			result: Result = 'pending'
		const gate = Promise.withResolvers<Response>(),
			entered = Promise.withResolvers<void>()
		const clock = new SimulatedClock()
		const actor = createActor(pdsRead, {
			clock,
			input: {
				uri,
				isCurrent: () => current,
				session: {
					did,
					handle: () => {
						reads++
						entered.resolve()
						return gate.promise
					}
				}
			}
		})
		const done = toPromise(actor).then(
			(output) => {
				result = output?.status ?? 'cancelled'
			},
			(error: unknown) => {
				result =
					error instanceof DOMException && error.name === 'AbortError'
						? 'cancelled'
						: error instanceof DOMException && error.name === 'TimeoutError'
							? 'timedOut'
							: 'failed'
			}
		)
		actor.start()
		await entered.promise
		return {
			async send(event) {
				if (result !== 'pending') {
					if (event.type === 'RESPONSE') {
						gate.resolve(reply(event.outcome))
						await Promise.resolve()
					}
					return
				}
				if (event.type === 'SCOPE') {
					current = false
					return
				}
				if (event.type === 'PULSE') return
				if (event.type === 'CANCEL') actor.send({ type: 'CANCEL' })
				if (event.type === 'DEADLINE') clock.increment(30_000)
				if (event.type === 'RESPONSE') gate.resolve(reply(event.outcome))
				await done
			},
			read() {
				return { result, current, reads }
			},
			async dispose() {
				actor.stop()
				gate.resolve(Response.json(record))
				await done
			}
		}
	},
	projectModel: (snapshot) => ({ ...snapshot.context, reads: 1 })
}

it('generates late replies, cancellation, deadlines and scope-loss schedules without reopening a terminal read', async () => {
	const { coverage } = await propertyTest(contract, {
		seed: 61117,
		numRuns: 100,
		maxCommands: 20,
		events: {
			RESPONSE: fc.record({ outcome: fc.constantFrom('found', 'notFound', 'failed') }),
			SCOPE: fc.constant({}),
			CANCEL: fc.constant({}),
			DEADLINE: fc.constant({}),
			PULSE: fc.constant({})
		},
		sut,
		failures: { dir: '.xstate-test', key: 'clipper-pds-read' }
	})
	assertTestCoverage(coverage, { stateNodes: 1, eventTypes: 1, transitions: 1 })
})
