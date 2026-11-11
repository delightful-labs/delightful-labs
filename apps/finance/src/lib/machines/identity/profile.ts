import { createProfileFormOptions as createSharedProfile } from 'delightful-local-first/profile/workflow'
export {
	profileScope,
	sameProfileScope,
	createProfileAvailability,
	selectProfileAvailability
} from 'delightful-local-first/profile/workflow'
import type { ProfileObservation } from '#lib/contracts/profile-contract.js'
import { imageProcessingMachine } from '../images/image-processing.js'
import {
	profileNameFormSchema,
	profileAvatarFormSchema,
	profileAvatarValuesSchema,
	avatarMimeType
} from '#lib/validation/identity.js'
import type { z } from 'zod'
export function createProfileFormOptions(deps: {
	binding: object
	observe: () => ProfileObservation
	saveName: (id: string, user: string, name: string | null) => Promise<unknown>
	saveAvatar: (
		id: string,
		user: string,
		values: z.output<typeof profileAvatarValuesSchema>
	) => Promise<unknown>
}) {
	return createSharedProfile({
		...deps,
		saveSettlement: 'locallyPersisted',
		nameSchema: profileNameFormSchema,
		avatarSchema: profileAvatarFormSchema,
		avatarValuesSchema: profileAvatarValuesSchema,
		mimeType: (value) => avatarMimeType.safeParse(value).data ?? 'image/png',
		processImage: imageProcessingMachine,
		validateBytes: ({ bytes, mimeType }) =>
			profileAvatarValuesSchema.safeParse({ avatarData: bytes, avatarMimeType: mimeType })
	})
}
