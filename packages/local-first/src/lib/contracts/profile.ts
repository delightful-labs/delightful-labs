type Profile = {
	id: string
	userId: string
	displayName?: string | null | undefined
	avatarData?: Uint8Array | null | undefined
	avatarMimeType?: string | null | undefined
}
import type { ScopedFormView } from './scoped-form.js'
export type ProfileScope = {
	identityId: string | null
	profileId: string | null
	binding: object | null
}
export type ProfileReason = 'sessionUnavailable' | 'loadFailed' | 'loading' | 'profileUnavailable'
export type ProfileObservation = {
	identityId: string | null
	binding: object | null
	sessionReady: boolean
	loading: boolean
	failed: boolean
	profile: Profile | null | undefined
}
export type ProfileView = ScopedFormView<void, ProfileReason>

export function profileScope(f: ProfileObservation): ProfileScope {
	return { identityId: f.identityId, profileId: f.profile?.id ?? null, binding: f.binding }
}
export function sameProfileScope(a: ProfileScope, b: ProfileScope) {
	return a.identityId === b.identityId && a.profileId === b.profileId && a.binding === b.binding
}
