// An independent test app owns its provenance and opaque database binding.
import { createActor, setup, types, toPromise } from 'xstate'
import { createWorkspaceInitialization } from 'delightful-local-first/workspace/initialization'
import { observeRow } from 'delightful-local-first/data/observations'
import 'delightful-local-first/workspace/startup'
import 'delightful-local-first/workspace/journal'
import 'delightful-local-first/workspace/creation-owner'
import 'delightful-local-first/workspace/creation-operation'
import 'delightful-local-first/workspace/creation-persistence'
import 'delightful-local-first/forms/workflow'
import 'delightful-local-first/forms/write'
import 'delightful-local-first/forms/policy'
import 'delightful-local-first/profile/workflow'
import 'delightful-local-first/profile/avatar'
import 'delightful-local-first/recovery/coordination'
import 'delightful-local-first/backend/jazz/startup'

/** @typedef {{db:object;attempt:{identityId:string;workspaceId:string};purpose?:'additional'|'bootstrap'}} Input */
/** @type {import('xstate').TypeSchema<Input>} */
const inputSchema = types()
/** @type {import('xstate').TypeSchema<{outcome:'committed'}>} */
const outputSchema = types()
const transaction = setup({
	schemas: {
		input: inputSchema,
		output: outputSchema,
		events: { CANCEL: types(), SHUTDOWN: types() }
	}
}).createMachine({
	initial: 'complete',
	states: { complete: { type: 'final' } },
	output: () => ({ outcome: 'committed' })
})
let reads = 0
const initialization = createWorkspaceInitialization({
	tiers: { local: 'cache', authority: 'server' },
	discover: async ({ tier }) => {
		reads++
		if (tier !== 'cache') throw new Error('Unexpected remote preflight')
		return {
			identities: [{ id: 'reader', initialWorkspaceId: 'test-app' }],
			workspaces: [],
			serverConfigured: true
		}
	},
	prepareInitial: async () => {
		throw new Error('Existing test app must not be replaced')
	},
	selectReady: (attempt) => attempt,
	transaction
})
const actor = createActor(initialization, { input: { db: {}, userId: 'reader' } }).start()
try {
	const result = await toPromise(actor)
	if (
		result.outcome !== 'ready' ||
		!('workspaceId' in result) ||
		result.workspaceId !== 'test-app' ||
		reads !== 1
	)
		throw new Error('Packaged local provenance changed')
} finally {
	actor.stop()
}
const native = { id: 'note', title: 'before' }
const snapshot = observeRow(native)
native.title = 'after'
if (snapshot?.title !== 'before') throw new Error('Packaged observation retained a mutable row')

// The optional adapter is usable through the built public subpath.
const { zodFormIssues } = await import('delightful-local-first/forms/zod')
const { z } = await import('zod')
const issues = zodFormIssues(
	new z.ZodError([{ code: 'custom', path: ['name'], message: 'private-message' }])
)
if (JSON.stringify(issues) !== JSON.stringify([{ path: ['name'], code: 'custom' }]))
	throw new Error('Packaged Zod adapter changed issue metadata')
