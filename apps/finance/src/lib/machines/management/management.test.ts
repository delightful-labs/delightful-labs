import { tagFormSchema } from '#lib/validation/tags.js'
import { categoryFormSchema } from '#lib/validation/categories.js'
import { describe, expect, it, vi } from 'vitest'
import type { ManagementObservation, ManagementReason } from '#lib/contracts/management-contract.js'
import {
	createManagementAvailability,
	managementScope,
	sameManagementScope,
	selectManagementArchiveIds,
	selectManagementAvailability,
	createManagementFormOptions
} from './management.js'
import { createScopedFormWriteMachine } from '../forms/scoped-form-write.js'
import { createActor, waitFor, initialTransition } from 'xstate'

const binding = {}
const category = {
	id: 'category',
	organizationId: 'org',
	name: 'Food',
	kind: 'expense',
	isSystem: false,
	archivedAt: null
} satisfies ManagementObservation['categories'][number]
const tag = {
	id: 'tag',
	organizationId: 'org',
	name: 'Groceries',
	kind: 'expense',
	categoryId: 'category',
	archivedAt: null
} satisfies ManagementObservation['tags'][number]
function facts(): ManagementObservation {
	return {
		binding,
		identityId: 'user',
		organizationId: 'org',
		sessionReady: true,
		loading: false,
		failed: false,
		membership: {
			id: 'member',
			userId: 'user',
			organizationId: 'org',
			role: 'owner',
			accountAccessMode: 'all',
			profileId: null
		},
		categories: [category],
		tags: [tag]
	}
}
function policy(f: ManagementObservation) {
	return selectManagementAvailability(
		initialTransition(createManagementAvailability(binding), { revision: 4, facts: f })[0]
	).readiness
}
describe('category/tag policy', () => {
	it.each([
		[{ sessionReady: false }, 'sessionUnavailable'],
		[{ binding: {} }, 'sessionUnavailable'],
		[{ identityId: null }, 'sessionUnavailable'],
		[{ organizationId: null }, 'selectWorkspace'],
		[{ failed: true, loading: true }, 'loadFailed'],
		[{ loading: true }, 'loading'],
		[{ membership: null }, 'readOnly'],
		[
			{ intent: { kind: 'archiveCategory', id: 'missing', organizationId: 'org' } },
			'unavailableReference'
		],
		[
			{ intent: { kind: 'archiveTag', id: 'tag', organizationId: 'other' } },
			'unavailableReference'
		],
		[
			{ intent: { kind: 'createTag', name: 'New tag', tagKind: 'expense', categoryId: 'missing' } },
			'unavailableReference'
		],
		[
			{
				categories: [{ ...category, isSystem: true }],
				intent: { kind: 'archiveCategory', id: 'category', organizationId: 'org' }
			},
			'protectedRecord'
		]
	] satisfies [Partial<ManagementObservation>, ManagementReason][])(
		'classifies %j',
		(patch, reason) => expect(policy({ ...facts(), ...patch })).toEqual({ kind: 'blocked', reason })
	)
	it.each(['owner', 'admin', 'member', 'viewer'] satisfies NonNullable<
		ManagementObservation['membership']
	>['role'][])('preserves %s editing permissions', (role) => {
		const f = facts()
		if (!f.membership) throw new Error('fixture')
		f.membership = { ...f.membership, role }
		expect(policy(f).kind).toBe(role === 'viewer' ? 'blocked' : 'ready')
	})
	it('rejects mismatched membership identities and archived references', () => {
		const f = facts()
		if (!f.membership) throw new Error('fixture')
		expect(policy({ ...f, membership: { ...f.membership, userId: 'other' } })).toEqual({
			kind: 'blocked',
			reason: 'readOnly'
		})
		expect(
			policy({
				...f,
				categories: [{ ...category, archivedAt: new Date() }],
				intent: { kind: 'createTag', name: 'New tag', tagKind: 'expense', categoryId: category.id }
			})
		).toEqual({ kind: 'blocked', reason: 'unavailableReference' })
		expect(
			policy({
				...f,
				intent: { kind: 'createTag', name: 'New tag', tagKind: 'expense', categoryId: null }
			})
		).toEqual({
			kind: 'ready'
		})
	})
	it.each(['category', 'tag'])(
		'compares normalized active %s names within organization and kind',
		(entity) => {
			const f = facts()
			const intent: NonNullable<ManagementObservation['intent']> =
				entity === 'category'
					? { kind: 'createCategory', name: ' FOOD ', categoryKind: 'expense' }
					: { kind: 'createTag', name: ' GROCERIES ', tagKind: 'expense', categoryId: null }
			expect(policy({ ...f, intent })).toEqual({ kind: 'blocked', reason: 'duplicateName' })
			const outside =
				entity === 'category'
					? { categories: [{ ...category, organizationId: 'other' }] }
					: { tags: [{ ...tag, organizationId: 'other' }] }
			const archived =
				entity === 'category'
					? { categories: [{ ...category, archivedAt: new Date() }] }
					: { tags: [{ ...tag, archivedAt: new Date() }] }
			const otherKind =
				entity === 'category'
					? {
							categories: [
								{ ...category, kind: 'income' }
							] satisfies ManagementObservation['categories']
						}
					: { tags: [{ ...tag, kind: 'income' }] satisfies ManagementObservation['tags'] }
			for (const patch of [outside, archived, otherKind])
				expect(policy({ ...f, ...patch, intent })).toEqual({ kind: 'ready' })
		}
	)
	it('rejects an active but mismatched-kind tag category', () => {
		expect(
			policy({
				...facts(),
				intent: { kind: 'createTag', name: 'Salary', tagKind: 'income', categoryId: category.id }
			})
		).toEqual({ kind: 'blocked', reason: 'unavailableReference' })
	})
	it('does not reserve names for archived typed tags', () => {
		expect(
			policy({
				...facts(),
				tags: [{ ...tag, archivedAt: new Date() }],
				intent: { kind: 'createTag', name: tag.name, tagKind: 'expense', categoryId: null }
			})
		).toEqual({ kind: 'ready' })
	})
	it.each(['category', 'tag'])(
		'blocks a %s duplicate that appears after the form observation',
		async (entity) => {
			const initial = { ...facts(), categories: [], tags: [] }
			const write = vi.fn(async () => 'saved')
			const formOptions = createManagementFormOptions({ binding, observe: facts })
			const options =
				entity === 'category'
					? formOptions({
							schema: categoryFormSchema,
							successContent: 'replace',
							write,
							assessmentObservation: ({ request, observation }) => ({
								...observation.facts,
								intent: {
									kind: 'createCategory',
									name: request.values.name,
									categoryKind: request.values.kind
								}
							})
						})
					: formOptions({
							schema: tagFormSchema,
							successContent: 'replace',
							write,
							assessmentObservation: ({ request, observation }) => ({
								...observation.facts,
								intent: {
									kind: 'createTag',
									name: request.values.name,
									tagKind: request.values.kind,
									categoryId: request.values.categoryId
								}
							})
						})
			// Both schemas accept the same shape here; category strips categoryId.
			const actor = createActor(options.operation, {
				input: {
					request: {
						id: 1,
						scope: managementScope(initial),
						scopeRevision: 0,
						values: {
							name: entity === 'category' ? ' food ' : ' groceries ',
							kind: 'expense',
							categoryId: null
						}
					},
					observation: { revision: 0, facts: initial }
				}
			}).start()
			try {
				await waitFor(actor, (snapshot) => snapshot.status === 'done')
				expect(actor.getSnapshot().output).toMatchObject({
					outcome: 'unavailable',
					reason: 'duplicateName',
					settlement: 'notStarted'
				})
				expect(write).not.toHaveBeenCalled()
			} finally {
				actor.stop()
			}
		}
	)
	it('projects archive row capabilities through the same assessment', () => {
		const f = facts()
		f.categories = [
			category,
			{ ...category, id: 'system', isSystem: true },
			{ ...category, id: 'archived', archivedAt: new Date() }
		]
		expect(selectManagementArchiveIds(f, binding, 'archiveCategory')).toEqual(['category'])
		expect(selectManagementArchiveIds(f, binding, 'archiveTag')).toEqual(['tag'])
	})
	it('assesses exact fresh request target before effect and settles an issued archive on shutdown', async () => {
		let current = facts()
		const write = vi.fn(async () => 'Food')
		const availability = createManagementAvailability(binding)
		const machine = createScopedFormWriteMachine<
			{ id: string },
			string,
			ManagementReason,
			ReturnType<typeof managementScope>,
			ManagementObservation,
			ReturnType<typeof availability.getInitialSnapshot>
		>({
			availability,
			selectAvailability: selectManagementAvailability,
			scopeOf: managementScope,
			sameScope: sameManagementScope,
			observe: () => current,
			classifyBlocked: (r) =>
				r === 'protectedRecord' || r === 'readOnly' ? 'denied' : 'unavailable',
			assessmentObservation: ({ request, observation }) => ({
				...observation.facts,
				intent: { kind: 'archiveCategory', id: request.values.id, organizationId: 'org' }
			}),
			write,
			settlement: 'locallyPersisted'
		})
		const input = {
			request: {
				id: 1,
				scope: managementScope(current),
				scopeRevision: 0,
				values: { id: 'category' }
			},
			observation: { revision: 0, facts: current }
		}
		current = { ...current, categories: [{ ...category, isSystem: true }] }
		const denied = createActor(machine, { input }).start()
		await waitFor(denied, (s) => s.status === 'done')
		expect(denied.getSnapshot().output).toMatchObject({
			outcome: 'denied',
			reason: 'protectedRecord'
		})
		expect(write).not.toHaveBeenCalled()
		denied.stop()
		current = facts()
		const saved = Promise.withResolvers<string>()
		write.mockImplementation(() => saved.promise)
		const active = createActor(machine, { input }).start()
		await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1))
		active.send({ type: 'SHUTDOWN' })
		expect(active.getSnapshot().status).toBe('active')
		saved.resolve('Food')
		await waitFor(active, (s) => s.status === 'done')
		expect(active.getSnapshot().output).toEqual({
			outcome: 'closed',
			settlement: 'locallyPersisted'
		})
		active.stop()
	})
})
