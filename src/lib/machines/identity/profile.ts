import { assign, setup, type SnapshotFrom, type Snapshot } from 'xstate'
import type { ProfileObservation, ProfileReason, ProfileScope } from '../../contracts/profile.js'
import type {
	FormCapability,
	FormChildEvent,
	FormObservation,
	FormSchema,
	FormOperationResult
} from '../../contracts/scoped-form.js'
import {
	createProfileAvatarMachine,
	type ProfileImageLogic,
	type ProfileImageResult,
	type ProfileAvatarDraft,
	type ProfileAvatarValues
} from './profile-avatar.js'
import type { ScopedFormOptions } from '../forms/scoped-form.js'
import { createSingleWriteFormOptions } from '../forms/policy.js'
export function profileScope(f: ProfileObservation): ProfileScope {
	return { identityId: f.identityId, profileId: f.profile?.id ?? null, binding: f.binding }
}
export function sameProfileScope(a: ProfileScope, b: ProfileScope) {
	return a.identityId === b.identityId && a.profileId === b.profileId && a.binding === b.binding
}
export function createProfileAvailability(binding: object) {
	return setup<
		{ observation: FormObservation<ProfileObservation> },
		FormChildEvent<ProfileObservation>,
		{},
		{},
		{},
		{},
		never,
		string,
		FormObservation<ProfileObservation>
	>({}).createMachine({
		initial: 'checking',
		context: ({ input }) => ({ observation: input }),
		on: {
			OBSERVE: {
				target: '.checking',
				actions: assign({ observation: ({ event }) => event.observation })
			}
		},
		states: {
			checking: {
				always: [
					{
						guard: ({
							context: {
								observation: { facts: f }
							}
						}) => !f.sessionReady || !f.identityId || f.binding !== binding,
						target: 'sessionUnavailable'
					},
					{
						guard: ({
							context: {
								observation: { facts: f }
							}
						}) => f.failed,
						target: 'loadFailed'
					},
					{
						guard: ({
							context: {
								observation: { facts: f }
							}
						}) => f.loading,
						target: 'loading'
					},
					{
						guard: ({
							context: {
								observation: { facts: f }
							}
						}) => !f.profile || f.profile.userId !== f.identityId,
						target: 'profileUnavailable'
					},
					{ target: 'ready' }
				]
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
	if (state === 'checking') throw new Error('Unassessed profile')
	return {
		revision,
		scope: profileScope(facts),
		readiness: state === 'ready' ? { kind: 'ready' } : { kind: 'blocked', reason: state }
	}
}
type NameValues = { displayName: string | null }
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
	validateBytes: (input: {
		bytes: Uint8Array
		mimeType: string
	}) => { success: true; data: ProfileAvatarValues } | { success: false }
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
		classifyBlocked: (): 'unavailable' => 'unavailable'
	}
	const name = createSingleWriteFormOptions<
		NameValues,
		void,
		ProfileReason,
		ProfileScope,
		ProfileObservation,
		SnapshotFrom<typeof availability>,
		Snapshot<FormOperationResult<void, ProfileReason>>,
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
		write: async ({ request }) => {
			const { profileId, identityId } = request.scope
			if (profileId === null || identityId === null) throw new Error('Missing authorized profile')
			await deps.saveName(profileId, identityId, request.values.displayName ?? null)
		}
	})
	const avatarWrite = createSingleWriteFormOptions<
		ProfileAvatarValues,
		void,
		ProfileReason,
		ProfileScope,
		ProfileObservation,
		SnapshotFrom<typeof availability>,
		Snapshot<FormOperationResult<void, ProfileReason>>,
		ValueSchema
	>({
		...common,
		schema: deps.avatarValuesSchema,
		write: async ({ request }) => {
			const { profileId, identityId } = request.scope
			if (profileId === null || identityId === null) throw new Error('Missing authorized profile')
			await deps.saveAvatar(profileId, identityId, request.values)
		}
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
