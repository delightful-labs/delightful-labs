import { afterAll, beforeAll, expect, it } from 'vitest'
import { createActor, toPromise } from 'xstate'
import { createJazz, sqlite } from 'jazz-tools/backend'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPolicyTestApp } from 'jazz-tools/testing'
import type { PolicyTestApp } from 'jazz-tools/testing'
import { app } from '../../backend/jazz/schema.js'
import permissions from '../../backend/jazz/permissions.js'
import { policySchema } from '../../backend/jazz/schema-permissions.test-support.js'
import { newDocumentValues } from '../../backend/jazz/document-values.js'
import { createPublicationStore } from './store.js'
import {
	publicationFromRow,
	publicationSchema,
	publicationValues
} from '../../annotations/publication.js'
import type { Publication } from '../../annotations/publication.js'
import { createPublicationOwner } from './owner.test-support.js'

let fixture: PolicyTestApp
const publishingDid = 'did:plc:ewvi7nxzyoun6zhxrhs64oiz'
const createdAt = '2026-11-17T12:00:00.000Z'
beforeAll(async () => {
	fixture = await createPolicyTestApp(policySchema(), permissions, expect)
})
afterAll(async () => fixture?.shutdown())

function owner(name: string) {
	return createPublicationOwner({
		fixture,
		name,
		publishingDid,
		noteText: 'Document note',
		withHighlight: true
	}).then((owner) => ({ ...owner, store: createPublicationStore(owner.backend, owner.scope) }))
}

async function stage(
	store: ReturnType<typeof createPublicationStore>,
	publication: Publication,
	operationId = crypto.randomUUID()
) {
	const actor = createActor(store.stage, {
		input: {
			attempt: {
				operationId,
				workspaceId: publication.libraryId,
				membershipId: publication.libraryId,
				draft: publication
			}
		}
	})
	const result = toPromise(actor)
	actor.start()
	try {
		return await result
	} finally {
		actor.stop()
	}
}

function requested(a: { libraryId: string; noteId: string }): Publication {
	return { libraryId: a.libraryId, source: { noteId: a.noteId }, publishingDid, state: 'requested' }
}

function issued(
	a: { libraryId: string; noteId: string },
	key = `note-${a.noteId}`,
	text = 'Document note'
): Publication {
	return publicationSchema.parse({
		...requested(a),
		state: 'issued',
		uri: `at://${publishingDid}/at.margin.note/${key}`,
		record: {
			$type: 'at.margin.note',
			createdAt,
			motivation: 'commenting',
			target: { source: 'https://example.org/article' },
			body: { value: text, format: 'text/plain' }
		}
	})
}

it('stores native parent joins and retains publication evidence after the source is deleted', async () => {
	const a = await owner('publication-joins')
	const highlight = { ...requested(a), source: { highlightId: a.highlightId } }
	const note = issued(a)
	expect((await stage(a.store, highlight)).outcome).toBe('succeeded')
	expect((await stage(a.store, requested(a))).outcome).toBe('succeeded')
	expect((await stage(a.store, note)).outcome).toBe('succeeded')
	const rows = await a.db.all(app.publications.include({ highlight: true, note: true }))
	expect(rows).toHaveLength(2)
	expect(rows.find((row) => row.highlightId)?.highlight?.id).toBe(a.highlightId)
	expect(rows.find((row) => row.noteId)?.note?.id).toBe(a.noteId)
	expect(rows.map(publicationFromRow)).toEqual(expect.arrayContaining([highlight, note]))
	await a.backend.delete(app.highlights, a.highlightId).wait({ tier: 'global' })
	await a.backend.delete(app.notes, a.noteId).wait({ tier: 'global' })
	expect(await a.store.list(highlight.source)).toEqual([highlight])
	expect(await a.store.list(note.source)).toEqual([note])
})

