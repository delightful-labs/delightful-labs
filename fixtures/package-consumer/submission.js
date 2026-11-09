// Independent parser and finite operation: no Zod, Finance schema, SDK or browser globals.
import { createActor, setup, types, toPromise, createAsyncLogic } from 'xstate'
import { createScopedFormSubmissionMachine } from 'delightful-local-first/forms/submission'

/** @typedef {{ name: string }} Values */
/** @typedef {{ attachment: object }} Scope */
/** @typedef {{ project: string }} Facts */
/** @typedef {import('delightful-local-first/forms/contracts').FormOperationInput<Values, Scope, Facts>} Input */
/** @typedef {import('delightful-local-first/forms/contracts').FormOperationResult<string, never>} Output */
/** @param {{ input: Input }} args @returns {Promise<Output>} */
async function save({ input }) {
	return { outcome: 'succeeded', value: input.request.values.name, settlement: 'locallyPersisted' }
}
/** @typedef {import('delightful-local-first/forms/contracts').FormChildEvent<Facts>} Event */
/** @typedef {{ input: Input; result: Output | undefined }} Context */
/** @type {import('xstate').TypeSchema<Context>} */
const contextSchema = types()
/** @type {import('xstate').TypeSchema<Input>} */
const inputSchema = types()
/** @type {import('xstate').TypeSchema<Output>} */
const outputSchema = types()
/** @type {import('xstate').TypeSchema<Omit<Extract<Event,{type:'OBSERVE'}>,'type'>>} */
const observeSchema = types()
const operation = setup({
	schemas: {
		context: contextSchema,
		input: inputSchema,
		output: outputSchema,
		events: { OBSERVE: observeSchema, CANCEL: types(), SHUTDOWN: types(), INVALIDATE: types() }
	},
	actors: { save: createAsyncLogic({ run: save }) }
}).createMachine({
	initial: 'saving',
	context: ({ input }) => ({ input, result: undefined }),
	output: ({ context }) => {
		if (!context.result) throw new Error('Missing synthetic save result')
		return context.result
	},
	states: {
		saving: {
			invoke: {
				src: 'save',
				input: ({ context }) => context.input,
				onDone: (args) => {
					return { target: 'finished', context: { result: args.event.output } }
				},
				onError: () => {
					return {
						target: 'finished',
						context: {
							result: { outcome: 'failed', code: 'operationFailed', settlement: 'unknown' }
						}
					}
				}
			}
		},
		finished: { type: 'final' }
	}
})
const logic = createScopedFormSubmissionMachine({
	schema: {
		parseAsync: async (raw) => {
			if (
				typeof raw !== 'object' ||
				raw === null ||
				!('name' in raw) ||
				typeof raw.name !== 'string' ||
				!raw.name.trim()
			)
				throw new TypeError('Synthetic invalid name')
			return { name: raw.name.trim() }
		}
	},
	validationIssues: (error) =>
		error instanceof TypeError ? [{ path: ['name'], code: 'invalid' }] : undefined,
	operation
})
const scope = { attachment: {} }
for (const name of [' Project ', ' ']) {
	const actor = createActor(logic, {
		input: {
			request: { id: 1, scope, scopeRevision: 2, values: { name } },
			observation: { revision: 4, facts: { project: 'consumer' } }
		}
	})
	try {
		actor.start()
		const result = await toPromise(actor)
		if (name.trim()) {
			if (
				result.outcome !== 'succeeded' ||
				result.value !== 'Project' ||
				result.settlement !== 'locallyPersisted'
			)
				throw new Error('Packaged submission lost its validated result')
		} else if (result.outcome !== 'invalid' || result.issues[0]?.code !== 'invalid') {
			throw new Error('Packaged submission lost consumer validation issues')
		}
	} finally {
		actor.stop()
	}
}
