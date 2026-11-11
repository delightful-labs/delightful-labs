import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
	FormCapability,
	FormCapabilityReportEvent,
	FormChildEvent,
	FormObservation
} from '#lib/contracts/form-contract.js'
import { createScopedFormWriteMachine } from './scoped-form-write.js'
import { createScopedFormReadinessMachine } from './scoped-form-readiness.js'
import { createScopedFormMachine, selectScopedFormView } from './scoped-form.js'
import { fixture, ready, success, type Facts } from './scoped-form.fixture.js'
import { createActor, isMachineSnapshot, setup, waitFor, types, createStepLogic } from 'xstate'
import type { SnapshotFrom } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'
import { collectEvents } from '../report-collector.fixture.js'

type ReadinessFacts = Facts & {
	reportRevision?: number
	reportScope?: string
	sourceFailure?: 'crash' | 'done'
}
const cleanup: (() => void)[] = []
afterEach(() => {
	for (const stop of cleanup.splice(0)) stop()
})
function domain() {
	const events0 = {
		INVALIDATE: types<EventPayload<FormChildEvent<ReadinessFacts>, 'INVALIDATE'>>(),
		CANCEL: types<EventPayload<FormChildEvent<ReadinessFacts>, 'CANCEL'>>(),
		SHUTDOWN: types<EventPayload<FormChildEvent<ReadinessFacts>, 'SHUTDOWN'>>(),
		OBSERVE: types<EventPayload<FormChildEvent<ReadinessFacts>, 'OBSERVE'>>()
	}
	type NativeEvent0 =
		| import('xstate').InferEvents<typeof events0>
		| import('xstate').DoneActorEvent<never>
		| import('xstate').ErrorActorEvent
	const source = setup({
		schemas: {
			context: types<{ observation: FormObservation<ReadinessFacts> }>(),
			events: events0,
			input: types<FormObservation<ReadinessFacts>>()
		}
	}).createMachine({
		context: ({ input }) => ({ observation: input }),
		initial: 'checking',
		on: {
			OBSERVE: (args) => {
				return { target: '.checking', context: { observation: args.event.observation } }
			}
		},
		states: {
			checking: {
				always: (args) => {
					const { context } = args
					if (context.observation.facts.sourceFailure === 'crash') {
						return { target: 'crashed' }
					}
					if (context.observation.facts.sourceFailure === 'done') {
						return { target: 'done' }
					}
					return { target: 'active' }
				}
			},
			active: {},
			crashed: {
				entry: () => {
					throw new Error('private source failure')
				}
			},
			done: { type: 'final' }
		}
	})
	const selectAvailability = (
		snapshot: SnapshotFrom<typeof source>
	): FormCapability<string, string> => {
		const { revision, facts } = snapshot.context.observation
		if (facts.broken) throw new Error('private projection failure')
		return {
			revision: facts.publish === false ? -1 : (facts.reportRevision ?? revision),
			scope: facts.reportScope ?? facts.scope,
			readiness: facts.allowed ? { kind: 'ready' } : { kind: 'blocked', reason: 'readOnly' }
		}
	}
	return {
		availability: source,
		selectAvailability,
		scopeOf: (facts: ReadinessFacts) => facts.scope,
		sameScope: (a: string, b: string) => a === b
	}
}
function adapter(facts: ReadinessFacts = ready, mode: 'watch' | 'assessment' = 'watch') {
	const options = domain()
	const reports = collectEvents<FormCapabilityReportEvent<string, string>>()
	const errors: unknown[] = []
	const delivery =
		mode === 'watch'
			? ({ kind: 'watch', generation: 8, recipient: reports } satisfies {
					kind: 'watch'
					generation: number
					recipient: typeof reports
				})
			: ({
					kind: 'assessment',
					token: { requestId: 3, scopeRevision: 4, generation: 5 }
				} satisfies {
					kind: 'assessment'
					token: { requestId: number; scopeRevision: number; generation: number }
				})
	const actor = createActor(createScopedFormReadinessMachine(options), {
		input: { observation: { revision: 7, facts }, delivery }
	})
	actor.subscribe({ error: (error) => errors.push(error) })
	actor.start()
	cleanup.push(
		() => actor.stop(),
		() => reports.stop()
	)
	return { actor, errors, reports: () => reports.getSnapshot().context }
}
function owner() {
	const base = fixture()
	const options = { ...base.config, ...domain() }
	const actor = createActor(
		createScopedFormMachine<
			{ name: string },
			void,
			string,
			string,
			ReadinessFacts,
			SnapshotFrom<typeof options.availability>,
			SnapshotFrom<typeof options.operation>
		>(options),
		{ input: ready }
	).start()
	cleanup.push(() => actor.stop())
	const view = () => selectScopedFormView(actor.getSnapshot(), options)
	const source = () => {
		const child = actor.getSnapshot().children.availability?.getSnapshot().children.source
		if (!child) throw new Error('Expected readiness source')
		return child
	}
	const report = (generation: number, revision: number, scope = ready.scope, allowed = true) =>
		actor.send({
			type: 'FORM_CAPABILITY_REPORTED',
			generation,
			capability: {
				revision,
				scope,
				readiness: allowed ? { kind: 'ready' } : { kind: 'blocked', reason: 'readOnly' }
			}
		})
	return {
		...base,
		actor,
		view,
		source,
		report,
		submit: () => actor.send({ type: 'SUBMIT', values: { name: 'Home' } })
	}
}

