import { schema as s } from 'jazz-tools'

export const attachmentsSchema = {
	transactionAttachments: s.table(
		{
			transactionId: s.uuid(),
			fileId: s.uuid()
		},
		{
			transaction: s.rel('transactions', 'transactionId'),
			file: s.rel('files', 'fileId')
		}
	),
	files: s.table(
		{
			transactionId: s.uuid().optional(),
			accountId: s.uuid().optional(),
			organizationId: s.uuid().optional(),
			fileName: s.string(),
			mimeType: s.string(),
			sizeBytes: s.int()
		},
		{
			transaction: s.rel('transactions', 'transactionId'),
			parts: s.reverse('fileParts', 'file')
		}
	),
	fileParts: s.table(
		{
			fileId: s.uuid(),
			partIndex: s.int(),
			sizeBytes: s.int(),
			data: s.bytes().optional()
		},
		{ file: s.rel('files', 'fileId') }
	),
	uploads: s.table({ fileId: s.uuid(), status: s.enum('pending', 'complete', 'failed') }, {})
}
