// Domain-free readiness and actor-free outcome imports; no SDK, Svelte or browser context.
import { createActor, createStepLogic, toPromise } from 'xstate'
import { formInterruptionResult } from 'delightful-local-first/forms/contracts'
import { createWorkerFormViewSchema } from 'delightful-local-first/forms/worker'
import { z } from 'zod'
import { createScopedFormReadinessMachine } from 'delightful-local-first/forms/readiness'

const scope = { attachment: {}, project: 'consumer' }
const observation = { revision: 1, facts: { scope, allowed: true } }
/** @typedef {typeof observation} Observation */
/** @typedef {import('delightful-local-first/forms/contracts').FormChildEvent<Observation['facts']>} Event */
const policy = createStepLogic({
	context: (/** @type {{input:Observation}} */ { input }) => input,
	run: (/** @type {{context:Observation;event:Event}} */ { context, event }) => ({
		context: event.type === 'OBSERVE' ? event.observation : context
	})
})
const token = { requestId: 4, scopeRevision: 2, generation: 3 }
const actor = createActor(
	createScopedFormReadinessMachine({
		availability: policy,
		selectAvailability: (snapshot) => ({
			revision: snapshot.context.revision,
			scope: snapshot.context.facts.scope,
			readiness: snapshot.context.facts.allowed
				? { kind: 'ready' }
				: { kind: 'blocked', reason: 'projectUnavailable' }
		}),
		scopeOf: (/** @type {Observation['facts']} */ facts) => facts.scope,
		sameScope: (left, right) =>
			left.attachment === right.attachment && left.project === right.project
	}),
	{ input: { observation, delivery: { kind: 'assessment', token } } }
)
try {
	actor.start()
	const result = await toPromise(actor)
	if (
		result.kind !== 'assessed' ||
		result.token !== token ||
		result.capability.scope !== scope ||
		result.capability.readiness.kind !== 'ready'
	)
		throw new Error('Packaged readiness lost its scoped assessment')
	if (formInterruptionResult('closed', undefined).settlement !== 'unknown')
		throw new Error('Actor-free interruption discarded uncertainty')
} finally {
	actor.stop()
}

// The public worker boundary projects private recovery capabilities out of a view.
const wire = createWorkerFormViewSchema(z.string(), z.string())
const view = wire.parse({
	readiness: { kind: 'ready' },
	content: { kind: 'fields' },
	activity: { kind: 'idle' },
	feedback: {
		kind: 'result',
		result: {
			outcome: 'failed',
			code: 'operationFailed',
			settlement: 'unknown',
			checkpoint: () => undefined
		}
	},
	feedbackDescriptors: [{ section: 'result', message: 'unknown' }],
	canSubmit: false,
	canReset: false,
	canOpen: true,
	canCancel: false,
	fieldsEditable: false,
	canRetryReadiness: false,
	draftRevision: 0
})
structuredClone(view)
if (view.feedback.kind !== 'result' || 'checkpoint' in view.feedback.result)
	throw new Error('Packaged form view leaked a recovery capability')