describe('readiness adapter public protocol', () => {
	it.each([true, false])(
		'publishes ongoing readiness (allowed: %s) with the supplied generation',
		(allowed) => {
			const f = adapter({ ...ready, allowed })
			expect(f.reports()).toEqual([
				{
					type: 'FORM_CAPABILITY_REPORTED',
					generation: 8,
					capability: {
						revision: 7,
						scope: ready.scope,
						readiness: allowed ? { kind: 'ready' } : { kind: 'blocked', reason: 'readOnly' }
					}
				}
			])
			expect(f.actor.getSnapshot().status).toBe('active')
			f.actor.send({
				type: 'OBSERVE',
				observation: { revision: 8, facts: { ...ready, allowed: !allowed } }
			})
			expect(f.reports().at(-1)?.capability).toMatchObject({
				revision: 8,
				readiness: { kind: allowed ? 'blocked' : 'ready' }
			})
		}
	)
	it.each([true, false])(
		'returns a finite assessment (allowed: %s) without sending watch reports',
		(allowed) => {
			const f = adapter({ ...ready, allowed }, 'assessment')
			expect(f.actor.getSnapshot().status).toBe('done')
			expect(f.actor.getSnapshot().output).toEqual({
				kind: 'assessed',
				token: { requestId: 3, scopeRevision: 4, generation: 5 },
				capability: {
					revision: 7,
					scope: ready.scope,
					readiness: allowed ? { kind: 'ready' } : { kind: 'blocked', reason: 'readOnly' }
				}
			})
			expect(f.reports()).toEqual([])
		}
	)
	for (const mode of ['watch', 'assessment'] satisfies ('watch' | 'assessment')[]) {
		it.each([
			{ publish: false },
			{ reportRevision: 6 },
			{ reportRevision: 8 },
			{ reportScope: 'other' }
		])(`ignores provisional/stale/wrong-scope projections in ${mode}`, (change) => {
			const f = adapter({ ...ready, ...change }, mode)
			expect(f.actor.getSnapshot().status).toBe('active')
			expect(f.reports()).toEqual([])
			const child = f.actor.getSnapshot().children.source
			if (!child) throw new Error('Expected source')
			child.send({ type: 'OBSERVE', observation: { revision: 7, facts: ready } })
			if (mode === 'watch') expect(f.reports()).toHaveLength(1)
			else expect(f.actor.getSnapshot().output?.kind).toBe('assessed')
		})
		it.each(['crash', 'done'] satisfies ('crash' | 'done')[])(
			`supervises source startup %s in ${mode}`,
			(sourceFailure) => {
				const f = adapter({ ...ready, sourceFailure }, mode)
				expect(f.actor.getSnapshot().output).toEqual(
					mode === 'assessment'
						? { kind: 'failed', token: { requestId: 3, scopeRevision: 4, generation: 5 } }
						: { kind: 'failed' }
				)
				expect(f.reports()).toEqual([])
			}
		)
		it.each(['crash', 'done'] satisfies ('crash' | 'done')[])(
			`supervises a later source %s in ${mode}`,
			(sourceFailure) => {
				const f = adapter({ ...ready, publish: false }, mode)
				const child = f.actor.getSnapshot().children.source
				if (!child) throw new Error('Expected source')
				child.send({
					type: 'OBSERVE',
					observation: { revision: 7, facts: { ...ready, sourceFailure } }
				})
				expect(f.actor.getSnapshot().output).toEqual(
					mode === 'assessment'
						? { kind: 'failed', token: { requestId: 3, scopeRevision: 4, generation: 5 } }
						: { kind: 'failed' }
				)
				expect(f.reports()).toEqual([])
			}
		)
		it(`exposes projection errors to the invoking supervisor in ${mode}`, () => {
			const f = adapter({ ...ready, broken: true }, mode)
			expect(f.actor.getSnapshot().status).toBe('error')
			expect(f.errors).toHaveLength(1)
			expect(f.reports()).toEqual([])
		})
	}
})

