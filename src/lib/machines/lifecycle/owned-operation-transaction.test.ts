import { createActor, toPromise } from 'xstate'
import { afterEach, expect, it, vi } from 'vitest'
import { createOwnedOperation } from './owned-operation.js'
import { createWorkspaceCreationTransaction } from '../workspaces/creation-transaction.js'
import type {
	WorkspaceCreationAttempt,
	WorkspaceCreationResult
} from '../../contracts/workspace-creation.js'
import type { RetainDetachedTransaction } from '../../contracts/transaction-custody.js'

type Phase = 'open' | 'read' | 'stage' | 'commit' | 'persist'
type Resource = { id: string }
type Write = { id: string }
type Receipt = { global: () => Promise<void> }
type Draft = { name: string }
const actors = new Set<{ stop: () => void }>()
afterEach(() => {
	for (const actor of actors) actor.stop()
	actors.clear()
})

function fixture(options: { pause?: Phase; fail?: Phase; rollbackFails?: boolean } = {}) {
	const entered = Promise.withResolvers<void>()
	const release = Promise.withResolvers<void>()
	const error = new Error('native leaf unavailable')
	const trace: Phase[] = []
	const step = async (phase: Phase) => {
		trace.push(phase)
		if (options.pause === phase) {
			entered.resolve()
			await release.promise
		}
		if (options.fail === phase) throw error
	}
	const resource: Resource = { id: 'native transaction' }
	const write: Write = { id: 'native commit' }
	const receipt: Receipt = { global: vi.fn(async () => {}) }
	const retainDetached = vi.fn<RetainDetachedTransaction<Resource, Write>>()
	const rollback = vi.fn(() => !options.rollbackFails)
	const attempt: WorkspaceCreationAttempt<Draft> = {
		operationId: 'original-operation',
		workspaceId: 'workspace',
		membershipId: 'membership',
		draft: { name: 'retained intent' }
	}
	const transaction = createWorkspaceCreationTransaction<Draft, Resource, object, Receipt, Write>({
		open: async () => {
			await step('open')
			return resource
		},
		readLocal: async (current, currentAttempt) => {
			expect(current).toBe(resource)
			expect(currentAttempt).toBe(attempt)
			await step('read')
			return {}
		},
		assess: () => ({ outcome: 'eligible' }),
		stage: async (current, currentAttempt) => {
			expect(current).toBe(resource)
			expect(currentAttempt).toBe(attempt)
			await step('stage')
			return receipt
		},
		commit: async (current) => {
			expect(current).toBe(resource)
			await step('commit')
			return write
		},
		persistLocal: async (current) => {
			expect(current).toBe(write)
			await step('persist')
		},
		rollback,
		retainDetached
	})
	const actor = createActor(
		createOwnedOperation<
			{ attempt: WorkspaceCreationAttempt<Draft> },
			WorkspaceCreationResult<Draft, Receipt>,
			{ type: 'SHUTDOWN' | 'CANCEL' }
		>(),
		{
			input: {
				operationId: attempt.operationId,
				input: { attempt },
				spawn: (spawn, input) => spawn(transaction, { input })
			}
		}
	)
	actors.add(actor)
	const result = toPromise(actor)
	actor.start()
	return {
		actor,
		result,
		attempt,
		resource,
		write,
		receipt,
		trace,
		entered,
		release,
		retainDetached,
		rollback
	}
}

for (const phase of ['open', 'read', 'stage', 'commit', 'persist'] as const) {
	it(`retains the real DLF ${phase} receipt through forced supervisor stop`, async () => {
		const f = fixture({ pause: phase })
		await f.entered.promise
		f.actor.stop()
		expect(f.retainDetached).toHaveBeenCalledOnce()
		const custody = f.retainDetached.mock.calls[0]![0]
		expect(custody.pending).toBeInstanceOf(Promise)
		expect(f.rollback).not.toHaveBeenCalled()
		f.release.resolve()
		expect(await custody.acquisition).toBe(f.resource)
		await custody.pending
		if (phase === 'commit' || phase === 'persist') {
			expect(await custody.commit).toBe(f.write)
		} else expect(custody.commit).toBeUndefined()
		expect(f.trace.filter((value) => value === phase)).toHaveLength(1)
		expect(f.rollback).not.toHaveBeenCalled()
		expect(f.actor.getSnapshot().status).toBe('stopped')
		expect(f.actor.getSnapshot().output).toBeUndefined()
		expect(f.receipt.global).not.toHaveBeenCalled()
	})
}

for (const phase of ['read', 'commit', 'persist'] as const) {
	it(`forwards cancellation and drains ${phase} before returning the original settlement`, async () => {
		const f = fixture({ pause: phase })
		await f.entered.promise
		f.actor.send({ type: 'INTERRUPT', command: { type: 'CANCEL' } })
		f.actor.send({ type: 'INTERRUPT', command: { type: 'SHUTDOWN' } })
		expect(f.actor.getSnapshot().status).toBe('active')
		expect(f.rollback).not.toHaveBeenCalled()
		f.release.resolve()
		const result = await f.result
		expect(result.operationId).toBe(f.attempt.operationId)
		if (result.kind !== 'completed') throw new Error('Expected transaction output')
		expect(result.output.attempt).toBe(f.attempt)
		expect(result.output.outcome).toBe('cancelled')
		expect(result.output.settlement).toEqual(
			phase === 'read' ? { kind: 'notStarted' } : { kind: 'locallyPersisted', workspace: f.receipt }
		)
		expect(f.retainDetached).not.toHaveBeenCalled()
		expect(f.receipt.global).not.toHaveBeenCalled()
		expect(f.trace.filter((value) => value === 'commit')).toHaveLength(phase === 'read' ? 0 : 1)
	})
}

it('drain-only shutdown lets the original transaction finish without cancellation', async () => {
	const f = fixture({ pause: 'read' })
	await f.entered.promise
	f.actor.send({ type: 'DRAIN' })
	f.actor.send({ type: 'INTERRUPT', command: { type: 'CANCEL' } })
	expect(f.actor.getSnapshot().status).toBe('active')
	f.release.resolve()
	const result = await f.result
	if (result.kind !== 'completed') throw new Error('Expected transaction output')
	expect(result.output.outcome).toBe('succeeded')
	expect(result.output.settlement).toEqual({ kind: 'locallyPersisted', workspace: f.receipt })
	expect(f.trace).toEqual(['open', 'read', 'stage', 'commit', 'persist'])
	expect(f.rollback).not.toHaveBeenCalled()
	expect(f.retainDetached).not.toHaveBeenCalled()
})

for (const phase of ['commit', 'persist'] as const) {
	it(`preserves unknown ${phase} settlement without replay or remote acceptance`, async () => {
		const f = fixture({ fail: phase, rollbackFails: true })
		const result = await f.result
		if (result.kind !== 'completed') throw new Error('Expected transaction output')
		expect(result.output.attempt).toBe(f.attempt)
		expect(result.output.settlement.kind).toBe('unresolved')
		expect(f.trace.filter((value) => value === 'stage')).toHaveLength(1)
		expect(f.trace.filter((value) => value === 'commit')).toHaveLength(1)
		expect(f.rollback).toHaveBeenCalledOnce()
		expect(f.receipt.global).not.toHaveBeenCalled()
	})
}
