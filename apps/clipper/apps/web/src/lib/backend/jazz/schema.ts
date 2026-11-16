import { schema as s } from 'jazz-tools'
import { nativeRangeSchema } from '../../annotations/schema.js'
import { z } from 'zod'
import { schema as authSchema } from './auth-schema.js'
import { captureSourceSchema } from '../../capture/article-schema.js'
import { readingProgressColumn, resumePositionColumn } from './reading-columns.js'
import { documentReadingStatusSchema, documentStatusSchema } from '../../capture/document-schema.js'

function nativeEnumValues<Value extends string>(values: Value[]): [Value, ...Value[]] {
	const [first, ...rest] = values
	if (first === undefined) throw new Error('Empty enum')
	return [first, ...rest]
}
export const app = s.defineApp(
	{
		...authSchema,
		publicationLinks: s.table(
			{
				libraryId: s.uuid(),
				highlightId: s.uuid().optional(),
				noteId: s.uuid().optional(),
				uri: s.string()
			},
			{
				library: s.rel('libraries', 'libraryId'),
				highlight: s.rel('highlights', 'highlightId'),
				note: s.rel('notes', 'noteId')
			}
		),
		notes: s.table(
			{
				libraryId: s.uuid(),
				documentId: s.uuid().optional(),
				source: s.string().optional(),
				highlightId: s.uuid().optional(),
				text: s.string().merge('text').default('')
			},
			{
				library: s.rel('libraries', 'libraryId'),
				document: s.rel('libraryDocuments', 'documentId'),
				highlight: s.rel('highlights', 'highlightId')
			}
		),
		highlights: s.table(
			{ libraryId: s.uuid(), documentId: s.uuid(), source: s.string() },
			{
				library: s.rel('libraries', 'libraryId'),
				document: s.rel('libraryDocuments', 'documentId'),
				anchors: s.reverse('highlightAnchors', 'highlight'),
				notes: s.reverse('notes', 'highlight')
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
				range: s.json(nativeRangeSchema),
				sourceCodePointPosition: s
					.json(
						z
							.object({
								start: z.number().int().nonnegative(),
								end: z.number().int().nonnegative()
							})
							.nullable()
					)
					.optional()
			},
			{ highlight: s.rel('highlights', 'highlightId') }
		),
		noteRevisions: s.table(
			{
				libraryId: s.uuid(),
				noteId: s.uuid(),
				text: s.string(),
				parents: s.string(),
				editedAt: s.string()
			},
			{ library: s.rel('libraries', 'libraryId'), note: s.rel('notes', 'noteId') }
		),
		articleImages: s.table(
			{
				libraryId: s.uuid(),
				articleId: s.uuid(),
				sourceUrl: s.string(),
				status: s.string(),
				assetId: s.uuid().optional(),
				retryable: s.boolean()
			},
			{
				library: s.rel('libraries', 'libraryId'),
				article: s.rel('articles', 'articleId'),
				asset: s.rel('assets', 'assetId')
			}
		),
		readerOperations: s.table(
			{ libraryId: s.uuid(), field: s.string(), value: s.string(), parents: s.string() },
			{ library: s.rel('libraries', 'libraryId') }
		),
		tagOperations: s.table(
			{
				libraryId: s.uuid(),

				documentId: s.uuid(),
				key: s.string(),
				name: s.string(),
				assigned: s.boolean(),
				parents: s.string()
			},
			{
				library: s.rel('libraries', 'libraryId'),
				document: s.rel('libraryDocuments', 'documentId')
			}
		),
		organizationOperations: s.table(
			{
				libraryId: s.uuid(),

				documentId: s.uuid(),
				field: s.string(),
				value: s.string(),
				parents: s.string()
			},
			{
				library: s.rel('libraries', 'libraryId'),
				document: s.rel('libraryDocuments', 'documentId')
			}
		),
		libraryDocuments: s.table(
			{
				libraryId: s.uuid(),
				sourceUrl: s.string().optional(),
				readingProgress: readingProgressColumn,
				resumePosition: resumePositionColumn,
				status: s.enum(...nativeEnumValues(documentStatusSchema.options)),
				favorite: s.boolean(),
				previousStatus: s.enum(...nativeEnumValues(documentReadingStatusSchema.options)).optional(),
				attachmentId: s.uuid().optional()
			},
			{
				library: s.rel('libraries', 'libraryId'),
				attachment: s.rel('articles', 'attachmentId'),
				captures: s.reverse('documentCaptures', 'document')
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
				source: s.json(captureSourceSchema.nullable()).optional(),
				html: s.string(),
				text: s.string()
			},
			{
				library: s.rel('libraries', 'libraryId'),
				operation: s.rel('storageOperations', 'operationId'),
				site: s.rel('sites', 'siteId')
			}
		),
		libraries: s.table(
			{ ownerId: s.uuid(), bootstrapVersion: s.string() },
			{ publicationLinks: s.reverse('publicationLinks', 'library') }
		),
		storageOperations: s.table(
			{ libraryId: s.uuid(), payloadHash: s.string() },
			{ library: s.rel('libraries', 'libraryId') }
		),
		assets: s.table(
			{ libraryId: s.uuid(), operationId: s.uuid(), mediaType: s.string(), payload: s.bytes() },
			{
				library: s.rel('libraries', 'libraryId'),
				operation: s.rel('storageOperations', 'operationId')
			}
		)
	},
	{ migrations: 'none' }
)
