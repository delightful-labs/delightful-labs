import { z } from 'zod'
import { cidSchema } from '../../annotations/publication-link.js'
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import { createPolicyTestApp } from 'jazz-tools/testing'
import type { PolicyTestApp } from 'jazz-tools/testing'
import { app } from '../../backend/jazz/schema.js'
import permissions from '../../backend/jazz/permissions.js'
import { policySchema } from '../../backend/jazz/schema-permissions.test-support.js'
import {
	publicationBaseSchema,
	publicationFromRow,
	publicationSchema
} from '../../annotations/publication.js'
import { firstPublicationWriteSchema } from './first-write.js'
import { handlePublicationPublish } from './publish.js'
import { handlePreviewRequest } from './request.js'
import { origin, requestFixture } from './request.test-support.js'

let fixture: PolicyTestApp
beforeAll(async () => {
	fixture = await createPolicyTestApp(policySchema(), permissions, expect)
})
afterAll(async () => fixture?.shutdown())
afterEach(() => vi.restoreAllMocks())
const setup = (name: string) => requestFixture({ fixture, name })
type Fixture = Awaited<ReturnType<typeof setup>>
function selection(a: Fixture) {
	return {
		libraryId: a.owner.libraryId,
		source: { noteId: a.owner.noteId },
		publishingDid: a.owner.scope.publishingDid
	}
}
function request(a: Fixture, body: unknown = selection(a), headers: Record<string, string> = {}) {
	return new Request(origin + '/api/publication/publish', {
		method: 'POST',
		headers: {
			origin,
			cookie: a.credentials.cookie,
			'content-type': 'application/json',
			...headers
		},
		body: JSON.stringify(body)
	})
}
function server(
	a: Fixture,
	options: {
		grant?: string
		loseResponse?: boolean
		loseRemovalResponse?: boolean
		rejectRemoval?: boolean
		rejectWrite?: boolean
		beforeWrite?: () => Promise<void>
	} = {}
) {
	const records = new Map<string, unknown>()
	const writes: unknown[] = []
	const removals: unknown[] = []
	let cid = 'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku'
	const handle = vi.fn(async (path: string, init?: RequestInit) => {
		if (path === '/xrpc/com.atproto.repo.putRecord') {
			await options.beforeWrite?.()
			const write = firstPublicationWriteSchema.parse(JSON.parse(String(init?.body)))
			const uri = 'at://' + write.repo + '/' + write.collection + '/' + write.rkey
			// Dispatch must follow native acceptance of precisely this frozen payload.
			const rows = await a.owner.backend.all(
				app.publications.where({ libraryId: a.owner.libraryId })
			)
			expect(rows).toHaveLength(1)
			expect(publicationFromRow(rows[0])).toEqual({
				...selection(a),
				state: 'issued',
				uri,
				record: write.record
			})
			expect(init?.method).toBe('POST')
			expect(write.swapRecord).toBeNull()
			writes.push(write)
			if (options.rejectWrite) return Response.json({ error: 'InvalidSwap' }, { status: 400 })
			expect(records.has(uri)).toBe(false)
			records.set(uri, write.record)
			if (options.loseResponse) throw new TypeError('Synthetic lost response')
			return Response.json({ uri, cid: 'unused-write-receipt' })
		}
		if (path === '/xrpc/com.atproto.repo.deleteRecord') {
			const removal = z
				.strictObject({
					repo: publicationBaseSchema.shape.publishingDid,
					collection: z.literal('at.margin.note'),
					rkey: z.string(),
					swapRecord: cidSchema
				})
				.parse(JSON.parse(String(init?.body)))
			const uri = 'at://' + removal.repo + '/' + removal.collection + '/' + removal.rkey
			expect(publicationFromRow((await rows(a))[0])).toEqual({
				...selection(a),
				state: 'unpublishing',
				uri,
				cid: removal.swapRecord
			})
			removals.push(removal)
			if (options.rejectRemoval || removal.swapRecord !== cid)
				return Response.json({ error: 'InvalidSwap' }, { status: 400 })
			records.delete(uri)
			if (options.loseRemovalResponse && removals.length === 1)
				throw new TypeError('Synthetic lost removal response')
			return Response.json({})
		}
		const url = new URL(path, origin)
		expect(url.pathname).toBe('/xrpc/com.atproto.repo.getRecord')
		const uri =
			'at://' +
			url.searchParams.get('repo') +
			'/' +
			url.searchParams.get('collection') +
			'/' +
			url.searchParams.get('rkey')
		return records.has(uri)
			? Response.json({ uri, value: records.get(uri), cid })
			: Response.json({ error: 'RecordNotFound' }, { status: 400 })
	})
	const restore = vi.fn(async () => ({
		session: {
			did: a.owner.scope.publishingDid,
			getTokenInfo: async () => ({
				sub: a.owner.scope.publishingDid,
				scope: options.grant ?? 'atproto repo:at.margin.note'
			}),
			handle
		}
	}))
	return {
		records,
		writes,
		removals,
		changeCid: (value: string) => {
			cid = value
		},
		handle,
		restore,
		auth: { api: { getSession: a.auth.api.getSession, getAtprotoClient: restore } },
		backend: { db: a.owner.backend, accountFor: vi.fn(async () => a.owner.libraryId) }
	}
}
const rows = (a: Fixture) =>
	a.owner.backend.all(app.publications.where({ libraryId: a.owner.libraryId }))

