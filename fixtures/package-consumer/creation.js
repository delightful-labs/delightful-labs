// A domain-free consumer: no Jazz client, router, browser globals, or Finance schema.
import { createActor, toPromise } from 'xstate'
import { createWorkspaceCreationTransaction } from 'delightful-local-first/workspace/creation/workflow'
import 'delightful-local-first/workspace/creation/contracts'

/** @type {import('delightful-local-first/workspace/creation/contracts').WorkspaceCreationTransactionCapability<
 * { name: string }, { staged: boolean }, { exists: boolean }, { id: string }, { local: Promise<void> }
 * >} */
const capability = {
	open: () => ({ staged: false }),
	readLocal: () => ({ exists: false }),
	assess: (records) =>
		records.exists ? { outcome: 'blocked', reason: 'conflict' } : { outcome: 'eligible' },
	stage: (transaction, attempt) => {
		transaction.staged = true
		return { id: attempt.workspaceId }
	},
	commit: () => ({ local: Promise.resolve() }),
	persistLocal: (write) => write.local,
	rollback: () => true
}
const attempt = {
	operationId: 'creation',
	workspaceId: 'workspace',
	membershipId: 'membership',
	draft: { name: 'Private workspace' }
}
const actor = createActor(createWorkspaceCreationTransaction(capability), { input: { attempt } })
try {
	actor.start()
	const result = await toPromise(actor)
	if (
		result.outcome !== 'succeeded' ||
		result.settlement.workspace.id !== attempt.workspaceId ||
		result.attempt !== attempt
	)
		throw new Error('Packaged creation did not retain its local result and attempt')
} finally {
	actor.stop()
}
