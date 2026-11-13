import { expect, test } from 'vitest'
import { createRawSnippet } from 'svelte'
import { render } from 'svelte/server'
import { Button, SkipControl } from './lib/index.js'

/** @type {import('svelte').Component<import('svelte/elements').HTMLAnchorAttributes & { href: string }>} */
const AnchorSkipControl = SkipControl
/** @type {import('svelte').Component<import('svelte/elements').HTMLButtonAttributes & { component: import('svelte').Component<import('svelte/elements').HTMLButtonAttributes> }>} */
const ButtonSkipControl = SkipControl

const children = createRawSnippet(() => ({
	render: () => '<span>Skip to content</span>'
}))

test('skip link preserves native navigation and caller-owned accessibility attributes', () => {
	const { body } = render(AnchorSkipControl, {
		props: {
			href: '#main-content',
			'aria-label': 'Skip <navigation> & tools',
			'aria-describedby': 'skip-help',
			target: '_self',
			children
		}
	})

	expect(body).toMatch(/<a\b[^>]*href="#main-content"/)
	expect(body).toContain('aria-label="Skip &lt;navigation> &amp; tools"')
	expect(body).toContain('aria-describedby="skip-help"')
	expect(body).toContain('target="_self"')
	expect(body).toContain('<span>Skip to content</span>')
	expect(body).not.toContain('<button')
	expect(body).not.toMatch(/\s(?:hidden|inert|aria-hidden|tabindex)=/)
})

test('skip button defaults to a non-submit button with caller-owned dialog semantics', () => {
	const { body } = render(ButtonSkipControl, {
		props: {
			component: Button,
			'aria-labelledby': 'tools-label',
			'aria-haspopup': 'dialog',
			'aria-controls': 'tools',
			children
		}
	})

	expect(body).toMatch(/<button\b[^>]*type="button"/)
	expect(body).toContain('aria-labelledby="tools-label"')
	expect(body).toContain('aria-haspopup="dialog"')
	expect(body).toContain('aria-controls="tools"')
	expect(body).toContain('<span>Skip to content</span>')
	expect(body).not.toContain('href=')
	expect(body).not.toContain('aria-label=')
	expect(body).not.toMatch(/\s(?:hidden|inert|aria-hidden|tabindex)=/)
})

test('skip button forwards native disabled state', () => {
	const { body } = render(ButtonSkipControl, {
		props: { component: Button, disabled: true, children }
	})

	expect(body).toMatch(/<button\b[^>]*\bdisabled(?:=""|\s|>)/)
})

test('skip button preserves explicit form submission attributes', () => {
	const { body } = render(ButtonSkipControl, {
		props: {
			component: Button,
			type: 'submit',
			form: 'tools-form',
			name: 'action',
			value: 'open',
			formnovalidate: true,
			children
		}
	})

	expect(body).toMatch(/<button\b[^>]*type="submit"/)
	expect(body).toContain('form="tools-form"')
	expect(body).toContain('name="action"')
	expect(body).toContain('value="open"')
	expect(body).toMatch(/\bformnovalidate(?:=""|\s|>)/)
})
