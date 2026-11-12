import { afterAll, beforeAll, expect, it } from 'vitest'
import { createActor, toPromise } from 'xstate'
import { createPolicyTestApp } from 'jazz-tools/testing'
import type { PolicyTestApp, PolicyTestSession } from 'jazz-tools/testing'
import { app } from './schema.js'
import permissions from './permissions.js'
import { policySchema } from './schema-permissions.test-support.js'
import { createLibraryRecords } from './records.js'

let fixture: PolicyTestApp
beforeAll(async () => {
	fixture = await createPolicyTestApp(policySchema(), permissions, expect)
})
afterAll(async () => {
	await fixture?.shutdown()
})

async function owner(name: string) {
	const session = {
		user_id: name,
		authMode: 'local-first',
		claims: {}
	} satisfies PolicyTestSession
	const db = fixture.as(session),
		id = fixture.accountFor(session)
	await db
		.upsert(app.libraries, id, { ownerId: id, bootstrapVersion: '1' })
		.wait({ tier: 'global' })
	return { db, id, records: createLibraryRecords(db, id, () => true) }
}

it('stores an owner-scoped Document and links at most its selected Article attachment', async () => {
	const account = await owner('document-owner')
	const contentId = crypto.randomUUID()
	const saved = await toPromise(
		createActor(account.records.saveMachine, {
			input: {
				operationId: contentId,
				title: 'Captured article',
				text: 'Readable content',
				bytes: new TextEncoder().encode('Readable content'),
				mediaType: 'text/plain'
			}
		}).start()
	)
	if (saved.kind !== 'saved') throw new Error('Expected article representation')
	await Promise.all(saved.receipts.map((receipt) => receipt.global()))

	const documentId = crypto.randomUUID()
	const attachmentId = crypto.randomUUID()
	await account.db
		.insert(
			app.libraryDocuments,
			{
				libraryId: account.id,
				url: 'https://example.com/article',
				savedAt: '2026-11-12T12:00:00.000Z',
				readingProgress: 0,
				status: 'inbox',
				favorite: false,
				articleAttachmentId: attachmentId
			},
			{ id: documentId }
		)
		.wait({ tier: 'global' })
	await account.db
		.insert(
			app.articleAttachments,
			{
				libraryId: account.id,
				documentId,
				title: 'Captured article',
				finalUrl: 'https://example.com/article',
				representationId: contentId
			},
			{ id: attachmentId }
		)
		.wait({ tier: 'global' })
	const document = await account.db.one(app.libraryDocuments.where({ id: documentId }))
	const attachment = await account.db.one(app.articleAttachments.where({ id: attachmentId }))
	expect(document).toMatchObject({
		libraryId: account.id,
		readingProgress: 0,
		articleAttachmentId: attachmentId
	})
	expect(attachment).toMatchObject({ documentId, representationId: contentId })
})

it('denies cross-library Document and attachment relationships', async () => {
	const ownerAccount = await owner('document-owner-scope')
	const foreignAccount = await owner('document-foreign-scope')
	const documentId = crypto.randomUUID()
	await expect(
		foreignAccount.db
			.insert(
				app.libraryDocuments,
				{
					libraryId: ownerAccount.id,
					savedAt: '2026-11-12T12:00:00.000Z',
					readingProgress: 0,
					status: 'inbox',
					favorite: false
				},
				{ id: documentId }
			)
			.wait({ tier: 'global' })
	).rejects.toThrow()
	expect(await foreignAccount.db.one(app.libraryDocuments.where({ id: documentId }))).toBeNull()
})
