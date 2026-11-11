import type { EventPayload } from '../../contracts/machine-events.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createActor, createCallbackLogic, createStepLogic, setup, waitFor, types } from 'xstate'
import { createScopedFormReadinessMachine } from './readiness.js'
import { formInterruptionResult } from '../../contracts/scoped-form.js'
import type {
	FormCapability,
	FormCapabilityReportEvent,
	FormChildEvent,
	FormObservation
} from '../../contracts/scoped-form.js'

type Scope = { binding: object; id: string }
type Facts = { scope: Scope; allowed: boolean; crash?: boolean }
type Observation = FormObservation<Facts>
type Capability = FormCapability<Scope, 'denied'>
type Report = FormCapabilityReportEvent<Scope, 'denied'>
const actors = new Set<{ stop: () => void }>()
afterEach(() => {
	for (const actor of actors) actor.stop()
	actors.clear()
})
function track<A extends { stop: () => void }>(actor: A): A {
	actors.add(actor)
	return actor
}
const sameScope = (a: Scope, b: Scope) => a.binding === b.binding && a.id === b.id
function fixture() {
	const observation: Observation = {
		revision: 1,
		facts: { scope: { binding: {}, id: 'A' }, allowed: true }
	}
	const source = createStepLogic({
		context: ({ input }: { input: Observation }) => input,
		run: ({ context, event }: { context: Observation; event: FormChildEvent<Facts> }) => ({
			context: ((context: Observation, event: FormChildEvent<Facts>) => {
				if (event.type !== 'OBSERVE') return context
				if (event.observation.facts.crash) throw new Error('policy crashed')
				return event.observation
			})(context, event)
		})
	})
	const selectAvailability = vi.fn(
		(snapshot: ReturnType<typeof source.getInitialSnapshot>): Capability => ({
			revision: snapshot.context.revision,
			scope: snapshot.context.facts.scope,
			readiness: snapshot.context.facts.allowed
				? { kind: 'ready' }
				: { kind: 'blocked', reason: 'denied' }
		})
	)
	const options = {
		availability: source,
		selectAvailability,
		scopeOf: (facts: Facts) => facts.scope,
		sameScope
	}
	const reporter = track(
		createActor(
			createStepLogic({
				context: (): Report[] => [],
				run: ({ context, event }: { context: Report[]; event: Report }) => ({
					context:
						event.type !== 'FORM_CAPABILITY_REPORTED'
							? context
							: ((reports: Report[], event: Report) => [...reports, event])(context, event)
				})
			})
		).start()
	)
	const token = { requestId: 8, scopeRevision: 4, generation: 12 }
	const create = (delivery: 'watch' | 'assessment' = 'watch', generation = 7) => {
		const actor = track(
			createActor(createScopedFormReadinessMachine(options), {
				input: {
					observation,
					delivery:
						delivery === 'watch'
							? { kind: 'watch', generation, recipient: reporter }
							: { kind: 'assessment', token }
				}
			})
		)
		const errors: unknown[] = []
		actor.subscribe({ error: (error) => errors.push(error) })
		return { actor, errors }
	}
	return {
		observation,
		options,
		selectAvailability,
		reporter,
		token,
		create,
		reports: () => reporter.getSnapshot().context
	}
}

