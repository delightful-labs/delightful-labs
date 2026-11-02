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
