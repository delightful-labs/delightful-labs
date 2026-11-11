import { afterEach, describe, expect, it, vi } from 'vitest'
import {
	createTransferMutationRequestMachine,
	type TransferMutationRequestInput
} from './internal-transfer-mutation-request.js'
import type { TransferMutationRequest } from './internal-transfer-mutation-owner.js'
import { createActor } from 'xstate'

const actors = new Set<{ stop: () => void }>()
afterEach(() => {
	for (const actor of actors) actor.stop()
	actors.clear()
})
function input(): Extract<TransferMutationRequestInput, { operation: 'link' }> {
	return {
		workspaceId: 'workspace-a',
		operation: 'link',
		input: {
			db: {
				beginTransaction() {
					throw new Error('Request actor must not perform SDK I/O')
				}
			},
			organizationId: 'workspace-a',
			identityId: 'user',
			expenseTransactionId: 'expense',
			incomeTransactionId: 'income',
			trackWrite: vi.fn()
		}
	}
}
function fixture(withScope = true) {
	const initial = { binding: {}, workspaceId: 'workspace-a', generation: 4 }
	let current = withScope ? initial : undefined
	const captureScope = vi.fn(() => current)
	const requests: TransferMutationRequest[] = []
	const cancellations: string[] = []
	const actor = createActor(
		createTransferMutationRequestMachine({
			captureScope,
			send(event) {
				if (event.type === 'TRANSFER_MUTATION_REQUEST') requests.push(event.request)
				else cancellations.push(event.requestId)
			}
		}),
		{ input: input() }
	)
	actors.add(actor)
	function request() {
		const value = requests[0]
		if (!value) throw new Error('Missing request')
		return value
	}
	return {
		actor,
		initial,
		captureScope,
		requests,
		cancellations,
		request,
		replace: () => {
			current = { ...initial, generation: 5 }
		}
	}
}

describe('transfer request scope capture', () => {
	it('captures at actor creation, before a delayed start or a later selected scope', () => {
		const test = fixture()
		expect(test.captureScope).toHaveBeenCalledOnce()
		test.replace()
		test.initial.generation = 99
		test.actor.start()
		expect(test.request().scope).toEqual({
			binding: test.initial.binding,
			workspaceId: 'workspace-a',
			generation: 4
		})
		expect(Object.isFrozen(test.request().scope)).toBe(true)
		expect(test.captureScope).toHaveBeenCalledOnce()
	})
	it('never adds a later scope to a request created without a selected lease', () => {
		const test = fixture(false)
		test.replace()
		test.actor.start()
		expect(test.request().scope).toBeUndefined()
		expect(test.captureScope).toHaveBeenCalledOnce()
	})
	it.each(['CANCEL', 'INVALIDATE', 'SHUTDOWN'] satisfies ('CANCEL' | 'INVALIDATE' | 'SHUTDOWN')[])(
		'retains the original request through %s until actual acknowledgement',
		(type) => {
			const test = fixture()
			test.actor.start()
			const request = test.request()
			test.replace()
			test.actor.send({ type })
			expect(test.cancellations).toEqual([request.requestId])
			expect(test.actor.getSnapshot().status).toBe('active')
			request.recipient.send({
				type: 'TRANSFER_MUTATION_RESULT',
				requestId: 'old-request',
				result: { operation: 'link', result: { outcome: 'cancelled', settlement: 'notStarted' } }
			})
			expect(test.actor.getSnapshot().status).toBe('active')
			request.recipient.send({
				type: 'TRANSFER_MUTATION_RESULT',
				requestId: request.requestId,
				result: { operation: 'link', result: { outcome: 'cancelled', settlement: 'notStarted' } }
			})
			expect(test.actor.getSnapshot().output).toEqual({
				operation: 'link',
				result: { outcome: 'cancelled', settlement: 'notStarted' }
			})
			expect(test.requests).toHaveLength(1)
			expect(test.captureScope).toHaveBeenCalledOnce()
		}
	)
	it('preserves an explicitly captured original scope instead of reading the latest scope', () => {
		const original = { binding: {}, workspaceId: 'workspace-a', generation: 2 }
		const captureScope = vi.fn(() => ({ ...original, generation: 10 }))
		const requests: TransferMutationRequest[] = []
		const actor = createActor(
			createTransferMutationRequestMachine({
				captureScope,
				send(event) {
					if (event.type === 'TRANSFER_MUTATION_REQUEST') requests.push(event.request)
				}
			}),
			{ input: { ...input(), scope: original } }
		).start()
		actors.add(actor)
		original.generation = 3
		expect(requests[0]?.scope?.generation).toBe(2)
		expect(captureScope).not.toHaveBeenCalled()
	})
})
