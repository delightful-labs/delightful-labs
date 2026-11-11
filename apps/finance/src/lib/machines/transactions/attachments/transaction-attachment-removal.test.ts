import { afterEach, describe, expect, it, vi } from 'vitest'
import { app } from '#lib/schema.js'
import type { TransactionAttachmentRemovalInput } from './transaction-attachment-removal.js'
import { transactionAttachmentRemovalMachine } from './transaction-attachment-removal.js'
import { createActor, toPromise } from 'xstate'

const cleanups: (() => void)[] = []
afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup()
	vi.restoreAllMocks()
})

function start(input: TransactionAttachmentRemovalInput) {
	const actor = createActor(transactionAttachmentRemovalMachine, { input }).start()
	cleanups.push(() => actor.stop())
	return actor
}

describe('transaction attachment removal actor', () => {
	it('removes only the authorized transaction link and retains file data', async () => {
		const attachment = {
			id: 'link-id',
			transactionId: 'transaction-id',
			fileId: 'file-id'
		}
		const all = vi.fn(async () => [attachment])
		const remove = vi.fn(() => ({ wait: async () => ({}) }))
		const db = { all, delete: remove } as unknown as TransactionAttachmentRemovalInput['db']
		expect(
			await toPromise(
				start({ db, transactionId: attachment.transactionId, attachmentId: attachment.id })
			)
		).toEqual({ outcome: 'removed' })
		expect(all).toHaveBeenCalledWith(
			app.transactionAttachments.where({
				id: attachment.id,
				transactionId: attachment.transactionId
			}),
			expect.objectContaining({ tier: expect.anything() })
		)
		expect(remove).toHaveBeenCalledExactlyOnceWith(app.transactionAttachments, attachment.id)
	})

	it('does not delete a link that does not belong to the requested transaction', async () => {
		const db = {
			all: vi.fn(async () => []),
			delete: vi.fn()
		} as unknown as TransactionAttachmentRemovalInput['db']
		expect(
			await toPromise(start({ db, transactionId: 'other-transaction', attachmentId: 'link-id' }))
		).toEqual({ outcome: 'failed' })
		expect(db.delete).not.toHaveBeenCalled()
	})
})
