import type { Snapshot } from 'xstate'
import { z } from 'zod'
import type { Document } from '../capture/document-schema.js'
import { extractedContentSchema } from './capture-response.js'
import { webUrlSchema, lowercaseUuidSchema } from '../validation/values.js'
import type { WorkspaceCreationResult } from 'delightful-local-first/workspace/creation/contracts'
import type { SaveRequest, SaveResult, SyncReceipt } from './storage.js'
export type { CaptureDocument } from '../capture/capture-document-schema.js'
import type { CaptureDocument } from '../capture/capture-document-schema.js'
export const articleContentSchema = extractedContentSchema.extend({
	finalUrl: webUrlSchema.max(8192),
	canonicalUrl: webUrlSchema.max(8192).nullable().optional(),
	provenance: z.string().max(32768)
})
export type ArticleContent = z.infer<typeof articleContentSchema>
/** Both Add Link and a trusted browser clip use this operation. */
export const saveArticleRequestSchema = z.object({
	url: webUrlSchema.max(8192),
	content: articleContentSchema.optional(),
	operationId: lowercaseUuidSchema.optional()
})
export type SaveArticleRequest = z.infer<typeof saveArticleRequestSchema>
export type ArticleSaveResult =
	| (SaveResult & { ready?: boolean })
	| { kind: 'duplicate'; operationId: string; ready: boolean; receipts: SyncReceipt[] }
export type ArticleDraft = { article: CaptureDocument; content?: SaveRequest; target: string }
export type ArticleStageResult = WorkspaceCreationResult<ArticleDraft, SyncReceipt>
export type ArticleStageInput = {
	attempt: { operationId: string; workspaceId: string; membershipId: string; draft: ArticleDraft }
}
export type ArticleStageOperation = (
	spawn: import('../machines/children.js').ChildSpawner,
	input: ArticleStageInput
) => import('xstate').ActorInstance<Snapshot<ArticleStageResult>, { type: 'SHUTDOWN' | 'CANCEL' }>
export type ContentOperation = (
	spawn: import('../machines/children.js').ChildSpawner,
	input: SaveRequest
) => import('xstate').ActorInstance<Snapshot<SaveResult>, { type: 'SHUTDOWN' }>
export type ArticleSaveCapability = {
	isCurrent: () => boolean
	prepare: (request: SaveArticleRequest) => Promise<ArticleDraft>
	read: (id: string) => Promise<CaptureDocument | null>
	document: (id: string) => Promise<import('../capture/article-schema.js').Article | null>
	intent: (id: string) => Promise<boolean>
	ensure: ArticleStageOperation
	attach: ArticleStageOperation
	content: ContentOperation
}
export type LibraryArticle = Pick<Document, 'id' | 'readingProgress'> & {
	excerpt?: string
	trashed?: boolean
	tags?: import('../capture/tags.js').Tag[]
	tagVocabulary?: import('../capture/tags.js').Tag[]
	status?: 'inbox' | 'later' | 'archive'
	favorite?: boolean
	title: string
	url: string | null
	readable: boolean
	createdAt: string
	failure: string | null
}
