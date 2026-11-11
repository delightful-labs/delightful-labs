import { afterEach, describe, expect, it, vi } from 'vitest'
import { Transaction } from 'jazz-tools'
import type { InternalTransferDeleteInput, InternalTransferLinkInput } from './internal-transfer.js'
import {
	createInternalTransferMutationOwner,
	type TransferMutationRequest,
	type TransferMutationResponse
} from './internal-transfer-mutation-owner.js'
import { createActor, setup, waitFor } from 'xstate'

const organizationId = '11111111-1111-4111-8111-111111111111'
const identityId = '22222222-2222-4222-8222-222222222222'
const expenseTransactionId = '33333333-3333-4333-8333-333333333333'
const incomeTransactionId = '44444444-4444-4444-8444-444444444444'
const actors: ReturnType<typeof createActor>[] = []

afterEach(() => {
	for (const actor of actors.splice(0)) actor.stop()
	vi.restoreAllMocks()
})

function deferred() {
	let release = () => {}
	const promise = new Promise<void>((resolve) => {
		release = resolve
	})
	return { promise, release }
}

function linkRequest(
	requestId: string,
	db: InternalTransferLinkInput['db'],
	responses: TransferMutationResponse[]
): TransferMutationRequest {
	return {
		requestId,
		workspaceId: organizationId,
		operation: 'link',
		input: {
			db,
			organizationId,
			identityId,
			expenseTransactionId,
			incomeTransactionId,
			trackWrite: vi.fn()
		},
		recipient: { send: (event) => responses.push(event) }
	}
}

function deleteRequest(
	requestId: string,
	db: InternalTransferDeleteInput['db'],
	responses: TransferMutationResponse[]
): TransferMutationRequest {
	return {
		requestId,
		workspaceId: organizationId,
		operation: 'delete',
		input: {
			db,
			organizationId,
			identityId,
			transferId: '77777777-7777-4777-8777-777777777777',
			expenseTransactionId,
			incomeTransactionId,
			trackWrite: vi.fn(),
			choice: { kind: 'both' }
		},
		recipient: { send: (event) => responses.push(event) }
	}
}

function database(read: () => Promise<null>) {
	const tx = new Transaction('mergeable', () => {
		throw new Error('Fixture must not open a Jazz runtime')
	})
	vi.spyOn(tx, 'one').mockImplementation(read)
	vi.spyOn(tx, 'all').mockResolvedValue([])
	vi.spyOn(tx, 'rollback').mockResolvedValue(true)
	const beginTransaction = vi.fn(() => tx)
	const db = { beginTransaction } satisfies InternalTransferLinkInput['db']
	return { db, beginTransaction }
}

function deletionDatabase(read: () => Promise<null>) {
	const base = database(read)
	const one = vi.fn(async () => read())
	const all = vi.fn(async () => [])
	const transaction = vi.fn<InternalTransferDeleteInput['db']['transaction']>(async () => ({
		txId: Promise.resolve('delete-write'),
		wait: vi.fn(async () => {})
	}))
	const db = { one, all, transaction } satisfies InternalTransferDeleteInput['db']
	return { ...base, db, one, all, transaction }
}