describe('shared scoped form readiness', () => {
	it.each([true, false])(
		'returns the matching assessment and original token for allowed=%s',
		async (allowed) => {
			const f = fixture()
			f.observation.facts.allowed = allowed
			const { actor } = f.create('assessment')
			actor.start()
			const output = (await waitFor(actor, (s) => s.status === 'done')).output
			expect(output).toEqual({
				kind: 'assessed',
				token: f.token,
				capability: {
					revision: 1,
					scope: f.observation.facts.scope,
					readiness: allowed ? { kind: 'ready' } : { kind: 'blocked', reason: 'denied' }
				}
			})
			if (output?.kind !== 'assessed') throw new Error('Expected assessment')
			expect(output.token).toBe(f.token)
			expect(output.capability.scope).toBe(f.observation.facts.scope)
			expect(f.reports()).toEqual([])
		}
	)
	it('publishes current watch observations with the owner generation without mutating earlier facts', () => {
		const f = fixture()
		const { actor } = f.create()
		actor.start()
		const next = { revision: 2, facts: { ...f.observation.facts, allowed: false } }
		actor.send({ type: 'OBSERVE', observation: next })
		expect(
			f.reports().map((r) => [r.generation, r.capability.revision, r.capability.readiness.kind])
		).toEqual([
			[7, 1, 'ready'],
			[7, 2, 'blocked']
		])
		expect(f.observation.facts.allowed).toBe(true)
		expect(f.observation.revision).toBe(1)
	})
	it.each(['older', 'future', 'wrongScope'])(
		'rejects a %s projection instead of publishing it',
		(mismatch) => {
			const f = fixture()
			const { actor } = f.create()
			actor.start()
			f.selectAvailability.mockReturnValueOnce({
				revision: mismatch === 'older' ? 1 : mismatch === 'future' ? 3 : 2,
				scope: mismatch === 'wrongScope' ? { binding: {}, id: 'A' } : f.observation.facts.scope,
				readiness: { kind: 'ready' }
			})
			actor.send({ type: 'OBSERVE', observation: { ...f.observation, revision: 2 } })
			expect(f.reports()).toHaveLength(1)
			actor.send({ type: 'OBSERVE', observation: { ...f.observation, revision: 3 } })
			expect(f.reports()).toHaveLength(2)
			expect(f.reports()[1]?.capability.revision).toBe(3)
		}
	)
	it('does not confuse a replacement A binding with an earlier A after A to B to A', () => {
		const f = fixture()
		const { actor } = f.create()
		actor.start()
		actor.send({
			type: 'OBSERVE',
			observation: { revision: 2, facts: { scope: { binding: {}, id: 'B' }, allowed: true } }
		})
		const replacement = { binding: {}, id: 'A' }
		f.selectAvailability.mockReturnValueOnce({
			revision: 3,
			scope: f.observation.facts.scope,
			readiness: { kind: 'ready' }
		})
		actor.send({
			type: 'OBSERVE',
			observation: { revision: 3, facts: { scope: replacement, allowed: true } }
		})
		expect(f.reports()).toHaveLength(2)
		actor.send({
			type: 'OBSERVE',
			observation: { revision: 4, facts: { scope: replacement, allowed: true } }
		})
		expect(f.reports()[2]?.capability.scope).toBe(replacement)
	})
	it('keeps independent watcher generations and policy actors separate', () => {
		const f = fixture()
		const first = f.create('watch', 10).actor
		const second = f.create('watch', 11).actor
		first.start()
		second.start()
		first.stop()
		second.send({ type: 'OBSERVE', observation: { ...f.observation, revision: 2 } })
		expect(f.reports().map((r) => [r.generation, r.capability.revision])).toEqual([
			[10, 1],
			[11, 1],
			[11, 2]
		])
	})
	it('finishes failed when the policy actor crashes without publishing a new capability', async () => {
		const f = fixture()
		const { actor, errors } = f.create()
		actor.start()
		actor.send({
			type: 'OBSERVE',
			observation: { revision: 2, facts: { ...f.observation.facts, crash: true } }
		})
		expect((await waitFor(actor, (s) => s.status === 'done')).output).toEqual({ kind: 'failed' })
		expect(f.reports()).toHaveLength(1)
		expect(errors).toEqual([])
	})
	it('does not treat unexpected policy completion as readiness', async () => {
		const f = fixture()
		const source = setup({
			schemas: {
				context: types<{ observation: Observation }>(),
				events: {
					CANCEL: types<EventPayload<FormChildEvent<Facts>, 'CANCEL'>>(),
					SHUTDOWN: types<EventPayload<FormChildEvent<Facts>, 'SHUTDOWN'>>(),
					INVALIDATE: types<EventPayload<FormChildEvent<Facts>, 'INVALIDATE'>>(),
					OBSERVE: types<EventPayload<FormChildEvent<Facts>, 'OBSERVE'>>()
				},
				input: types<Observation>()
			}
		}).createMachine({
			initial: 'watching',
			context: ({ input }) => ({ observation: input }),
			states: {
				watching: {
					on: {
						OBSERVE: (args) => {
							return { target: 'finished', context: { observation: args.event.observation } }
						}
					}
				},
				finished: { type: 'final' }
			}
		})
		const actor = track(
			createActor(
				createScopedFormReadinessMachine({
					...f.options,
					availability: source,
					selectAvailability: (snapshot): Capability => ({
						revision: snapshot.context.observation.revision,
						scope: snapshot.context.observation.facts.scope,
						readiness: { kind: 'ready' }
					})
				}),
				{
					input: {
						observation: f.observation,
						delivery: { kind: 'watch', generation: 7, recipient: f.reporter }
					}
				}
			).start()
		)
		actor.send({ type: 'OBSERVE', observation: { ...f.observation, revision: 2 } })
		expect((await waitFor(actor, (s) => s.status === 'done')).output).toEqual({ kind: 'failed' })
		expect(f.reports()).toHaveLength(1)
	})
	it('propagates a throwing public projection to the invoking owner rather than granting readiness', () => {
		const f = fixture()
		const error = new Error('projection failed')
		f.selectAvailability.mockImplementation(() => {
			throw error
		})
		const { actor, errors } = f.create('assessment')
		actor.start()
		expect(actor.getSnapshot().status).toBe('error')
		expect(errors).toEqual([error])
		expect(f.reports()).toEqual([])
	})
	it('tears down its invoked policy source when its owner stops it', () => {
		const f = fixture()
		const cleanup = vi.fn()
		const source = createCallbackLogic<FormChildEvent<Facts>, Observation>(() => cleanup)
		const actor = track(
			createActor(
				createScopedFormReadinessMachine({
					...f.options,
					availability: source,
					selectAvailability: (): Capability => ({
						revision: 1,
						scope: f.observation.facts.scope,
						readiness: { kind: 'ready' }
					})
				}),
				{
					input: {
						observation: f.observation,
						delivery: { kind: 'watch', generation: 7, recipient: f.reporter }
					}
				}
			).start()
		)
		expect(cleanup).not.toHaveBeenCalled()
		actor.stop()
		expect(cleanup).toHaveBeenCalledTimes(1)
	})
})

describe('interrupted form outcomes', () => {
	it.each(['notStarted', 'locallyPersisted', 'unknown'] satisfies (
		| 'notStarted'
		| 'locallyPersisted'
		| 'unknown'
	)[])('preserves %s settlement and recovery evidence', (settlement) => {
		const checkpoint = { attempt: 'fixed' }
		expect(
			formInterruptionResult('scopeChanged', { outcome: 'closed', settlement, checkpoint })
		).toEqual({ outcome: 'scopeChanged', settlement, checkpoint })
	})
	it('defaults missing outcomes to uncertainty rather than claiming rollback', () => {
		expect(formInterruptionResult('cancelled', undefined)).toEqual({
			outcome: 'cancelled',
			settlement: 'unknown'
		})
	})
})
