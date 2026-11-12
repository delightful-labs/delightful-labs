import { schema as s, migration as m } from 'jazz-tools'

export default m.defineMigration({
	renameTables: {
		contentRepresentations: m.renameTableFrom('documents')
	},
	migrate: {
		libraryDocuments: {
			contentRepresentationId: m.renameFrom('representationId')
		}
	},
	fromHash: 'f3a133184527',
	toHash: '3b875a72f847',
	from: {
		articleImages: s.table(
			{
				libraryId: s.uuid(),
				documentId: s.uuid(),
				sourceUrl: s.string(),
				status: s.string(),
				assetId: s.uuid().optional(),
				retryable: s.boolean()
			},
			{
				library: s.rel('libraries', 'libraryId'),
				document: s.rel('documents', 'documentId'),
				asset: s.rel('assets', 'assetId')
			}
		),
		articleNoteRevisions: s.table(
			{
				libraryId: s.uuid(),
				articleId: s.uuid(),
				articleParentId: s.uuid().optional(),
				documentParentId: s.uuid().optional(),
				text: s.string(),
				parents: s.string(),
				editedAt: s.string()
			},
			{
				library: s.rel('libraries', 'libraryId'),
				articleParent: s.rel('articles', 'articleParentId'),
				documentParent: s.rel('documents', 'documentParentId')
			}
		),
		articles: s.table(
			{
				libraryId: s.uuid(),
				url: s.string(),
				originalSavedAt: s.string(),
				contentId: s.uuid().optional(),
				operationId: s.uuid().optional(),
				failure: s.string().optional()
			},
			{
				library: s.rel('libraries', 'libraryId'),
				content: s.rel('documents', 'contentId')
			}
		),
		articleSources: s.table(
			{
				documentId: s.uuid(),
				libraryId: s.uuid(),
				finalUrl: s.string(),
				submittedUrl: s.string(),
				provenance: s.string()
			},
			{
				library: s.rel('libraries', 'libraryId'),
				document: s.rel('documents', 'documentId')
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
				previousStatus: s.enum('inbox', 'later', 'archive').optional(),
				title: s.string().optional(),
				author: s.string().optional(),
				publishedAt: s.string().optional(),
				siteName: s.string().optional(),
				language: s.string().optional(),
				finalUrl: s.string().optional(),
				canonicalUrl: s.string().optional(),
				representationId: s.uuid().optional()
			},
			{
				library: s.rel('libraries', 'libraryId'),
				representation: s.rel('documents', 'representationId')
			}
		),
		notes: s.table(
			{
				libraryId: s.uuid(),
				articleId: s.uuid().optional(),
				documentId: s.uuid().optional()
			},
			{
				library: s.rel('libraries', 'libraryId'),
				article: s.rel('articles', 'articleId'),
				document: s.rel('documents', 'documentId')
			}
		),
		organizationOperations: s.table(
			{
				libraryId: s.uuid(),
				articleId: s.uuid().optional(),
				documentId: s.uuid().optional(),
				field: s.string(),
				value: s.string(),
				parents: s.string()
			},
			{
				library: s.rel('libraries', 'libraryId'),
				article: s.rel('articles', 'articleId'),
				document: s.rel('documents', 'documentId')
			}
		),
		readerOperations: s.table(
			{
				libraryId: s.uuid(),
				documentId: s.uuid().optional(),
				field: s.string(),
				value: s.string(),
				parents: s.string()
			},
			{
				library: s.rel('libraries', 'libraryId'),
				document: s.rel('documents', 'documentId')
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
		),
		tagOperations: s.table(
			{
				libraryId: s.uuid(),
				articleId: s.uuid().optional(),
				documentId: s.uuid().optional(),
				key: s.string(),
				name: s.string(),
				assigned: s.boolean(),
				parents: s.string()
			},
			{
				library: s.rel('libraries', 'libraryId'),
				article: s.rel('articles', 'articleId'),
				document: s.rel('documents', 'documentId')
			}
		)
	},
	to: {
		articleImages: s.table(
			{
				libraryId: s.uuid(),
				documentId: s.uuid(),
				sourceUrl: s.string(),
				status: s.string(),
				assetId: s.uuid().optional(),
				retryable: s.boolean()
			},
			{
				library: s.rel('libraries', 'libraryId'),
				document: s.rel('contentRepresentations', 'documentId'),
				asset: s.rel('assets', 'assetId')
			}
		),
		articleNoteRevisions: s.table(
			{
				libraryId: s.uuid(),
				articleId: s.uuid(),
				articleParentId: s.uuid().optional(),
				documentParentId: s.uuid().optional(),
				text: s.string(),
				parents: s.string(),
				editedAt: s.string()
			},
			{
				library: s.rel('libraries', 'libraryId'),
				articleParent: s.rel('articles', 'articleParentId'),
				documentParent: s.rel('contentRepresentations', 'documentParentId')
			}
		),
		articles: s.table(
			{
				libraryId: s.uuid(),
				url: s.string(),
				originalSavedAt: s.string(),
				contentId: s.uuid().optional(),
				operationId: s.uuid().optional(),
				failure: s.string().optional()
			},
			{
				library: s.rel('libraries', 'libraryId'),
				content: s.rel('contentRepresentations', 'contentId')
			}
		),
		articleSources: s.table(
			{
				documentId: s.uuid(),
				libraryId: s.uuid(),
				finalUrl: s.string(),
				submittedUrl: s.string(),
				provenance: s.string()
			},
			{
				library: s.rel('libraries', 'libraryId'),
				document: s.rel('contentRepresentations', 'documentId')
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
		contentRepresentations: s.table(
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
				previousStatus: s.enum('inbox', 'later', 'archive').optional(),
				title: s.string().optional(),
				author: s.string().optional(),
				publishedAt: s.string().optional(),
				siteName: s.string().optional(),
				language: s.string().optional(),
				finalUrl: s.string().optional(),
				canonicalUrl: s.string().optional(),
				contentRepresentationId: s.uuid().optional()
			},
			{
				library: s.rel('libraries', 'libraryId'),
				contentRepresentation: s.rel('contentRepresentations', 'contentRepresentationId')
			}
		),
		notes: s.table(
			{
				libraryId: s.uuid(),
				articleId: s.uuid().optional(),
				documentId: s.uuid().optional()
			},
			{
				library: s.rel('libraries', 'libraryId'),
				article: s.rel('articles', 'articleId'),
				document: s.rel('contentRepresentations', 'documentId')
			}
		),
		organizationOperations: s.table(
			{
				libraryId: s.uuid(),
				articleId: s.uuid().optional(),
				documentId: s.uuid().optional(),
				field: s.string(),
				value: s.string(),
				parents: s.string()
			},
			{
				library: s.rel('libraries', 'libraryId'),
				article: s.rel('articles', 'articleId'),
				document: s.rel('contentRepresentations', 'documentId')
			}
		),
		readerOperations: s.table(
			{
				libraryId: s.uuid(),
				documentId: s.uuid().optional(),
				field: s.string(),
				value: s.string(),
				parents: s.string()
			},
			{
				library: s.rel('libraries', 'libraryId'),
				document: s.rel('contentRepresentations', 'documentId')
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
		),
		tagOperations: s.table(
			{
				libraryId: s.uuid(),
				articleId: s.uuid().optional(),
				documentId: s.uuid().optional(),
				key: s.string(),
				name: s.string(),
				assigned: s.boolean(),
				parents: s.string()
			},
			{
				library: s.rel('libraries', 'libraryId'),
				article: s.rel('articles', 'articleId'),
				document: s.rel('contentRepresentations', 'documentId')
			}
		)
	}
})
