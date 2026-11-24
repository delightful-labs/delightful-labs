/// <reference lib="es2024.promise" />
import assert from 'node:assert/strict'
import { createActor, waitFor } from 'xstate'
import { createWorkspaceCreationTransaction } from 'delightful-local-first/workspace/creation/workflow'

for (const outcome of ['accepted', 'rejected']) {
	const attempt = {
		operationId: 'original',
		workspaceId: 'workspace',
		membershipId: 'membership',
		draft: {}
	}
	const resource = { token: {} }
	const write = { token: {} }
	const workspace = { id: attempt.workspaceId }
	const entered = Promise.withResolvers<void>()
	const receipt = Promise.withResolvers<void>()
	const rejection = new Error('Known authority rejection')
	let detached = 0
	const machine = createWorkspaceCreationTransaction<
		object,
		typeof resource,
		object,
		typeof workspace,
		typeof write
	>({
		open: (original) => {
			assert.equal(original, attempt)
			return resource
		},
		retainDetached: () => {
			detached++
		},
		readLocal: (current) => {
			assert.equal(current, resource)
			return {}
		},
		assess: () => ({ outcome: 'eligible' }),
		stage: (current) => {
			assert.equal(current, resource)
			return workspace
		},
		commit: (current) => {
			assert.equal(current, resource)
			return write
		},
		authority: {
			confirm: (current) => {
				assert.equal(current, write)
				entered.resolve()
				return receipt.promise
			},
			isRejected: (error) => error === rejection
		},
		rollback: () => {
			throw new Error('An issued authority receipt cannot be rolled back')
		}
	})
	const actor = createActor(machine, { input: { attempt } }).start()
	try {
		await entered.promise
		actor.send({ type: 'SHUTDOWN' })
		assert.equal(actor.getSnapshot().status, 'active')
		if (outcome === 'accepted') receipt.resolve()
		else receipt.reject(rejection)
		const result = (await waitFor(actor, (snapshot) => snapshot.status === 'done')).output
		assert.deepEqual(result, {
			attempt,
			outcome: 'closed',
			settlement:
				outcome === 'accepted'
					? { kind: 'authorityAccepted', workspace }
					: { kind: 'rejected', error: rejection }
		})
		assert.equal(detached, 0)
	} finally {
		actor.stop()
	}
}
