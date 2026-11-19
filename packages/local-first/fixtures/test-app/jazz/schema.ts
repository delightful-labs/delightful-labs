import { schema as s } from 'jazz-tools'
export const schema = s.defineSchema({
	restoreDestinations: s.table(
		{
			ownerId: s.uuid(),
			operationId: s.string(),
			payloadSha256: s.string(),
			graphSha256: s.string(),
			status: s.enum('incomplete', 'active')
		},
		{
			attachments: s.reverse('restoreAttachments', 'destination'),
			notebooks: s.reverse('restoreNotebooks', 'destination'),
			notes: s.reverse('restoreNotes', 'destination')
		}
	),
	restoreNotes: s.table(
		{
			destinationId: s.uuid(),
			ownerId: s.uuid(),
			operationId: s.string(),
			notebookId: s.uuid(),
			attachmentId: s.uuid().optional(),
			body: s.string(),
			archived: s.boolean()
		},
		{
			destination: s.rel('restoreDestinations', 'destinationId'),
			notebook: s.rel('restoreNotebooks', 'notebookId'),
			attachment: s.rel('restoreAttachments', 'attachmentId')
		}
	),
	restoreNotebooks: s.table(
		{
			destinationId: s.uuid(),
			ownerId: s.uuid(),
			operationId: s.string(),
			title: s.string()
		},
		{ destination: s.rel('restoreDestinations', 'destinationId') }
	),
	restoreAttachments: s.table(
		{
			destinationId: s.uuid(),
			ownerId: s.uuid(),
			operationId: s.string(),
			mediaType: s.string(),
			fileName: s.string(),
			sizeBytes: s.int(),
			sha256: s.string(),
			contents: s.bytes()
		},
		{ destination: s.rel('restoreDestinations', 'destinationId') }
	)
})
