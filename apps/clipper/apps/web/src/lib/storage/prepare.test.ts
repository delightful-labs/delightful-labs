import type { SaveRequest } from '../contracts/storage.js'
import { expect, it } from 'vitest'
import { prepareSave, BYTE_LIMIT, TEXT_LIMIT } from './prepare.js'
const libraryId = crypto.randomUUID()
const request = () =>
	({
		operationId: crypto.randomUUID(),
		title: 'Title',
		text: 'café 🦊',
		bytes: new TextEncoder().encode('<p>café 🦊</p>'),
		mediaType: 'text/html'
	}) satisfies SaveRequest
it('prepares Article content and fingerprints the exact payload for uncertain-write reconciliation', async () => {
	const input = request(),
		first = await prepareSave(libraryId, input),
		second = await prepareSave(libraryId, input)
	expect(first.attachment).toMatchObject({
		title: input.title,
		html: '<p>café 🦊</p>',
		text: input.text,
		site: null,
		source: null
	})
	expect(first.intent.payloadHash).toBe(second.intent.payloadHash)
	input.bytes[0] = 9
	expect(first.attachment.html).toBe('<p>café 🦊</p>')
	expect((await prepareSave(libraryId, input)).intent.payloadHash).not.toBe(
		first.intent.payloadHash
	)
	expect((await prepareSave(libraryId, { ...input, text: 'changed' })).intent.payloadHash).not.toBe(
		first.intent.payloadHash
	)
})
it('keeps supplied URL separate from redirect and canonical evidence and scopes Site to the resolved origin', async () => {
	const input = {
		...request(),
		author: 'Ada',
		publishedTime: '2026-11-12',
		lang: 'en',
		siteName: 'News',
		source: {
			submittedUrl: 'https://short.example/story?q=1#passage',
			finalUrl: 'https://news.example.com/story',
			canonicalUrl: 'https://publisher.example/article',
			provenance: '{}'
		}
	}
	const first = await prepareSave(libraryId, input),
		second = await prepareSave(libraryId, {
			...input,
			operationId: crypto.randomUUID(),
			source: { ...input.source, finalUrl: 'https://news.example.com/other' }
		})
	expect(first.attachment).toMatchObject({
		author: 'Ada',
		publishedAt: input.publishedTime,
		language: 'en',
		source: { resolvedUrl: input.source.finalUrl, canonicalUrl: input.source.canonicalUrl },
		site: { origin: 'https://news.example.com', name: 'News', favicon: null }
	})
	expect(first.attachment.site?.id).toBe(second.attachment.site?.id)
	expect(first.source?.submittedUrl).toBe(input.source.submittedUrl)
})
it('rejects oversized inputs before persistence', async () => {
	await expect(
		prepareSave(libraryId, { ...request(), bytes: new Uint8Array(BYTE_LIMIT + 1) })
	).rejects.toThrow()
	await expect(
		prepareSave(libraryId, { ...request(), text: 'é'.repeat(TEXT_LIMIT) })
	).rejects.toThrow()
})
it('queues featured images once even when repeated in the body', async () => {
	const featuredImageUrl = 'https://example.com/cover.png'
	const saved = await prepareSave(libraryId, {
		...request(),
		bytes: new TextEncoder().encode(
			`<img data-clipper-image="${encodeURIComponent(featuredImageUrl)}">`
		),
		featuredImageUrl
	})
	expect(saved.images).toHaveLength(1)
	expect(saved.images?.[0]).toMatchObject({
		sourceUrl: featuredImageUrl,
		status: 'pending',
		assetId: null
	})
})
