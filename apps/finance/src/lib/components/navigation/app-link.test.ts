import { expect, it } from 'vitest'
import { createRawSnippet } from 'svelte'
import { render } from 'svelte/server'
import { NavigationLink } from 'delightful-ui'
import OverviewIcon from 'tdesign-icons-svg/src/dashboard.svg?component'
import AppLink from './AppLink.svelte'
import AppNavigationLink from './AppNavigationLink.svelte'
import PaginationLink from './PaginationLink.svelte'
import { queryLinksKey, type QueryLinkContext } from '#lib/filters/query-links.js'

const children = createRawSnippet(() => ({ render: () => '<span>Expenses</span>' }))
const scope = {
	href: 'https://finance.example/expenses?workspace=personal&page=2&account=cash',
	keys: ['workspace', 'page', 'account']
} satisfies QueryLinkContext
const context = new Map([[queryLinksKey, scope]])

it('renders a native anchor by default and retains attributes, content and inherited query', () => {
	const { body } = render(AppLink, {
		props: { href: '/expenses/item', children, target: '_blank', rel: 'noopener' },
		context
	})
	expect([...body.matchAll(/<a\b/g)]).toHaveLength(1)
	expect(body).toContain('href="/expenses/item?workspace=personal&amp;page=2&amp;account=cash"')
	expect(body).toContain('target="_blank"')
	expect(body).toContain('rel="noopener"')
	expect(body).toContain('Expenses')
	expect(body).not.toMatch(/<(?:component|linkcomponent)\b/i)
})

it('supplies a custom component with the resolved destination and child content', () => {
	const { body } = render(AppLink, {
		props: {
			component: NavigationLink,
			href: '/expenses?page=3',
			children,
			'aria-current': 'page'
		},
		context
	})
	expect([...body.matchAll(/<a\b/g)]).toHaveLength(1)
	expect(body).toContain('href="/expenses?page=3&amp;workspace=personal&amp;account=cash"')
	expect(body).toContain('aria-current="page"')
	expect(body).toContain('Expenses')
})

it.each([{ inheritParams: false }, { download: true }] satisfies Array<{
	inheritParams?: false
	download?: boolean
}>)('does not inherit query parameters for %j', (attributes) => {
	const { body } = render(AppLink, { props: { href: '/export', ...attributes, children }, context })
	expect(body).toContain('href="/export"')
	expect(body).not.toContain('workspace=')
})

it('passes component-specific props and explicit query updates to pagination', () => {
	const { body } = render(PaginationLink, {
		props: { href: '/expenses?page=3', label: 'Page 3', current: true, children },
		context
	})
	expect(body).toContain('<li')
	expect(body).toContain('href="/expenses?page=3&amp;workspace=personal&amp;account=cash"')
	expect(body).toContain('aria-label="Page 3"')
	expect(body).toContain('aria-current="page"')
})

it.each([{ disabled: true }, { ellipsis: true }])(
	'keeps non-navigable pagination non-interactive: %j',
	(attributes) => {
		const { body } = render(PaginationLink, {
			props: { href: '/expenses?page=3', label: 'Page 3', ...attributes, children },
			context
		})
		expect(body).toContain('<li')
		expect(body).not.toMatch(/<a\b/)
		expect(body).not.toContain('href=')
	}
)

it('renders navigation labels and determines the current route independently of query parameters', () => {
	const { body } = render(AppNavigationLink, {
		props: {
			href: '/expenses?other=keep',
			pathname: '/expenses/',
			label: 'Expenses',
			icon: OverviewIcon
		},
		context
	})
	expect(body).toContain('aria-current="page"')
	expect(body).toContain('Expenses')
	expect(body).toContain('other=keep&amp;workspace=personal')
	expect(body).toMatch(/<svg\b[^>]*aria-hidden="true"/)
})