it('allows owner reads but rejects owner and foreign client mutations', async () => {
	const a = await owner('publication-owner'),
		b = await owner('publication-foreign')
	const publication = requested(a)
	expect((await stage(a.store, publication)).outcome).toBe('succeeded')
	const row = await a.db.one(app.publications.where({ libraryId: a.libraryId }))
	if (!row) throw new Error('Expected publication')
	expect(
		await createPublicationStore(a.backend, { ...a.scope, accountId: b.libraryId }).list(
			publication.source
		)
	).toEqual([])
	expect(await b.db.all(app.publications.where({ libraryId: a.libraryId }))).toEqual([])
	expect(
		(await a.db.all(app.$history.publications.where({ id: row.id }))).map(publicationFromRow)
	).toEqual([publication])
	expect(await b.db.all(app.$history.publications.where({ id: row.id }))).toEqual([])
	for (const client of [a.db, b.db]) {
		await expect(
			client.insert(app.publications, publicationValues(publication)).wait({ tier: 'global' })
		).rejects.toThrow()
		await expect(
			client
				.update(app.publications, row.id, { lifecycle: { state: 'private' } })
				.wait({ tier: 'global' })
		).rejects.toThrow()
		await expect(client.delete(app.publications, row.id).wait({ tier: 'global' })).rejects.toThrow()
	}
})

it('refuses foreign roots, attached Notes, wrong publishers, wrong owners and Trash', async () => {
	const a = await owner('publication-eligibility'),
		b = await owner('publication-other-root')
	const attachedId = crypto.randomUUID()
	await a.backend
		.insert(
			app.notes,
			{
				libraryId: a.libraryId,
				documentId: null,
				highlightId: a.highlightId,
				source: null,
				text: 'Attached'
			},
			{ id: attachedId }
		)
		.wait({ tier: 'global' })
	for (const candidate of [
		{ ...requested(a), source: { noteId: b.noteId } },
		{ ...requested(a), source: { highlightId: b.highlightId } },
		{ ...requested(a), source: { noteId: attachedId } },
		{ ...requested(a), libraryId: b.libraryId },
		{ ...requested(a), publishingDid: 'did:web:other.example' }
	])
		expect((await stage(a.store, candidate)).outcome).toBe('blocked')
	expect(
		(
			await stage(
				createPublicationStore(a.backend, { ...a.scope, accountId: b.libraryId }),
				requested(a)
			)
		).outcome
	).toBe('blocked')
	await a.backend
		.update(app.libraryDocuments, a.documentId, { status: 'trashed', previousStatus: 'inbox' })
		.wait({ tier: 'global' })
	expect((await stage(a.store, requested(a))).outcome).toBe('blocked')
	expect(await a.backend.all(app.publications.where({ libraryId: a.libraryId }))).toEqual([])
})

it('supports a private choice and cancellation before issuance, without erasing an issued address', async () => {
	const a = await owner('publication-choice')
	const privateChoice = publicationSchema.parse({ ...requested(a), state: 'private' })
	expect((await stage(a.store, privateChoice)).outcome).toBe('succeeded')
	expect((await stage(a.store, requested(a))).outcome).toBe('succeeded')
	expect((await stage(a.store, privateChoice)).outcome).toBe('succeeded')
	expect((await stage(a.store, requested(a))).outcome).toBe('succeeded')
	expect((await stage(a.store, issued(a))).outcome).toBe('succeeded')
	expect((await stage(a.store, privateChoice)).outcome).toBe('blocked')
	expect((await stage(a.store, requested(a))).outcome).toBe('blocked')
})

it('freezes only accepted document-note content and refuses skipped states or unresolved replacement', async () => {
	const a = await owner('publication-frozen')
	expect((await stage(a.store, issued(a))).outcome).toBe('blocked')
	expect((await stage(a.store, requested(a))).outcome).toBe('succeeded')
	const publication = issued(a)
	expect(
		(
			await stage(a.store, {
				...requested(a),
				state: 'published',
				uri: `at://${publishingDid}/at.margin.note/record`
			})
		).outcome
	).toBe('blocked')
	await a.backend.update(app.notes, a.noteId, { text: 'Newly accepted' }).wait({ tier: 'global' })
	expect((await stage(a.store, publication)).outcome).toBe('blocked')
	const frozen = issued(a, 'record', 'Newly accepted')
	expect((await stage(a.store, frozen)).outcome).toBe('succeeded')
	await a.backend.update(app.notes, a.noteId, { text: 'Later edit' }).wait({ tier: 'global' })
	expect((await stage(a.store, issued(a, 'record', 'Later edit'))).outcome).toBe('blocked')
	expect((await stage(a.store, issued(a, 'replacement', 'Later edit'))).outcome).toBe('blocked')
	expect(await a.store.list(frozen.source)).toEqual([frozen])
})

