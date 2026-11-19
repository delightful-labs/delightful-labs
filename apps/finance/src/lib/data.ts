import type { Db as JazzDb } from 'jazz-tools'
import { app, type Organization } from './queries.js'
import type { AccountCurrency } from './domain/account-currency.js'
import type { z } from 'zod'
import {
	appProfileSchema,
	profileAvatarValuesSchema,
	workspaceSettingsFormSchema
} from './validation/identity.js'

export { createAccount, archiveAccount } from './data/accounts.js'

export { stableUuid } from './domain/stable-uuid.js'

type Db = JazzDb

export function saveProfileName(
	db: Pick<Db, 'update'>,
	profileId: string,
	userId: string,
	displayName: string | null | undefined
) {
	const profile = appProfileSchema.parse({ userId, displayName })
	return db
		.update(app.profiles, profileId, { displayName: profile.displayName ?? null })
		.wait({ tier: 'local' })
}

export function saveProfileAvatar(
	db: Pick<Db, 'update'>,
	profileId: string,
	userId: string,
	values: z.output<typeof profileAvatarValuesSchema>
) {
	const avatar = profileAvatarValuesSchema.parse(values)
	appProfileSchema.shape.userId.parse(userId)
	return db.update(app.profiles, profileId, avatar).wait({ tier: 'local' })
}

/** Leaf adapter: one atomic update; the opaque receipt is not implicitly awaited. */
export function workspaceNamingWrites(db: Pick<Db, 'update'>) {
	function issueRename(
		workspaceId: Organization['id'],
		values: { name: Organization['name']; defaultCurrency: AccountCurrency }
	) {
		const settings = workspaceSettingsFormSchema.parse(values)
		const receipt = db.update(app.organizations, workspaceId, settings)
		return {
			write: async () => {
				await receipt.wait({ tier: 'local' })
			}
		}
	}
	return {
		issueRename,
		persistLocal: (write: ReturnType<typeof issueRename>['write']) => write()
	}
}

export { createCategory, archiveCategory, createTag, archiveTag } from './data/classification.js'
