import { normalizedName } from '#lib/domain/names.js'
import type { z } from 'zod'
import { createSingleWriteFormOptions } from '../forms/scoped-form-policy.js'
import type {
	FormOperationInput,
	FormCapability,
	FormChildEvent,
	FormObservation
} from '#lib/contracts/form-contract.js'
import type {
	ManagementObservation,
	ManagementReason,
	ManagementScope
} from '#lib/contracts/management-contract.js'
import { canEditCategoriesAndTags } from '#lib/domain/organization-permissions.js'
import { setup, types, initialTransition } from 'xstate'
import type { SnapshotFrom } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'

export function managementScope(facts: ManagementObservation): ManagementScope {
	return {
		identityId: facts.identityId,
		organizationId: facts.organizationId,
		binding: facts.binding
	}
}
export function sameManagementScope(a: ManagementScope, b: ManagementScope) {
	return (
		a.identityId === b.identityId &&
		a.organizationId === b.organizationId &&
		a.binding === b.binding
	)
}
export function createManagementAvailability(binding: object) {
	const events0 = {
		INVALIDATE: types<EventPayload<FormChildEvent<ManagementObservation>, 'INVALIDATE'>>(),
		CANCEL: types<EventPayload<FormChildEvent<ManagementObservation>, 'CANCEL'>>(),
		SHUTDOWN: types<EventPayload<FormChildEvent<ManagementObservation>, 'SHUTDOWN'>>(),
		OBSERVE: types<EventPayload<FormChildEvent<ManagementObservation>, 'OBSERVE'>>()
	}
	type NativeEvent0 =
		| import('xstate').InferEvents<typeof events0>
		| import('xstate').DoneActorEvent<never>
		| import('xstate').ErrorActorEvent
	return setup({
		schemas: {
			context: types<{ observation: FormObservation<ManagementObservation> }>(),
			events: events0,
			input: types<FormObservation<ManagementObservation>>()
		}
	}).createMachine({
		initial: 'checking',
		context: ({ input }) => ({ observation: input }),
		on: {
			OBSERVE: (args) => {
				return { target: '.checking', context: { observation: args.event.observation } }
			}
		},
		states: {
			checking: {
				always: (args) => {
					if (
						(({
							context: {
								observation: { facts: f }
							}
						}) => !f.sessionReady || !f.identityId || f.binding !== binding)(args)
					) {
						return { target: 'sessionUnavailable' }
					}
					if (
						(({
							context: {
								observation: { facts: f }
							}
						}) => !f.organizationId)(args)
					) {
						return { target: 'selectWorkspace' }
					}
					if (
						(({
							context: {
								observation: { facts: f }
							}
						}) => f.failed)(args)
					) {
						return { target: 'loadFailed' }
					}
					if (
						(({
							context: {
								observation: { facts: f }
							}
						}) => f.loading)(args)
					) {
						return { target: 'loading' }
					}
					if (
						(({
							context: {
								observation: { facts: f }
							}
						}) =>
							f.membership?.userId !== f.identityId ||
							!canEditCategoriesAndTags(f.membership, f.organizationId))(args)
					) {
						return { target: 'readOnly' }
					}
					if (
						(({
							context: {
								observation: { facts: f }
							}
						}) =>
							f.intent?.kind === 'archiveCategory' &&
							f.categories.some(
								(c) =>
									c.id === archiveIntentId(f) && c.organizationId === f.organizationId && c.isSystem
							))(args)
					) {
						return { target: 'protectedRecord' }
					}
					if (
						(({
							context: {
								observation: { facts: f }
							}
						}) =>
							f.intent?.kind === 'archiveCategory' &&
							(f.intent.organizationId !== f.organizationId ||
								!f.categories.some(
									(c) =>
										c.id === archiveIntentId(f) &&
										c.organizationId === f.organizationId &&
										c.archivedAt === null
								)))(args)
					) {
						return { target: 'unavailableReference' }
					}
					if (
						(({
							context: {
								observation: { facts: f }
							}
						}) =>
							f.intent?.kind === 'archiveTag' &&
							(f.intent.organizationId !== f.organizationId ||
								!f.tags.some(
									(t) =>
										t.id === archiveIntentId(f) &&
										t.organizationId === f.organizationId &&
										t.archivedAt === null
								)))(args)
					) {
						return { target: 'unavailableReference' }
					}
					if (
						(({
							context: {
								observation: { facts: f }
							}
						}) => {
							const intent = f.intent
							return (
								intent?.kind === 'createTag' &&
								intent.categoryId !== null &&
								!f.categories.some(
									(category) =>
										category.id === intent.categoryId &&
										category.organizationId === f.organizationId &&
										category.kind === intent.tagKind &&
										category.archivedAt === null
								)
							)
						})(args)
					) {
						return { target: 'unavailableReference' }
					}
					if (
						(({
							context: {
								observation: { facts: f }
							}
						}) => {
							const intent = f.intent
							return (
								intent?.kind === 'createTag' &&
								f.tags.some(
									(tag) =>
										tag.organizationId === f.organizationId &&
										tag.kind === intent.tagKind &&
										tag.archivedAt === null &&
										normalizedName(tag.name) === normalizedName(intent.name)
								)
							)
						})(args)
					) {
						return { target: 'duplicateName' }
					}
					if (
						(({
							context: {
								observation: { facts: f }
							}
						}) => {
							const intent = f.intent
							return (
								intent?.kind === 'createCategory' &&
								f.categories.some(
									(category) =>
										category.organizationId === f.organizationId &&
										category.archivedAt === null &&
										category.kind === intent.categoryKind &&
										normalizedName(category.name) === normalizedName(intent.name)
								)
							)
						})(args)
					) {
						return { target: 'duplicateName' }
					}
					return { target: 'ready' }
				}
			},
			sessionUnavailable: {},
			selectWorkspace: {},
			loadFailed: {},
			loading: {},
			readOnly: {},
			protectedRecord: {},
			unavailableReference: {},
			duplicateName: {},
			ready: {}
		}
	})
}
export function selectManagementAvailability(
	snapshot: SnapshotFrom<ReturnType<typeof createManagementAvailability>>
): FormCapability<ManagementScope, ManagementReason> {
	const { revision, facts } = snapshot.context.observation
	const state = snapshot.value
	if (state === 'checking') throw new Error('Unassessed management policy')
	return {
		revision,
		scope: managementScope(facts),
		readiness: state === 'ready' ? { kind: 'ready' } : { kind: 'blocked', reason: state }
	}
}
/** Uses exactly the same policy for each row as the pre-write assessment. */
export function selectManagementArchiveIds(
	facts: ManagementObservation,
	binding: object,
	kind: 'archiveCategory' | 'archiveTag'
) {
	// Pure projection of the same guards through a resource-free chart.
	const machine = createManagementAvailability(binding)
	return (kind === 'archiveCategory' ? facts.categories : facts.tags)
		.filter((row) => {
			const snapshot = selectManagementAvailability(
				initialTransition(machine, {
					revision: 0,
					facts: { ...facts, intent: { kind, id: row.id, organizationId: row.organizationId } }
				})[0]
			)
			return snapshot.readiness.kind === 'ready'
		})
		.map((row) => row.id)
}

