import { render } from 'svelte/server'
import { describe, expect, it } from 'vitest'
import { RadioGroup } from './lib/index.js'

const options = [
	{ label: 'Day & night', value: 'day' },
	{ label: 'Week', value: 'week' },
	{ label: 'Month', value: 'month', disabled: true }
]

/** @param {string} body */
function checkedInputs(body) {
	return [...body.matchAll(/<input\b[^>]*>/g)]
		.map(([input]) => input)
		.filter((input) => /\bchecked(?:=""|\s|>)/.test(input))
}

describe('radio group server rendering', () => {
	it('renders a named native group with labelled radios and a checked default', () => {
		const { body } = render(RadioGroup, {
			props: {
				label: 'View & schedule',
				name: 'view',
				options,
				defaultValue: 'week',
				required: true,
				'aria-describedby': 'view-help'
			}
		})
		expect(body).toMatch(/<fieldset\b[^>]*aria-describedby="view-help"/)
		expect(body).toMatch(/<legend\b[^>]*>View &amp; schedule<\/legend>/)
		expect(body).toMatch(
			/<label\b[^>]*>\s*<input\b[^>]*value="day"[^>]*>\s*<span[^>]*>Day &amp; night<\/span>/
		)
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
		const { body } = render(RadioGroup, {
			props: { label: 'View', options, value: 'day', defaultValue: 'week' }
		})
		expect(checkedInputs(body)).toHaveLength(1)
		expect(checkedInputs(body)[0]).toContain('value="day"')
	})

	it('preserves an empty string value and starts unselected without a default', () => {
		const { body } = render(RadioGroup, {
			props: {
				label: 'View',
				options: [{ label: 'None', value: '' }, ...options],
				value: '',
				defaultValue: 'week'
			}
		})
		expect(checkedInputs(body)).toHaveLength(1)
		expect(checkedInputs(body)[0]).toContain('value=""')
		const unselected = render(RadioGroup, { props: { label: 'View', options } })
		expect(checkedInputs(unselected.body)).toHaveLength(0)
	})

	it('forwards external form ownership and disabled options', () => {
		const { body } = render(RadioGroup, {
			props: { label: 'View', options, form: 'owner' }
		})
		const inputs = [...body.matchAll(/<input\b[^>]*>/g)].map(([input]) => input)
		for (const input of inputs) expect(input).toContain('form="owner"')
		expect(inputs[0]).not.toMatch(/\bdisabled(?:=""|\s|>)/)
		expect(inputs[2]).toMatch(/\bdisabled(?:=""|\s|>)/)
		const disabled = render(RadioGroup, {
			props: { label: 'View', options, disabled: true }
		})
		expect(disabled.body).toMatch(/<fieldset\b[^>]*\bdisabled(?:=""|\s|>)/)
	})
})
