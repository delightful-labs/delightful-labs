import { expect, test } from 'vitest'
import { createRawSnippet } from 'svelte'
import { render } from 'svelte/server'
import { FloatingActionLink, FloatingActionButton } from './lib/index.js'

const children = createRawSnippet(() => ({
	render: () => '<svg aria-hidden="true"><path d="M0 0h1" /></svg>'
}))

test('link forwards its native accessible name, destination, title, and child icon', () => {
	const { body } = render(FloatingActionLink, {
		props: {
			href: '/items/new?workspace=personal',
			'aria-label': 'Add <item> & notes',
			title: 'Add item',
			children
		}
	})
	expect([...body.matchAll(/<a\b/g)]).toHaveLength(1)
	expect(body).toContain('href="/items/new?workspace=personal"')
	expect(body).toContain('aria-label="Add &lt;item> &amp; notes"')
	expect(body).toContain('title="Add item"')
	expect(body).toMatch(/<svg\b[^>]*aria-hidden="true"/)
	expect(body).not.toContain('<button')
})

test('button defaults to a native non-submit button without inventing a name or title', () => {
	const text = createRawSnippet(() => ({
		render: () => '<span>Add item</span>'
	}))
	const { body } = render(FloatingActionButton, { props: { children: text } })
	expect(body).toMatch(/<button\b[^>]*type="button"/)
	expect(body).toContain('<span>Add item</span>')
	expect(body).not.toContain('aria-label=')
	expect(body).not.toContain('title=')
	expect(body).not.toContain('href=')
})

test('button forwards native disabled state', () => {
	const { body } = render(FloatingActionButton, {
		props: { 'aria-label': 'Add item', disabled: true, children }
	})
	expect(body).toMatch(/<button\b[^>]*\bdisabled(?:=""|\s|>)/)
	expect(body).toContain('type="button"')
})

test('button supports explicit native form submission attributes', () => {
	const { body } = render(FloatingActionButton, {
		props: {
			'aria-label': 'Save item',
			type: 'submit',
			form: 'item-form',
			name: 'action',
			value: 'save',
			formnovalidate: true,
			children
		}
	})
	expect(body).toContain('type="submit"')
	expect(body).toContain('form="item-form"')
	expect(body).toContain('name="action"')
	expect(body).toContain('value="save"')
	expect(body).toMatch(/\bformnovalidate(?:=""|\s|>)/)
})

test('link preserves native navigation attributes', () => {
	const { body } = render(FloatingActionLink, {
		props: {
			href: '/items/new',
			'aria-label': 'Add item in a new tab',
			title: 'Create an item',
			target: '_blank',
			rel: 'noopener',
			'aria-describedby': 'item-help',
			children
		}
	})
	expect(body).toContain('target="_blank"')
	expect(body).toContain('rel="noopener"')
	expect(body).toContain('title="Create an item"')
	expect(body).toContain('aria-describedby="item-help"')
})

test('both controls support caller-owned aria-labelledby', () => {
	const link = render(FloatingActionLink, {
		props: { 'aria-labelledby': 'action-label', children }
	})
	const button = render(FloatingActionButton, {
		props: { 'aria-labelledby': 'action-label', children }
	})
	for (const body of [link.body, button.body]) {
		expect(body).toContain('aria-labelledby="action-label"')
		expect(body).not.toContain('aria-label=')
	}
})
