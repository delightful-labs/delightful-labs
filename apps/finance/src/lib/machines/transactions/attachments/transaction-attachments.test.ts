import { afterEach, describe, expect, it, vi } from 'vitest'
import type { getDb } from 'jazz-tools/svelte'
import * as image from '#lib/domain/image-processing.js'
import { app } from '#lib/schema.js'
import { createTransactionAttachmentsMachine } from './transaction-attachments.js'
import { createActor, toPromise } from 'xstate'

type AttachmentDb = Pick<ReturnType<typeof getDb>, 'all' | 'insert' | 'insertStreaming' | 'delete'>
const transaction = {
	id: '44444444-4444-4444-8444-444444444444',
	accountId: '11111111-1111-4111-8111-111111111111',
	organizationId: '22222222-2222-4222-8222-222222222222'
}
const files = [
	new File(['one'], 'one.webp', { type: 'image/webp' }),
	new File(['two'], 'two.png', { type: 'image/png' })
]
const cleanups: (() => void)[] = []
afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup()
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
})

function setup(existingCount: number) {
	vi.stubGlobal(
		'OffscreenCanvas',
		class {
			constructor(
				public width: number,
				public height: number
			) {}
		}
	)
	const bitmap = { width: 1, height: 1, close: vi.fn() } as ImageBitmap
	const canvas = new OffscreenCanvas(1, 1)
	vi.spyOn(image, 'decodeImage').mockResolvedValue(bitmap)
	vi.spyOn(image, 'initializeImageResizer').mockResolvedValue(undefined)
	vi.spyOn(image, 'createImageCanvas').mockReturnValue(canvas)
	vi.spyOn(image, 'resizeImage').mockResolvedValue(canvas)
	vi.spyOn(image, 'encodeImage').mockImplementation((_canvas, options) =>
		Promise.resolve(new Blob(['processed'], { type: options.mimeType }))
	)
	vi.spyOn(image, 'releaseImageBitmap').mockImplementation((resource) => resource.close())
	vi.spyOn(image, 'releaseImageCanvas').mockImplementation((resource) => {
		resource.width = 0
		resource.height = 0
	})
	const existing = Array.from({ length: existingCount }, (_, index) => ({
		id: `link-${index}`,
		transactionId: transaction.id,
		fileId: `file-${index}`
	}))
	let fileIndex = 0
	let partIndex = 0
	let linkIndex = 0
	const insert = vi.fn((_table: unknown, row: { fileName?: string }) => ({
		wait: async () => (row.fileName ? { id: `file-${fileIndex++}` } : { id: `link-${linkIndex++}` })
	}))
	const insertStreaming = vi.fn(async () => ({
		value: { id: `part-${partIndex++}` },
		wait: async () => ({})
	}))
	const db = {
		all: vi.fn(async () => existing),
		insert,
		insertStreaming,
		delete: vi.fn(() => ({ wait: async () => ({}) }))
	} as unknown as AttachmentDb
	const actor = (selectedFiles = files) => {
		const ref = createActor(createTransactionAttachmentsMachine(), {
			input: { db, transaction, files: selectedFiles }
		}).start()
		cleanups.push(() => ref.stop())
		return ref
	}
	return { actor, bitmap, canvas, insert, insertStreaming }
}

describe('transaction attachment batch actor', () => {
	it('checks the current count before processing selected images', async () => {
		const f = setup(5)
		const result = await toPromise(f.actor([files[0]!]))
		expect(result).toMatchObject({ outcome: 'limitReached', attached: 0, skipped: 1 })
		expect(image.decodeImage).not.toHaveBeenCalled()
		expect(f.insert).not.toHaveBeenCalled()
	})

	it('resizes and stores files sequentially up to the five-image limit', async () => {
		const f = setup(3)
		const result = await toPromise(f.actor())
		expect(result).toMatchObject({ outcome: 'complete', attached: 2, failed: 0, skipped: 0 })
		expect(image.createImageCanvas).toHaveBeenNthCalledWith(1, f.bitmap, {
			maxWidth: 2048,
			maxHeight: 2048,
			mimeType: 'image/webp',
			quality: 0.85
		})
		expect(image.createImageCanvas).toHaveBeenNthCalledWith(2, f.bitmap, {
			maxWidth: 2048,
			maxHeight: 2048,
			mimeType: 'image/png',
			quality: 0.85
		})
		expect(f.insert).toHaveBeenCalledTimes(4)
		expect(f.insertStreaming).toHaveBeenCalledTimes(2)
		expect(image.releaseImageBitmap).toHaveBeenCalledTimes(2)
		expect(image.releaseImageCanvas).toHaveBeenCalledTimes(2)
	})

	it('rejects unsupported files before invoking image processing', async () => {
		const f = setup(0)
		const result = await toPromise(
			f.actor([new File(['image'], 'vector.svg', { type: 'image/svg+xml' })])
		)
		expect(result).toMatchObject({ outcome: 'invalidSelection', attached: 0 })
		expect(image.decodeImage).not.toHaveBeenCalled()
	})
})
