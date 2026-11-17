import { expect, it } from 'vitest'
import { publicationSchema } from './publication.js'

it('binds an addressed lifecycle value to its exact publisher and contains malformed URI input', () => {
	const base = {
		libraryId: crypto.randomUUID(),
		source: { noteId: crypto.randomUUID() },
		publishingDid: 'did:web:owner.example'
	}
	for (const state of ['issued', 'published']) {
		expect(
			publicationSchema.safeParse({
				...base,
				state,
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
			expect(publicationSchema.safeParse({ ...base, state, uri }).success).toBe(false)
		}
	}
})
