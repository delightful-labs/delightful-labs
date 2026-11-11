import { expect, test } from 'vitest'
import { render } from 'svelte/server'
import { TopNavigation } from './lib/index.js'

test('top navigation renders a header with optional sticky positioning', () => {
	const { body } = render(TopNavigation, {
		props: {
			sticky: true,
			id: 'toolbar',
			'aria-label': 'Finance'
		}
	})
	expect(body).toContain('<header')
	expect(body).toContain('data-sticky="true"')
	expect(body).toContain('data-top-navigation')
	expect(body).toContain('id="toolbar"')

	expect(body).toContain('aria-label="Finance"')
})

test('top navigation is not sticky by default', () => {
	const { body } = render(TopNavigation)
	expect(body).toContain('data-sticky="false"')
})
