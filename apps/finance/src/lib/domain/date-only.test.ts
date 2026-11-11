import { afterEach, describe, expect, it, vi } from 'vitest'
import { todayDateOnly } from './date-only.js'

afterEach(() => vi.useRealTimers())

describe('todayDateOnly', () => {
	it.each([
		{ date: new Date(2026, 0, 2, 12), expected: '2026-01-02' },
		{ date: new Date(2026, 8, 8, 12), expected: '2026-09-08' },
		{ date: new Date(2026, 10, 12, 12), expected: '2026-11-12' },
		{ date: new Date(2026, 0, 31, 23, 59, 59), expected: '2026-01-31' },
		{ date: new Date(2026, 1, 1, 0, 0, 0), expected: '2026-02-01' },
		{ date: new Date(2025, 11, 31, 23, 45), expected: '2025-12-31' },
		{ date: new Date(2026, 0, 1, 0, 15), expected: '2026-01-01' },
		{ date: new Date(2024, 1, 29, 12), expected: '2024-02-29' },
		{ date: new Date(2000, 1, 29, 12), expected: '2000-02-29' },
		{ date: new Date(2100, 2, 1, 0), expected: '2100-03-01' },
		// Both sides of New York's spring and autumn daylight-saving changes.
		{ date: new Date(2026, 2, 8, 1, 59), expected: '2026-03-08' },
		{ date: new Date(2026, 2, 8, 3, 1), expected: '2026-03-08' },
		{ date: new Date(2026, 10, 1, 0, 30), expected: '2026-11-01' },
		{ date: new Date(2026, 10, 1, 2, 30), expected: '2026-11-01' }
	])('returns the local calendar date $expected', ({ date, expected }) => {
		expect(todayDateOnly(date)).toBe(expected)
	})

	it('pads years below 1000 without Date constructor year remapping', () => {
		const date = new Date(2000, 0, 2, 12)
		date.setFullYear(7)
		expect(todayDateOnly(date)).toBe('0007-01-02')
	})

	it('does not mutate the supplied date', () => {
		const date = new Date(2026, 9, 15, 23, 59, 58, 123)
		const timestamp = date.getTime()
		expect(todayDateOnly(date)).toBe('2026-10-15')
		expect(date.getTime()).toBe(timestamp)
	})

	it('uses the current local date when no date is supplied', () => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date(2026, 0, 1, 0, 15))
		expect(todayDateOnly()).toBe('2026-01-01')
	})

	it('reads the clock on every call and follows the local year boundary', () => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date(2025, 11, 31, 23, 45))
		expect(todayDateOnly()).toBe('2025-12-31')
		vi.advanceTimersByTime(30 * 60 * 1000)
		expect(todayDateOnly()).toBe('2026-01-01')
	})
})
