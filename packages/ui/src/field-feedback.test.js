import { describe, expect, it } from 'vitest'
import { render } from 'svelte/server'
import { FieldFeedback } from './lib/index.js'

describe('field feedback rendering', () => {
	it('keeps a stable description ID without adding a live region', () => {
		const { body } = render(FieldFeedback, { props: { id: 'name-help' } })
		expect(body).toContain('id="name-help"')
		expect(body).not.toContain('<span')
		expect(body).not.toContain('role=')
	})
	it('renders both escaped descriptions and forwards native attributes', () => {
		const { body } = render(FieldFeedback, {
			props: {
				id: 'name-help',
				instructions: 'Use <name>',
				errorMessage: 'Name & type required',
				hidden: true
			}
		})
		expect(body).toContain('Use &lt;name>')
		expect(body).toContain('Name &amp; type required')

		expect(body).toMatch(/<div\b[^>]*\bhidden(?:=""|\s|>)/)
	})
})
