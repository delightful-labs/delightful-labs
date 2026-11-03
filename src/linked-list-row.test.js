import { expect, test } from 'vitest'
import { createRawSnippet } from 'svelte'
import { render } from 'svelte/server'
import { LinkedListRow } from './lib/index.js'

const children = createRawSnippet(() => ({
	render: () => '<strong>Saved article</strong><p>A description</p>'
}))
const trailing = createRawSnippet(() => ({ render: () => '<span>35%</span>' }))

test('renders a native list item with one descriptively named link and decorative indicator', () => {
	const { body } = render(LinkedListRow, {
		props: {
			href: '/articles/saved?view=notes',
			label: 'Read Saved article & notes',
			children,
			trailing
		}
	})
	expect([...body.matchAll(/<li\b/g)]).toHaveLength(1)
	expect([...body.matchAll(/<a\b/g)]).toHaveLength(1)
	expect(body).toContain('href="/articles/saved?view=notes"')
	expect(body).toContain('aria-label="Read Saved article &amp; notes"')
	expect(body).toContain('<strong>Saved article</strong>')
	expect(body).toContain('A description')
	expect(body).toContain('35%')
	expect(body).toMatch(/<svg\b[^>]*aria-hidden="true"/)
	expect(body).not.toContain('role="button"')
	expect(body).not.toContain('tabindex=')
})

test('supports content without trailing metadata', () => {
	const { body } = render(LinkedListRow, {
		props: { href: '#article', label: 'Read Saved article', children }
	})
	expect(body).toContain('Saved article')
	expect(body).not.toContain('35%')
	expect([...body.matchAll(/<a\b/g)]).toHaveLength(1)
})

test('forwards native attributes to the anchor for browser-owned navigation', () => {
	const { body } = render(LinkedListRow, {
		props: {
			href: '/saved/article.html',
			label: 'Download Saved article',
			children,
			download: 'article.html',
			target: '_blank',
			rel: 'noopener',
			id: 'article-link',
			'aria-describedby': 'download-help'
		}
	})
	expect(body).toMatch(/<a\b[^>]*id="article-link"/)
	expect(body).toContain('download="article.html"')
	expect(body).toContain('target="_blank"')
	expect(body).toContain('rel="noopener"')
	expect(body).toContain('aria-describedby="download-help"')
})
