import { createRawSnippet } from 'svelte'
import { render } from 'svelte/server'
import { describe, expect, it } from 'vitest'
import { Heading } from './lib/index.js'

const children = createRawSnippet(() => ({
	render: () => '<span>Account settings</span>'
}))

describe('Heading semantics', () => {
	it('defaults to a native h2 and preserves content and native attributes', () => {
		const { body } = render(Heading, {
			props: { children, id: 'settings', tabindex: -1 }
		})
		expect(body).toMatch(/<h2\b/)
		expect(body).toContain('id="settings"')
		expect(body).toContain('tabindex="-1"')
		expect(body).toContain('<span>Account settings</span>')
	})

	for (const level of /** @type {const} */ ([
		'h1',
		'h2',
		'h3',
		'h4',
		'h5',
		'h6'
	])) {
		it(`preserves native ${level} semantics with default and overridden sizes`, () => {
			for (const size of /** @type {const} */ ([
				undefined,
				'xs',
				'sm',
				'md',
				'lg',
				'xl',
				'xxl'
			])) {
				const { body } = render(Heading, { props: { children, level, size } })
				expect(body).toMatch(new RegExp(`<${level}\\b`))
				expect(body).toContain(`</${level}>`)
			}
		})
	}
})
