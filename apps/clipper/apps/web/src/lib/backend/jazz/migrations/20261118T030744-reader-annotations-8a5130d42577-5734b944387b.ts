import { schema as s, migration as m } from 'jazz-tools'

export default m.defineMigration({
	createTables: {
		highlightAnchors: true,
		highlights: true,
		publications: true
	},
	migrate: {
		notes: {
			source: m.add.string({ default: null }),
			highlightId: m.add.ref('highlights', { default: null }),
			text: m.add.string({ default: '' })
		}
	},
	fromHash: '8a5130d42577',
	toHash: '5734b944387b',
	from: {
		articles: s.table(
			{
				libraryId: s.uuid(),
				operationId: s.uuid(),
				title: s.string(),
				excerpt: s.string().optional(),
				author: s.string().optional(),
				publishedAt: s.string().optional(),
				language: s.string().optional(),
				siteId: s.uuid().optional(),
				source: s
					.json(
						JSON.parse(
							'{"$schema":"http://json-schema.org/draft-07/schema#","anyOf":[{"type":"object","properties":{"resolvedUrl":{"type":"string","maxLength":8192,"format":"uri"},"canonicalUrl":{"anyOf":[{"type":"string","maxLength":8192,"format":"uri"},{"type":"null"}]}},"required":["resolvedUrl","canonicalUrl"],"additionalProperties":false},{"type":"null"}]}'
						)
					)
					.optional(),
				html: s.string(),
				text: s.string()
			},
			{
				library: s.rel('libraries', 'libraryId'),
				operation: s.rel('storageOperations', 'operationId'),
				site: s.rel('sites', 'siteId')
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
		documentCaptures: s.table(
			{
				libraryId: s.uuid(),
				documentId: s.uuid(),
				operationId: s.uuid().optional(),
				failure: s.string().optional()
			},
			{
				library: s.rel('libraries', 'libraryId'),
				document: s.rel('libraryDocuments', 'documentId')
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
				sourceUrl: s.string().optional(),
				readingProgress: s.array(s.string()).merge('g-set'),
				resumePosition: s.array(s.string()).merge('g-set'),
				status: s.enum('inbox', 'later', 'archive', 'trashed'),
				favorite: s.boolean(),
				previousStatus: s.enum('inbox', 'later', 'archive').optional(),
				attachmentId: s.uuid().optional()
			},
			{
				library: s.rel('libraries', 'libraryId'),
				attachment: s.rel('articles', 'attachmentId'),
				captures: s.reverse('documentCaptures', 'document')
			}
		),
		notes: s.table(
			{
				libraryId: s.uuid(),
				documentId: s.uuid()
			},
			{
				library: s.rel('libraries', 'libraryId'),
				document: s.rel('libraryDocuments', 'documentId')
			}
		),
		sites: s.table(
			{
				libraryId: s.uuid(),
				origin: s.string(),
				name: s.string().optional(),
				faviconId: s.uuid().optional()
			},
			{
				library: s.rel('libraries', 'libraryId'),
				favicon: s.rel('assets', 'faviconId')
			}
		),
		storageOperations: s.table(
			{
				libraryId: s.uuid(),
				payloadHash: s.string()
			},
			{
				library: s.rel('libraries', 'libraryId')
			}
		)
	},
	to: {
		articles: s.table(
			{
				libraryId: s.uuid(),
				operationId: s.uuid(),
				title: s.string(),
				excerpt: s.string().optional(),
				author: s.string().optional(),
				publishedAt: s.string().optional(),
				language: s.string().optional(),
				siteId: s.uuid().optional(),
				source: s
					.json(
						JSON.parse(
							'{"$schema":"http://json-schema.org/draft-07/schema#","anyOf":[{"type":"object","properties":{"resolvedUrl":{"type":"string","maxLength":8192,"format":"uri"},"canonicalUrl":{"anyOf":[{"type":"string","maxLength":8192,"format":"uri"},{"type":"null"}]}},"required":["resolvedUrl","canonicalUrl"],"additionalProperties":false},{"type":"null"}]}'
						)
					)
					.optional(),
				html: s.string(),
				text: s.string()
			},
			{
				library: s.rel('libraries', 'libraryId'),
				operation: s.rel('storageOperations', 'operationId'),
				site: s.rel('sites', 'siteId')
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
		documentCaptures: s.table(
			{
				libraryId: s.uuid(),
				documentId: s.uuid(),
				operationId: s.uuid().optional(),
				failure: s.string().optional()
			},
			{
				library: s.rel('libraries', 'libraryId'),
				document: s.rel('libraryDocuments', 'documentId')
			}
		),
		highlightAnchors: s.table(
			{
				highlightId: s.uuid(),
				kind: s.enum('source', 'reader'),
				normalizationVersion: s.string(),
				textHash: s.string(),
				textLengthCodePoints: s.int().optional(),
				sourceDate: s.timestamp().optional(),
				range: s.json(
					JSON.parse(
						'{"$schema":"http://json-schema.org/draft-07/schema#","type":"object","properties":{"version":{"type":"integer","minimum":0,"maximum":9007199254740991},"start":{"type":"integer","minimum":0,"maximum":9007199254740991},"end":{"type":"integer","minimum":0,"maximum":9007199254740991},"before":{"type":"string"},"matched":{"type":"string"},"after":{"type":"string"}},"required":["before","matched","after"],"additionalProperties":false}'
					)
				),
				sourceCodePointPosition: s
					.json(
						JSON.parse(
							'{"$schema":"http://json-schema.org/draft-07/schema#","anyOf":[{"type":"object","properties":{"start":{"type":"integer","minimum":0,"maximum":9007199254740991},"end":{"type":"integer","minimum":0,"maximum":9007199254740991}},"required":["start","end"],"additionalProperties":false},{"type":"null"}]}'
						)
					)
					.optional()
			},
			{
				highlight: s.rel('highlights', 'highlightId')
			}
		),
		highlights: s.table(
			{
				libraryId: s.uuid(),
				documentId: s.uuid(),
				source: s.string()
			},
			{
				library: s.rel('libraries', 'libraryId'),
				document: s.rel('libraryDocuments', 'documentId'),
				anchors: s.reverse('highlightAnchors', 'highlight'),
				notes: s.reverse('notes', 'highlight')
			}
		),
		libraries: s.table(
			{
				ownerId: s.uuid(),
				bootstrapVersion: s.string()
			},
			{
				publications: s.reverse('publications', 'library')
			}
		),
		libraryDocuments: s.table(
			{
				libraryId: s.uuid(),
				sourceUrl: s.string().optional(),
				readingProgress: s.array(s.string()).merge('g-set'),
				resumePosition: s.array(s.string()).merge('g-set'),
				status: s.enum('inbox', 'later', 'archive', 'trashed'),
				favorite: s.boolean(),
				previousStatus: s.enum('inbox', 'later', 'archive').optional(),
				attachmentId: s.uuid().optional()
			},
			{
				library: s.rel('libraries', 'libraryId'),
				attachment: s.rel('articles', 'attachmentId'),
				captures: s.reverse('documentCaptures', 'document')
			}
		),
		notes: s.table(
			{
				libraryId: s.uuid(),
				documentId: s.uuid(),
				source: s.string().optional(),
				highlightId: s.uuid().optional(),
				text: s.string().default('').merge('text')
			},
			{
				library: s.rel('libraries', 'libraryId'),
				document: s.rel('libraryDocuments', 'documentId'),
				highlight: s.rel('highlights', 'highlightId')
			}
		),
		publications: s.table(
			{
				libraryId: s.uuid(),
				highlightId: s.uuid().optional(),
				noteId: s.uuid().optional(),
				publishingDid: s.string(),
				lifecycle: s.json(
					JSON.parse(
						'{"$schema":"http://json-schema.org/draft-07/schema#","oneOf":[{"type":"object","properties":{"state":{"type":"string","const":"private"}},"required":["state"],"additionalProperties":false},{"type":"object","properties":{"state":{"type":"string","const":"requested"}},"required":["state"],"additionalProperties":false},{"type":"object","properties":{"state":{"type":"string","const":"issued"},"uri":{"type":"string","maxLength":8192},"record":{"oneOf":[{"type":"object","properties":{"$type":{"type":"string","const":"at.margin.note"},"createdAt":{"type":"string","format":"date-time","pattern":"^(?:(?:\\\\d\\\\d[2468][048]|\\\\d\\\\d[13579][26]|\\\\d\\\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\\\d|30)|(?:02)-(?:0[1-9]|1\\\\d|2[0-8])))T(?:(?:[01]\\\\d|2[0-3]):[0-5]\\\\d:[0-5]\\\\d(?:\\\\.\\\\d+)?(?:Z))$"},"modifiedAt":{"type":"string","format":"date-time","pattern":"^(?:(?:\\\\d\\\\d[2468][048]|\\\\d\\\\d[13579][26]|\\\\d\\\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\\\d|30)|(?:02)-(?:0[1-9]|1\\\\d|2[0-8])))T(?:(?:[01]\\\\d|2[0-3]):[0-5]\\\\d:[0-5]\\\\d(?:\\\\.\\\\d+)?(?:Z))$"},"motivation":{"type":"string","const":"highlighting"},"target":{"type":"object","properties":{"source":{"type":"string","format":"uri"},"selector":{"type":"object","properties":{"type":{"type":"string","const":"TextQuoteSelector"},"exact":{"type":"string","minLength":1},"prefix":{"type":"string"},"suffix":{"type":"string"}},"required":["type","exact"],"additionalProperties":false}},"required":["source","selector"],"additionalProperties":false}},"required":["$type","createdAt","motivation","target"],"additionalProperties":false},{"type":"object","properties":{"$type":{"type":"string","const":"at.margin.note"},"createdAt":{"type":"string","format":"date-time","pattern":"^(?:(?:\\\\d\\\\d[2468][048]|\\\\d\\\\d[13579][26]|\\\\d\\\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\\\d|30)|(?:02)-(?:0[1-9]|1\\\\d|2[0-8])))T(?:(?:[01]\\\\d|2[0-3]):[0-5]\\\\d:[0-5]\\\\d(?:\\\\.\\\\d+)?(?:Z))$"},"modifiedAt":{"type":"string","format":"date-time","pattern":"^(?:(?:\\\\d\\\\d[2468][048]|\\\\d\\\\d[13579][26]|\\\\d\\\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\\\d|30)|(?:02)-(?:0[1-9]|1\\\\d|2[0-8])))T(?:(?:[01]\\\\d|2[0-3]):[0-5]\\\\d:[0-5]\\\\d(?:\\\\.\\\\d+)?(?:Z))$"},"motivation":{"type":"string","const":"commenting"},"target":{"type":"object","properties":{"source":{"type":"string","format":"uri"},"selector":{"type":"object","properties":{"type":{"type":"string","const":"TextQuoteSelector"},"exact":{"type":"string","minLength":1},"prefix":{"type":"string"},"suffix":{"type":"string"}},"required":["type","exact"],"additionalProperties":false}},"required":["source"],"additionalProperties":false},"body":{"type":"object","properties":{"value":{"type":"string"},"format":{"type":"string","const":"text/plain"}},"required":["value","format"],"additionalProperties":false}},"required":["$type","createdAt","motivation","target","body"],"additionalProperties":false}]}},"required":["state","uri","record"],"additionalProperties":false},{"type":"object","properties":{"state":{"type":"string","const":"published"},"uri":{"type":"string","maxLength":8192}},"required":["state","uri"],"additionalProperties":false},{"type":"object","properties":{"state":{"type":"string","const":"unpublishing"},"uri":{"type":"string","maxLength":8192},"cid":{"type":"string"}},"required":["state","uri","cid"],"additionalProperties":false},{"type":"object","properties":{"state":{"type":"string","const":"unpublished"},"uri":{"type":"string","maxLength":8192}},"required":["state","uri"],"additionalProperties":false}]}'
					)
				)
			},
			{
				library: s.rel('libraries', 'libraryId'),
				highlight: s.rel('highlights', 'highlightId'),
				note: s.rel('notes', 'noteId')
			}
		),
		sites: s.table(
			{
				libraryId: s.uuid(),
				origin: s.string(),
				name: s.string().optional(),
				faviconId: s.uuid().optional()
			},
			{
				library: s.rel('libraries', 'libraryId'),
				favicon: s.rel('assets', 'faviconId')
			}
		),
		storageOperations: s.table(
			{
				libraryId: s.uuid(),
				payloadHash: s.string()
			},
			{
				library: s.rel('libraries', 'libraryId')
			}
		)
	}
})