it('keeps native identity/history when the trusted backend records a matching PDS confirmation', async () => {
	const a = await owner('publication-confirmed')
	const publication = issued(a)
	expect((await stage(a.store, requested(a))).outcome).toBe('succeeded')
	const before = await a.backend.one(
		app.publications.where({ libraryId: a.libraryId }).select('*', '$createdAt')
	)
	if (!before) throw new Error('Expected requested publication')
	expect((await stage(a.store, publication)).outcome).toBe('succeeded')
	// The persistence capability trusts its backend host's PDS observation. This is
	// not a PDS integration test or an HTTP/client confirmation capability.
	const confirmed = publicationSchema.parse({
		...requested(a),
		state: 'published',
		uri: `at://${publishingDid}/at.margin.note/note-${a.noteId}`
	})
	expect(
		(
			await stage(
				a.store,
				publicationSchema.parse({ ...confirmed, uri: `at://${publishingDid}/at.margin.note/other` })
			)
		).outcome
	).toBe('blocked')
	await a.backend.delete(app.notes, a.noteId).wait({ tier: 'global' })
	expect((await stage(a.store, confirmed)).outcome).toBe('succeeded')
	const after = await a.backend.one(
		app.publications.where({ id: before.id }).select('*', '$createdAt')
	)
	expect(after?.$createdAt).toEqual(before.$createdAt)
	expect(publicationFromRow(after)).toEqual(confirmed)
	const history = await a.backend.all(
		app.$history.publications.where({ id: before.id }).orderBy('$acceptedAt', 'asc')
	)
	expect(history.map(publicationFromRow)).toEqual([requested(a), publication, confirmed])
	expect(history.every((row) => row.$acceptedAt instanceof Date && !!row.$transactionId)).toBe(true)
})

it('prevents URI reuse, duplicate source/publisher rows and native identity retargeting', async () => {
	const a = await owner('publication-stable'),
		b = await owner('publication-other-library')
	const operationId = crypto.randomUUID()
	expect((await stage(a.store, requested(a), operationId)).outcome).toBe('succeeded')
	expect((await stage(a.store, issued(a))).outcome).toBe('succeeded')
	expect((await stage(a.store, requested(a))).outcome).toBe('blocked')
	expect((await stage(b.store, requested(b), operationId)).outcome).toBe('blocked')
	expect((await stage(b.store, requested(b))).outcome).toBe('succeeded')
	expect((await stage(b.store, issued(b, `note-${a.noteId}`))).outcome).toBe('blocked')
	expect(
		publicationFromRow(await a.backend.one(app.publications.where({ id: operationId })))
	).toEqual(issued(a))
})

it('checks scope before acquisition and before exposing retained publications', async () => {
	const a = await owner('publication-scope')
	expect((await stage(a.store, requested(a))).outcome).toBe('succeeded')
	const expired = createPublicationStore(a.backend, { ...a.scope, isCurrent: () => false })
	expect((await stage(expired, issued(a))).outcome).not.toBe('succeeded')
	await expect(expired.list(requested(a).source)).rejects.toThrow('Publication scope expired')
	expect(await a.store.list(requested(a).source)).toEqual([requested(a)])
})

it('uses native serializable validation for concurrent requests and issuance', async () => {
	const a = await owner('publication-concurrent')
	const requests = await Promise.all([stage(a.store, requested(a)), stage(a.store, requested(a))])
	expect(requests.filter((result) => result.outcome === 'succeeded')).toHaveLength(1)
	const issues = await Promise.all([stage(a.store, issued(a, 'a')), stage(a.store, issued(a, 'b'))])
	expect(issues.filter((result) => result.outcome === 'succeeded')).toHaveLength(1)
	expect(await a.backend.all(app.publications.where({ libraryId: a.libraryId }))).toHaveLength(1)
})

