import { expect, it } from 'vitest'
import {
	advanceReadingProgress,
	defaultPreferences,
	isValidReaderChange,
	projectReaderState,
	reconcilePositionProgress,
	readerOperationSchema
} from './schema.js'
const libraryId = crypto.randomUUID(),
	documentId = crypto.randomUUID()
function operation(
	field: string,
	value: unknown,
	parents: string[] = [],
	id = crypto.randomUUID()
) {
	return readerOperationSchema.parse({
		id,
		libraryId,
		documentId: field === 'position' ? documentId : null,
		field,
		value: JSON.stringify(value),
		parents: JSON.stringify(parents)
	})
}
const position = (offset: number, progress: number, interactedAt = '2026-11-05T12:00:00.000Z') => ({
	version: 1 as const,
	offset,
	quote: 'Reading',
	prefix: '',
	suffix: '',
	progress,
	interactedAt: new Date(interactedAt)
})
it('validates independent preference bounds and representation-scoped positions', () => {
	expect(isValidReaderChange({ documentId: null, field: 'size', value: 33 })).toBe(false)
	expect(isValidReaderChange({ documentId, field: 'size', value: 20 })).toBe(false)
	expect(isValidReaderChange({ documentId: null, field: 'theme', value: 'dark' })).toBe(true)
	expect(isValidReaderChange({ documentId, field: 'position', value: position(10, 0.5) })).toBe(
		true
	)
	expect(isValidReaderChange({ documentId, field: 'position', value: position(-1, 0.5) })).toBe(
		false
	)
	expect(isValidReaderChange({ documentId, field: 'position', value: position(1, 2) })).toBe(false)
})
it('keeps defaults and independent fields while resolving causal changes and concurrent ties deterministically', () => {
	const dark = operation('theme', 'dark'),
		light = operation('theme', 'light', [dark.id])
	const serif = operation('font', 'serif'),
		sans = operation('font', 'sans')
	const rows = [light, dark, serif, sans]
	const expected = serif.id.localeCompare(sans.id) > 0 ? 'serif' : 'sans'
	expect(projectReaderState(rows).preferences).toEqual({
		...defaultPreferences,
		theme: 'light',
		font: expected
	})
	expect(projectReaderState([...rows].reverse()).preferences).toEqual(
		projectReaderState(rows).preferences
	)
})
it('projects the Document resume location independently of its furthest progress', () => {
	const { progress: _progress, ...resumePosition } = position(10, 0.2)
	const state = projectReaderState([], [{ id: documentId, readingProgress: 0.8, resumePosition }])
	expect(state.positions[documentId]?.offset).toBe(10)
	expect(state.progress[documentId]).toBe(0.8)
	expect(state.positions[documentId]?.interactedAt).toBeInstanceOf(Date)
})
it('uses one bounded furthest-progress update for live and final position measurements', () => {
	const current = { [documentId]: 0.8, [libraryId]: 0.3 }
	const observed = position(10, 0.2)
	const reconciled = reconcilePositionProgress(current, documentId, observed)
	expect(reconciled.progress).toEqual(current)
	expect(reconciled.position).toEqual({ ...observed, progress: 0.8 })
	expect(advanceReadingProgress(0.2, 0.5)).toBe(0.5)
	expect(() => advanceReadingProgress(0.2, 1.01)).toThrow()
})
it('never reconstructs Document progress from preference history or another Document', () => {
	const otherId = crypto.randomUUID()
	const state = projectReaderState(
		[operation('theme', 'dark')],
		[
			{ id: documentId, readingProgress: 0.4, resumePosition: null },
			{ id: otherId, readingProgress: 0.9, resumePosition: null }
		]
	)
	expect(state.progress).toEqual({ [documentId]: 0.4, [otherId]: 0.9 })
	expect(state.positions).toEqual({})
})
