export const MAX_TRANSACTION_ATTACHMENT_BYTES = 10 * 1024 * 1024
export const MAX_TRANSACTION_ATTACHMENTS = 5
export const TRANSACTION_ATTACHMENT_TYPES: readonly ('image/jpeg' | 'image/png' | 'image/webp')[] =
	['image/jpeg', 'image/png', 'image/webp']

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

export type AttachmentFileContents = {
	fileName: string
	mimeType: string
	sizeBytes: number
	parts: readonly { partIndex: number; sizeBytes: number; data: Uint8Array | null }[] | null
}
/** Native file assembly shared by saved previews and replacement editing. */
export function completeAttachmentParts(contents: AttachmentFileContents) {
	if (
		!isTransactionAttachmentType(contents.mimeType) ||
		contents.sizeBytes < 1 ||
		contents.sizeBytes > MAX_TRANSACTION_ATTACHMENT_BYTES
	)
		return
	const parts = [...(contents.parts ?? [])].sort((a, b) => a.partIndex - b.partIndex)
	if (
		!parts.length ||
		parts.some(
			(part, index) =>
				part.partIndex !== index || !part.data || part.data.byteLength !== part.sizeBytes
		) ||
		parts.reduce((sum, part) => sum + part.sizeBytes, 0) !== contents.sizeBytes
	)
		return
	return parts
}
export function attachmentFile(contents: AttachmentFileContents): File | undefined {
	const parts = completeAttachmentParts(contents)
	if (!parts) return
	const bytes = new Uint8Array(contents.sizeBytes)
	let offset = 0
	for (const part of parts) {
		if (!part.data) return
		bytes.set(part.data, offset)
		offset += part.sizeBytes
	}
	return new File([bytes], contents.fileName, { type: contents.mimeType })
}
