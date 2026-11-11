import { describe, expect, it } from 'vitest'
import { render } from 'svelte/server'
import { Stepper } from './lib/index.js'

const steps =
	/** @type {import('./lib/Components/Stepper.svelte').StepperStep[]} */ ([
		{ id: 'details', label: 'Personal details', status: 'completed' },
		{ id: 'address', label: 'Address' },
		{ id: 'review', label: 'Review' }
	])

describe('stepper server rendering', () => {
	it('renders an ordered list with exactly one current step', () => {
		const { body } = render(Stepper, {
			props: { steps, currentStep: 'address' }
		})

		expect(body).toContain('<ol aria-label="Progress"')
		expect(body).toMatch(/<ol\b/)
		expect(body).toContain('aria-current="step"')
		expect([...body.matchAll(/aria-current="step"/g)]).toHaveLength(1)
		expect(body).toContain('data-status="completed"')
		expect(body).toContain('data-status="upcoming"')
		expect(body).toContain('Personal details')
		expect(body).toContain('Address')
	})

	it('derives current and upcoming states when no explicit status is provided', () => {
		const { body } = render(Stepper, {
			props: {
				steps: [
					{ id: 'one', label: 'First' },
					{ id: 'two', label: 'Second' }
				],
				currentStep: 'one',
				label: 'Application progress'
			}
		})

		expect(body).toContain('aria-label="Application progress"')
		expect(body).toContain('aria-current="step"')
		expect(body).toContain('not completed')
	})

	it('allows caller attributes and translated status text', () => {
		const { body } = render(Stepper, {
			props: {
				steps: [{ id: 'one', label: 'Maelezo', status: 'completed' }],
				currentStep: 'one',
				label: 'Maendeleo',
				completedLabel: 'imekamilika',
				id: 'application-steps'
			}
		})

		expect(body).toContain('id="application-steps"')

		expect(body).toContain('aria-label="Maendeleo"')
		expect(body).toContain('imekamilika')
		expect(body).not.toContain('aria-current="step"')
	})
})
