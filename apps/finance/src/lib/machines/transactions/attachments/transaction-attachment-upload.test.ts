import { afterEach, describe, expect, it, vi } from 'vitest'
import { app } from '#lib/schema.js'
import type { TransactionAttachmentInput } from './transaction-attachment-upload.js'
import { transactionAttachmentUploadMachine } from './transaction-attachment-upload.js'
import { createActor, toPromise } from 'xstate'

const transaction = {
	id: '44444444-4444-4444-8444-444444444444',
	accountId: '11111111-1111-4111-8111-111111111111',
	organizationId: '22222222-2222-4222-8222-222222222222'
}
const file = { name: 'receipt.webp', type: 'image/webp', size: 600 * 1024 }
const cleanups: (() => void)[] = []
afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup()
	vi.restoreAllMocks()
})

function start(db: TransactionAttachmentInput['db'], bytes = new Uint8Array(file.size)) {
	const actor = createActor(transactionAttachmentUploadMachine, {
		input: { db, transaction, file, bytes }
	}).start()
	cleanups.push(() => actor.stop())
	return actor
}

describe('transaction attachment upload actor', () => {
	it('stores ordered 256 KiB chunks and links the completed file', async () => {
		const parts: { index: number; size: number; bytes: Uint8Array }[] = []
		const insert = vi.fn((_table: unknown, row: { fileName?: string }) => ({
			wait: async () => ({ id: row.fileName ? 'file-id' : 'link-id' })
		}))
		const insertStreaming = vi.fn(
			async (
				_table: unknown,
				row: { partIndex: number; sizeBytes: number; data: ReadableStream<Uint8Array> }
			) => {
				parts.push({
					index: row.partIndex,
					size: row.sizeBytes,
					bytes: new Uint8Array(await new Response(row.data).arrayBuffer())
				})
				return { value: { id: `part-${row.partIndex}` }, wait: async () => ({}) }
			}
		)
		const db = {
			all: vi.fn(),
			insert,
			insertStreaming,
			delete: vi.fn()
		} as unknown as TransactionAttachmentInput['db']
		const result = await toPromise(start(db))
		expect(result).toEqual({ outcome: 'attached', fileId: 'file-id' })
		expect(parts.map(({ index, size }) => ({ index, size }))).toEqual([
			{ index: 0, size: 256 * 1024 },
			{ index: 1, size: 256 * 1024 },
			{ index: 2, size: 88 * 1024 }
		])
		expect(parts.flatMap(({ bytes }) => [...bytes])).toEqual(new Array(file.size).fill(0))
		expect(insert).toHaveBeenNthCalledWith(1, app.files, {
			transactionId: transaction.id,
			fileName: file.name,
			mimeType: file.type,
			sizeBytes: file.size
		})
		expect(insert).toHaveBeenNthCalledWith(
			2,
			app.transactionAttachments,
			expect.objectContaining({ transactionId: transaction.id, fileId: 'file-id' })
		)
	})

	it('retains file bytes when relation settlement is uncertain', async () => {
		const insert = vi
			.fn()
			.mockImplementationOnce(() => ({ wait: async () => ({ id: 'file-id' }) }))
			.mockImplementationOnce(() => ({ wait: async () => Promise.reject(new Error('unknown')) }))
		const insertStreaming = vi.fn(async () => ({
			value: { id: 'part-id' },
			wait: async () => ({})
		}))
		const remove = vi.fn()
		const db = {
			all: vi.fn(),
			insert,
			insertStreaming,
			delete: remove
		} as unknown as TransactionAttachmentInput['db']
		expect(await toPromise(start(db, new Uint8Array([1]))).then(({ outcome }) => outcome)).toBe(
			'failed'
		)
		expect(insertStreaming).toHaveBeenCalledOnce()
		expect(remove).not.toHaveBeenCalled()
	})

	it('rediscovers and removes a part after its write reports an uncertain failure', async () => {
		const insert = vi.fn(() => ({ wait: async () => ({ id: 'file-id' }) }))
		const insertStreaming = vi.fn(async () => {
			throw new Error('part settlement uncertain')
		})
		const all = vi.fn(async () => [
			{ id: 'persisted-part', fileId: 'file-id', partIndex: 0, sizeBytes: 1 }
		])
		const remove = vi.fn(() => ({ wait: async () => ({}) }))
		const db = {
			all,
			insert,
			insertStreaming,
			delete: remove
		} as unknown as TransactionAttachmentInput['db']
		expect(await toPromise(start(db, new Uint8Array([1]))).then(({ outcome }) => outcome)).toBe(
			'failed'
		)
		expect(all).toHaveBeenCalledOnce()
		expect(remove).toHaveBeenNthCalledWith(1, app.fileParts, 'persisted-part')
		expect(remove).toHaveBeenNthCalledWith(2, app.files, 'file-id')
	})
})