describe('form readiness generation and failure ownership', () => {
	it('immediately withdraws readiness and rejects old A reports after A to B to A', () => {
		const f = owner()
		const generation = f.actor.getSnapshot().context.watchGeneration
		f.actor.send({ type: 'OBSERVE', observation: { ...ready, scope: 'b', publish: false } })
		f.actor.send({ type: 'OBSERVE', observation: { ...ready, publish: false } })
		expect(f.actor.getSnapshot().context.capability).toBeUndefined()
		expect(f.view().readiness.kind).toBe('observing')
		f.report(generation, 0)
		f.report(generation, 2, 'b')
		f.report(generation - 1, 2)
		f.submit()
		expect(f.view().canSubmit).toBe(false)
		expect(f.started).not.toHaveBeenCalled()
		f.source().send({ type: 'OBSERVE', observation: { revision: 2, facts: ready } })
		expect(f.view().canSubmit).toBe(true)
		expect(f.started).not.toHaveBeenCalled()
	})
	it('uses a new watcher generation on retry at the same observation revision', () => {
		const f = owner()
		const generation = f.actor.getSnapshot().context.watchGeneration
		f.source().send({
			type: 'OBSERVE',
			observation: { revision: 0, facts: { ...ready, sourceFailure: 'crash' } }
		})
		expect(f.view().readiness.kind).toBe('failed')
		f.report(generation, 0)
		expect(f.view().canSubmit).toBe(false)
		f.actor.send({ type: 'RETRY_READINESS' })
		expect(f.actor.getSnapshot().context.observation?.revision).toBe(0)
		expect(f.actor.getSnapshot().context.watchGeneration).toBe(generation + 1)
		expect(f.view().canSubmit).toBe(true)
		f.report(generation, 0, ready.scope, false)
		expect(f.view().readiness.kind).toBe('ready')
	})
	it.each(['crash', 'done'] satisfies ('crash' | 'done')[])(
		'drains an active write after watcher %s, preserving shutdown priority',
		async (sourceFailure) => {
			const f = owner()
			f.submit()
			await waitFor(f.actor, () => f.view().activity.kind === 'operating')
			expect(f.started).toHaveBeenCalledTimes(1)
			const generation = f.actor.getSnapshot().context.watchGeneration
			f.source().send({
				type: 'OBSERVE',
				observation: { revision: 0, facts: { ...ready, sourceFailure } }
			})
			expect(f.view().readiness.kind).toBe('failed')
			expect(f.view().activity).toEqual({ kind: 'settling', reason: 'scopeChanged' })
			f.report(generation, 0)
			f.actor.send({ type: 'RETRY_READINESS' })
			expect(f.actor.getSnapshot().context.watchGeneration).toBe(generation)
			expect(f.aborted).not.toHaveBeenCalled()
			f.actor.send({ type: 'SHUTDOWN' })
			f.actor.send({ type: 'RETRY_READINESS' })
			f.report(generation, 0)
			f.actor.send({ type: 'CANCEL' })
			f.settlement.resolve(success)
			await waitFor(f.actor, (snapshot) => snapshot.status === 'done')
			expect(f.view().readiness.kind).toBe('closed')
			expect(f.started).toHaveBeenCalledTimes(1)
		}
	)
})

