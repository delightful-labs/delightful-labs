import { createRawSnippet } from 'svelte'
import { describe, expect, it } from 'vitest'
import { render } from 'svelte/server'
import Dialog from './lib/Components/Dialog.svelte'
import Demo from './routes/+page.svelte'

describe('dialog server rendering', () => {
	it('renders caller-translated dialog headings as strings or snippets', () => {
		const plain = render(Dialog, {
			props: { heading: 'Kagua & hifadhi', lang: 'sw' }
		})
		expect(plain.body).toContain('Kagua &amp; hifadhi')
		expect(plain.body).toContain('lang="sw"')
		const rich = render(Dialog, {
			props: {
				heading: createRawSnippet(() => ({
					render: () => '<strong>Kagua</strong>'
				}))
			}
		})
		expect(rich.body.replace(/<!--[\s\S]*?-->/g, '')).toMatch(
			/<h2\b[^>]*><strong>Kagua<\/strong><\/h2>/
		)
	})

	it('escapes headings and forwards native attributes', () => {
		const { body } = render(Dialog, {
			props: {
				heading: 'Review & save',
				headingLevel: 'h3',
				id: 'review',
				closedby: 'any'
			}
		})
		expect(body).toContain('Review &amp; save')
		expect(body).toContain('<h3')
		expect(body).toContain('id="review"')
		expect(body).toContain('closedby="any"')
	})

	it('leaves modal opening to the browser even when initially requested', () => {
		const { body } = render(Dialog, {
			props: { heading: 'Review', open: true }
		})
		expect(body).not.toMatch(/<dialog\b[^>]*\bopen(?:=""|\s|>)/)
	})

	it('gives both demo dialogs distinct heading references and renders snippets', () => {
		const { body } = render(Demo)
		const references = [
			...body.matchAll(/<dialog\b[^>]*aria-labelledby="([^"]+)"/g)
		].map((match) => match[1])
		expect(references).toHaveLength(2)
		expect(new Set(references).size).toBe(2)
		for (const reference of references)
			expect(body).toContain(`id="${reference}"`)
		expect(body).toContain('Light-dismiss dialog')
	})
})
