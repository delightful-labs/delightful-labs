import { expect, it } from 'vitest'
import fc from 'fast-check'
import { normalizeReaderText } from './schema.js'
import {
	textPositionSelectorSchema,
	textQuoteSelectorSchema,
	toTextPositionSelector,
	toTextQuoteSelector,
	toTimeState
} from './selectors.js'

it('projects retained quotation/context exactly and only adds the W3C type label', () => {
	expect(
		toTextQuoteSelector({
			version: 7,
			start: 3,
			end: 9,
			before: ' A ',
			matched: 'café 🦊',
			after: '\n follows '
		})
	).toEqual({
		type: 'TextQuoteSelector',
		exact: 'café 🦊',
		prefix: ' A ',
		suffix: '\n follows '
	})
})

it('converts UTF-16 offsets to Unicode code points without collapsing combining marks', () => {
	const text = '🦊 A e\u0301 👩‍💻 end'
	expect(
		toTextPositionSelector(
			{ start: 5, end: 13, before: '🦊 A ', matched: 'e\u0301 👩‍💻', after: ' end' },
			text
		)
	).toEqual({ type: 'TextPositionSelector', start: 4, end: 10 })
})

it('uses the same normalized text for quotation and positions', () => {
	const text = normalizeReaderText('🦊\r\nA\rB')
	const range = { start: 3, end: 6, before: '🦊\n', matched: 'A\nB', after: '' }
	expect(toTextQuoteSelector(range).exact).toBe('A\nB')
	expect(toTextPositionSelector(range, text)).toEqual({
		type: 'TextPositionSelector',
		start: 2,
		end: 5
	})
	expect(() => toTextPositionSelector(range, '🦊\r\nA\rB')).toThrow()
})

it('keeps quote-only native ranges usable without inventing position evidence', () => {
	const range = { before: '', matched: 'passage', after: '' }
	expect(toTextPositionSelector(range, 'passage')).toBeUndefined()
	expect(toTextQuoteSelector(range)).toEqual({
		type: 'TextQuoteSelector',
		exact: 'passage',
		prefix: '',
		suffix: ''
	})
})

it('refuses contradictory positions, context, bounds and split surrogate pairs', () => {
	const range = { start: 3, end: 10, before: '🦊 ', matched: 'passage', after: '!' }
	for (const change of [
		{ start: undefined },
		{ end: undefined },
		{ start: -1 },
		{ start: 3.5 },
		{ end: 3 },
		{ end: 12 },
		{ before: 'elsewhere' },
		{ after: '?' },
		{ matched: 'another' }
	]) {
		expect(() => toTextPositionSelector({ ...range, ...change }, '🦊 passage!')).toThrow()
	}
	expect(() =>
		toTextPositionSelector({ start: 1, end: 2, before: '', matched: '\udc00', after: '' }, '🦊')
	).toThrow()
	expect(() => toTextPositionSelector(range, '🦊 passage!\ud800')).toThrow()
})

it('refuses oversized quotes/context and malformed Unicode without truncation', () => {
	for (const range of [
		{ matched: 'x'.repeat(1501), before: '', after: '' },
		{ matched: ('a' + '\u0301'.repeat(10)).repeat(250), before: '', after: '' },
		{ matched: 'quote', before: 'x'.repeat(151), after: '' },
		{ matched: 'quote', before: '', after: ('a' + '\u0301'.repeat(10)).repeat(25) },
		{ matched: '\ud800', before: '', after: '' }
	]) {
		expect(() => toTextQuoteSelector(range)).toThrow('Annotation selector cannot be projected')
	}
	expect(
		toTextQuoteSelector({ matched: 'x'.repeat(1500), before: 'x'.repeat(150), after: '' }).exact
	).toHaveLength(1500)
})

it('only admits supported valid selector fields at this projection boundary', () => {
	expect(textQuoteSelectorSchema.safeParse({ type: 'TextQuoteSelector' }).success).toBe(false)
	expect(textQuoteSelectorSchema.safeParse({ type: 'CssSelector', value: 'p' }).success).toBe(false)
	for (const [start, end] of [
		[-1, 2],
		[2, 2],
		[4, 2],
		[0, 1.5],
		[0, Infinity]
	]) {
		expect(
			textPositionSelectorSchema.safeParse({ type: 'TextPositionSelector', start, end }).success
		).toBe(false)
	}
})

it('counts independently generated code-point passages rather than UTF-16 units', () => {
	const text = fc.array(fc.constantFrom('a', '🦊', '💻', '\u0301', '\n', 'ש', '字'), {
		maxLength: 30
	})
	fc.assert(
		fc.property(text, text, text, (before, inside, after) => {
			const selected = ['🦊', ...inside]
			const range = {
				before: before.join(''),
				matched: selected.join(''),
				after: after.join(''),
				start: before.join('').length,
				end: before.join('').length + selected.join('').length
			}
			expect(toTextPositionSelector(range, [...before, ...selected, ...after].join(''))).toEqual({
				type: 'TextPositionSelector',
				start: before.length,
				end: before.length + selected.length
			})
		}),
		{ numRuns: 200, seed: 3814 }
	)
})

it('serializes the retained capture timestamp without adding publication metadata', () => {
	expect(toTimeState(new Date('2026-11-14T10:30:00Z'))).toEqual({
		type: 'TimeState',
		sourceDate: '2026-11-14T10:30:00.000Z'
	})
	expect(() => toTimeState(new Date(NaN))).toThrow()
})
