import { describe, expect, it } from 'vitest'
import { render } from 'svelte/server'
import Details from './lib/Components/Details.svelte'
import Demo from './routes/+page.svelte'

describe('native disclosure server rendering', () => {
	it('renders a closed, escaped summary with native attributes', () => {
		const { body } = render(Details, {
			props: {
				summary: 'Options & settings',
				id: 'options',
				name: 'settings',
				title: 'Tooltip'
			}
		})

		expect(body).toContain('Options &amp; settings')
		expect(body).toContain('id="options"')
		expect(body).toContain('name="settings"')
		expect(body).toContain('title="Tooltip"')
		expect(body).not.toMatch(/<details\b[^>]*\bopen(?:=""|\s|>)/)
	})

	it('renders initial absolute open state without requiring a browser', () => {
		const { body } = render(Details, {
			props: {
				summary: 'Filters',
				open: true,
				position: 'absolute',
				align: 'end'
			}
		})

		expect(body).toMatch(/<details\b[^>]*\bopen(?:=""|\s|>)/)
		expect(body).toContain('data-position="absolute"')
		expect(body).toContain('data-align="end"')
	})

	it('renders caller-provided summary and content snippets in the demo', () => {
		const { body } = render(Demo)

		expect(body).toContain('<strong>Inline details</strong>')
		expect(body).toContain('View input examples')
	})
})
