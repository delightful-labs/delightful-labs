import { afterEach, describe, expect, it } from 'vitest'
import type {
	WorkspaceDrainRequest,
	WorkspaceLease
} from 'delightful-local-first/workspace/contracts'
import type {
	SelectedResourceCommand,
	SelectedResourceOutput
} from '../../contracts/workspace-selected-resources.js'
import type { WorkspaceResourceRelease } from '../../contracts/workspace-resource-release.js'
import type {
	TransferScopeDrainRequest,
	TransferScopeDrainResponse
} from '../../contracts/transfer-scope-drain.js'
import type { TransferMutationOwnerEvent } from '../transfers/internal-transfer-mutation-owner.js'
import { createInternalTransferMutationOwner } from '../transfers/internal-transfer-mutation-owner.js'
import {
	createWorkspaceSelectionDrainMachine,
	transferScopeForWorkspaceLease
} from './workspace-selection-drain.js'
import { createActor, createCallbackLogic } from 'xstate'

const actors = new Set<{ stop: () => void }>()
afterEach(() => {
	for (const actor of actors) actor.stop()
	actors.clear()
})
function drain(): WorkspaceDrainRequest {
	return {
		token: {},
		lease: {
			scope: { binding: {}, attachment: {} },
			request: { workspaceId: 'workspace-a', attempt: 3 },
			epoch: 7
		}
	}
}
function fixture(options: { absent?: boolean; immediateTransfer?: boolean } = {}) {
	const original = drain()
	const resourceCommands: SelectedResourceCommand[] = []
	const transferCommands: TransferMutationOwnerEvent[] = []
	const resources = createActor(
		createCallbackLogic<SelectedResourceCommand>(({ receive }) => {
			receive((event) => resourceCommands.push(event))
		})
	).start()
	const transfers = createActor(
		createCallbackLogic<TransferMutationOwnerEvent>(({ receive }) => {
			receive((event) => {
				transferCommands.push(event)
				if (options.immediateTransfer && event.type === 'DRAIN_TRANSFER_SCOPE') {
					event.drain.recipient.send({
						type: 'TRANSFER_SCOPE_DRAIN_RESULT',
						request: event.drain.request,
						outcome: 'released'
					})
				}
			})
		})
	).start()
	const actor = createActor(createWorkspaceSelectionDrainMachine(), {
		input: { drain: original, resources: options.absent ? undefined : resources, transfers }
	}).start()
	actors.add(resources)
	actors.add(transfers)
	actors.add(actor)
	function transferDrain(): TransferScopeDrainRequest {
		const event = transferCommands.find((value) => value.type === 'DRAIN_TRANSFER_SCOPE')
		if (event?.type !== 'DRAIN_TRANSFER_SCOPE') throw new Error('Missing transfer drain')
		return event.drain
	}
	function releaseTransfers(
		outcome: Exclude<TransferScopeDrainResponse['outcome'], 'rejected'> = 'released'
	) {
		const sent = transferDrain()
		sent.recipient.send({ type: 'TRANSFER_SCOPE_DRAIN_RESULT', request: sent.request, outcome })
	}
	function releaseResources(
		outcome: WorkspaceResourceRelease['outcome'] = 'released',
		independent = false
	) {
		const result: SelectedResourceOutput = {
			lease: original.lease,
			drain: independent ? undefined : original,
			release: { outcome }
		}
		actor.send({ type: 'SELECTED_RESOURCES_RELEASED', result })
	}
	return {
		actor,
		original,
		resourceCommands,
		transferCommands,
		transferDrain,
		releaseTransfers,
		releaseResources
	}
}
const outcomes: WorkspaceResourceRelease['outcome'][] = [
	'released',
	'releasedWithFailure',
	'unresolved'
]
const combinations = outcomes.flatMap((resource) =>
	outcomes.flatMap((transfer) =>
		['resources', 'transfers'].map((first) => ({ resource, transfer, first }))
	)
)

