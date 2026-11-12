import { documentReadingStatusSchema } from './document-schema.js'
import { z } from 'zod'
import { tagRequestSchema } from './tags.js'
import {
	causalHeads,
	causalParentsSchema,
	articleTargets,
	createArticleTargetLookup,
	indexCausalHistory
} from './causal.js'
import type { ArticleTargetLookup } from './causal.js'
import { lowercaseUuidSchema } from '../validation/values.js'
import type { CaptureDocument, LibraryArticle } from '../contracts/articles.js'
export const articleStatuses = documentReadingStatusSchema.options
export const libraryViewSchema = z.enum(['all', ...articleStatuses, 'trash'])
export const libraryViews = libraryViewSchema.options
export type ArticleStatus = (typeof articleStatuses)[number]
export function isArticleStatus(value: string): value is ArticleStatus {
	return articleStatuses.some((status) => status === value)
}
export type LibraryView = (typeof libraryViews)[number]
const organizationTargetSchema = tagRequestSchema.pick({ id: true })
const articleStatusSchema = documentReadingStatusSchema
export const organizationRequestSchema = z.discriminatedUnion('field', [
	organizationTargetSchema.extend({ field: z.literal('status'), value: articleStatusSchema }),
	organizationTargetSchema.extend({ field: z.literal('favorite'), value: z.boolean() }),
	organizationTargetSchema.extend({ field: z.literal('trashed'), value: z.boolean() }),
	tagRequestSchema
])
export type OrganizationRequest = z.infer<typeof organizationRequestSchema>
export const organizationOperationSchema = z
	.object({
		id: lowercaseUuidSchema,
		libraryId: lowercaseUuidSchema,

		documentId: lowercaseUuidSchema,
		field: z.enum(['status', 'favorite', 'trashed']),
		value: z.string().max(7),
		parents: causalParentsSchema
	})
	.refine((r) =>
		r.field === 'status'
			? articleStatuses.some((s) => s === r.value)
			: r.value === 'true' || r.value === 'false'
	)
export type OrganizationOperation = z.infer<typeof organizationOperationSchema>
/** Causally superseded operations never win. Concurrent heads use operation UUID order,
 * independently for each scalar field. No clocks or toggle replay are involved. */
export const organizationHeads = causalHeads
export const organizationTargets = articleTargets
export function projectOrganization(
	rows: LibraryArticle[],
	operations: OrganizationOperation[],
	articles: Pick<CaptureDocument, 'id'>[] = [],
	targets: ArticleTargetLookup = createArticleTargetLookup(articles)
) {
	const history = indexCausalHistory(operations, (operation) => operation.field)
	return rows.map((row) => {
		const heads = history(targets(row.id))
		return {
			...row,
			status: articleStatusSchema.parse(heads.get('status')?.value ?? row.status ?? 'inbox'),
			favorite: heads.has('favorite')
				? heads.get('favorite')?.value === 'true'
				: row.favorite === true,
			trashed: heads.has('trashed') ? heads.get('trashed')?.value === 'true' : row.trashed === true
		}
	})
}
export function matchesLibraryFilter(row: LibraryArticle, view: LibraryView, favorites: boolean) {
	return (
		(view === 'trash'
			? row.trashed === true
			: (row.trashed === true) !== true && (view === 'all' || (row.status ?? 'inbox') === view)) &&
		(!favorites || row.favorite === true)
	)
}
export function canOrganizeArticle(article: unknown, document: unknown) {
	return article != null || document != null
}

export function canRequestOrganization(rows: LibraryArticle[], request: OrganizationRequest) {
	if (!organizationRequestSchema.safeParse(request).success) return false
	return rows.some((row) => row.id === request.id)
}
