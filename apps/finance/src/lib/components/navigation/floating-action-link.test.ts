import { expect, it } from 'vitest'
import { render } from 'svelte/server'
import FloatingActionLink from './FloatingActionLink.svelte'
import { queryLinksKey, type QueryLinkContext } from '#lib/filters/query-links.js'

const scope = {
	href: 'https://finance.example/expenses?workspace=personal&page=2&account=cash',
	keys: ['workspace', 'page', 'account']
} satisfies QueryLinkContext

it.each(['/expenses/new', '/income/new', '/transfers/new'])(
	'keeps native add-link semantics and inherited scope for %s',
	(href) => {
		const { body } = render(FloatingActionLink, {
			props: { href, label: 'Add a record' },
			context: new Map([[queryLinksKey, scope]])
		})
		expect([...body.matchAll(/<a\b/g)]).toHaveLength(1)
		expect(body).not.toContain('<button')
		expect(body).toContain(`href="${href}?workspace=personal&amp;page=2&amp;account=cash"`)
		expect(body).toContain('aria-label="Add a record"')
		expect(body).toContain('title="Add a record"')
		expect(body).toMatch(/<svg\b[^>]*aria-hidden="true"/)
	}
)

it('preserves an explicit page when resolving the add destination', () => {
	const { body } = render(FloatingActionLink, {
		props: { href: '/expenses/new?page=3', label: 'Add an expense' },
		context: new Map([[queryLinksKey, scope]])
	})
	expect(body).toContain('href="/expenses/new?page=3&amp;workspace=personal&amp;account=cash"')
})
