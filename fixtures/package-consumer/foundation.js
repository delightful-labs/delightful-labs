// An independent notebook app owns its provenance and opaque database binding.
import { createActor, setup, toPromise } from 'xstate'
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

/** @type {{events?:import('delightful-local-first/workspace/initialization').InitializationEvent;input?:{db:object;attempt:{profileId:string;organizationId:string};purpose?:'additional'|'bootstrap'};output?:{outcome:'committed'}}} */
const types = {}
const transaction = setup({ types }).createMachine({
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
			profiles: [{ id: 'reader', initialWorkspaceId: 'notebook' }],
			organizations: [],
			serverConfigured: true
		}
	},
	prepareInitial: async () => {
		throw new Error('Existing notebook must not be replaced')
	},
	transaction
})
const actor = createActor(initialization, { input: { db: {}, userId: 'reader' } }).start()
try {
	const result = await toPromise(actor)
	if (
		result.outcome !== 'ready' ||
		!('organizationId' in result) ||
		result.organizationId !== 'notebook' ||
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
