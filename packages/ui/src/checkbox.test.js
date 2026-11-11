import { render } from 'svelte/server'
import { describe, expect, it } from 'vitest'
import Checkbox from './lib/Components/Inputs/Checkbox.svelte'

describe('checkbox server rendering', () => {
	it('links an escaped label and renders checked defaults and native attributes', () => {
		const { body } = render(Checkbox, {
			props: {
				label: 'Updates & news',
				name: 'updates',
				value: 'yes',
				defaultChecked: true,
				required: true
			}
		})
		const id = body.match(/<input\b[^>]*id="([^"]+)"/)?.[1]
		expect(id).toBeTruthy()
		expect(body).toContain(`for="${id}"`)
		expect(body).toContain('Updates &amp; news')
		expect(body).toContain('type="checkbox"')
		expect(body).toContain('name="updates"')
		expect(body).toContain('value="yes"')
		expect(body).toMatch(/<input\b[^>]*\bchecked(?:=""|\s|>)/)
		expect(body).toMatch(/<input\b[^>]*\brequired(?:=""|\s|>)/)
	})

	it('preserves explicit false over a checked default', () => {
		const { body } = render(Checkbox, {
			props: { label: 'Updates', checked: false, defaultChecked: true }
		})
		expect(body).not.toMatch(/<input\b[^>]*\bchecked(?:=""|\s|>)/)
	})

	it('starts unchecked without defaults and forwards disabled state and identifiers', () => {
		const { body } = render(Checkbox, {
			props: {
				label: 'Updates',
				id: 'updates',
				disabled: true,
				'aria-describedby': 'updates-help'
			}
		})
		expect(body).toContain('for="updates"')
		expect(body).toContain('id="updates"')
		expect(body).toContain('aria-describedby="updates-help"')
		expect(body).toMatch(/<input\b[^>]*\bdisabled(?:=""|\s|>)/)
		expect(body).not.toMatch(/<input\b[^>]*\bchecked(?:=""|\s|>)/)
	})
})