describe('selected-workspace drain join', () => {
	it.each(combinations)(
		'joins $resource resources and $transfer transfers, $first first',
		({ resource, transfer, first }) => {
			const test = fixture()
			if (first === 'resources') test.releaseResources(resource)
			else test.releaseTransfers(transfer)
			expect(test.actor.getSnapshot().status).toBe('active')
			expect(test.actor.getSnapshot().output).toBeUndefined()
			if (first === 'resources') test.releaseTransfers(transfer)
			else test.releaseResources(resource)
			const expected =
				resource === 'unresolved' || transfer === 'unresolved'
					? 'unresolved'
					: resource === 'releasedWithFailure' || transfer === 'releasedWithFailure'
						? 'releasedWithFailure'
						: 'released'
			expect(test.actor.getSnapshot().status).toBe('done')
			expect(test.actor.getSnapshot().output).toEqual({
				drain: test.original,
				release: { outcome: expected }
			})
			expect(test.resourceCommands).toEqual([{ type: 'DRAIN', drain: test.original }])
			expect(test.transferCommands).toHaveLength(1)
		}
	)

	it('waits for transfers when no selected resources were acquired', () => {
		const test = fixture({ absent: true })
		expect(test.resourceCommands).toEqual([])
		expect(test.actor.getSnapshot().status).toBe('active')
		test.releaseTransfers('releasedWithFailure')
		expect(test.actor.getSnapshot().output?.release).toEqual({ outcome: 'releasedWithFailure' })
	})

	it('accepts an immediate transfer response during startup without skipping resources', () => {
		const test = fixture({ immediateTransfer: true })
		expect(test.actor.getSnapshot().status).toBe('active')
		test.releaseResources()
		expect(test.actor.getSnapshot().output?.release).toEqual({ outcome: 'released' })
	})

	it.each(outcomes)('accepts actual independent shutdown output with %s evidence', (outcome) => {
		const test = fixture()
		test.releaseResources(outcome, true)
		expect(test.actor.getSnapshot().status).toBe('active')
		test.releaseTransfers()
		expect(test.actor.getSnapshot().output?.release).toEqual({ outcome })
	})

	const otherLeases: { name: string; change: (lease: WorkspaceLease) => WorkspaceLease }[] = [
		{ name: 'client', change: (lease) => ({ ...lease, scope: { ...lease.scope, binding: {} } }) },
		{
			name: 'attachment',
			change: (lease) => ({ ...lease, scope: { ...lease.scope, attachment: {} } })
		},
		{
			name: 'workspace',
			change: (lease) => ({ ...lease, request: { ...lease.request, workspaceId: 'workspace-b' } })
		},
		{
			name: 'attempt',
			change: (lease) => ({
				...lease,
				request: { ...lease.request, attempt: lease.request.attempt + 1 }
			})
		},
		{ name: 'epoch', change: (lease) => ({ ...lease, epoch: lease.epoch + 1 }) }
	]
	it.each(otherLeases)(
		'ignores resource outputs and crashes with a foreign $name',
		({ change }) => {
			const test = fixture()
			const lease = change(test.original.lease)
			test.actor.send({
				type: 'SELECTED_RESOURCES_RELEASED',
				result: { lease, drain: undefined, release: { outcome: 'unresolved' } }
			})
			test.actor.send({ type: 'SELECTED_RESOURCES_CRASHED', lease })
			test.releaseTransfers()
			expect(test.actor.getSnapshot().status).toBe('active')
			test.releaseResources()
			expect(test.actor.getSnapshot().output?.release).toEqual({ outcome: 'released' })
		}
	)

	it('rejects a mismatched resource drain token or nested lease', () => {
		const test = fixture()
		for (const foreign of [
			{ ...test.original, token: {} },
			{ ...test.original, lease: { ...test.original.lease, epoch: 8 } }
		]) {
			test.actor.send({
				type: 'SELECTED_RESOURCES_RELEASED',
				result: { lease: test.original.lease, drain: foreign, release: { outcome: 'unresolved' } }
			})
		}
		test.releaseTransfers()
		expect(test.actor.getSnapshot().status).toBe('active')
		test.releaseResources()
		expect(test.actor.getSnapshot().output?.release).toEqual({ outcome: 'released' })
	})

	it('ignores transfer responses with a foreign token, binding, workspace, or generation', () => {
		const test = fixture()
		const sent = test.transferDrain()
		const request = sent.request
		for (const foreign of [
			{ ...request, token: {} },
			{ ...request, scope: { ...request.scope, binding: {} } },
			{ ...request, scope: { ...request.scope, workspaceId: 'workspace-b' } },
			{ ...request, scope: { ...request.scope, generation: 8 } }
		]) {
			sent.recipient.send({
				type: 'TRANSFER_SCOPE_DRAIN_RESULT',
				request: foreign,
				outcome: 'unresolved'
			})
		}
		test.releaseResources()
		expect(test.actor.getSnapshot().status).toBe('active')
		test.releaseTransfers()
		expect(test.actor.getSnapshot().output?.release).toEqual({ outcome: 'released' })
	})

	it.each(['scopeMismatch', 'busy', 'retired'])(
		'treats a %s rejection as unresolved and still waits for resources',
		(reason) => {
			const test = fixture()
			const sent = test.transferDrain()
			if (reason !== 'scopeMismatch' && reason !== 'busy' && reason !== 'retired')
				throw new Error('Invalid rejection')
			sent.recipient.send({
				type: 'TRANSFER_SCOPE_DRAIN_RESULT',
				request: sent.request,
				outcome: 'rejected',
				reason
			})
			expect(test.actor.getSnapshot().status).toBe('active')
			test.releaseResources()
			expect(test.actor.getSnapshot().output?.release).toEqual({ outcome: 'unresolved' })
		}
	)

	it('retains unresolved resource crash evidence while waiting for transfers', () => {
		const test = fixture()
		test.actor.send({ type: 'SELECTED_RESOURCES_CRASHED', lease: test.original.lease })
		test.releaseResources()
		expect(test.actor.getSnapshot().status).toBe('active')
		test.releaseTransfers()
		expect(test.actor.getSnapshot().output?.release).toEqual({ outcome: 'unresolved' })
	})

	it('retains unresolved transfer crash evidence while waiting for resources', () => {
		const test = fixture()
		test.actor.send({ type: 'TRANSFER_OWNER_CRASHED', drain: test.original })
		test.releaseTransfers()
		expect(test.actor.getSnapshot().status).toBe('active')
		test.releaseResources()
		expect(test.actor.getSnapshot().output?.release).toEqual({ outcome: 'unresolved' })
	})

	it('ignores stale transfer-owner crash notifications', () => {
		const test = fixture()
		test.actor.send({ type: 'TRANSFER_OWNER_CRASHED', drain: { ...test.original, token: {} } })
		test.actor.send({
			type: 'TRANSFER_OWNER_CRASHED',
			drain: { ...test.original, lease: { ...test.original.lease, epoch: 8 } }
		})
		test.releaseResources()
		expect(test.actor.getSnapshot().status).toBe('active')
		test.releaseTransfers()
		expect(test.actor.getSnapshot().output?.release).toEqual({ outcome: 'released' })
	})

	it('consumes each leg once and never lets duplicate responses erase failure evidence', () => {
		const test = fixture()
		test.releaseResources('releasedWithFailure')
		test.releaseResources('released')
		test.actor.send({ type: 'SELECTED_RESOURCES_CRASHED', lease: test.original.lease })
		expect(test.actor.getSnapshot().status).toBe('active')
		test.releaseTransfers()
		expect(test.actor.getSnapshot().output?.release).toEqual({ outcome: 'releasedWithFailure' })
	})

	it('captures input identities before callers replace their objects', () => {
		const test = fixture()
		const captured = test.resourceCommands[0]
		if (captured?.type !== 'DRAIN') throw new Error('Missing resource command')
		expect(captured.drain).not.toBe(test.original)
		expect(captured.drain.lease).not.toBe(test.original.lease)
		expect(captured.drain.lease.scope).not.toBe(test.original.lease.scope)
		expect(captured.drain.lease.request).not.toBe(test.original.lease.request)
		expect(Object.isFrozen(captured.drain.lease)).toBe(true)
		expect(test.transferDrain().request.scope).toEqual({
			binding: test.original.lease.scope.attachment,
			workspaceId: 'workspace-a',
			generation: 7
		})
	})

	it('uses the same scope with a real idle transfer owner and receives its public acknowledgement', () => {
		const original = drain()
		const transfers = createActor(createInternalTransferMutationOwner()).start()
		actors.add(transfers)
		transfers.send({
			type: 'BIND_TRANSFER_SCOPE',
			scope: transferScopeForWorkspaceLease(original.lease)
		})
		const actor = createActor(createWorkspaceSelectionDrainMachine(), {
			input: { drain: original, resources: undefined, transfers }
		}).start()
		actors.add(actor)
		expect(actor.getSnapshot().status).toBe('done')
		expect(actor.getSnapshot().output).toEqual({
			drain: original,
			release: { outcome: 'released' }
		})
	})
})

