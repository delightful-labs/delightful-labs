import { describe, expect, it } from 'vitest'
import { render } from 'svelte/server'
import { Popover } from './lib/index.js'
import Demo from './routes/+page.svelte'

describe('popover server rendering', () => {
	it('renders native auto behavior and forwards escaped attributes', () => {
		const { body } = render(Popover, {
			props: {
				id: 'info',
				title: 'Amount & tax',
				'aria-label': 'Help'
			}
		})
		expect(body).toContain('id="info"')
		expect(body).toContain('popover="auto"')
		expect(body).toContain('title="Amount &amp; tax"')
		expect(body).toContain('aria-label="Help"')

		expect(body).not.toContain('role=')
	})

	it('renders rich content and caller-owned triggers without browser APIs', () => {
		const { body } = render(Demo)
		expect(body).toContain('popovertarget="amount-info"')
		expect(body).toContain('Enter the total amount, including tax.')
		expect(body).toContain('popovertargetaction="hide"')
	})
})
