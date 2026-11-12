import { schema as s, migration as m } from 'jazz-tools'

export default m.defineMigration({
	migrate: {
		libraryDocuments: {
			savedAt: m.drop.string({ backwardsDefault: '1970-01-01T00:00:00.000Z' })
		}
	},
	fromHash: '147cca2a3088',
	toHash: 'f51d40bd10a8',
	from: {
		articleAttachments: s.table(
			{
				libraryId: s.uuid(),
				documentId: s.uuid(),
				title: s.string(),
				author: s.string().optional(),
				publishedAt: s.string().optional(),
				siteName: s.string().optional(),
				language: s.string().optional(),
				finalUrl: s.string(),
				canonicalUrl: s.string().optional(),
				representationId: s.uuid()
			},
			{
				library: s.rel('libraries', 'libraryId'),
				document: s.rel('libraryDocuments', 'documentId'),
				representation: s.rel('documents', 'representationId')
			}
		),
		assets: s.table(
			{
				libraryId: s.uuid(),
				operationId: s.uuid(),
				mediaType: s.string(),
				payload: s.bytes()
			},
			{
				library: s.rel('libraries', 'libraryId'),
				operation: s.rel('storageOperations', 'operationId')
			}
		),
		documents: s.table(
			{
				libraryId: s.uuid(),
				operationId: s.uuid(),
				snapshotId: s.uuid(),
				assetId: s.uuid(),
				title: s.string(),
				originalSavedAt: s.string()
			},
			{
				library: s.rel('libraries', 'libraryId'),
				operation: s.rel('storageOperations', 'operationId'),
				snapshot: s.rel('snapshots', 'snapshotId'),
				asset: s.rel('assets', 'assetId')
			}
		),
		libraries: s.table(
			{
				ownerId: s.uuid(),
				bootstrapVersion: s.string()
			},
			{}
		),
		libraryDocuments: s.table(
			{
				libraryId: s.uuid(),
				url: s.string().optional(),
				savedAt: s.string(),
				readingProgress: s.float(),
				resumePosition: s
					.json(
						JSON.parse(
							'{"$schema":"http://json-schema.org/draft-07/schema#","type":"object","properties":{"version":{"type":"number","const":1},"offset":{"type":"integer","minimum":0,"maximum":10000000},"quote":{"type":"string","minLength":1,"maxLength":160},"prefix":{"type":"string","maxLength":48},"suffix":{"type":"string","maxLength":48},"interactedAt":{"type":"string","format":"date-time","pattern":"^(?:(?:\\\\d\\\\d[2468][048]|\\\\d\\\\d[13579][26]|\\\\d\\\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\\\d|30)|(?:02)-(?:0[1-9]|1\\\\d|2[0-8])))T(?:(?:[01]\\\\d|2[0-3]):[0-5]\\\\d:[0-5]\\\\d(?:\\\\.\\\\d+)?(?:Z))$"}},"required":["version","offset","quote","prefix","suffix","interactedAt"],"additionalProperties":false}'
						)
					)
					.optional(),
				status: s.enum('inbox', 'later', 'archive', 'trashed'),
				favorite: s.boolean(),
				trashedAt: s.string().optional(),
				previousStatus: s.enum('inbox', 'later', 'archive').optional(),
				articleAttachmentId: s.uuid().optional()
			},
			{
				library: s.rel('libraries', 'libraryId'),
				articleAttachment: s.rel('articleAttachments', 'articleAttachmentId')
			}
		),
		snapshots: s.table(
			{
				libraryId: s.uuid(),
				documentId: s.uuid(),
				text: s.string(),
				excerpt: s.string().optional(),
				author: s.string().optional(),
				siteName: s.string().optional(),
				publishedTime: s.string().optional(),
				lang: s.string().optional(),
				dir: s.string().optional(),
				featuredImageUrl: s.string().optional(),
				formatVersion: s.string()
			},
			{
				library: s.rel('libraries', 'libraryId'),
				operation: s.rel('storageOperations', 'documentId')
			}
		),
		storageOperations: s.table(
			{
				libraryId: s.uuid(),
				payloadHash: s.string(),
				createdAt: s.string()
			},
			{
				library: s.rel('libraries', 'libraryId')
			}
		)
	},
	to: {
		articleAttachments: s.table(
			{
				libraryId: s.uuid(),
				documentId: s.uuid(),
				title: s.string(),
				author: s.string().optional(),
				publishedAt: s.string().optional(),
				siteName: s.string().optional(),
				language: s.string().optional(),
				finalUrl: s.string(),
				canonicalUrl: s.string().optional(),
				representationId: s.uuid()
			},
			{
				library: s.rel('libraries', 'libraryId'),
				document: s.rel('libraryDocuments', 'documentId'),
				representation: s.rel('documents', 'representationId')
			}
		),
		assets: s.table(
			{
				libraryId: s.uuid(),
				operationId: s.uuid(),
				mediaType: s.string(),
				payload: s.bytes()
			},
			{
				library: s.rel('libraries', 'libraryId'),
				operation: s.rel('storageOperations', 'operationId')
			}
		),
		documents: s.table(
			{
				libraryId: s.uuid(),
				operationId: s.uuid(),
				snapshotId: s.uuid(),
				assetId: s.uuid(),
				title: s.string(),
				originalSavedAt: s.string()
			},
			{
				library: s.rel('libraries', 'libraryId'),
				operation: s.rel('storageOperations', 'operationId'),
				snapshot: s.rel('snapshots', 'snapshotId'),
				asset: s.rel('assets', 'assetId')
			}
		),
		libraries: s.table(
			{
				ownerId: s.uuid(),
				bootstrapVersion: s.string()
			},
			{}
		),
		libraryDocuments: s.table(
			{
				libraryId: s.uuid(),
				url: s.string().optional(),
				readingProgress: s.float(),
				resumePosition: s
					.json(
						JSON.parse(
							'{"$schema":"http://json-schema.org/draft-07/schema#","type":"object","properties":{"version":{"type":"number","const":1},"offset":{"type":"integer","minimum":0,"maximum":10000000},"quote":{"type":"string","minLength":1,"maxLength":160},"prefix":{"type":"string","maxLength":48},"suffix":{"type":"string","maxLength":48},"interactedAt":{"type":"string","format":"date-time","pattern":"^(?:(?:\\\\d\\\\d[2468][048]|\\\\d\\\\d[13579][26]|\\\\d\\\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\\\d|30)|(?:02)-(?:0[1-9]|1\\\\d|2[0-8])))T(?:(?:[01]\\\\d|2[0-3]):[0-5]\\\\d:[0-5]\\\\d(?:\\\\.\\\\d+)?(?:Z))$"}},"required":["version","offset","quote","prefix","suffix","interactedAt"],"additionalProperties":false}'
						)
					)
					.optional(),
				status: s.enum('inbox', 'later', 'archive', 'trashed'),
				favorite: s.boolean(),
				trashedAt: s.string().optional(),
				previousStatus: s.enum('inbox', 'later', 'archive').optional(),
				articleAttachmentId: s.uuid().optional()
			},
			{
				library: s.rel('libraries', 'libraryId'),
				articleAttachment: s.rel('articleAttachments', 'articleAttachmentId')
			}
		),
		snapshots: s.table(
			{
				libraryId: s.uuid(),
				documentId: s.uuid(),
				text: s.string(),
				excerpt: s.string().optional(),
				author: s.string().optional(),
				siteName: s.string().optional(),
				publishedTime: s.string().optional(),
				lang: s.string().optional(),
				dir: s.string().optional(),
				featuredImageUrl: s.string().optional(),
				formatVersion: s.string()
			},
			{
				library: s.rel('libraries', 'libraryId'),
				operation: s.rel('storageOperations', 'documentId')
			}
		),
		storageOperations: s.table(
			{
				libraryId: s.uuid(),
				payloadHash: s.string(),
				createdAt: s.string()
			},
			{
				library: s.rel('libraries', 'libraryId')
			}
		)
	}
})