describe('application handoff finite inputs', () => {
	it.each(outcomes)(
		'retains %s evidence for an already released transfer owner while resources drain',
		(outcome) => {
			const original = drain()
			const actor = createActor(createWorkspaceSelectionDrainMachine(), {
				input: {
					drain: original,
					transfers: undefined,
					transferRelease: { outcome },
					resources: { send() {} }
				}
			}).start()
			actors.add(actor)
			expect(actor.getSnapshot().status).toBe('active')
			actor.send({
				type: 'SELECTED_RESOURCES_RELEASED',
				result: { lease: original.lease, drain: undefined, release: { outcome: 'released' } }
			})
			expect(actor.getSnapshot().output?.release).toEqual({ outcome })
		}
	)
	it('releases a library lease invalidated before either resource owner acquired it', () => {
		const original = drain()
		const actor = createActor(createWorkspaceSelectionDrainMachine(), {
			input: { drain: original, transfers: undefined, resources: undefined }
		}).start()
		actors.add(actor)
		expect(actor.getSnapshot().output).toEqual({
			drain: original,
			release: { outcome: 'released' }
		})
	})
	it('drains the actual application generation after a new attachment resets library epoch', () => {
		const original = drain()
		const scope = { ...transferScopeForWorkspaceLease(original.lease), generation: 50 }
		const requests: TransferScopeDrainRequest[] = []
		const actor = createActor(createWorkspaceSelectionDrainMachine(), {
			input: {
				drain: original,
				resources: undefined,
				transferScope: scope,
				transfers: {
					send(event) {
						if (event.type === 'DRAIN_TRANSFER_SCOPE') requests.push(event.drain)
					}
				}
			}
		}).start()
		actors.add(actor)
		const sent = requests[0]
		if (!sent) throw new Error('Missing drain command')
		expect(sent.request.scope.generation).toBe(50)
		sent.recipient.send({
			type: 'TRANSFER_SCOPE_DRAIN_RESULT',
			request: { ...sent.request, scope: { ...scope, generation: original.lease.epoch } },
			outcome: 'released'
		})
		expect(actor.getSnapshot().status).toBe('active')
		sent.recipient.send({
			type: 'TRANSFER_SCOPE_DRAIN_RESULT',
			request: sent.request,
			outcome: 'released'
		})
		expect(actor.getSnapshot().output?.release).toEqual({ outcome: 'released' })
	})
})

it.each(outcomes)(
	'retains preclosed resource evidence %s without forwarding to a completed actor',
	(outcome) => {
		const original = drain()
		const commands: TransferScopeDrainRequest[] = []
		const actor = createActor(createWorkspaceSelectionDrainMachine(), {
			input: {
				drain: original,
				resources: undefined,
				resourceRelease: { outcome },
				transfers: {
					send(event) {
						if (event.type === 'DRAIN_TRANSFER_SCOPE') commands.push(event.drain)
					}
				}
			}
		}).start()
		actors.add(actor)
		expect(actor.getSnapshot().status).toBe('active')
		const sent = commands[0]
		if (!sent) throw new Error('Missing transfer command')
		sent.recipient.send({
			type: 'TRANSFER_SCOPE_DRAIN_RESULT',
			request: sent.request,
			outcome: 'released'
		})
		expect(actor.getSnapshot().output?.release).toEqual({ outcome })
	}
)
