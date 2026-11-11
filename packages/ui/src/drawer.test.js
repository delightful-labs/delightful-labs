import { expect, test } from 'vitest'
import { render } from 'svelte/server'
import { Drawer } from './lib/index.js'

const labels = { heading: 'Main & settings', closeLabel: 'Close menu' }

test('closed drawer is an inert, accessible-hidden aside without modal semantics', () => {
	const { body } = render(Drawer, { props: { ...labels, id: 'sidebar' } })
	expect(body).toContain('<aside')
	expect(body).toContain('id="sidebar"')
	expect(body).toContain('data-open="false"')
	expect(body).toContain('aria-hidden="true"')
	expect(body).toMatch(/<aside\b[^>]*\binert(?:=""|\s|>)/)
	// The DOM stays mounted so closing can animate; inert/aria-hidden apply immediately.
	expect(body).not.toMatch(/<aside\b[^>]*\bhidden(?:=""|\s|>)/)
	expect(body).not.toContain('<dialog')
	expect(body).not.toContain('aria-modal')
	expect(body).not.toContain('closedby=')
	expect(body).toContain('Main &amp; settings')
})

test('open drawer preserves heading association, side and native attributes', () => {
	const { body } = render(Drawer, {
		props: {
			...labels,
			open: true,
			side: 'right',
			id: 'sidebar',
			title: 'Navigation panel',
			headingLevel: 'h3'
		}
	})
	const id = body.match(/<h3\b[^>]*id="([^"]+)"/)?.[1]
	expect(id).toBeTruthy()
	expect(body).toContain(`aria-labelledby="${id}"`)
	expect(body).toContain('data-side="right"')
	expect(body).toContain('data-open="true"')
	expect(body).toContain('aria-hidden="false"')
	expect(body).toContain('title="Navigation panel"')
	expect(body).toContain('<svg')
	expect(body).toContain('aria-hidden="true"')
	expect(body).toContain('<path')
	expect(body).toContain('stroke="currentColor"')

	expect(body).not.toMatch(/<aside\b[^>]*\binert(?:=""|\s|>)/)
	expect(body).toMatch(/<button\b[^>]*>[\s\S]*?Close menu[\s\S]*?<\/button>/)
	expect(body).not.toContain('aria-label="Close menu"')
})

test('the close control can be omitted without losing the named aside', () => {
	const { body } = render(Drawer, {
		props: { ...labels, open: true, showCloseButton: false }
	})
	expect(body).toContain('aria-labelledby=')
	expect(body).toContain('Main &amp; settings')
	expect(body).toContain('data-close-button="false"')
	expect(body).not.toContain('<button')
})

test('a visually hidden heading still names the drawer', () => {
	const { body } = render(Drawer, {
		props: { ...labels, open: true, headingHidden: true }
	})
	const id = body.match(/<h2\b[^>]*id="([^"]+)"/)?.[1]
	expect(id).toBeTruthy()
	expect(body).toContain(`aria-labelledby="${id}"`)
	expect(body).toContain('heading-hidden')
	expect(body).toContain('Main &amp; settings')
	expect(body).toContain('data-side="left"')
})