function archiveIntentId(f: ManagementObservation) {
	return f.intent?.kind === 'archiveCategory' || f.intent?.kind === 'archiveTag'
		? f.intent.id
		: undefined
}

/** Shared management policy binding; integrations supply each form's unique write and intent. */
export function createManagementFormOptions(dependencies: {
	binding: object
	observe: () => ManagementObservation
}) {
	const availability = createManagementAvailability(dependencies.binding)
	return function formOptions<Values, Result>(options: {
		schema: z.ZodType<Values>
		successContent: 'retain' | 'replace'
		assessmentObservation?: (
			input: FormOperationInput<Values, ManagementScope, ManagementObservation>
		) => ManagementObservation
		write: (
			input: FormOperationInput<Values, ManagementScope, ManagementObservation>
		) => Promise<Result>
	}) {
		return createSingleWriteFormOptions<
			Values,
			Result,
			ManagementReason,
			ManagementScope,
			ManagementObservation,
			SnapshotFrom<typeof availability>
		>({
			...options,
			mode: 'create',
			availability,
			selectAvailability: selectManagementAvailability,
			scopeOf: managementScope,
			sameScope: sameManagementScope,
			observe: dependencies.observe,
			classifyBlocked: (reason) =>
				reason === 'readOnly' || reason === 'protectedRecord' ? 'denied' : 'unavailable'
		})
	}
}
