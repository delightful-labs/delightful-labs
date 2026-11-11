import { render } from 'svelte/server'
import { describe, expect, it } from 'vitest'
import InputDate from './lib/Components/Inputs/InputDate.svelte'

describe('date input server rendering', () => {
	it('links an escaped label and renders its date-only default', () => {
		const { body } = render(InputDate, {
			props: {
				label: 'Date & schedule',
				name: 'date',
				defaultValue: '2026-10-13',
				required: true
			}
		})
		const id = body.match(/<input\b[^>]*id="([^"]+)"/)?.[1]
		expect(id).toBeTruthy()
		expect(body).toContain(`for="${id}"`)
		expect(body).toContain('Date &amp; schedule')
		expect(body).toContain('type="date"')
		expect(body).toContain('name="date"')
		expect(body).toContain('value="2026-10-13"')
		expect(body).toMatch(/<input\b[^>]*\brequired(?:=""|\s|>)/)
	})

	it('keeps an explicit empty value instead of restoring its default', () => {
		const { body } = render(InputDate, {
			props: { label: 'Date', value: '', defaultValue: '2026-10-13' }
		})
		expect(body).toContain('value=""')
		expect(body).not.toContain('value="2026-10-13"')
	})

	it('forwards explicit IDs, date range, day step and readonly state', () => {
		const { body } = render(InputDate, {
			props: {
				label: 'Date',
				id: 'date',
				min: '2026-10-01',
				max: '2026-10-31',
				step: 2,
				readonly: true
			}
		})
		for (const attribute of [
			'for="date"',
			'id="date"',
			'min="2026-10-01"',
			'max="2026-10-31"',
			'step="2"'
		])
			expect(body).toContain(attribute)
		expect(body).toMatch(/<input\b[^>]*\breadonly(?:=""|\s|>)/)
	})
})
