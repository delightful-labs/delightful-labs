import { createProfileAvatarMachine as createSharedAvatar } from 'delightful-local-first/profile/avatar'
import type { z } from 'zod'
import { profileAvatarValuesSchema } from '#lib/validation/identity.js'
import { imageProcessingMachine } from '../images/image-processing.js'
import type {
	FormChildEvent,
	FormOperationInput,
	FormOperationResult
} from '#lib/contracts/form-contract.js'
import type {
	ProfileObservation,
	ProfileReason,
	ProfileScope
} from '#lib/contracts/profile-contract.js'
import type { ActorLogic, Snapshot, SnapshotFrom } from 'xstate'

type Values = z.output<typeof profileAvatarValuesSchema>
type Result = FormOperationResult<void, ProfileReason>
type Event = FormChildEvent<ProfileObservation>
/** Owns image resources through cleanup, then delegates readiness and settlement to the write child. */
export function createProfileAvatarMachine<WriteSnapshot extends Snapshot<Result>>(options: {
	write: ActorLogic<
		WriteSnapshot,
		Event,
		FormOperationInput<Values, ProfileScope, ProfileObservation>
	>
	scopeOf: (facts: ProfileObservation) => ProfileScope
	sameScope: (left: ProfileScope, right: ProfileScope) => boolean
}) {
	return createSharedAvatar<SnapshotFrom<typeof imageProcessingMachine>, WriteSnapshot>({
		...options,
		processImage: imageProcessingMachine,
		validateBytes: ({ bytes, mimeType }) =>
			profileAvatarValuesSchema.safeParse({ avatarData: bytes, avatarMimeType: mimeType })
	})
}
