import { expect, it } from 'vitest'
import { createActor, setup, types, type SnapshotFrom } from 'xstate'
import type { FormCapability, FormObservation } from '../../contracts/scoped-form.js'
import { createSingleWriteFormOptions } from './policy.js'
import { createScopedFormMachine, selectScopedFormView } from './scoped-form.js'

it('binds initial and replacement readiness to the generation accepted by the form', () => {
	type Facts = { scope: string; crash: boolean }
	const facts: Facts = { scope: 'account', crash: false }
	const availability = setup({
		schemas: {
			context: types<FormObservation<Facts>>(),
			input: types<FormObservation<Facts>>(),
			events: {
				OBSERVE: types<{ observation: FormObservation<Facts> }>(),
				CANCEL: types(),
				SHUTDOWN: types(),
				INVALIDATE: types()
			}
		}
	}).createMachine({
		context: ({ input }) => input,
		on: {
			OBSERVE: ({ event }) => {
				if (event.observation.facts.crash) throw new Error('Controlled policy failure')
				return { context: event.observation }
			}
		}
	})
	const options = createSingleWriteFormOptions({
		mode: 'create',
		schema: { parseAsync: async () => ({ name: 'Saved' }) },
		settlement: 'locallyPersisted',
		availability,
		selectAvailability: (
			snapshot: SnapshotFrom<typeof availability>
		): FormCapability<string, string> => ({
			revision: snapshot.context.revision,
			scope: snapshot.context.facts.scope,
			readiness: { kind: 'ready' }
		}),
		scopeOf: (value: Facts) => value.scope,
		sameScope: (left: string, right: string) => left === right,
		observe: () => facts,
		classifyBlocked: () => 'unavailable',
		write: async () => undefined
	})
	const message = () => 'Test feedback'
	const logic = createScopedFormMachine(options, {
		validationIssues: () => undefined,
		messages: {
			unknown: message,
			loading: message,
			loadFailed: message,
			saved: message,
			completionFailed: message,
			interruptedSaved: message,
			archiveFailed: message,
			saveFailed: message,
			settling: message
		}
	})
	const actor = createActor(logic, { input: facts }).start()
	try {
		const generation = actor.getSnapshot().context.watchGeneration
		expect(selectScopedFormView(actor.getSnapshot(), options).canSubmit).toBe(true)
		actor.send({ type: 'OBSERVE', observation: { ...facts, crash: true } })
		expect(selectScopedFormView(actor.getSnapshot(), options).canRetryReadiness).toBe(true)
		actor.send({ type: 'OBSERVE', observation: facts })
		actor.send({ type: 'RETRY_READINESS' })
		expect(actor.getSnapshot().context.watchGeneration).toBe(generation + 1)
		expect(selectScopedFormView(actor.getSnapshot(), options).canSubmit).toBe(true)
		actor.send({
			type: 'FORM_CAPABILITY_REPORTED',
			generation,
			capability: {
				revision: 2,
				scope: facts.scope,
				readiness: { kind: 'blocked', reason: 'stale' }
			}
		})
		expect(selectScopedFormView(actor.getSnapshot(), options).canSubmit).toBe(true)
	} finally {
		actor.stop()
	}
})
