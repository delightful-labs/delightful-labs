import { z } from 'zod'
import {
	documentFieldsSchema,
	documentSchema,
	documentReadingStatusSchema,
	documentStatusSchema
} from '../../capture/document-schema.js'
import { captureDocumentSchema } from '../../capture/capture-document-schema.js'
import { lowercaseUuidSchema } from '../../validation/values.js'
const nativeDocumentSchema = documentFieldsSchema.extend({
	libraryId: lowercaseUuidSchema,
	status: documentStatusSchema,
	previousStatus: documentReadingStatusSchema.nullish(),
	attachmentId: lowercaseUuidSchema.nullable()
})
const captureFields = captureDocumentSchema.options[0]
	.pick({ operationId: true, failure: true })
	.strip()
const captureMetadataSchema = z.object({
	$createdAt: z.date(),
	captures: z
		.array(captureFields.extend({ id: lowercaseUuidSchema, documentId: lowercaseUuidSchema }))
		.length(1)
})
export function documentRecord(value: unknown, libraryId: string) {
	const parsed = nativeDocumentSchema.safeParse(value)
	if (
		!parsed.success ||
		parsed.data.libraryId !== libraryId ||
		parsed.data.library.id !== libraryId
	)
		throw new Error('invalidRecord')
	const { libraryId: _library, attachmentId, previousStatus, status, ...fields } = parsed.data
	if (attachmentId !== null && fields.attachment === null) throw new Error('incompleteRecord')
	if (status !== 'trashed' && previousStatus != null) throw new Error('invalidRecord')
	return documentSchema.parse({
		...fields,
		status,
		...(status === 'trashed' ? { previousStatus } : {})
	})
}
export function captureDocumentRecord(value: unknown, libraryId: string) {
	const document = documentRecord(value, libraryId),
		metadata = captureMetadataSchema.safeParse(value)
	if (!metadata.success) throw new Error('invalidRecord')
	const capture = metadata.data.captures[0]
	if (!capture || capture.id !== document.id || capture.documentId !== document.id)
		throw new Error('invalidRecord')
	return captureDocumentSchema.parse({
		...document,
		libraryId,
		createdAt: metadata.data.$createdAt,
		operationId: capture.operationId,
		failure: capture.failure
	})
}
