import { describe, expect, it } from 'vitest'
import { appCategorySchema, categoryFormSchema, categoryArchiveSchema } from './categories.js'

const organizationId = '11111111-1111-4111-8111-111111111111'
const categoryId = '22222222-2222-4222-8222-222222222222'

describe('category validation', () => {
	it.each(['expense', 'income'])(
		'normalizes %s categories and defaults to non-system and active',
		(kind) => {
			expect(appCategorySchema.parse({ organizationId, name: '  Food  ', kind })).toEqual({
				organizationId,
				name: 'Food',
				kind,
				isSystem: false,
				archivedAt: null
			})
		}
	)
	it.each([
		{ name: ' ' },
		{ organizationId: '' },
		{ kind: 'transfer' },
		{ archivedAt: '2026-10-13' },
		{ isSystem: 'false' }
	])('rejects invalid fields %j', (override) => {
		expect(
			appCategorySchema.safeParse({ organizationId, name: 'Food', kind: 'expense', ...override })
				.success
		).toBe(false)
	})
	it('preserves system identity and archive timestamps', () => {
		const archivedAt = new Date()
		expect(
			appCategorySchema.parse({
				organizationId,
				name: 'Uncategorized',
				kind: 'income',
				isSystem: true,
				archivedAt
			})
		).toMatchObject({ isSystem: true, archivedAt })
	})
	it('strips fields outside the form to prevent submitting system or workspace identity', () => {
		expect(
			categoryFormSchema.parse({
				name: '  Food  ',
				kind: 'expense',
				organizationId,
				isSystem: true
			})
		).toEqual({ name: 'Food', kind: 'expense' })
	})
	it.each(['', ' ', '\n\t'])('rejects blank form names %j', (name) => {
		expect(categoryFormSchema.safeParse({ name, kind: 'income' }).success).toBe(false)
	})
	it('requires the form transaction kind', () => {
		expect(categoryFormSchema.safeParse({ name: 'Food' }).success).toBe(false)
	})
	it('accepts valid archive identifiers', () => {
		expect(categoryArchiveSchema.parse({ categoryId, organizationId })).toEqual({
			categoryId,
			organizationId
		})
	})
	it.each([
		{ categoryId: '' },
		{ organizationId: '' },
		{ categoryId: undefined },
		{ organizationId: undefined }
	])('rejects invalid archive identifiers %j', (override) => {
		expect(
			categoryArchiveSchema.safeParse({ categoryId, organizationId, ...override }).success
		).toBe(false)
	})
})
