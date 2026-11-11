export const MAX_TRANSACTION_ATTACHMENT_BYTES = 10 * 1024 * 1024
export const MAX_TRANSACTION_ATTACHMENTS = 5
export const TRANSACTION_ATTACHMENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

export type AttachmentSelectionResult =
	| { kind: 'accepted'; files: readonly File[] }
	| { kind: 'unsupportedType' }
	| { kind: 'tooLarge' }
	| { kind: 'limitReached' }

export function isTransactionAttachmentType(
	type: string
): type is (typeof TRANSACTION_ATTACHMENT_TYPES)[number] {
	return TRANSACTION_ATTACHMENT_TYPES.some((supportedType) => supportedType === type)
}

export function validateAttachmentSelection(
	files: readonly File[],
	currentCount: number
): AttachmentSelectionResult {
	if (currentCount + files.length > MAX_TRANSACTION_ATTACHMENTS) return { kind: 'limitReached' }
	if (files.some((file) => !isTransactionAttachmentType(file.type)))
		return { kind: 'unsupportedType' }
	if (files.some((file) => file.size <= 0 || file.size > MAX_TRANSACTION_ATTACHMENT_BYTES))
		return { kind: 'tooLarge' }
	return { kind: 'accepted', files }
}
