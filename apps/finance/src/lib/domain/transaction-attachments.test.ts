import { describe, expect, it } from 'vitest'
import {
	MAX_TRANSACTION_ATTACHMENT_BYTES,
	MAX_TRANSACTION_ATTACHMENTS,
	validateAttachmentSelection
} from './transaction-attachments.js'

function image(name = 'receipt.webp', type = 'image/webp', size = 1) {
	return new File([new Uint8Array(size)], name, { type })
}

describe('transaction attachment selection', () => {
	it('accepts supported images within the remaining count and byte limits', () => {
		const files = [
			image('one.jpg', 'image/jpeg', MAX_TRANSACTION_ATTACHMENT_BYTES),
			image('two.png', 'image/png')
		]
		expect(validateAttachmentSelection(files, MAX_TRANSACTION_ATTACHMENTS - 2)).toEqual({
			kind: 'accepted',
			files
		})
	})

	it('rejects unsupported types before upload', () => {
		expect(validateAttachmentSelection([image('receipt.svg', 'image/svg+xml')], 0)).toEqual({
			kind: 'unsupportedType'
		})
	})

	it('rejects zero-byte and oversized files', () => {
		expect(validateAttachmentSelection([image('empty.webp', 'image/webp', 0)], 0)).toEqual({
			kind: 'tooLarge'
		})
		expect(
			validateAttachmentSelection(
				[image('large.webp', 'image/webp', MAX_TRANSACTION_ATTACHMENT_BYTES + 1)],
				0
			)
		).toEqual({ kind: 'tooLarge' })
	})

	it('rejects selections that exceed the per-transaction limit', () => {
		expect(validateAttachmentSelection([image()], MAX_TRANSACTION_ATTACHMENTS)).toEqual({
			kind: 'limitReached'
		})
	})
})
