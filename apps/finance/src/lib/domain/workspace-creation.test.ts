import { afterEach, describe, expect, it, vi } from 'vitest'
import { prepareWorkspaceCreation } from './workspace-creation.js'
import { m } from '../paraglide/messages.js'
import { workspaceCreationAttemptSchema, workspaceNameFormSchema } from '../validation/identity.js'

const input = {
	organizationId: '33333333-3333-4333-8333-333333333333',
	userId: '11111111-1111-4111-8111-111111111111',
	profileId: '22222222-2222-4222-8222-222222222222',
	name: '  Household  '
}
afterEach(() => vi.restoreAllMocks())

describe('workspace creation payload', () => {
	it('preserves the historical starter category UUIDs', async () => {
		const attempt = await prepareWorkspaceCreation({
			...input,
			organizationId: '22222222-2222-4222-8222-222222222222'
		})
		expect(attempt.categories.map(({ id }) => id)).toEqual([
			'9fd2bcfc-cdb4-5276-9fcb-b999077a3109',
			'192c1d03-fa80-53bd-a950-91db19bfebbe',
			'd5ea5f9c-6f10-56e9-a544-617ff479d553',
			'13bc316a-627a-518a-81a8-756454fae082',
			'65dcd338-f3cb-5e39-a4d1-5d0700b09f3c',
			'558276d3-f47e-58dc-b3c0-d2a4d09cb2dd',
			'2ba045d6-cd27-55db-8962-a5b9d1ed2af0',
			'be552916-de7d-5238-b7f9-1819cd54102c'
		])
	})
	it('keeps attempt and seed identities stable across retries and label changes', async () => {
		const first = await prepareWorkspaceCreation(input)
		const revisedLabel = m['labels.subject_name']({ subject: m['nouns.workspace']({ count: 1 }) })
		vi.spyOn(m, 'defaults.categories.groceries').mockReturnValue(revisedLabel)
		const translated = await prepareWorkspaceCreation(input)
		expect(translated.workspace.name).toBe('Household')
		expect(translated.membershipId).toBe(first.membershipId)
		expect(translated.categories.map((category) => category.id)).toEqual(
			first.categories.map((category) => category.id)
		)
		expect(translated.categories.some((category) => category.name === revisedLabel)).toBe(true)
		expect(first.categories.some((category) => category.name === revisedLabel)).toBe(false)
		expect(first.profileId).toBe(input.profileId)
	})
	it('gives same-named workspaces separate membership and category identities', async () => {
		const first = await prepareWorkspaceCreation(input)
		const second = await prepareWorkspaceCreation({
			...input,
			organizationId: '77777777-7777-4777-8777-777777777777'
		})
		expect(first.workspace.name).toBe(second.workspace.name)
		expect(first.membershipId).not.toBe(second.membershipId)
		const existingIds = new Set(first.categories.map((category) => category.id))
		expect(second.categories.every((category) => !existingIds.has(category.id))).toBe(true)
	})
	it('requires exactly one system category per kind and unique seed IDs', async () => {
		const attempt = await prepareWorkspaceCreation(input)
		expect(workspaceCreationAttemptSchema.safeParse({ ...attempt, categories: [] }).success).toBe(
			false
		)
		expect(
			workspaceCreationAttemptSchema.safeParse({
				...attempt,
				categories: [...attempt.categories, ...attempt.categories]
			}).success
		).toBe(false)
		expect(
			attempt.categories
				.filter((category) => category.isSystem)
				.map((category) => category.kind)
				.sort()
		).toEqual(['expense', 'income'])
	})
	it('preserves rename adapter stripping while rejecting blank creation names', async () => {
		expect(workspaceNameFormSchema.parse({ name: ' Office ', unrelated: 'ignored' })).toEqual({
			name: 'Office'
		})
		await expect(prepareWorkspaceCreation({ ...input, name: ' ' })).rejects.toThrow()
	})
})
