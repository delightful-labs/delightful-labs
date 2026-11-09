// Exercise the built public protocol without importing a backend, provider, or Finance domain.
import { createActor, createStepLogic } from 'xstate'
import {
	createWorkspaceSelectionMachine,
	selectWorkspaceLease
} from 'delightful-local-first/workspace/workflow'
import 'delightful-local-first/workspace/contracts'

/** @typedef {import('delightful-local-first/workspace/contracts').WorkspaceSelectionReport} Report */
const recipient = createActor(
	createStepLogic({
		context: /** @returns {Report[]} */ () => [],
		run: (/** @type {{context:Report[];event:Report}} */ { context, event }) => ({
			context: event.type === 'WORKSPACE_DRAIN_REQUESTED' ? [...context, event] : context
		})
	})
).start()
const actor = createActor(createWorkspaceSelectionMachine(), {
	input: { reportTo: recipient }
}).start()
const scope = { binding: {}, attachment: {} }
function drain() {
	const report = recipient
		.getSnapshot()
		.context.filter((event) => event.type === 'WORKSPACE_DRAIN_REQUESTED')
		.at(-1)
	if (!report) throw new Error('Packaged workspace drain report missing')
	return report.drain
}
try {
	actor.send({ type: 'BIND', scope })
	for (const [index, workspaceId] of ['a', 'b'].entries()) {
		const request = { workspaceId, attempt: index + 1 }
		actor.send({ type: 'SELECT', scope, request })
		actor.send({
			type: 'OBSERVED',
			observation: {
				scope,
				request,
				generation: 0,
				directory: { status: 'available', entries: [] },
				access: 'allowed'
			}
		})
		if (index > 0) {
			if (selectWorkspaceLease(actor.getSnapshot()))
				throw new Error('Old scope remained usable during drain')
			actor.send({ type: 'DRAINED', drain: drain() })
		}
		if (selectWorkspaceLease(actor.getSnapshot())?.request.workspaceId !== workspaceId)
			throw new Error('Packaged selection did not activate the requested workspace')
	}
	actor.send({ type: 'SHUTDOWN' })
	actor.send({ type: 'DRAINED', drain: drain() })
	if (actor.getSnapshot().status !== 'done' || actor.getSnapshot().output?.outcome !== 'closed')
		throw new Error('Packaged workspace did not close after release')
} finally {
	actor.stop()
	recipient.stop()
}
