import { expect, it } from 'vitest'
import { createRawSnippet } from 'svelte'
import { render } from 'svelte/server'
import LoadingContent from '#lib/components/shared/LoadingContent.svelte'
import QueryContent from '#lib/components/shared/QueryContent.svelte'

const children = createRawSnippet(() => ({ render: () => '<button>Add Category</button>' }))

it('keeps content rendered but inert and hidden from accessibility while loading', () => {
	const { body } = render(LoadingContent, { props: { text: 'Loading categories', children } })
	expect(body).toContain('Add Category')
	expect(body).toContain('aria-busy="true"')
	expect(body).toContain('inert')
	expect(body).toContain('aria-hidden="true"')
	expect(body).toContain('Loading categories')
})

it('releases content and removes the loading display when ready', () => {
	const { body } = render(LoadingContent, {
		props: { loading: false, text: 'Loading categories', children }
	})
	expect(body).toContain('Add Category')
	expect(body).toContain('aria-busy="false"')
	expect(body).not.toContain('inert')
	expect(body).not.toContain('Loading categories')
})

it('supports the standalone Jazz startup and error display', () => {
	const { body } = render(LoadingContent, {
		props: {
			text: 'Startup failed',
			variant: 'error',
			style: '--dui-loading-screen-min-height: auto'
		}
	})
	expect(body).toContain('Startup failed')
	expect(body).toContain('--dui-loading-screen-min-height: auto')
	expect(body).not.toContain('aria-busy')
})

it('preserves the default query loading behavior and opts into retaining content', () => {
	const props = {
		queries: [{ isLoading: true, error: null }],
		loadingMessage: 'Loading categories',
		errorMessage: 'Could not load categories',
		children
	}
	expect(render(QueryContent, { props }).body).not.toContain('Add Category')
	const retained = render(QueryContent, { props: { ...props, keepContentWhileLoading: true } }).body
	expect(retained).toContain('Add Category')
	expect(retained).toContain('inert')
})

it('shows query errors instead of content or a loading overlay', () => {
	const { body } = render(QueryContent, {
		props: {
			queries: [{ isLoading: true, error: new Error('Unavailable') }],
			loadingMessage: 'Loading categories',
			errorMessage: 'Could not load categories',
			keepContentWhileLoading: true,
			children
		}
	})
	expect(body).toContain('Could not load categories')
	expect(body).not.toContain('Add Category')
	expect(body).not.toContain('Loading categories')
})
