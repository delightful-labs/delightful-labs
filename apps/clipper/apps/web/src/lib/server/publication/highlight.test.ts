import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { createPolicyTestApp } from 'jazz-tools/testing'
import type { PolicyTestApp } from 'jazz-tools/testing'
import { app } from '../../backend/jazz/schema.js'
import permissions from '../../backend/jazz/permissions.js'
import { policySchema } from '../../backend/jazz/schema-permissions.test-support.js'
import { READER_TEXT_VERSION, textFingerprint } from '../../annotations/schema.js'
import { publicationFromRow, publicationSchema } from '../../annotations/publication.js'
import { createGatewayMachine } from '../../machines/capture/gateway.js'
import { handlePublicationPublish } from './publish.js'
import { handlePreviewRequest } from './request.js'
import { firstPublicationWriteSchema } from './first-write.js'
import { origin, requestFixture } from './request.test-support.js'

let fixture: PolicyTestApp
beforeAll(async () => {
	fixture = await createPolicyTestApp(policySchema(), permissions, expect)
})
afterAll(async () => fixture?.shutdown())
const quote = 'A quoted café 🦊 passage.'
const html =
	'<html><body><nav>Original page menu. </nav><article><p>' +
	quote +
	'</p></article><footer> Original footer.</footer></body></html>'
const cid = 'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku'
async function setup(name: string, withNote = false) {
	const a = await requestFixture({ fixture, name })
	const text = 'Reader-only prefix. ' + quote + ' Reader-only suffix.'
	const start = text.indexOf(quote)
	await a.owner.backend
		.insert(
			app.highlights,
			{
				libraryId: a.owner.libraryId,
				documentId: a.owner.documentId,
				source: 'https://example.org/article'
			},
			{ id: a.owner.highlightId }
		)
		.wait({ tier: 'global' })
	await a.owner.backend
		.insert(app.highlightAnchors, {
			highlightId: a.owner.highlightId,
			kind: 'reader',
			normalizationVersion: READER_TEXT_VERSION,
			textHash: await textFingerprint(text),
			range: a.owner.backend.textAnchors().captureRange(text, start, start + quote.length),
			sourceDate: null,
			textLengthCodePoints: null,
			sourceCodePointPosition: null
		})
		.wait({ tier: 'global' })
	const attachedId = crypto.randomUUID()
	if (withNote)
		await a.owner.backend
			.insert(
				app.notes,
				{
					libraryId: a.owner.libraryId,
					documentId: null,
					highlightId: a.owner.highlightId,
					source: null,
					text: 'Attached note'
				},
				{ id: attachedId }
			)
			.wait({ tier: 'global' })
	return { ...a, attachedId }
}
type Fixture = Awaited<ReturnType<typeof setup>>
function selection(a: Fixture) {
	return {
		libraryId: a.owner.libraryId,
		source: { highlightId: a.owner.highlightId },
		publishingDid: a.owner.scope.publishingDid
	}
}
function request(a: Fixture, preview = false) {
	return new Request(origin + '/api/publication/' + (preview ? 'preview' : 'publish'), {
		method: 'POST',
		headers: { origin, cookie: a.credentials.cookie, 'content-type': 'application/json' },
		body: JSON.stringify(
			preview
				? { libraryId: a.owner.libraryId, source: { highlightId: a.owner.highlightId } }
				: selection(a)
		)
	})
}
function server(a: Fixture, source = html, onGrant?: () => Promise<void>) {
	const fetch = vi.fn(async () => ({
		status: 200,
		location: undefined,
		mediaType: 'text/html; charset=utf-8',
		body: new TextEncoder().encode(source)
	}))
	const gateway = createGatewayMachine({
		resolve: async () => ({ address: '203.0.113.1', family: 4 }),
		fetch,
		extract: async () => {
			throw new Error('Unexpected reader extraction')
		}
	})
	const records = new Map<string, unknown>(),
		writes: unknown[] = []
	const handle = vi.fn(async (path: string, init?: RequestInit) => {
		if (path === '/xrpc/com.atproto.repo.putRecord') {
			const write = firstPublicationWriteSchema.parse(JSON.parse(String(init?.body)))
			const uri = 'at://' + write.repo + '/' + write.collection + '/' + write.rkey
			const rows = await a.owner.backend.all(
				app.publications.where({ libraryId: a.owner.libraryId })
			)
			expect(publicationFromRow(rows[0])).toEqual({
				...selection(a),
				state: 'issued',
				uri,
				record: write.record
			})
			expect(records.has(uri)).toBe(false)
			writes.push(write)
			records.set(uri, write.record)
			return Response.json({ uri, cid })
		}
		if (path === '/xrpc/com.atproto.repo.deleteRecord') {
			const value: unknown = JSON.parse(String(init?.body))
			if (
				typeof value !== 'object' ||
				value === null ||
				!('rkey' in value) ||
				typeof value.rkey !== 'string' ||
				!('swapRecord' in value)
			)
				throw new Error('Invalid removal')
			expect(value.swapRecord).toBe(cid)
			records.delete('at://' + a.owner.scope.publishingDid + '/at.margin.note/' + value.rkey)
			return Response.json({})
		}
		const params = new URL(path, origin).searchParams
		const uri =
			'at://' + params.get('repo') + '/' + params.get('collection') + '/' + params.get('rkey')
		return records.has(uri)
			? Response.json({ uri, cid, value: records.get(uri) })
			: Response.json({ error: 'RecordNotFound' }, { status: 400 })
	})
	const auth = {
		api: {
			getSession: a.auth.api.getSession,
			getAtprotoClient: async () => ({
				session: {
					did: a.owner.scope.publishingDid,
					getTokenInfo: async () => {
						await onGrant?.()
						return { sub: a.owner.scope.publishingDid, scope: 'atproto repo:at.margin.note' }
					},
					handle
				}
			})
		}
	}
	return {
		gateway,
		fetch,
		records,
		writes,
		handle,
		auth,
		backend: { db: a.owner.backend, accountFor: async () => a.owner.libraryId }
	}
}

