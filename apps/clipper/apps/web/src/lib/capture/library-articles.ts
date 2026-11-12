import type { CaptureDocument, LibraryArticle } from '../contracts/articles.js'
import { makeExcerpt } from './excerpt.js'
export function projectLibraryArticles(documents: CaptureDocument[]): LibraryArticle[] {
	return documents
		.map((document) => {
			const excerpt = document.attachment
				? makeExcerpt(
						document.attachment.excerpt?.trim()
							? document.attachment.excerpt
							: document.attachment.text,
						document.attachment.title
					)
				: ''
			return {
				id: document.id,
				title: document.attachment?.title ?? document.sourceUrl ?? '',
				readingProgress: document.readingProgress,
				status: document.status === 'trashed' ? document.previousStatus : document.status,
				favorite: document.favorite,
				trashed: document.status === 'trashed',
				...(excerpt ? { excerpt } : {}),
				url: document.sourceUrl,
				readable: document.attachment !== null,
				createdAt: document.createdAt.toISOString(),
				failure: document.failure
			}
		})
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))
}
