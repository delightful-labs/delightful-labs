import { afterEach, describe, expect, it, vi } from 'vitest'
import type { getDb } from 'jazz-tools/svelte'
import type { InternalTransfer, TransactionDetail } from '#lib/schema.js'
import type { TransactionEntryObservation } from '#lib/contracts/transaction-entry-contract.js'
import { createTransactionEditFormOptions, transactionEntryScope } from './transaction-entry.js'
import { createTransactionEditMachine } from './transaction-edit.js'
import type { TransferMutationGateway } from '../transfers/internal-transfer-mutation-request.js'
import type { TransferMutationRequest } from '../transfers/internal-transfer-mutation-owner.js'
import { createActor, waitFor } from 'xstate'

const binding = {}
const organizationId = '22222222-2222-4222-8222-222222222222'
const expenseAccountId = '11111111-1111-4111-8111-111111111111'
const incomeAccountId = '33333333-3333-4333-8333-333333333333'
const expenseId = '44444444-4444-4444-8444-444444444444'
const incomeId = '55555555-5555-4555-8555-555555555555'
const transferId = '66666666-6666-4666-8666-666666666666'
const actors: ReturnType<typeof createActor>[] = []
afterEach(() => actors.splice(0).forEach((actor) => actor.stop()))

function fixture() {
	const transaction = {
		id: expenseId,
		organizationId,
		accountId: expenseAccountId,
		categoryId: 'expense-category',
		kind: 'expense',
		amountMinor: 100,
		currency: 'USD',
		bookedOn: '2026-10-25',
		source: 'manual',
		externalId: null,
		paymentMethod: null,
		checkId: null,
		internalTransferId: transferId,
		tags: []
	} as unknown as TransactionDetail
	const facts = {
		binding,
		identityId: 'user',
		organizationId,
		kind: 'expense',
		transactionId: expenseId,
		sessionReady: true,
		loading: false,
		failed: false,
		membership: { id: 'membership', userId: 'user', organizationId, role: 'owner' },
		grants: [],
		accounts: [
			{
				id: expenseAccountId,
				organizationId,
				name: 'Expense account',
				kind: 'cash',
				currency: 'USD',
				archivedAt: null
			}
		],
		categories: [
			{
				id: 'expense-category',
				organizationId,
				name: 'Category',
				kind: 'expense',
				isSystem: false,
				archivedAt: null
			}
		],
		tags: [],
		transaction
	} as unknown as TransactionEntryObservation
	const db = {} as ReturnType<typeof getDb>
	const options = createTransactionEditFormOptions({ binding, observe: () => facts, db })
	const requests: TransferMutationRequest[] = []
	const capturedScope = { binding, workspaceId: organizationId, generation: 7 }
	const captureScope = vi.fn(() => capturedScope)
	const gateway: TransferMutationGateway = {
		captureScope,
		send(event) {
			if (event.type === 'TRANSFER_MUTATION_REQUEST') requests.push(event.request)
		}
	}
	const workflow = createTransactionEditMachine(options, db, vi.fn(), gateway)
	const actor = createActor(workflow.logic, { input: facts }).start()
	actors.push(actor)
	return { actor, facts, requests, workflow, capturedScope, captureScope }
}

function transfer(): InternalTransfer {
	return {
		id: transferId,
		organizationId,
		expenseTransactionId: expenseId,
		incomeTransactionId: incomeId,
		expenseAccountId,
		incomeAccountId,
		amountMinor: 100,
		currency: 'USD'
	} as InternalTransfer
}

async function linkedFixture() {
	const f = fixture()
	await waitFor(f.actor, (snapshot) => f.workflow.selectFormView(snapshot).fieldsEditable)
	const linkedTransfer = transfer()
	f.actor.send({
		type: 'TRANSFER_OBSERVATION',
		observation: {
			rows: [],
			scope: transactionEntryScope(f.facts),
			scopeGeneration: f.actor.getSnapshot().context.scopeGeneration,
			linkedTransactionIds: [expenseId, incomeId],
			linkedTransfer,
			linked: true,
			conflicted: false,
			searchEnabled: false,
			pendingUnlink: false,
			loading: false,
			failed: false
		}
	})
	return f
}

async function conflictedFixture() {
	const f = fixture()
	await waitFor(f.actor, (snapshot) => f.workflow.selectFormView(snapshot).fieldsEditable)
	f.actor.send({
		type: 'TRANSFER_OBSERVATION',
		observation: {
			rows: [],
			scope: transactionEntryScope(f.facts),
			scopeGeneration: f.actor.getSnapshot().context.scopeGeneration,
			linkedTransactionIds: [expenseId, incomeId],
			linkedTransfer: null,
			linked: false,
			conflicted: true,
			searchEnabled: false,
			pendingUnlink: false,
			loading: false,
			failed: false
		}
	})
	return f
}

describe('transaction edit transfer deletion', () => {
	it.each([
		{ label: 'both transactions', choice: { kind: 'both' as const } },
		{
			label: 'only the current transaction',
			choice: { kind: 'selected' as const, transactionId: expenseId }
		}
	])(
		'routes the $label choice through the mutation owner and locks the form',
		async ({ choice }) => {
			const f = await linkedFixture()
			f.actor.send({ type: 'DELETE_LINKED_TRANSFER', choice })
			await waitFor(f.actor, () => f.requests.length === 1)
			expect(f.requests[0]).toMatchObject({
				workspaceId: organizationId,
				scope: f.capturedScope,
				operation: 'delete',
				input: { transferId, choice }
			})
			expect(f.workflow.selectFormView(f.actor.getSnapshot()).fieldsEditable).toBe(false)
			expect(f.captureScope).toHaveBeenCalledOnce()
			f.capturedScope.generation = 8
			expect(f.requests[0]?.scope?.generation).toBe(7)
		}
	)

	it('publishes a denied result from the mutation owner', async () => {
		const f = await linkedFixture()
		f.actor.send({ type: 'DELETE_LINKED_TRANSFER', choice: { kind: 'both' } })
		await waitFor(f.actor, () => f.requests.length === 1)
		const request = f.requests[0]
		if (!request) throw new Error('Expected deletion request')
		request.recipient.send({
			type: 'TRANSFER_MUTATION_RESULT',
			requestId: request.requestId,
			result: { operation: 'delete', result: { outcome: 'denied', settlement: 'notStarted' } }
		})
		await waitFor(f.actor, (snapshot) => snapshot.context.deleteResult?.outcome === 'denied')
		expect(f.actor.getSnapshot().context.deleteInput).toBeUndefined()
		expect(f.workflow.selectFormView(f.actor.getSnapshot()).fieldsEditable).toBe(true)
	})

	it('keeps inconsistent transfer actions unavailable', async () => {
		const f = await conflictedFixture()
		expect(f.workflow.selectTransferState(f.actor.getSnapshot())).toBe('conflicted')

		f.actor.send({ type: 'UNLINK_TRANSFER' })
		f.actor.send({ type: 'DELETE_LINKED_TRANSFER', choice: { kind: 'both' } })
		f.actor.send({ type: 'LINK_COUNTERPART', candidateId: incomeId })

		expect(f.requests).toEqual([])
		expect(f.actor.getSnapshot().context.linkedTransfer).toBeNull()
	})
})