it.each([false, true])(
	'publishes one source-verified highlight, attached note=%s',
	async (withNote) => {
		const a = await setup('highlight-' + withNote, withNote),
			s = server(a)
		const preview = await handlePreviewRequest(
			s.auth,
			s.backend,
			request(a, true),
			origin,
			s.gateway
		)
		expect(preview.status).toBe(200)
		expect(s.records.size).toBe(0)
		const response = await handlePublicationPublish(
			s.auth,
			s.backend,
			request(a),
			origin,
			'publish',
			s.gateway
		)
		expect(response.status).toBe(200)
		const value = publicationSchema.parse(await response.json())
		expect(value.state).toBe('published')
		expect(s.writes).toHaveLength(1)
		const write = firstPublicationWriteSchema.parse(s.writes[0])
		expect(write.record.motivation).toBe(withNote ? 'commenting' : 'highlighting')
		expect(write.record.target.selector).toEqual({
			type: 'TextQuoteSelector',
			exact: quote,
			prefix: expect.stringContaining('Original page menu.'),
			suffix: expect.stringContaining('Original footer.')
		})
		expect(JSON.stringify(write.record)).not.toContain('Reader-only')
		expect(JSON.stringify(write.record)).not.toContain('TextPositionSelector')
		if (withNote)
			expect(write.record).toMatchObject({ body: { value: 'Attached note', format: 'text/plain' } })
		expect(s.fetch).toHaveBeenCalledTimes(2)
		await a.owner.backend.delete(app.highlights, a.owner.highlightId).wait({ tier: 'global' })
		const removed = await handlePublicationPublish(
			s.auth,
			s.backend,
			request(a),
			origin,
			'cleanup',
			s.gateway
		)
		expect(removed.status).toBe(200)
		expect(s.records.size).toBe(0)
	}
)
it.each([
	'<p>Quote missing.</p>',
	'<p>' + quote + quote + '</p>',
	'<script>' + quote + '</script><p>Visible content.</p>'
])('refuses missing, ambiguous or non-content quotations: %s', async (source) => {
	const a = await setup('highlight-refused-' + crypto.randomUUID()),
		s = server(a, source)
	expect(
		(await handlePublicationPublish(s.auth, s.backend, request(a), origin, 'publish', s.gateway))
			.status
	).toBe(409)
	expect(s.writes).toHaveLength(0)
	expect(
		await a.owner.backend.all(app.publications.where({ libraryId: a.owner.libraryId }))
	).toHaveLength(0)
})
it('rechecks accepted commentary after source verification', async () => {
	const a = await setup('highlight-late-note', true)
	const s = server(a, html, async () => {
		await a.owner.backend
			.update(app.notes, a.attachedId, { text: 'Changed after source verification' })
			.wait({ tier: 'global' })
	})
	expect(
		(await handlePublicationPublish(s.auth, s.backend, request(a), origin, 'publish', s.gateway))
			.status
	).toBe(409)
	expect(s.writes).toHaveLength(0)
})
it('republishes a bare highlight at the same address after removing its private commentary', async () => {
	const a = await setup('highlight-bare-republish', true),
		s = server(a)
	const first = publicationSchema.parse(
		await (
			await handlePublicationPublish(s.auth, s.backend, request(a), origin, 'publish', s.gateway)
		).json()
	)
	expect(
		(await handlePublicationPublish(s.auth, s.backend, request(a), origin, 'unpublish', s.gateway))
			.status
	).toBe(200)
	await a.owner.backend.delete(app.notes, a.attachedId).wait({ tier: 'global' })
	const second = publicationSchema.parse(
		await (
			await handlePublicationPublish(s.auth, s.backend, request(a), origin, 'publish', s.gateway)
		).json()
	)
	expect(second).toEqual(first)
	expect(firstPublicationWriteSchema.parse(s.writes[1]).record.motivation).toBe('highlighting')
})
