import type { SaveRequest } from '../contracts/storage.js'
import { expect, it } from 'vitest'
import {
	BYTE_LIMIT,
	TEXT_LIMIT,
	savePayloadSchema,
	extractedTextSchema,
	isValidTitle,
	isValidMediaType,
	htmlSchema,
	sourceMetadataSchema
} from './policy.js'
it('preserves inclusive title, media-type, text and HTML bounds', () => {
	expect(isValidTitle('a'.repeat(500))).toBe(true)
	expect(isValidTitle('a'.repeat(501))).toBe(false)
	expect(isValidMediaType('a'.repeat(150))).toBe(true)
	expect(isValidMediaType('a'.repeat(151))).toBe(false)
	expect(htmlSchema.safeParse('').success).toBe(true)
	expect(htmlSchema.safeParse('a'.repeat(BYTE_LIMIT)).success).toBe(true)
	expect(htmlSchema.safeParse('a'.repeat(BYTE_LIMIT + 1)).success).toBe(false)
})
it('allows empty stored text but requires nonblank extraction text', () => {
	const request = {
		operationId: 'abcdef01-2345-6789-abcd-ef0123456789',
		title: 'Title',
		text: '',
		mediaType: 'text/plain',
		bytes: new Uint8Array()
	} satisfies SaveRequest
	expect(savePayloadSchema.safeParse(request).success).toBe(true)
	expect(extractedTextSchema.safeParse(request.text).success).toBe(false)
	expect(extractedTextSchema.safeParse(' \n ').success).toBe(false)
	expect(
		savePayloadSchema.safeParse({ ...request, text: 'é'.repeat(TEXT_LIMIT / 2) }).success
	).toBe(true)
	expect(
		savePayloadSchema.safeParse({ ...request, text: 'é'.repeat(TEXT_LIMIT / 2 + 1) }).success
	).toBe(false)
	expect(
		savePayloadSchema.safeParse({ ...request, bytes: new Uint8Array(BYTE_LIMIT + 1) }).success
	).toBe(false)
})
it('keeps source URL/provenance limits in characters and accepts omitted metadata', () => {
	const source = {
		finalUrl: 'https://example.com/' + 'é'.repeat(8192 - 'https://example.com/'.length),
		submittedUrl: 'https://example.com/' + 'a'.repeat(8192 - 'https://example.com/'.length),
		provenance: 'a'.repeat(32768)
	}
	expect(sourceMetadataSchema.optional().safeParse(undefined).success).toBe(true)
	expect(sourceMetadataSchema.optional().safeParse(source).success).toBe(true)
	expect(
		sourceMetadataSchema.optional().safeParse({ ...source, finalUrl: source.finalUrl + 'a' })
			.success
	).toBe(false)
	expect(
		sourceMetadataSchema.optional().safeParse({ ...source, provenance: source.provenance + 'a' })
			.success
	).toBe(false)
})

it('validates complete save inputs without trimming or coercing stored values', async () => {
	const { saveRequestSchema } = await import('./policy.js')
	const request = {
		operationId: 'abcdef01-2345-6789-abcd-ef0123456789',
		documentId: crypto.randomUUID(),
		title: ' Title ',
		text: ' exact text ',
		bytes: new Uint8Array([1]),
		mediaType: 'text/plain',
		source: {
			finalUrl: 'https://example.com/',
			submittedUrl: 'https://short.example/',
			provenance: '{}'
		}
	} satisfies SaveRequest
	const parsed = saveRequestSchema.safeParse(request)
	expect(parsed.success).toBe(true)
	if (!parsed.success) throw new Error('Expected valid request')
	expect(parsed.data).toEqual(request)
	expect(saveRequestSchema.safeParse({ ...request, bytes: [1] }).success).toBe(false)
	expect(saveRequestSchema.safeParse({ ...request, source: { finalUrl: 12 } }).success).toBe(false)
})
it('maps schema failures to existing storage errors without exposing validation input', async () => {
	const { prepareSave } = await import('./prepare.js')
	const request = {
		operationId: crypto.randomUUID(),
		title: 'Title',
		text: '',
		bytes: new Uint8Array(),
		mediaType: 'text/plain',
		source: {
			finalUrl: 'https://example.com',
			submittedUrl: 'https://example.com',
			provenance: 'private-evidence'.repeat(4000)
		}
	} satisfies SaveRequest
	await expect(prepareSave('library', request)).rejects.toThrow('Invalid source metadata')
	await expect(prepareSave('library', { ...request, title: '' })).rejects.toThrow(
		'Invalid bounded storage request'
	)
})

it('fingerprints bounded content deterministically and snapshots source input before awaiting hashing', async () => {
	const { prepareSave } = await import('./prepare.js')
	const request = {
		operationId: 'abcdef01-2345-6789-abcd-ef0123456789',
		title: ' Title ',
		text: ' exact ',
		bytes: new Uint8Array([1, 2]),
		mediaType: 'text/plain',
		source: {
			submittedUrl: 'https://short.example/',
			finalUrl: 'https://example.com/',
			provenance: '{}'
		}
	} satisfies SaveRequest
	const pending = prepareSave('library', request)
	request.source.finalUrl = 'https://changed.example/'
	const prepared = await pending
	expect(prepared.source?.finalUrl).toBe('https://example.com/')
	expect(prepared.intent.payloadHash).toBe(
		'bd53462f40250237c0648a76e11e5ccdb167a7fdc439e0672e7528006f8f9f93'
	)
})
