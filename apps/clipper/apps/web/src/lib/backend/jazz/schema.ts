import { schema as s } from 'jazz-tools'
import { migrations } from './migrations/index.js'
import { schema as authSchema } from './auth-schema.js'
import { positionSchema } from '../../reader/schema.js'
import { documentReadingStatusValues, documentStatusValues } from '../../capture/document-schema.js'

export const app = s.defineApp(
	{
		...authSchema,
		notes: s.table(
			{ libraryId: s.uuid(), articleId: s.uuid().optional(), documentId: s.uuid().optional() },
			{
				library: s.rel('libraries', 'libraryId'),
				article: s.rel('articles', 'articleId'),
				document: s.rel('documents', 'documentId')
			}
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
		readerOperations: s.table(
			{
				libraryId: s.uuid(),
				documentId: s.uuid().optional(),
				field: s.string(),
				value: s.string(),
				parents: s.string()
			},
			{ library: s.rel('libraries', 'libraryId'), document: s.rel('documents', 'documentId') }
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
		articles: s.table(
			{
				libraryId: s.uuid(),
				url: s.string(),
				originalSavedAt: s.string(),
				contentId: s.uuid().optional(),
				operationId: s.uuid().optional(),
				failure: s.string().optional()
			},
			{ library: s.rel('libraries', 'libraryId'), content: s.rel('documents', 'contentId') }
		),
		// The legacy `documents` table stores immutable content bundles; this table owns saved-library state.
		libraryDocuments: s.table(
			{
				libraryId: s.uuid(),
				url: s.string().optional(),
				readingProgress: s.float(),
				resumePosition: s.json(positionSchema.omit({ progress: true })).optional(),
				status: s.enum(...documentStatusValues),
				favorite: s.boolean(),
				previousStatus: s.enum(...documentReadingStatusValues).optional(),
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
		articleSources: s.table(
			{
				documentId: s.uuid(),
				libraryId: s.uuid(),
				finalUrl: s.string(),
				submittedUrl: s.string(),
				provenance: s.string()
			},
			{ library: s.rel('libraries', 'libraryId'), document: s.rel('documents', 'documentId') }
		),
		libraries: s.table({ ownerId: s.uuid(), bootstrapVersion: s.string() }, {}),
		storageOperations: s.table(
			{ libraryId: s.uuid(), payloadHash: s.string(), createdAt: s.string() },
			{ library: s.rel('libraries', 'libraryId') }
		),
		assets: s.table(
			{ libraryId: s.uuid(), operationId: s.uuid(), mediaType: s.string(), payload: s.bytes() },
			{
				library: s.rel('libraries', 'libraryId'),
				operation: s.rel('storageOperations', 'operationId')
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
		)
	},
	{ migrations }
)
