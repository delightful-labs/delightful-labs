import { issueLocalWrite, persistLocal } from 'delightful-local-first/backend/jazz/data'
import type { getDb } from 'jazz-tools/svelte'
import { app, type Account, type Category, type Organization, type Tag } from './schema.js'
import { ACCOUNT_CURRENCY, type AccountCurrency } from './domain/account-currency.js'
import { appAccountSchema } from './validation/accounts.js'
import { appCategorySchema } from './validation/categories.js'
import { appTagSchema } from './validation/tags.js'
import type { z } from 'zod'
import {
	appProfileSchema,
	profileAvatarValuesSchema,
	workspaceSettingsFormSchema
} from './validation/identity.js'

export { stableUuid } from './domain/stable-uuid.js'

type Db = ReturnType<typeof getDb>

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
		return issueLocalWrite(() => db.update(app.organizations, workspaceId, settings))
	}
	return {
		issueRename,
		persistLocal: (write: ReturnType<typeof issueRename>['write']) => persistLocal(write)
	}
}

export function createAccount(
	db: Pick<Db, 'insert'>,
	organizationId: string,
	name: string,
	kind: Account['kind'],
	currency: AccountCurrency = ACCOUNT_CURRENCY.USD
) {
	const account = appAccountSchema.parse({ organizationId, name, kind, currency })
	return db.insert(app.accounts, account).wait({ tier: 'local' })
}

export function archiveAccount(db: Pick<Db, 'update'>, accountId: Account['id']) {
	return db.update(app.accounts, accountId, { archivedAt: new Date() }).wait({ tier: 'local' })
}

export function createCategory(
	db: Pick<Db, 'insert'>,
	organizationId: string,
	name: string,
	kind: Category['kind']
) {
	const category = appCategorySchema.parse({ organizationId, name, kind })
	return db.insert(app.categories, category).wait({ tier: 'local' })
}

export function archiveCategory(db: Pick<Db, 'update'>, categoryId: Category['id']) {
	return db.update(app.categories, categoryId, { archivedAt: new Date() }).wait({ tier: 'local' })
}

export function createTag(
	db: Pick<Db, 'insert'>,
	organizationId: string,
	name: string,
	kind: Category['kind'],
	categoryId: string | null
) {
	const tag = appTagSchema.parse({ organizationId, name, kind, categoryId })
	return db.insert(app.tags, tag).wait({ tier: 'local' })
}

export function archiveTag(db: Pick<Db, 'update'>, tagId: Tag['id']) {
	return db.update(app.tags, tagId, { archivedAt: new Date() }).wait({ tier: 'local' })
}