describe('internal transfer mutation owner', () => {
	it('dispatches and serializes deletion through the workspace owner', async () => {
		const firstRead = deferred()
		const firstDb = deletionDatabase(async () => {
			await firstRead.promise
			return null
		})
		const secondDb = database(async () => null)
		const firstResponses: TransferMutationResponse[] = []
		const secondResponses: TransferMutationResponse[] = []
		const actor = createActor(createInternalTransferMutationOwner()).start()
		actors.push(actor)

		actor.send({ type: 'TRANSFER_SCOPE_CHANGED', workspaceId: organizationId })
		actor.send({
			type: 'REQUEST_TRANSFER_MUTATION',
			request: deleteRequest('delete-first', firstDb.db, firstResponses)
		})
		await waitFor(actor, (snapshot) => snapshot.matches({ running: { work: 'deleting' } }))
		actor.send({
			type: 'REQUEST_TRANSFER_MUTATION',
			request: linkRequest('link-second', secondDb.db, secondResponses)
		})

		expect(firstDb.beginTransaction).not.toHaveBeenCalled()
		expect(secondDb.beginTransaction).not.toHaveBeenCalled()

		firstRead.release()
		await waitFor(actor, () => secondDb.beginTransaction.mock.calls.length === 1)
		await waitFor(actor, (snapshot) => snapshot.matches({ running: { work: 'idle' } }))

		expect(firstResponses[0]?.result).toEqual({
			operation: 'delete',
			result: { outcome: 'unavailable', settlement: 'notStarted' }
		})
		expect(secondResponses[0]?.result).toEqual({
			operation: 'link',
			result: { outcome: 'unavailable', settlement: 'notStarted' }
		})
	})

	it('serializes workspace mutations and returns each result to its requester', async () => {
		const firstRead = deferred()
		const firstDb = database(async () => {
			await firstRead.promise
			return null
		})
		const secondDb = database(async () => null)
		const firstResponses: TransferMutationResponse[] = []
		const secondResponses: TransferMutationResponse[] = []
		const actor = createActor(createInternalTransferMutationOwner()).start()
		actors.push(actor)

		actor.send({ type: 'TRANSFER_SCOPE_CHANGED', workspaceId: organizationId })
		actor.send({
			type: 'REQUEST_TRANSFER_MUTATION',
			request: linkRequest('first', firstDb.db, firstResponses)
		})
		await waitFor(actor, (snapshot) => snapshot.matches({ running: { work: 'linking' } }))
		actor.send({
			type: 'REQUEST_TRANSFER_MUTATION',
			request: linkRequest('second', secondDb.db, secondResponses)
		})

		expect(firstDb.beginTransaction).toHaveBeenCalledOnce()
		expect(secondDb.beginTransaction).not.toHaveBeenCalled()

		firstRead.release()
		await waitFor(actor, () => secondDb.beginTransaction.mock.calls.length === 1)
		await waitFor(actor, (snapshot) => snapshot.matches({ running: { work: 'idle' } }))

		expect(firstResponses).toEqual([
			{
				type: 'TRANSFER_MUTATION_RESULT',
				requestId: 'first',
				result: { operation: 'link', result: { outcome: 'unavailable', settlement: 'notStarted' } }
			}
		])
		expect(secondResponses).toEqual([
			{
				type: 'TRANSFER_MUTATION_RESULT',
				requestId: 'second',
				result: { operation: 'link', result: { outcome: 'unavailable', settlement: 'notStarted' } }
			}
		])
	})

	it('rejects requests from an inactive workspace without opening a transaction', () => {
		const otherOrganizationId = '55555555-5555-4555-8555-555555555555'
		const db = database(async () => null)
		const responses: TransferMutationResponse[] = []
		const actor = createActor(createInternalTransferMutationOwner()).start()
		actors.push(actor)
		actor.send({ type: 'TRANSFER_SCOPE_CHANGED', workspaceId: organizationId })
		actor.send({
			type: 'REQUEST_TRANSFER_MUTATION',
			request: {
				...linkRequest('stale', db.db, responses),
				workspaceId: otherOrganizationId
			}
		})

		expect(db.beginTransaction).not.toHaveBeenCalled()
		expect(responses).toEqual([
			{
				type: 'TRANSFER_MUTATION_RESULT',
				requestId: 'stale',
				result: { operation: 'link', result: { outcome: 'unavailable', settlement: 'notStarted' } }
			}
		])
	})

	it('waits for an active mutation to drain before shutting down', async () => {
		const read = deferred()
		const db = database(async () => {
			await read.promise
			return null
		})
		const responses: TransferMutationResponse[] = []
		const harness = setup({
			actors: { owner: createInternalTransferMutationOwner() }
		}).createMachine({
			initial: 'active',
			invoke: { id: 'owner', src: 'owner' },
			states: { active: {} }
		})
		const parent = createActor(harness).start()
		actors.push(parent)
		const actor = parent.getSnapshot().children.owner
		if (!actor) throw new Error('Expected mutation owner actor')

		actor.send({ type: 'TRANSFER_SCOPE_CHANGED', workspaceId: organizationId })
		actor.send({
			type: 'REQUEST_TRANSFER_MUTATION',
			request: linkRequest('shutdown', db.db, responses)
		})
		await waitFor(actor, (snapshot) => snapshot.matches({ running: { work: 'linking' } }))
		actor.send({ type: 'SHUTDOWN' })

		expect(actor.getSnapshot().status).toBe('active')
		expect(responses).toHaveLength(0)

		read.release()
		await waitFor(parent, (snapshot) => snapshot.children.owner?.getSnapshot().status === 'done')
		expect(responses).toEqual([
			{
				type: 'TRANSFER_MUTATION_RESULT',
				requestId: 'shutdown',
				result: { operation: 'link', result: { outcome: 'closed', settlement: 'notStarted' } }
			}
		])
	})
})
