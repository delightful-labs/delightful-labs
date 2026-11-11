import { types, setup, type SnapshotFrom, type Snapshot } from 'xstate'

import type { EventPayload } from '../../contracts/machine-events.js'
import type { ProfileObservation, ProfileReason, ProfileScope } from '../../contracts/profile.js'
import type {
	FormCapability,
	FormChildEvent,
	FormObservation,
	FormSchema
} from '../../contracts/scoped-form.js'
import {
	createProfileAvatarMachine,
	type ProfileImageLogic,
	type ProfileImageResult,
	type ProfileAvatarDraft,
	type ProfileAvatarValues
} from './profile-avatar.js'
import type { ScopedFormOptions } from '../forms/scoped-form.js'
import { createProfilePersistenceMachine } from './profile-persistence.js'
import { createSingleWriteFormOptions } from '../forms/policy.js'
export { profileScope, sameProfileScope } from '../../contracts/profile.js'
import { profileScope, sameProfileScope } from '../../contracts/profile.js'
export function createProfileAvailability(binding: object) {
	return setup({
		schemas: {
			context: types<{
				observation: FormObservation<ProfileObservation>
			}>(),
			events: {
				CANCEL: types<EventPayload<FormChildEvent<ProfileObservation>, 'CANCEL'>>(),
				SHUTDOWN: types<EventPayload<FormChildEvent<ProfileObservation>, 'SHUTDOWN'>>(),
				INVALIDATE: types<EventPayload<FormChildEvent<ProfileObservation>, 'INVALIDATE'>>(),
				OBSERVE: types<EventPayload<FormChildEvent<ProfileObservation>, 'OBSERVE'>>()
			},
			input: types<FormObservation<ProfileObservation>>()
		}
	}).createMachine({
		initial: 'checking',
		context: ({ input }) => ({ observation: input }),
		on: {
			OBSERVE: (args) => {
				return {
					target: '.checking',
					context: { observation: args.event.observation } satisfies Partial<{
						observation: FormObservation<ProfileObservation>
					}>
				}
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
						}) => !f.profile || f.profile.userId !== f.identityId)(args)
					) {
						return { target: 'profileUnavailable' }
					}
					return { target: 'ready' }
				}
			},
			sessionUnavailable: {},
			loadFailed: {},
			loading: {},
			profileUnavailable: {},
			ready: {}
		}
	})
}
export function selectProfileAvailability(
	s: SnapshotFrom<ReturnType<typeof createProfileAvailability>>
): FormCapability<ProfileScope, ProfileReason> {
	const { revision, facts } = s.context.observation
	const state = s.value
	return {
		revision,
		scope: profileScope(facts),
		readiness:
			state === 'ready'
				? { kind: 'ready' }
				: { kind: 'blocked', reason: state === 'checking' ? 'loading' : state }
	}
}
type NameValues = {
	displayName: string | null
}
export function createProfileFormOptions<
	ProcessSnapshot extends Snapshot<ProfileImageResult>,
	NameSchema extends FormSchema<NameValues>,
	AvatarSchema extends FormSchema<ProfileAvatarDraft>,
	ValueSchema extends FormSchema<ProfileAvatarValues>
>(deps: {
	binding: object
	observe: () => ProfileObservation
	nameSchema: NameSchema
	avatarSchema: AvatarSchema
	avatarValuesSchema: ValueSchema
	mimeType: (value: unknown) => 'image/png' | 'image/jpeg' | 'image/webp'
	processImage: ProfileImageLogic<ProcessSnapshot>
	validateBytes: (input: { bytes: Uint8Array; mimeType: string }) =>
		| {
				success: true
				data: ProfileAvatarValues
		  }
		| {
				success: false
		  }
	/** Applies to both save callbacks; hosts await the backend's persistence receipt before resolving. */
	saveSettlement: 'locallyPersisted' | 'confirmed'
	saveName: (id: string, user: string, name: string | null) => Promise<unknown>
	saveAvatar: (id: string, user: string, values: ProfileAvatarValues) => Promise<unknown>
}) {
	const availability = createProfileAvailability(deps.binding)
	const common = {
		availability,
		selectAvailability: selectProfileAvailability,
		scopeOf: profileScope,
		sameScope: sameProfileScope,
		observe: deps.observe,
		settlement: deps.saveSettlement,
		classifyBlocked: (): 'unavailable' => 'unavailable'
	}
	const namePersistence = createProfilePersistenceMachine<NameValues>({
		settlement: deps.saveSettlement,
		save: (id, user, values) => deps.saveName(id, user, values.displayName ?? null)
	})
	const avatarPersistence = createProfilePersistenceMachine<ProfileAvatarValues>({
		settlement: deps.saveSettlement,
		save: deps.saveAvatar
	})
	const name = createSingleWriteFormOptions<
		NameValues,
		void,
		ProfileReason,
		ProfileScope,
		ProfileObservation,
		SnapshotFrom<typeof availability>,
		SnapshotFrom<typeof namePersistence>,
		NameSchema
	>({
		...common,
		successContent: 'retain',
		schema: deps.nameSchema,
		mode: 'edit',
		initialValues: (f) => ({ displayName: f.profile?.displayName ?? null }),
		valuesEqual: (draft, initial) =>
			typeof draft === 'object' &&
			draft !== null &&
			'displayName' in draft &&
			typeof draft.displayName === 'string' &&
			(draft.displayName.trim() || null) === (initial.displayName ?? null),
		persistence: namePersistence
	})
	const avatarWrite = createSingleWriteFormOptions<
		ProfileAvatarValues,
		void,
		ProfileReason,
		ProfileScope,
		ProfileObservation,
		SnapshotFrom<typeof availability>,
		SnapshotFrom<typeof avatarPersistence>,
		ValueSchema
	>({
		...common,
		schema: deps.avatarValuesSchema,
		persistence: avatarPersistence
	})
	const avatarOperation = createProfileAvatarMachine({
		processImage: deps.processImage,
		validateBytes: deps.validateBytes,
		write: avatarWrite.operation,
		scopeOf: profileScope,
		sameScope: sameProfileScope
	})
	const avatar = {
		...common,
		successContent: 'retain',
		schema: deps.avatarSchema,
		operation: avatarOperation,
		resetOnSuccess: true,
		mode: 'edit',
		initialValues: (f) =>
			f.profile?.avatarData
				? {
						action: 'upload',
						file: new File([Uint8Array.from(f.profile.avatarData)], 'avatar', {
							type: deps.mimeType(f.profile.avatarMimeType)
						})
					}
				: { action: 'remove' },
		valuesEqual: (draft, initial) =>
			!(
				typeof draft === 'object' &&
				draft !== null &&
				'action' in draft &&
				((draft.action === 'upload' &&
					'file' in draft &&
					draft.file instanceof File &&
					draft.file.size > 0) ||
					(draft.action === 'remove' && initial.action === 'upload'))
			)
	} satisfies ScopedFormOptions<
		ProfileAvatarDraft,
		void,
		ProfileReason,
		ProfileScope,
		ProfileObservation,
		SnapshotFrom<typeof availability>,
		SnapshotFrom<typeof avatarOperation>
	>
	return { name, avatar }
}
