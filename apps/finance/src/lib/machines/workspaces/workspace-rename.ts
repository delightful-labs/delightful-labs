import { ORGANIZATION_ROLE } from '#lib/domain/organization-role.js'
import type { AccountCurrency } from '#lib/domain/account-currency.js'
import type {
	FormCapability,
	FormChildEvent,
	FormObservation
} from '#lib/contracts/form-contract.js'
import type {
	WorkspaceRenameObservation,
	WorkspaceRenameReason,
	WorkspaceRenameScope
} from '#lib/contracts/workspace-rename-contract.js'
import { workspaceSettingsFormSchema } from '#lib/validation/identity.js'
import { createSingleWriteFormOptions } from '../forms/scoped-form-policy.js'
import {
	createWorkspaceNamingPersistence,
	type WorkspaceNamingPersistence
} from './workspace-naming-persistence.js'
import { setup, types } from 'xstate'
import type { SnapshotFrom } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'

type Values = { name: string; defaultCurrency: AccountCurrency }

export function workspaceRenameScope(facts: WorkspaceRenameObservation): WorkspaceRenameScope {
	return {
		identityId: facts.identityId,
		organizationId: facts.organizationId,
		binding: facts.binding
	}
}
export function sameWorkspaceRenameScope(
	currentScope: WorkspaceRenameScope,
	incomingScope: WorkspaceRenameScope
) {
	return (
		currentScope.identityId === incomingScope.identityId &&
		currentScope.organizationId === incomingScope.organizationId &&
		currentScope.binding === incomingScope.binding
	)
}

/** One domain policy chart, used for displayed availability and pre-write authorization. */
export function createWorkspaceRenameAvailability(binding: object) {
	const events0 = {
		INVALIDATE: types<EventPayload<FormChildEvent<WorkspaceRenameObservation>, 'INVALIDATE'>>(),
		CANCEL: types<EventPayload<FormChildEvent<WorkspaceRenameObservation>, 'CANCEL'>>(),
		SHUTDOWN: types<EventPayload<FormChildEvent<WorkspaceRenameObservation>, 'SHUTDOWN'>>(),
		OBSERVE: types<EventPayload<FormChildEvent<WorkspaceRenameObservation>, 'OBSERVE'>>()
	}
	type NativeEvent0 =
		| import('xstate').InferEvents<typeof events0>
		| import('xstate').DoneActorEvent<never>
		| import('xstate').ErrorActorEvent
	return setup({
		schemas: {
			context: types<{ observation: FormObservation<WorkspaceRenameObservation> }>(),
			events: events0,
			input: types<FormObservation<WorkspaceRenameObservation>>()
		}
	}).createMachine({
		id: 'workspace-rename-availability',
		initial: 'assessing',
		context: ({ input }) => ({ observation: input }),
		on: {
			OBSERVE: (args) => {
				return { target: '.assessing', context: { observation: args.event.observation } }
			}
		},
		states: {
			assessing: {
				always: (args) => {
					if (
						(({
							context: {
								observation: { facts }
							}
						}) => !facts.sessionReady || !facts.identityId || facts.binding !== binding)(args)
					) {
						return { target: 'sessionUnavailable' }
					}
					if (
						(({
							context: {
								observation: { facts }
							}
						}) => !facts.organizationId)(args)
					) {
						return { target: 'selectWorkspace' }
					}
					if (
						(({
							context: {
								observation: { facts }
							}
						}) => facts.workspaceError || facts.membershipError)(args)
					) {
						return { target: 'loadFailed' }
					}
					if (
						(({
							context: {
								observation: { facts }
							}
						}) => facts.workspaceLoading || facts.membershipLoading)(args)
					) {
						return { target: 'loading' }
					}
					if (
						(({
							context: {
								observation: { facts }
							}
						}) => facts.workspace?.id !== facts.organizationId)(args)
					) {
						return { target: 'workspaceUnavailable' }
					}
					if (
						(({
							context: {
								observation: { facts }
							}
						}) =>
							facts.membership?.userId !== facts.identityId ||
							facts.membership?.organizationId !== facts.organizationId ||
							(facts.membership?.role !== ORGANIZATION_ROLE.OWNER &&
								facts.membership?.role !== ORGANIZATION_ROLE.ADMIN))(args)
					) {
						return { target: 'readOnly' }
					}
					return { target: 'ready' }
				}
			},
			sessionUnavailable: {},
			selectWorkspace: {},
			loadFailed: {},
			loading: {},
			workspaceUnavailable: {},
			readOnly: {},
			ready: {}
		}
	})
}
export function selectWorkspaceRenameAvailability(
	snapshot: SnapshotFrom<ReturnType<typeof createWorkspaceRenameAvailability>>
): FormCapability<WorkspaceRenameScope, WorkspaceRenameReason> {
	const { revision, facts } = snapshot.context.observation
	const state = snapshot.value
	if (state === 'assessing') throw new Error('Workspace readiness has not been assessed')
	return {
		revision,
		scope: workspaceRenameScope(facts),
		readiness: state === 'ready' ? { kind: 'ready' } : { kind: 'blocked', reason: state }
	}
}

export function createWorkspaceRenameFormOptions<Write>(
	dependencies: {
		binding: object
		observe: () => WorkspaceRenameObservation
	} & WorkspaceNamingPersistence<Write>
) {
	const availability = createWorkspaceRenameAvailability(dependencies.binding)
	const persistence = createWorkspaceNamingPersistence(dependencies)
	return createSingleWriteFormOptions<
		Values,
		void,
		WorkspaceRenameReason,
		WorkspaceRenameScope,
		WorkspaceRenameObservation,
		SnapshotFrom<typeof availability>,
		SnapshotFrom<typeof persistence>
	>({
		schema: workspaceSettingsFormSchema,
		mode: 'edit',
		initialValues: (facts: WorkspaceRenameObservation): Values => ({
			name: facts.workspace?.name ?? '',
			defaultCurrency: facts.workspace?.defaultCurrency === 'TZS' ? 'TZS' : 'USD'
		}),
		valuesEqual: (draft: unknown, initial: Values) =>
			typeof draft === 'object' &&
			draft !== null &&
			'name' in draft &&
			typeof draft.name === 'string' &&
			draft.name.trim() === initial.name &&
			'defaultCurrency' in draft &&
			draft.defaultCurrency === initial.defaultCurrency,

		availability,
		selectAvailability: selectWorkspaceRenameAvailability,
		scopeOf: workspaceRenameScope,
		sameScope: sameWorkspaceRenameScope,
		observe: dependencies.observe,
		classifyBlocked: (reason) => (reason === 'readOnly' ? 'denied' : 'unavailable'),
		successContent: 'retain',
		persistence
	})
}
