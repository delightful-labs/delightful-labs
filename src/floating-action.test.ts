import { expect, test } from 'vitest'
import { render } from 'svelte/server'
import type { ComponentProps } from 'svelte'
import AddIcon from 'tdesign-icons-svg/src/add.svg?component'
import { FloatingAction } from './lib/index.js'

test('href selects a native named anchor with a decorative icon and default title', () => {
	const props = {
		href: '/items/new?workspace=personal',
		label: 'Add <item> & notes',
		icon: AddIcon
	} satisfies ComponentProps<typeof FloatingAction>
	const { body } = render<typeof FloatingAction, typeof props>(FloatingAction, {
		props
	})
	expect([...body.matchAll(/<a\b/g)]).toHaveLength(1)
	expect(body).toContain('href="/items/new?workspace=personal"')
	expect(body).toContain('aria-label="Add &lt;item> &amp; notes"')
	expect(body).toContain('title="Add &lt;item> &amp; notes"')
	expect(body).toMatch(/<svg\b[^>]*aria-hidden="true"/)
	expect(body).not.toContain('<button')
})

test('without href it defaults to a native non-submit button', () => {
	const props = { label: 'Add item', icon: AddIcon } satisfies ComponentProps<
		typeof FloatingAction
	>
	const { body } = render<typeof FloatingAction, typeof props>(FloatingAction, {
		props
	})
	expect(body).toMatch(/<button\b[^>]*type="button"/)
	expect(body).toContain('aria-label="Add item"')
	expect(body).not.toContain('<a ')
	expect(body).not.toContain('href=')
})

test('forwards native disabled state to a button', () => {
	const props = {
		label: 'Add item',
		icon: AddIcon,
		disabled: true
	} satisfies ComponentProps<typeof FloatingAction>
	const { body } = render<typeof FloatingAction, typeof props>(FloatingAction, {
		props
	})
	expect(body).toMatch(/<button\b[^>]*\bdisabled(?:=""|\s|>)/)
	expect(body).toContain('type="button"')
})

test('supports explicit native form submission attributes', () => {
	const props = {
		label: 'Save item',
		icon: AddIcon,
		type: 'submit',
		form: 'item-form',
		name: 'action',
		value: 'save',
		formnovalidate: true
	} satisfies ComponentProps<typeof FloatingAction>
	const { body } = render<typeof FloatingAction, typeof props>(FloatingAction, {
		props
	})
	expect(body).toContain('type="submit"')
	expect(body).toContain('form="item-form"')
	expect(body).toContain('name="action"')
	expect(body).toContain('value="save"')
	expect(body).toMatch(/\bformnovalidate(?:=""|\s|>)/)
})

test('preserves native link attributes and caller title overrides', () => {
	const props = {
		href: '/items/new',
		label: 'Add item in a new tab',
		icon: AddIcon,
		title: 'Create an item',
		target: '_blank',
		rel: 'noopener',
		'aria-describedby': 'item-help'
	} satisfies ComponentProps<typeof FloatingAction>
	const { body } = render<typeof FloatingAction, typeof props>(FloatingAction, {
		props
	})
	expect(body).toContain('target="_blank"')
	expect(body).toContain('rel="noopener"')
	expect(body).toContain('title="Create an item"')
	expect(body).toContain('aria-describedby="item-help"')
	expect(body).not.toContain('title="Add item in a new tab"')
})
