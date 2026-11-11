import { describe, expect, it } from 'vitest'
import { render } from 'svelte/server'
import { Pagination, PaginationItem } from './lib/index.js'
import { createRawSnippet } from 'svelte'

describe('pagination', () => {
	it('renders a labelled navigation landmark containing caller-provided items', () => {
		const { body } = render(Pagination, {
			props: {
				label: 'Search results pages',
				children: createRawSnippet(() => ({
					render: () => '',
					setup: () => {}
				}))
			}
		})

		expect(body).toContain('<nav aria-label="Search results pages"')
		expect(body).toContain('<ul')
	})

	it('renders a labelled current page link with its URL', () => {
		const { body } = render(PaginationItem, {
			props: {
				label: 'Page 4',
				href: '/page/4',
				current: true,
				children: createRawSnippet(() => ({
					render: () => '4',
					setup: () => {}
				}))
			}
		})

		expect(body).toContain('<li')
		expect(body).toContain('<a')
		expect(body).toContain('aria-label="Page 4"')
		expect(body).toContain('aria-current="page"')
		expect(body).toContain('href="/page/4"')
	})

	it('renders disabled items without link semantics', () => {
		const { body } = render(PaginationItem, {
			props: {
				label: 'Next page',
				disabled: true,
				children: createRawSnippet(() => ({
					render: () => '›',
					setup: () => {}
				}))
			}
		})

		expect(body).toContain('aria-label="Next page"')
		expect(body).toContain('aria-disabled="true"')
		expect(body).not.toContain('<a')
	})

	it('hides decorative ellipses from assistive technology', () => {
		const { body } = render(PaginationItem, {
			props: {
				label: 'More pages',
				ellipsis: true,
				children: createRawSnippet(() => ({
					render: () => '…',
					setup: () => {}
				}))
			}
		})

		expect(body).toContain('aria-hidden="true"')
	})

	it('forwards caller-provided navigation attributes', () => {
		const { body } = render(Pagination, {
			props: {
				label: 'Results pages',
				id: 'results-pagination',
				'aria-describedby': 'results-summary'
			}
		})

		expect(body).toContain('id="results-pagination"')
		expect(body).toContain('aria-describedby="results-summary"')
	})
})
