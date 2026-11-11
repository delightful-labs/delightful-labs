import { render } from 'svelte/server'
import { describe, expect, it } from 'vitest'
import Textarea from './lib/Components/Inputs/Textarea.svelte'

describe('textarea server rendering', () => {
	it('links an escaped label and renders multiline default text safely', () => {
		const { body } = render(Textarea, {
			props: {
				label: 'Notes & context',
				name: 'notes',
				required: true,
				defaultValue: 'First line\n<draft> & details'
			}
		})
		const id = body.match(/<textarea\b[^>]*id="([^"]+)"/)?.[1]
		expect(id).toBeTruthy()
		expect(body).toContain(`for="${id}"`)
		expect(body).toContain('Notes &amp; context')
		expect(body).toContain('name="notes"')
		expect(body).toContain('rows="4"')
		expect(body).toMatch(/<textarea\b[^>]*\brequired(?:=""|\s|>)/)
		expect(body).toContain('First line\n&lt;draft> &amp; details')
	})

	it('preserves explicit empty value over the default', () => {
		const { body } = render(Textarea, {
			props: { label: 'Notes', value: '', defaultValue: 'Default' }
		})
		expect(body).toMatch(/<textarea\b[^>]*><\/textarea>/)
	})

	it('forwards caller identifiers, native constraints and readonly state', () => {
		const { body } = render(Textarea, {
			props: {
				label: 'Notes',
				id: 'notes',
				rows: 6,
				cols: 30,
				minlength: 5,
				maxlength: 40,
				readonly: true,
				'aria-describedby': 'notes-help'
			}
		})
		for (const attribute of [
			'for="notes"',
			'id="notes"',
			'rows="6"',
			'cols="30"',
			'minlength="5"',
			'maxlength="40"',
			'aria-describedby="notes-help"'
		]) {
			expect(body).toContain(attribute)
		}
		expect(body).toMatch(/<textarea\b[^>]*\breadonly(?:=""|\s|>)/)
	})
})
