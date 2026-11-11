import { createRawSnippet } from 'svelte'
import { render } from 'svelte/server'
import { describe, expect, it } from 'vitest'
import Button from './lib/Components/Button.svelte'

describe('button server rendering', () => {
	it('renders caller-translated button text with native language attributes', () => {
		const { body } = render(Button, {
			props: { text: 'Hifadhi & endelea', lang: 'sw', dir: 'ltr' }
		})
		expect(body).toContain('Hifadhi &amp; endelea')
		expect(body).toContain('lang="sw"')
		expect(body).toContain('dir="ltr"')
	})

	it('gives child content precedence over the text prop', () => {
		const { body } = render(Button, {
			props: {
				text: 'Unused label',
				children: createRawSnippet(() => ({
					render: () => '<strong>Hifadhi</strong>'
				}))
			}
		})
		expect(body).toContain('<strong>Hifadhi</strong>')
		expect(body).not.toContain('Unused label')
	})

	it('does not invent fallback text for a caller-labelled empty button', () => {
		const { body } = render(Button, { props: { 'aria-label': 'Hifadhi' } })
		expect(body).toContain('aria-label="Hifadhi"')
		expect(body.replace(/<!--[\s\S]*?-->/g, '')).toMatch(
			/<button\b[^>]*><\/button>/
		)
	})

	it('forwards aria-disabled without setting native disabled', () => {
		const { body } = render(Button, { props: { 'aria-disabled': 'true' } })
		expect(body).toContain('aria-disabled="true"')
		expect(body).not.toMatch(/<button\b[^>]*\sdisabled(?:=""|\s|>)/)
	})
})
