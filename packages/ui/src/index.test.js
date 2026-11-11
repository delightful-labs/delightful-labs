import { describe, expect, it } from 'vitest'
import { render } from 'svelte/server'
import InputNumber from './lib/Components/Inputs/InputNumber.svelte'
import InputText from './lib/Components/Inputs/InputText.svelte'
import Demo from './routes/+page.svelte'

describe('native input server rendering', () => {
	it('renders an accessible named text control with its escaped default', () => {
		const { body } = render(InputText, {
			props: {
				label: 'Recipient & sender',
				name: 'recipient',
				defaultValue: 'Ada & Grace',
				required: true
			}
		})
		const inputId = body.match(/<input\b[^>]*\bid="([^"]+)"/)?.[1]

		expect(inputId).toBeTruthy()
		expect(body).toContain(`for="${inputId}"`)
		expect(body).toContain('Recipient &amp; sender')
		expect(body).toContain('name="recipient"')
		expect(body).toContain('value="Ada &amp; Grace"')
		expect(body).toMatch(/<input\b[^>]*\brequired(?:=""|\s|>)/)
	})

	it('preserves an explicit empty text value over its initial default', () => {
		const { body } = render(InputText, {
			props: { label: 'Description', value: '', defaultValue: 'Default' }
		})

		expect(body).toContain('value=""')
		expect(body).not.toContain('value="Default"')
	})

	it('preserves zero, numeric constraints, and a caller-provided identifier', () => {
		const { body } = render(InputNumber, {
			props: {
				label: 'Quantity',
				id: 'quantity',
				name: 'quantity',
				defaultValue: 0,
				min: 0,
				max: 100,
				step: 0.01
			}
		})

		expect(body).toContain('for="quantity"')
		expect(body).toContain('id="quantity"')
		expect(body).toContain('type="number"')
		expect(body).toContain('name="quantity"')
		expect(body).toContain('value="0"')
		expect(body).toContain('min="0"')
		expect(body).toContain('max="100"')
		expect(body).toContain('step="0.01"')
	})

	it('gives an explicit numeric value precedence over the initial default', () => {
		const { body } = render(InputNumber, {
			props: { label: 'Measurement', value: 0, defaultValue: 1.25 }
		})

		expect(body).toContain('value="0"')
	})

	it('renders distinct input IDs and matching label associations in one page', () => {
		const { body } = render(Demo)
		const ids = Array.from(
			body.matchAll(/<input\b[^>]*\bid="([^"]+)"/g),
			(match) => match[1]
		)
		const labels = Array.from(
			body.matchAll(/<label\b[^>]*\bfor="([^"]+)"/g),
			(match) => match[1]
		)

		expect(ids.length).toBeGreaterThan(1)
		expect(new Set(ids).size).toBe(ids.length)
		expect(labels.sort()).toEqual(ids.sort())
	})
})