describe('finite readiness with the real write owner', () => {
	function writeOwner(initial: ReadinessFacts) {
		let facts = initial
		const saved = Promise.withResolvers<void>()
		const write = vi.fn(() => saved.promise)
		const policy = domain()
		const machine = createScopedFormWriteMachine<
			{ name: string },
			void,
			string,
			string,
			ReadinessFacts,
			SnapshotFrom<typeof policy.availability>
		>({
			...policy,
			observe: () => facts,
			write,
			classifyBlocked: () => 'denied',
			settlement: 'locallyPersisted'
		})
		const actor = createActor(machine, {
			input: {
				request: { id: 1, scope: ready.scope, scopeRevision: 0, values: { name: 'Home' } },
				observation: { revision: 0, facts }
			}
		}).start()
		cleanup.push(() => actor.stop())
		const observe = (next: ReadinessFacts, revision: number) => {
			facts = next
			actor.send({ type: 'OBSERVE', observation: { revision, facts } })
		}
		const review = () => {
			const child = Object.values(actor.getSnapshot().children).find(
				(child) => child?.id === 'review'
			)
			if (!child) throw new Error('Expected readiness assessment')
			return child
		}
		const source = () => {
			const snapshot = review().getSnapshot()
			if (!isMachineSnapshot(snapshot)) throw new Error('Expected readiness statechart')
			const child = snapshot.children.source
			if (!child) throw new Error('Expected domain source')
			return child
		}
		return { actor, observe, review, source, saved, write }
	}
	it.each(['crash', 'done'] satisfies ('crash' | 'done')[])(
		'returns failure/notStarted when finite source ends with %s',
		async (sourceFailure) => {
			const f = writeOwner({ ...ready, sourceFailure })
			const done = await waitFor(f.actor, (s) => s.status === 'done')
			expect(done.output).toEqual({
				outcome: 'failed',
				code: 'operationFailed',
				settlement: 'notStarted'
			})
			expect(f.write).not.toHaveBeenCalled()
		}
	)
	it('rechecks newer facts before issuing a write and abandons the superseded assessment', async () => {
		const f = writeOwner({ ...ready, publish: false })
		await waitFor(f.actor, (s) => s.matches('authorizing'))
		const firstGeneration = f.actor.getSnapshot().context.assessmentGeneration
		const old = f.review()
		f.observe({ ...ready, publish: false }, 1)
		expect(old.getSnapshot().status).toBe('stopped')
		expect(f.actor.getSnapshot().context.assessmentGeneration).toBe(firstGeneration + 1)
		expect(f.write).not.toHaveBeenCalled()
		f.source().send({ type: 'OBSERVE', observation: { revision: 1, facts: ready } })
		await waitFor(f.actor, (s) => s.matches({ writing: 'pending' }))
		expect(f.write).toHaveBeenCalledTimes(1)
		f.saved.resolve()
		const done = await waitFor(f.actor, (s) => s.status === 'done')
		expect(done.output).toMatchObject({ outcome: 'succeeded', settlement: 'locallyPersisted' })
	})
	it.each(['assessed', 'failed', 'error'])(
		'does not use a queued old %s completion after observation replacement',
		async (outcome) => {
			const f = writeOwner({ ...ready, publish: false })
			await waitFor(f.actor, (s) => s.matches('authorizing'))
			const old = f.review()
			const subscription = old.subscribe({
				next: (snapshot) => {
					if (snapshot.status === 'done') f.observe({ ...ready, publish: false }, 1)
				},
				error: () => f.observe({ ...ready, publish: false }, 1)
			})
			cleanup.push(() => subscription.unsubscribe())
			f.source().send({
				type: 'OBSERVE',
				observation: {
					revision: 0,
					facts:
						outcome === 'failed'
							? { ...ready, sourceFailure: 'crash' }
							: outcome === 'error'
								? { ...ready, broken: true }
								: ready
				}
			})
			expect(f.actor.getSnapshot().matches('authorizing')).toBe(true)
			expect(f.write).not.toHaveBeenCalled()
			f.source().send({ type: 'OBSERVE', observation: { revision: 1, facts: ready } })
			await waitFor(f.actor, (s) => s.matches({ writing: 'pending' }))
			f.saved.resolve()
			await waitFor(f.actor, (s) => s.status === 'done')
			expect(f.write).toHaveBeenCalledTimes(1)
		}
	)
})
