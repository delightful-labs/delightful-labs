import { expect, test } from 'vitest'
import { render } from 'svelte/server'
import { Navigation } from './lib/index.js'

test('navigation renders a labelled native landmark and list without menu semantics', () => {
	const { body } = render(Navigation, {
		props: { label: 'Finance & settings' }
	})
	expect(body).toContain('<nav')
	expect(body).toContain('aria-label="Finance &amp; settings"')
	expect(body).toContain('<ul')
	expect(body).not.toContain('role="menu"')
	expect(body).not.toContain('aria-orientation')
})

test('native landmark attributes remain on the nav and orientation is a component prop', () => {
	const { body } = render(Navigation, {
		props: {
			label: 'Main navigation',
			orientation: 'horizontal',
			id: 'main-nav',
			hidden: true,
			'aria-describedby': 'help'
		}
	})
	expect(body).toContain('id="main-nav"')

	expect(body).toContain('aria-describedby="help"')
	expect(body).toMatch(/<nav\b[^>]*\bhidden(?:=""|\s|>)/)
	expect(body).not.toContain('orientation=')
})