it('keeps highlight issuance blocked until source-page evidence has an admitted publisher', async () => {
	const a = await owner('publication-highlight-gate')
	const highlight = { ...requested(a), source: { highlightId: a.highlightId } }
	expect((await stage(a.store, highlight)).outcome).toBe('succeeded')
	expect((await stage(a.store, { ...issued(a), source: highlight.source })).outcome).toBe('blocked')
})

it('retains a valid timestamp spelling and keeps separate publisher choices on the same source', async () => {
	const a = await owner('publication-destinations')
	expect((await stage(a.store, requested(a))).outcome).toBe('succeeded')
	const first = publicationSchema.parse({
		...issued(a),
		record: {
			$type: 'at.margin.note',
			createdAt: '2026-11-17T12:00:00Z',
			motivation: 'commenting',
			target: { source: 'https://example.org/article' },
			body: { value: 'Document note', format: 'text/plain' }
		}
	})
	expect((await stage(a.store, first)).outcome).toBe('succeeded')
	const other = { ...requested(a), publishingDid: 'did:web:other.example' }
	expect(
		(
			await stage(
				createPublicationStore(a.backend, { ...a.scope, publishingDid: other.publishingDid }),
				other
			)
		).outcome
	).toBe('succeeded')
	expect(await a.store.list(first.source)).toEqual(expect.arrayContaining([first, other]))
	expect(await a.backend.all(app.publications.where({ libraryId: a.libraryId }))).toHaveLength(2)
})

it('retains requested/issued state, exact payload, native identity and history through backend restarts', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'clipper-publications-'))
	const open = () => createJazz({ app, permissions, store: sqlite({ path: directory }) })
	let backend = open()
	const libraryId = crypto.randomUUID(),
		documentId = crypto.randomUUID(),
		noteId = crypto.randomUUID()
	const scope = { libraryId, accountId: libraryId, publishingDid, isCurrent: () => true }
	const source = { libraryId, noteId }
	try {
		await backend.ready()
		await backend.db
			.upsert(app.libraries, libraryId, { ownerId: libraryId, bootstrapVersion: '1' })
			.wait({ tier: 'global' })
		await backend.db
			.insert(
				app.libraryDocuments,
				newDocumentValues(documentId, libraryId, 'https://example.org/article'),
				{ id: documentId }
			)
			.wait({ tier: 'global' })
		await backend.db
			.insert(
				app.notes,
				{
					libraryId,
					documentId,
					highlightId: null,
					source: 'https://example.org/article',
					text: 'Retained'
				},
				{ id: noteId }
			)
			.wait({ tier: 'global' })

		expect(
			(await stage(createPublicationStore(backend.db, scope), requested(source))).outcome
		).toBe('succeeded')
		const before = await backend.db.one(
			app.publications.where({ libraryId }).select('*', '$createdAt')
		)
		if (!before) throw new Error('Expected publication before restart')
		await backend.close()
		backend = open()
		await backend.ready()
		expect(await createPublicationStore(backend.db, scope).list({ noteId })).toEqual([
			requested(source)
		])
		const publication = issued(source, 'retained', 'Retained')
		expect((await stage(createPublicationStore(backend.db, scope), publication)).outcome).toBe(
			'succeeded'
		)
		await backend.close()
		backend = open()
		await backend.ready()
		expect(await createPublicationStore(backend.db, scope).list({ noteId })).toEqual([publication])
		const after = await backend.db.one(
			app.publications.where({ libraryId }).select('*', '$createdAt')
		)
		expect(after?.id).toBe(before.id)
		expect(after?.$createdAt).toEqual(before.$createdAt)
		expect(
			(await backend.db.all(app.$history.publications.where({ id: before.id }))).map(
				publicationFromRow
			)
		).toEqual(expect.arrayContaining([requested(source), publication]))
	} finally {
		await backend.close()
		await rm(directory, { recursive: true, force: true })
	}
})
