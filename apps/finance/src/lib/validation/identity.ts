import { INCOME, EXPENSE } from '#lib/domain/transaction-kind.js'
import { accountCurrencySchema } from './accounts.js'
import { z } from 'zod'

export const appWorkspaceSchema = z.strictObject({
	name: z.string().trim().min(1),
	kind: z.enum(['personal', 'business']),
	defaultCurrency: accountCurrencySchema.default('USD'),
	ownerId: z.uuid()
})

export const workspaceNameFormSchema = appWorkspaceSchema.pick({ name: true }).strip()
export const workspaceSettingsFormSchema = appWorkspaceSchema
	.pick({ name: true, defaultCurrency: true })
	.strip()

export const workspaceCreationAttemptSchema = z.strictObject({
	organizationId: z.uuid(),
	membershipId: z.uuid(),
	profileId: z.uuid(),
	workspace: appWorkspaceSchema,
	categories: z
		.array(
			z.strictObject({
				id: z.uuid(),
				name: z.string().trim().min(1),
				kind: z.enum([EXPENSE, INCOME]),
				isSystem: z.boolean()
			})
		)
		.superRefine((categories, context) => {
			if (new Set(categories.map((category) => category.id)).size !== categories.length) {
				context.addIssue({ code: 'custom', message: 'Duplicate starter category identity' })
			}
			for (const kind of [EXPENSE, INCOME]) {
				if (
					categories.filter((category) => category.kind === kind && category.isSystem).length !== 1
				) {
					context.addIssue({
						code: 'custom',
						message: 'One system category per transaction kind is required'
					})
				}
			}
		})
})

export const MAX_AVATAR_UPLOAD_BYTES = 10 * 1024 * 1024
export const MAX_AVATAR_BYTES = 256 * 1024
export const avatarMimeType = z.enum(['image/png', 'image/jpeg', 'image/webp'])

export const appProfileSchema = z.strictObject({
	userId: z.uuid(),
	initialWorkspaceId: z.uuid().nullable().optional(),
	displayName: z.string().trim().min(1).nullable().optional(),
	avatarData: z
		.instanceof(Uint8Array)
		.check(z.property('byteLength', z.number().int().min(1).max(MAX_AVATAR_BYTES)))
		.nullable()
		.optional(),
	avatarMimeType: avatarMimeType.nullable().optional()
})

export const profileNameFormSchema = appProfileSchema
	.pick({ displayName: true })
	.extend({
		displayName: z
			.string()
			.trim()
			.transform((value) => value || null)
			.pipe(appProfileSchema.shape.displayName.unwrap())
	})
	.strip()

const avatarFields = appProfileSchema.pick({
	avatarData: true,
	avatarMimeType: true
})

export const profileAvatarValuesSchema = z.union([
	avatarFields.extend({
		avatarData: avatarFields.shape.avatarData.unwrap().unwrap(),
		avatarMimeType
	}),
	avatarFields.extend({ avatarData: z.null(), avatarMimeType: z.null() })
])

export const profileAvatarFormSchema = z.discriminatedUnion('action', [
	z.object({
		action: z.literal('upload'),
		file: z.file().min(1).max(MAX_AVATAR_UPLOAD_BYTES).mime(avatarMimeType.options)
	}),
	z.object({ action: z.literal('remove') })
])
