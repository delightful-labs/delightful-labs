import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'svelte/server'
import DateRangeFilter from './DateRangeFilter.svelte'

function filter(start: string, end: string) {
	return render(DateRangeFilter, {
		props: { start, end, onchange: () => {}, onpreset: () => {} }
	}).body
}

beforeEach(() => {
	vi.useFakeTimers()
	vi.setSystemTime(new Date(2026, 10, 5, 12))
})
afterEach(() => vi.useRealTimers())

describe('date range filter controls', () => {
	for (const { start, choice } of [
		{ start: '2026-10-30', choice: '7' },
		{ start: '2026-10-07', choice: '30' }
	]) {
		it(`selects the inclusive ${choice}-day preset and hides custom inputs`, () => {
			const html = filter(start, '2026-11-05')
			expect(html).toContain('Filter Dates')
			expect(html).toContain('Last week')
			expect(html).toContain('Last month')
			expect(html).toContain('Custom')
			const radios = [...html.matchAll(/<input\b[^>]*type="radio"[^>]*>/g)]
			const checked = radios.filter(([input]) => /\bchecked(?:=""|\s|\/?>)/.test(input))
			expect(radios).toHaveLength(3)
			expect(checked).toHaveLength(1)
			expect(checked[0]?.[0]).toContain(`value="${choice}"`)
			expect(html).not.toContain('type="date"')
		})
	}

	for (const { start, end } of [
		{ start: '', end: '' },
		{ start: '2026-10-30', end: '' },
		{ start: '2026-10-30', end: '2026-11-04' },
		{ start: '2026-11-06', end: '2026-11-05' }
	]) {
		it(`shows custom fields for ${start || 'open start'} through ${end || 'open end'}`, () => {
			const html = filter(start, end)
			expect(html).toMatch(/<input\b[^>]*value="custom"[^>]*\bchecked(?:=""|\s|\/?>)/)
			expect([...html.matchAll(/type="date"/g)]).toHaveLength(2)
			expect(html).toContain('Start Date')
			expect(html).toContain('End Date')
			expect(html).toContain(`value="${start}"`)
			expect(html).toContain(`value="${end}"`)
			expect(html).toContain(`max="${end}"`)
			expect(html).toContain(`min="${start}"`)
		})
	}
})
