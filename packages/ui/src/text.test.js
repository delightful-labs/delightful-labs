import { createRawSnippet } from 'svelte'
import { render } from 'svelte/server'
import { describe, expect, it } from 'vitest'
import { Text } from './lib/index.js'

const children = createRawSnippet(() => ({
	render: () => '<strong>Saved</strong>'
}))

describe('Text semantics', () => {
	it('renders a paragraph by default with native attributes and child content', () => {
		const { body } = render(Text, {
			props: { children, id: 'saved', role: 'status' }
		})
		expect(body).toMatch(/<p\b/)
		expect(body).toContain('id="saved"')
		expect(body).toContain('role="status"')
		expect(body).toContain('<strong>Saved</strong>')
		expect(body).toContain('</p>')
	})

	it('renders inline text without introducing a paragraph when as is span', () => {
		const { body } = render(Text, {
			props: { children, as: 'span', size: 'sm', lang: 'en' }
		})
		expect(body).toMatch(/<span\b/)
		expect(body).toContain('lang="en"')
		expect(body).toContain('<strong>Saved</strong>')
		expect(body).not.toMatch(/<p\b/)
	})
})
