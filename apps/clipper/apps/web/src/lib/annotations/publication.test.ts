import { expect, it } from 'vitest'
import { publicationSchema } from './publication.js'

const record = {
	$type: 'at.margin.note',
	createdAt: '2026-11-17T12:00:00.000Z',
	motivation: 'commenting',
	target: { source: 'https://example.org/article' },
	body: { value: 'The exact note chosen for dispatch.', format: 'text/plain' }
}

it('binds an addressed lifecycle value to its exact publisher and contains malformed URI input', () => {
	const base = {
		libraryId: crypto.randomUUID(),
		source: { noteId: crypto.randomUUID() },
		publishingDid: 'did:web:owner.example'
	}
	for (const variant of [{ state: 'issued', record }, { state: 'published' }]) {
		expect(
			publicationSchema.safeParse({
				...base,
				...variant,
				uri: 'at://did:web:owner.example/at.margin.note/self'
			}).success
		).toBe(true)
		for (const uri of [
			'at://did:web:owner.example.attacker.example/at.margin.note/self',
			'at://did:web:owner.example:other/at.margin.note/self',
			'at://did:web:other.example/at.margin.note/self',
			'not-an-at-record-uri',
			undefined
		]) {
			expect(publicationSchema.safeParse({ ...base, ...variant, uri }).success).toBe(false)
		}
	}
})

it('requires the exact validated Margin record only while issuance needs confirmation', () => {
	const addressed = {
		libraryId: crypto.randomUUID(),
		source: { noteId: crypto.randomUUID() },
		publishingDid: 'did:web:owner.example',
		uri: 'at://did:web:owner.example/at.margin.note/self'
	}
	const issued = { ...addressed, state: 'issued', record }
	expect(publicationSchema.parse(JSON.parse(JSON.stringify(issued)))).toEqual(issued)
	for (const invalid of [
		undefined,
		{ ...record, body: { ...record.body, format: 'text/html' } },
		{ ...record, target: { source: 'https://user:secret@example.org/article' } },
		{ ...record, libraryId: addressed.libraryId }
	]) {
		expect(publicationSchema.safeParse({ ...issued, record: invalid }).success).toBe(false)
	}
	expect(publicationSchema.safeParse({ ...issued, state: 'published' }).success).toBe(false)
})
