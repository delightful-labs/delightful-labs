import { createRawSnippet } from 'svelte'
import { render } from 'svelte/server'
import { describe, expect, it } from 'vitest'
import Button from './lib/Components/Button.svelte'
import Icon from './lib/Components/Icon.svelte'

const arrow = '<path d="M5 12h14M13 6l6 6-6 6" />'
const arrowSnippet = createRawSnippet(() => ({ render: () => arrow }))

describe('icon server rendering', () => {
	it('renders caller SVG content as decorative by default', () => {
		const { body } = render(Icon, {
			props: {
				children: arrowSnippet
			}
		})

		expect(body).toContain('aria-hidden="true"')
		expect(body).toContain('focusable="false"')
		expect(body).toContain('stroke="currentColor"')
		expect(body).toContain(arrow)
	})

	it('uses an accessible name when the icon conveys meaning', () => {
		const { body } = render(Icon, {
			props: {
				label: 'Continue',
				children: arrowSnippet
			}
		})

		expect(body).toContain('role="img"')
		expect(body).toContain('aria-label="Continue"')
		expect(body).not.toContain('aria-hidden="true"')
	})

	it('supports a visible SVG title as the accessible name', () => {
		const { body } = render(Icon, {
			props: {
				title: 'Continue',
				children: arrowSnippet
			}
		})

		expect(body).toContain('<title>Continue</title>')
		expect(body).toContain('role="img"')
		expect(body).not.toContain('aria-hidden="true"')
	})

	it('renders directly inside a button without taking over its accessible label', () => {
		const { body } = render(Button, {
			props: {
				'aria-label': 'Continue',
				children: createRawSnippet(() => ({
					render: () =>
						`<svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">${arrow}</svg>Continue`
				}))
			}
		})

		expect(body).toContain('<button aria-label="Continue"')
		expect(body).toContain('aria-hidden="true"')
		expect(body).toContain('Continue<!----><!--]--></button>')
	})
})