it.each([false, true])(
	'publishes and confirms one native note, including lost PUT response=%s',
	async (loseResponse) => {
		const a = await setup('publish-' + loseResponse),
			s = server(a, { loseResponse })
		const response = await handlePublicationPublish(s.auth, s.backend, request(a), origin)
		expect(response.status).toBe(200)
		expect(response.headers.get('cache-control')).toBe('private, no-store')
		const publication = publicationSchema.parse(await response.json())
		expect(publication.state).toBe('published')
		expect(publicationFromRow((await rows(a))[0])).toEqual(publication)
		expect(s.writes).toHaveLength(1)
		expect(s.records.size).toBe(1)
		// Closing/reopening and repeated Publish retain the accepted address.
		const previewRequest = new Request(origin + '/api/publication/preview', {
			method: 'POST',
			headers: { origin, cookie: a.credentials.cookie, 'content-type': 'application/json' },
			body: JSON.stringify({ libraryId: a.owner.libraryId, source: { noteId: a.owner.noteId } })
		})
		const preview = await handlePreviewRequest(s.auth, s.backend, previewRequest, origin)
		expect(preview.status).toBe(200)
		expect(await preview.json()).toEqual(publication)
		const again = await handlePublicationPublish(s.auth, s.backend, request(a), origin)
		expect(await again.json()).toEqual(publication)
		expect(s.writes).toHaveLength(1)
		const row = (await rows(a))[0]
		if (!row) throw new Error('Missing publication')
		expect(await a.owner.backend.all(app.$history.publications.where({ id: row.id }))).toHaveLength(
			3
		)
	}
)

it('does not store intent or call the PDS without the collection grant', async () => {
	const a = await setup('publish-grant'),
		s = server(a, { grant: 'atproto' })
	expect((await handlePublicationPublish(s.auth, s.backend, request(a), origin)).status).toBe(403)
	expect(await rows(a)).toEqual([])
	expect(s.handle).not.toHaveBeenCalled()
})
it('rejects foreign origins, forged payloads, another publisher and missing cookies before dispatch', async () => {
	const a = await setup('publish-auth'),
		s = server(a)
	for (const [body, headers, status] of [
		[selection(a), { origin: 'https://evil.invalid' }, 403],
		[{ ...selection(a), record: {} }, {}, 400],
		[{ ...selection(a), publishingDid: 'did:web:other.invalid' }, {}, 409],
		[selection(a), { cookie: '' }, 401]
	] satisfies [unknown, Record<string, string>, number][]) {
		expect(
			(await handlePublicationPublish(s.auth, s.backend, request(a, body, headers), origin)).status
		).toBe(status)
	}
	expect(await rows(a)).toEqual([])
	expect(s.restore).not.toHaveBeenCalled()
})
it('retains uncertain issuance and retries only a GET at the same address', async () => {
	const a = await setup('publish-retain'),
		s = server(a, { rejectWrite: true })
	expect((await handlePublicationPublish(s.auth, s.backend, request(a), origin)).status).toBe(409)
	const issued = publicationFromRow((await rows(a))[0])
	if (issued.state !== 'issued') throw new Error('Missing retained issuance')
	expect(s.writes).toHaveLength(1)
	expect((await handlePublicationPublish(s.auth, s.backend, request(a), origin)).status).toBe(409)
	expect(s.writes).toHaveLength(1)
	// A late repository confirmation can finish that exact retained publication.
	s.records.set(issued.uri, issued.record)
	expect((await handlePublicationPublish(s.auth, s.backend, request(a), origin)).status).toBe(200)
	expect(publicationFromRow((await rows(a))[0])).toEqual({
		...selection(a),
		state: 'published',
		uri: issued.uri
	})
	expect(s.writes).toHaveLength(1)
})
it('does not confirm a different record at the retained address', async () => {
	const a = await setup('publish-conflict'),
		s = server(a, { rejectWrite: true })
	await handlePublicationPublish(s.auth, s.backend, request(a), origin)
	const issued = publicationFromRow((await rows(a))[0])
	if (issued.state !== 'issued') throw new Error('Missing retained issuance')
	s.records.set(issued.uri, {
		...issued.record,
		body: { value: 'Changed elsewhere', format: 'text/plain' }
	})
	expect((await handlePublicationPublish(s.auth, s.backend, request(a), origin)).status).toBe(409)
	expect(publicationFromRow((await rows(a))[0])).toEqual(issued)
	expect(s.writes).toHaveLength(1)
})

