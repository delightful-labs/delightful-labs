// Packaged operation without a Jazz client, browser globals, or Finance schema.
import { createActor, toPromise } from 'xstate'
import { createWorkspaceNamingOperation } from 'delightful-local-first/workspace/naming/workflow'
import 'delightful-local-first/workspace/naming/contracts'

const scope = { attachment: {}, generation: 1 }
const settings = { color: 'blue' }
let issued = 0
/** @type {import('delightful-local-first/workspace/naming/contracts').WorkspaceNamingCapability<
 * typeof scope, typeof settings, string, { local: Promise<void> }
 * >} */
const capability = {
	assess: () => ({ kind: 'allowed' }),
	issue: (request) => {
		if (request.name !== 'Project' || request.settings !== settings)
			throw new Error('Naming lost its canonical name or companion settings')
		issued += 1
		return { write: { local: Promise.resolve() } }
	},
	persistLocal: (write) => write.local
}
const request = { scope, workspaceId: 'workspace', name: ' Project ', settings }
const actor = createActor(createWorkspaceNamingOperation(capability), { input: { request } })
try {
	actor.start()
	const result = await toPromise(actor)
	if (
		result.outcome !== 'succeeded' ||
		result.settlement.kind !== 'locallyPersisted' ||
		result.request.scope !== scope ||
		result.request.workspaceId !== request.workspaceId ||
		issued !== 1
	)
		throw new Error('Packaged naming did not preserve its scoped local result')
} finally {
	actor.stop()
}
