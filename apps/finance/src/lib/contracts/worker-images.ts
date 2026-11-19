import { z } from 'zod'
export const financeImageEditorRequest = z.strictObject({
	type: z.literal('EDIT_IMAGE'),
	file: z.file()
})
export const financeImageEditorResult = z.discriminatedUnion('kind', [
	z.strictObject({ kind: z.literal('applied'), file: z.file() }),
	z.strictObject({ kind: z.enum(['cancelled', 'closed']) }),
	z.strictObject({
		kind: z.literal('failed'),
		reason: z.enum(['input', 'decode', 'read', 'render', 'encode', 'cleanup'])
	})
])
export const financeImageEditorCancel = z.strictObject({ type: z.enum(['CANCEL', 'SHUTDOWN']) })
export const workerSavedImageView = z.strictObject({
	editableIds: z.array(z.uuid()),
	disabledIds: z.array(z.uuid()),
	problem: z
		.enum(['unavailable', 'conflict', 'editingFailed', 'saveFailed', 'unresolved'])
		.nullable(),
	activity: z.enum(['idle', 'loading', 'editing', 'saving'])
})
export const workerTransactionImage = z.strictObject({
	id: z.uuid(),
	fileId: z.uuid(),
	file: z.file()
})
export const workerTransactionImageCommand = z.discriminatedUnion('type', [
	z.strictObject({ type: z.literal('EDIT'), attachmentId: z.uuid() }),
	z.strictObject({ type: z.literal('REMOVE'), attachmentId: z.uuid() }),
	z.strictObject({ type: z.literal('CLOSE') })
])
export type WorkerTransactionImageCommand = z.output<typeof workerTransactionImageCommand>

import { workerProfile } from './worker-identity.js'
export const workerTransactionMetadata = z.strictObject({
	$createdBy: z.strictObject({ account: z.uuid(), system: z.boolean() }),
	$updatedBy: z.strictObject({ account: z.uuid(), system: z.boolean() }),
	$createdAt: z.date(),
	$updatedAt: z.date()
})
export const workerTransactionDetailsView = z.strictObject({
	transactionId: z.uuid(),
	transaction: workerTransactionMetadata.nullable(),
	creatorProfile: workerProfile.nullable(),
	editorProfile: workerProfile.nullable(),
	images: z.array(workerTransactionImage),
	loading: z.boolean(),
	failed: z.boolean()
})
export type WorkerTransactionDetailsView = z.output<typeof workerTransactionDetailsView>
