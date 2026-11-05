import { render } from 'svelte/server'
import { describe, expect, it } from 'vitest'
import RadioGroupExample from '../tests/fixtures/RadioGroupExample.svelte'

/** @param {string} body */
function checkedInputs(body) {
	return [...body.matchAll(/<input\b[^>]*>/g)]
		.map(([input]) => input)
		.filter((input) => /\bchecked(?:=""|\s|>)/.test(input))
}

describe('radio group server rendering', () => {
	it('renders a named native group with labelled radios and a checked default', () => {
		const { body } = render(RadioGroupExample, {
			props: {
				label: 'View & schedule',
				name: 'view',
				defaultValue: 'week',
				required: true,
				'aria-describedby': 'view-help'
			}
		})
		expect(body).toMatch(/<fieldset\b[^>]*aria-describedby="view-help"/)
		expect(body).toMatch(/<legend\b[^>]*>View &amp; schedule<\/legend>/)
		expect(body).toMatch(/<label\b[^>]*>\s*<input\b[^>]*value="day"/)
		expect(body).toContain('Day &amp; night')
		const inputs = [...body.matchAll(/<input\b[^>]*>/g)]
		expect(inputs).toHaveLength(3)
		for (const [input] of inputs) {
			expect(input).toContain('type="radio"')
			expect(input).toContain('name="view"')
			expect(input).toMatch(/\brequired(?:=""|\s|>)/)
		}
		expect(checkedInputs(body)).toHaveLength(1)
		expect(checkedInputs(body)[0]).toContain('value="week"')
	})

	it('gives an explicit value precedence over the default', () => {
		const { body } = render(RadioGroupExample, {
			props: { label: 'View', value: 'day', defaultValue: 'week' }
		})
		expect(checkedInputs(body)).toHaveLength(1)
		expect(checkedInputs(body)[0]).toContain('value="day"')
	})

	it('preserves an empty string value and starts unselected without a default', () => {
		const { body } = render(RadioGroupExample, {
			props: {
				label: 'View',
				includeEmpty: true,
				value: '',
				defaultValue: 'week'
			}
		})
		expect(checkedInputs(body)).toHaveLength(1)
		expect(checkedInputs(body)[0]).toContain('value=""')
		const unselected = render(RadioGroupExample, { props: { label: 'View' } })
		expect(checkedInputs(unselected.body)).toHaveLength(0)
	})

	it('forwards external form ownership and disabled options', () => {
		const { body } = render(RadioGroupExample, {
			props: { label: 'View', form: 'owner' }
		})
		const inputs = [...body.matchAll(/<input\b[^>]*>/g)].map(([input]) => input)
		for (const input of inputs) expect(input).toContain('form="owner"')
		expect(inputs[0]).not.toMatch(/\bdisabled(?:=""|\s|>)/)
		expect(inputs[2]).toMatch(/\bdisabled(?:=""|\s|>)/)
		const disabled = render(RadioGroupExample, {
			props: { label: 'View', disabled: true }
		})
		expect(disabled.body).toMatch(/<fieldset\b[^>]*\bdisabled(?:=""|\s|>)/)
	})
})
