import { describe, expect, it } from 'vitest'
import { appTagSchema, tagFormSchema, tagArchiveSchema } from './tags.js'

const organizationId = '11111111-1111-4111-8111-111111111111'
const tagId = '22222222-2222-4222-8222-222222222222'

describe('tag validation', () => {
	it('trims names and defaults to uncategorized and active', () => {
		expect(appTagSchema.parse({ organizationId, kind: 'expense', name: '  Garden  ' })).toEqual({
			organizationId,
			name: 'Garden',
			kind: 'expense',
			categoryId: null,
			archivedAt: null
		})
	})
	it('preserves a category and archive date', () => {
		const archivedAt = new Date()
		expect(
			appTagSchema.parse({
				organizationId,
				kind: 'expense',
				name: 'Garden',
				categoryId: tagId,
				archivedAt
			})
		).toMatchObject({ categoryId: tagId, archivedAt })
	})
	it.each([
		{ name: ' ' },
		{ organizationId: '' },
		{ categoryId: '' },
		{ categoryId: 'bad' },
		{ archivedAt: '2026-10-13' }
	])('rejects invalid fields %j', (override) => {
		expect(
			appTagSchema.safeParse({ organizationId, kind: 'expense', name: 'Garden', ...override })
				.success
		).toBe(false)
	})
	it.each(['', null, undefined])('normalizes no category %j from the form', (categoryId) => {
		expect(tagFormSchema.parse({ name: '  Garden  ', kind: 'expense', categoryId })).toEqual({
			name: 'Garden',
			kind: 'expense',
			categoryId: null
		})
	})
	it('preserves a valid selected category and strips other fields', () => {
		expect(
			tagFormSchema.parse({
				name: 'Garden',
				kind: 'expense',
				categoryId: tagId,
				organizationId,
				archivedAt: new Date()
			})
		).toEqual({ name: 'Garden', kind: 'expense', categoryId: tagId })
	})
	it.each(['', ' ', '\n\t'])('rejects blank form names %j', (name) => {
		expect(tagFormSchema.safeParse({ name, kind: 'expense', categoryId: '' }).success).toBe(false)
	})
	it.each([undefined, null, '', 'bank'])('requires an explicit valid kind: %j', (kind) => {
		expect(appTagSchema.safeParse({ organizationId, name: 'Salary', kind }).success).toBe(false)
		expect(tagFormSchema.safeParse({ name: 'Salary', kind, categoryId: '' }).success).toBe(false)
	})
	it('accepts income without defaulting to expense', () => {
		expect(appTagSchema.parse({ organizationId, name: 'Salary', kind: 'income' }).kind).toBe(
			'income'
		)
	})
	it('accepts archive identifiers', () => {
		expect(tagArchiveSchema.parse({ organizationId, tagId })).toEqual({ organizationId, tagId })
	})
	it.each([
		{ organizationId: '' },
		{ tagId: '' },
		{ organizationId: undefined },
		{ tagId: undefined }
	])('rejects invalid archive identifiers %j', (override) => {
		expect(tagArchiveSchema.safeParse({ organizationId, tagId, ...override }).success).toBe(false)
	})
})