it.each([false, true])(
	'unpublishes exactly the observed version, retains the private note, lost response=%s',
	async (loseRemovalResponse) => {
		const a = await setup('unpublish-' + loseRemovalResponse),
			s = server(a, { loseRemovalResponse })
		const published = publicationSchema.parse(
			await (await handlePublicationPublish(s.auth, s.backend, request(a), origin)).json()
		)
		if (published.state !== 'published') throw new Error('Expected publication')
		let response = await handlePublicationPublish(
			s.auth,
			s.backend,
			request(a),
			origin,
			'unpublish'
		)
		if (loseRemovalResponse) {
			expect(response.status).toBe(409)
			expect(publicationFromRow((await rows(a))[0]).state).toBe('unpublishing')
			response = await handlePublicationPublish(s.auth, s.backend, request(a), origin, 'unpublish')
		}
		expect(response.status).toBe(200)
		const value = publicationSchema.parse(await response.json())
		expect(value).toEqual({ ...selection(a), state: 'unpublished', uri: published.uri })
		expect(publicationFromRow((await rows(a))[0])).toEqual(value)
		expect(s.records.size).toBe(0)
		expect(s.removals).toHaveLength(loseRemovalResponse ? 2 : 1)
		expect((await a.owner.backend.one(app.notes.where({ id: a.owner.noteId })))?.text).toBe(
			'Private document note'
		)
		expect(
			(await handlePublicationPublish(s.auth, s.backend, request(a), origin, 'unpublish')).status
		).toBe(200)
		expect(s.removals).toHaveLength(loseRemovalResponse ? 2 : 1)
		// Republish uses the same native/public identity and first publication time.
		expect((await handlePublicationPublish(s.auth, s.backend, request(a), origin)).status).toBe(200)
		expect(publicationFromRow((await rows(a))[0])).toEqual(published)
		expect(s.records.size).toBe(1)
		expect(s.writes).toHaveLength(2)
	}
)
it('retains a failed removal CID and refuses a changed version on retry', async () => {
	const a = await setup('unpublish-swap'),
		s = server(a, { rejectRemoval: true })
	await handlePublicationPublish(s.auth, s.backend, request(a), origin)
	expect(
		(await handlePublicationPublish(s.auth, s.backend, request(a), origin, 'unpublish')).status
	).toBe(409)
	const removing = publicationFromRow((await rows(a))[0])
	expect(removing.state).toBe('unpublishing')
	s.changeCid('bafkreigh2akiscaildc45wwzntq6jijrryohw3nzz6m3f6ty5duwq7m52e')
	expect(
		(await handlePublicationPublish(s.auth, s.backend, request(a), origin, 'unpublish')).status
	).toBe(409)
	expect(publicationFromRow((await rows(a))[0])).toEqual(removing)
	expect(s.removals).toHaveLength(1)
	expect(s.records.size).toBe(1)
})
it('cleans up only an accepted native document-note deletion and preserves publication history', async () => {
	const a = await setup('unpublish-deleted'),
		s = server(a)
	await handlePublicationPublish(s.auth, s.backend, request(a), origin)
	expect(
		(await handlePublicationPublish(s.auth, s.backend, request(a), origin, 'cleanup')).status
	).toBe(409)
	expect(s.removals).toHaveLength(0)
	await a.owner.backend.delete(app.notes, a.owner.noteId).wait({ tier: 'global' })
	const native = await a.owner.backend.one(
		app.notes.includeDeleted().where({ id: a.owner.noteId }).select('id', '$deletedAt')
	)
	expect(native?.$deletedAt).toBeTruthy()
	expect(
		(await handlePublicationPublish(s.auth, s.backend, request(a), origin, 'cleanup')).status
	).toBe(200)
	expect(s.records.size).toBe(0)
	expect(s.removals).toHaveLength(1)
	const row = (await rows(a))[0]
	if (!row) throw new Error('Expected retained identity')
	expect(publicationFromRow(row).state).toBe('unpublished')
	expect(await a.owner.backend.all(app.$history.publications.where({ id: row.id }))).toHaveLength(5)
})
it('does not delete another app’s changed owned content', async () => {
	const a = await setup('unpublish-content-conflict'),
		s = server(a)
	const value = publicationSchema.parse(
		await (await handlePublicationPublish(s.auth, s.backend, request(a), origin)).json()
	)
	if (value.state !== 'published') throw new Error('Expected publication')
	s.records.set(value.uri, { changed: 'another application' })
	expect(
		(await handlePublicationPublish(s.auth, s.backend, request(a), origin, 'unpublish')).status
	).toBe(409)
	expect(s.removals).toHaveLength(0)
	expect(publicationFromRow((await rows(a))[0])).toEqual(value)
})
