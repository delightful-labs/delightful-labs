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
import { createPublicationLinkStore } from './links.js'
import {
	publicationLinkFromRow,
	publicationLinkValues
} from '../../annotations/publication-link.js'
import type { PublicationLink } from '../../annotations/publication-link.js'
import { createPublicationOwner } from './owner.test-support.js'

let fixture: PolicyTestApp
const publishingDid = 'did:plc:ewvi7nxzyoun6zhxrhs64oiz'
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
	}).then((owner) => ({
		...owner,
		store: createPublicationLinkStore(owner.backend, owner.scope)
	}))
}

async function stage(
	store: ReturnType<typeof createPublicationLinkStore>,
	link: PublicationLink,
	operationId = crypto.randomUUID()
) {
	return toPromise(
		createActor(store.stage, {
			input: {
				attempt: {
					operationId,
					workspaceId: link.libraryId,
					membershipId: link.libraryId,
					draft: link
				}
			}
		}).start()
	)
}

function linkFor(a: Awaited<ReturnType<typeof owner>>, key: string): PublicationLink {
	return {
		libraryId: a.libraryId,
		source: { highlightId: a.highlightId },
		uri: `at://${publishingDid}/at.margin.note/${key}`
	}
}

it('stores native parent joins and retains addresses after the source is deleted', async () => {
	const a = await owner('publication-joins')
	const highlight = linkFor(a, 'highlight')
	const note = { ...linkFor(a, 'note'), source: { noteId: a.noteId } }
	expect((await stage(a.store, highlight)).outcome).toBe('succeeded')
	expect((await stage(a.store, note)).outcome).toBe('succeeded')
	const rows = await a.db.all(app.publicationLinks.include({ highlight: true, note: true }))
	expect(rows).toHaveLength(2)
	expect(rows.find((row) => row.highlightId)?.highlight?.id).toBe(a.highlightId)
	expect(rows.find((row) => row.noteId)?.note?.id).toBe(a.noteId)
	expect(rows.map(publicationLinkFromRow)).toEqual(expect.arrayContaining([highlight, note]))
	await a.backend.delete(app.highlights, a.highlightId).wait({ tier: 'global' })
	await a.backend.delete(app.notes, a.noteId).wait({ tier: 'global' })
	expect(await a.store.list(highlight.source)).toEqual([highlight])
	expect(await a.store.list(note.source)).toEqual([note])
	expect(await a.db.all(app.publicationLinks)).toHaveLength(2)
})

it('allows owner reads but rejects owner and foreign client mutations', async () => {
	const a = await owner('publication-owner'),
		b = await owner('publication-foreign')
	const link = linkFor(a, 'private')
	expect((await stage(a.store, link)).outcome).toBe('succeeded')
	const row = await a.db.one(app.publicationLinks.where({ libraryId: a.libraryId }))
	if (!row) throw new Error('Expected publication link')
	expect(
		await createPublicationLinkStore(a.backend, { ...a.scope, accountId: b.libraryId }).list(
			link.source
		)
	).toEqual([])
	expect(await b.db.all(app.publicationLinks.where({ libraryId: a.libraryId }))).toEqual([])
	for (const client of [a.db, b.db]) {
		await expect(
			client.insert(app.publicationLinks, publicationLinkValues(link)).wait({ tier: 'global' })
		).rejects.toThrow()
		await expect(
			client
				.update(app.publicationLinks, row.id, { uri: linkFor(a, 'forged').uri })
				.wait({ tier: 'global' })
		).rejects.toThrow()
		await expect(
			client.delete(app.publicationLinks, row.id).wait({ tier: 'global' })
		).rejects.toThrow()
	}
})

it('refuses foreign roots, attached Notes, wrong publishers, wrong owners and Trash', async () => {
	const a = await owner('publication-eligibility'),
		b = await owner('publication-other-root')
	const link = linkFor(a, 'eligible')
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
		{ ...link, source: { highlightId: b.highlightId } },
		{ ...link, source: { noteId: attachedId } },
		{ ...link, libraryId: b.libraryId },
		{ ...link, uri: 'at://did:web:other.example/at.margin.note/key' }
	]) {
		expect((await stage(a.store, candidate)).outcome).toBe('blocked')
	}
	const wrongOwner = createPublicationLinkStore(a.backend, { ...a.scope, accountId: b.libraryId })
	expect((await stage(wrongOwner, link)).outcome).toBe('blocked')
	await a.backend
		.update(app.libraryDocuments, a.documentId, { status: 'trashed', previousStatus: 'inbox' })
		.wait({ tier: 'global' })
	expect((await stage(a.store, link)).outcome).toBe('blocked')
	expect(await a.backend.all(app.publicationLinks.where({ libraryId: a.libraryId }))).toEqual([])
})

