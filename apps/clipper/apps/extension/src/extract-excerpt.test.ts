import { expect, it } from 'vitest'
import { extractRenderedSource } from './extract.js'

it('includes the full Readability description in a rendered browser clip', () => {
	const result = extractRenderedSource({
		url: 'https://example.com/clip',
		base: 'https://example.com/clip',
		html: `<html><head><title>Clipped article</title><meta name="description" content="A useful description from the browser parser."/></head><body><article><h1>Clipped article</h1><p>${'Detailed body evidence from the page. '.repeat(40)}</p></article></body></html>`
	})
	expect(result.excerpt).toBe('A useful description from the browser parser.')
	expect(result.text).toContain('Detailed body evidence')
})

it.each([
	['/preferred?edition=2#part', 'https://example.com/preferred?edition=2#part'],
	['https://publisher.example/story', 'https://publisher.example/story'],
	['javascript:alert(1)', null],
	['https://user:password@example.com/private', null]
])(
	'retains valid publisher canonical evidence independently of the captured URL: %s',
	(href, expected) => {
		const result = extractRenderedSource({
			url: 'https://example.com/clip',
			base: 'https://example.com/clip',
			html: `<html><head><title>Clipped article</title><link rel="canonical" href="${href}"/></head><body><article><h1>Clipped article</h1><p>${'Detailed body evidence from the page. '.repeat(40)}</p></article></body></html>`
		})
		expect(result.finalUrl).toBe('https://example.com/clip')
		expect(result.canonicalUrl).toBe(expected)
	}
)
