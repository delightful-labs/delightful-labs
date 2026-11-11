import { createRawSnippet } from 'svelte'
import { render } from 'svelte/server'
import { describe, expect, it } from 'vitest'
import ScreenReaderText from './lib/Components/ScreenReaderText.svelte'
import LoadingSpinner from './lib/Components/LoadingSpinner.svelte'

describe('supplementary text server rendering', () => {
	it('renders child snippets with native attributes', () => {
		const { body } = render(ScreenReaderText, {
			props: {
				id: 'save-description',
				lang: 'en',
				children: createRawSnippet(() => ({
					render: () => '<strong>Changes to this item</strong>'
				}))
			}
		})
		expect(body).toContain('id="save-description"')
		expect(body).toContain('lang="en"')

		expect(body).toContain('<strong>Changes to this item</strong>')
		expect(body).not.toMatch(/\b(?:role|aria-hidden|hidden)=/)
	})

	it('allows empty content without introducing accessibility semantics', () => {
		const { body } = render(ScreenReaderText)
		expect(body).toContain('<span')
		expect(body).not.toMatch(/\b(?:role|aria-live|aria-hidden|hidden)=/)
	})

	it('renders LoadingSpinner text through the migrated child snippet', () => {
		const { body } = render(LoadingSpinner, {
			props: { text: 'Saving <draft> & changes' }
		})
		expect(body.replace(/<!--[\s\S]*?-->/g, '')).toMatch(
			/<span\b[^>]*>Saving &lt;draft> &amp; changes<\/span>/
		)
		expect(body).toContain('role="status"')
	})
})