it('refuses a second address for the same source/publisher and reuse by another source', async () => {
	const a = await owner('publication-stable-address')
	const link = linkFor(a, 'stable')
	expect((await stage(a.store, link)).outcome).toBe('succeeded')
	expect((await stage(a.store, linkFor(a, 'replacement'))).outcome).toBe('blocked')
	expect((await stage(a.store, { ...link, source: { noteId: a.noteId } })).outcome).toBe('blocked')
	expect(await a.store.list(link.source)).toEqual([link])
})

it('refuses reusing an existing native link ID for a different source and URI', async () => {
	const a = await owner('publication-native-identity')
	const operationId = crypto.randomUUID()
	const link = linkFor(a, 'original')
	expect((await stage(a.store, link, operationId)).outcome).toBe('succeeded')
	const replacement = { ...linkFor(a, 'other'), source: { noteId: a.noteId } }
	expect((await stage(a.store, replacement, operationId)).outcome).toBe('blocked')
	expect(
		publicationLinkFromRow(await a.backend.one(app.publicationLinks.where({ id: operationId })))
	).toEqual(link)
})

it('checks scope before acquisition and before exposing retained links', async () => {
	const a = await owner('publication-scope')
	const link = linkFor(a, 'scope')
	expect((await stage(a.store, link)).outcome).toBe('succeeded')
	const expired = createPublicationLinkStore(a.backend, { ...a.scope, isCurrent: () => false })
	expect(
		(await stage(expired, { ...linkFor(a, 'expired'), source: { noteId: a.noteId } })).outcome
	).not.toBe('succeeded')
	await expect(expired.list(link.source)).rejects.toThrow('Publication scope expired')
	expect(await a.backend.all(app.publicationLinks.where({ libraryId: a.libraryId }))).toHaveLength(
		1
	)
})

it('uses native serializable validation for concurrent address allocation', async () => {
	const a = await owner('publication-concurrent')
	const outcomes = await Promise.all([
		stage(a.store, linkFor(a, 'concurrent-a')),
		stage(a.store, linkFor(a, 'concurrent-b'))
	])
	expect(outcomes.filter((result) => result.outcome === 'succeeded')).toHaveLength(1)
	expect(await a.backend.all(app.publicationLinks.where({ libraryId: a.libraryId }))).toHaveLength(
		1
	)
})

it('retains the native link identity and metadata through a complete backend restart', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'clipper-publication-links-'))
	const open = () => createJazz({ app, permissions, store: sqlite({ path: directory }) })
	let backend = open()
	const libraryId = crypto.randomUUID(),
		documentId = crypto.randomUUID(),
		noteId = crypto.randomUUID()
	const scope = { libraryId, accountId: libraryId, publishingDid, isCurrent: () => true }
	const link: PublicationLink = {
		libraryId,
		source: { noteId },
		uri: `at://${publishingDid}/at.margin.note/retained`
	}
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
		expect((await stage(createPublicationLinkStore(backend.db, scope), link)).outcome).toBe(
			'succeeded'
		)
		const before = await backend.db.one(
			app.publicationLinks.where({ libraryId }).select('*', '$createdAt')
		)
		expect(before).not.toBeNull()
		expect(before?.$createdAt).toBeInstanceOf(Date)
		await backend.close()
		backend = open()
		await backend.ready()
		expect(await createPublicationLinkStore(backend.db, scope).list(link.source)).toEqual([link])
		const after = await backend.db.one(
			app.publicationLinks.where({ libraryId }).select('*', '$createdAt')
		)
		expect(after?.id).toBe(before?.id)
		expect(after?.$createdAt).toEqual(before?.$createdAt)
	} finally {
		await backend.close()
		await rm(directory, { recursive: true, force: true })
	}
})
