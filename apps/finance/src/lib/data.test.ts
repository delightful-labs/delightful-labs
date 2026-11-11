import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { getDb } from 'jazz-tools/svelte'
import {
	archiveAccount,
	archiveCategory,
	archiveTag,
	createTag,
	createCategory,
	createAccount,
	workspaceNamingWrites,
	saveProfileName,
	saveProfileAvatar
} from './data.js'
import { app, type Account, type Organization } from './schema.js'

type Db = ReturnType<typeof getDb>
const userId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const organization = {
	id: organizationId,
	name: 'Existing workspace',
	kind: 'personal',
	defaultCurrency: 'USD',
	ownerId: userId
} satisfies Organization

beforeEach(() => vi.restoreAllMocks())

describe('createAccount', () => {
	const account: Account = {
		id: 'account',
		organizationId: organization.id,
		name: 'Checking',
		kind: 'bank',
		currency: 'USD',
		archivedAt: null
	}
	it('writes the selected workspace and USD currency, then waits for local persistence', async () => {
		const wait = vi.fn().mockResolvedValue(account)
		const db = { insert: vi.fn().mockReturnValue({ wait }) } satisfies Pick<Db, 'insert'>
		await expect(createAccount(db, organization.id, '  Checking  ', 'bank')).resolves.toEqual(
			account
		)
		expect(db.insert).toHaveBeenCalledExactlyOnceWith(app.accounts, {
			organizationId: organization.id,
			name: 'Checking',
			kind: 'bank',
			currency: 'USD',
			archivedAt: null
		})
		expect(wait).toHaveBeenCalledExactlyOnceWith({ tier: 'local' })
	})
	it('returns the persistence promise rather than reporting success immediately', async () => {
		const pending = Promise.withResolvers<Account>()
		const wait = vi.fn(() => pending.promise)
		const db = { insert: vi.fn().mockReturnValue({ wait }) } satisfies Pick<Db, 'insert'>
		const result = createAccount(db, organization.id, 'Checking', 'bank')
		expect(result).toBe(pending.promise)
		pending.resolve(account)
		await expect(result).resolves.toEqual(account)
	})
	it('persists an explicitly selected Tanzanian shilling currency', async () => {
		const wait = vi.fn().mockResolvedValue({ ...account, currency: 'TZS' })
		const db = { insert: vi.fn().mockReturnValue({ wait }) } satisfies Pick<Db, 'insert'>
		await expect(
			createAccount(db, organization.id, 'Wallet', 'cash', 'TZS')
		).resolves.toMatchObject({
			currency: 'TZS'
		})
		expect(db.insert).toHaveBeenCalledExactlyOnceWith(
			app.accounts,
			expect.objectContaining({ currency: 'TZS', name: 'Wallet' })
		)
	})
	it('propagates local persistence failures', async () => {
		const failure = new Error('Local write failed')
		const wait = vi.fn().mockRejectedValue(failure)
		const db = { insert: vi.fn().mockReturnValue({ wait }) } satisfies Pick<Db, 'insert'>
		await expect(createAccount(db, organization.id, 'Checking', 'bank')).rejects.toBe(failure)
	})
	it('rejects blank names before opening a write', () => {
		const db = { insert: vi.fn() } satisfies Pick<Db, 'insert'>
		expect(() => createAccount(db, organization.id, ' ', 'cash')).toThrow()
		expect(db.insert).not.toHaveBeenCalled()
	})
})

describe('workspaceNamingWrites', () => {
	it('updates the workspace name and default currency together at local durability', async () => {
		const wait = vi.fn().mockResolvedValue(organization)
		const db = { update: vi.fn().mockReturnValue({ wait }) } satisfies Pick<Db, 'update'>
		const adapter = workspaceNamingWrites(db)
		const { write } = adapter.issueRename(organization.id, {
			name: ' Home ',
			defaultCurrency: 'TZS'
		})
		expect(wait).not.toHaveBeenCalled()
		await adapter.persistLocal(write)
		expect(db.update).toHaveBeenCalledExactlyOnceWith(app.organizations, organization.id, {
			name: 'Home',
			defaultCurrency: 'TZS'
		})
		expect(wait).toHaveBeenCalledExactlyOnceWith({ tier: 'local' })
	})

	it('rejects invalid settings before issuing any update', () => {
		const db = { update: vi.fn() } satisfies Pick<Db, 'update'>
		expect(() =>
			workspaceNamingWrites(db).issueRename(organization.id, { name: ' ', defaultCurrency: 'USD' })
		).toThrow()
		expect(db.update).not.toHaveBeenCalled()
	})
})

describe('archiveAccount', () => {
	it('only sets the archive timestamp and waits for local persistence', async () => {
		const wait = vi.fn().mockResolvedValue(undefined)
		const db = { update: vi.fn().mockReturnValue({ wait }) } satisfies Pick<Db, 'update'>
		const before = Date.now()
		await archiveAccount(db, 'account')
		expect(db.update).toHaveBeenCalledExactlyOnceWith(app.accounts, 'account', {
			archivedAt: expect.any(Date)
		})
		const archivedAt = db.update.mock.calls[0]?.[2]?.archivedAt
		expect(archivedAt.getTime()).toBeGreaterThanOrEqual(before)
		expect(archivedAt.getTime()).toBeLessThanOrEqual(Date.now())
		expect(wait).toHaveBeenCalledExactlyOnceWith({ tier: 'local' })
	})
	it('propagates local persistence errors', async () => {
		const failure = new Error('Archive persistence failed')
		const wait = vi.fn().mockRejectedValue(failure)
		const db = { update: vi.fn().mockReturnValue({ wait }) } satisfies Pick<Db, 'update'>
		await expect(archiveAccount(db, 'account')).rejects.toBe(failure)
	})
})

describe('category persistence', () => {
	it('creates a trimmed non-system category in the selected workspace and waits locally', async () => {
		const wait = vi.fn().mockResolvedValue({ id: 'category' })
		const db = { insert: vi.fn().mockReturnValue({ wait }) } satisfies Pick<Db, 'insert'>
		await expect(createCategory(db, organization.id, '  Food  ', 'expense')).resolves.toEqual({
			id: 'category'
		})
		expect(db.insert).toHaveBeenCalledExactlyOnceWith(app.categories, {
			organizationId: organization.id,
			name: 'Food',
			kind: 'expense',
			isSystem: false,
			archivedAt: null
		})
		expect(wait).toHaveBeenCalledExactlyOnceWith({ tier: 'local' })
	})
	it('rejects invalid input before inserting', () => {
		const db = { insert: vi.fn() } satisfies Pick<Db, 'insert'>
		expect(() => createCategory(db, organization.id, ' ', 'income')).toThrow()
		expect(db.insert).not.toHaveBeenCalled()
	})
	it('propagates category creation persistence failures', async () => {
		const failure = new Error('Persistence failed')
		const db = {
			insert: vi.fn().mockReturnValue({ wait: vi.fn().mockRejectedValue(failure) })
		} satisfies Pick<Db, 'insert'>
		await expect(createCategory(db, organization.id, 'Food', 'expense')).rejects.toBe(failure)
	})
	it('archives without deleting the category or its connections and waits locally', async () => {
		const wait = vi.fn().mockResolvedValue(undefined)
		const db = { update: vi.fn().mockReturnValue({ wait }) } satisfies Pick<Db, 'update'>
		await archiveCategory(db, 'category')
		expect(db.update).toHaveBeenCalledExactlyOnceWith(app.categories, 'category', {
			archivedAt: expect.any(Date)
		})
		expect(wait).toHaveBeenCalledExactlyOnceWith({ tier: 'local' })
	})
	it('propagates category archive persistence failures', async () => {
		const failure = new Error('Persistence failed')
		const db = {
			update: vi.fn().mockReturnValue({ wait: vi.fn().mockRejectedValue(failure) })
		} satisfies Pick<Db, 'update'>
		await expect(archiveCategory(db, 'category')).rejects.toBe(failure)
	})
})

describe('tag persistence', () => {
	it.each([null, organization.id])(
		'creates normalized tags with category %s and waits locally',
		async (categoryId) => {
			const wait = vi.fn().mockResolvedValue({ id: 'tag' })
			const db = { insert: vi.fn().mockReturnValue({ wait }) } satisfies Pick<Db, 'insert'>
			await expect(
				createTag(db, organization.id, '  Garden  ', 'expense', categoryId)
			).resolves.toEqual({
				id: 'tag'
			})
			expect(db.insert).toHaveBeenCalledExactlyOnceWith(app.tags, {
				organizationId: organization.id,
				name: 'Garden',
				kind: 'expense',
				categoryId,
				archivedAt: null
			})
			expect(wait).toHaveBeenCalledExactlyOnceWith({ tier: 'local' })
		}
	)
	it('rejects invalid names before inserting', () => {
		const db = { insert: vi.fn() } satisfies Pick<Db, 'insert'>
		expect(() => createTag(db, organization.id, ' ', 'expense', null)).toThrow()
		expect(db.insert).not.toHaveBeenCalled()
	})
	it('propagates tag creation failures', async () => {
		const failure = new Error('Persistence failed')
		const db = {
			insert: vi.fn().mockReturnValue({ wait: vi.fn().mockRejectedValue(failure) })
		} satisfies Pick<Db, 'insert'>
		await expect(createTag(db, organization.id, 'Garden', 'expense', null)).rejects.toBe(failure)
	})
	it('archives without deleting or rewriting links and waits locally', async () => {
		const wait = vi.fn().mockResolvedValue(undefined)
		const db = { update: vi.fn().mockReturnValue({ wait }) } satisfies Pick<Db, 'update'>
		await archiveTag(db, 'tag')
		expect(db.update).toHaveBeenCalledExactlyOnceWith(app.tags, 'tag', {
			archivedAt: expect.any(Date)
		})
		expect(wait).toHaveBeenCalledExactlyOnceWith({ tier: 'local' })
	})
	it('propagates tag archive failures', async () => {
		const failure = new Error('Persistence failed')
		const db = {
			update: vi.fn().mockReturnValue({ wait: vi.fn().mockRejectedValue(failure) })
		} satisfies Pick<Db, 'update'>
		await expect(archiveTag(db, 'tag')).rejects.toBe(failure)
	})
})

describe('saveProfileName', () => {
	it('normalizes the name, updates only the display field, and waits for local persistence', async () => {
		const wait = vi.fn().mockResolvedValue(undefined)
		const db = { update: vi.fn().mockReturnValue({ wait }) } satisfies Pick<Db, 'update'>
		await saveProfileName(db, 'profile', userId, '  Matthew  ')
		expect(db.update).toHaveBeenCalledExactlyOnceWith(app.profiles, 'profile', {
			displayName: 'Matthew'
		})
		expect(wait).toHaveBeenCalledExactlyOnceWith({ tier: 'local' })
	})
	it.each([null, undefined])('clears the name with %j', async (displayName) => {
		const wait = vi.fn().mockResolvedValue(undefined)
		const db = { update: vi.fn().mockReturnValue({ wait }) } satisfies Pick<Db, 'update'>
		await saveProfileName(db, 'profile', userId, displayName)
		expect(db.update).toHaveBeenCalledExactlyOnceWith(app.profiles, 'profile', {
			displayName: null
		})
	})
	it('rejects invalid canonical names or identities before writing', () => {
		const db = { update: vi.fn() } satisfies Pick<Db, 'update'>
		expect(() => saveProfileName(db, 'profile', userId, ' ')).toThrow()
		expect(() => saveProfileName(db, 'profile', 'invalid', 'Matthew')).toThrow()
		expect(db.update).not.toHaveBeenCalled()
	})
	it('returns the local persistence promise and propagates its failure', async () => {
		const pending = Promise.withResolvers<void>()
		const wait = vi.fn(() => pending.promise)
		const db = { update: vi.fn().mockReturnValue({ wait }) } satisfies Pick<Db, 'update'>
		const result = saveProfileName(db, 'profile', userId, 'Matthew')
		expect(result).toBe(pending.promise)
		const rejection = expect(result).rejects.toThrow('Profile write failed')
		pending.reject(new Error('Profile write failed'))
		await rejection
	})
})

describe('saveProfileAvatar', () => {
	const avatar = {
		avatarData: new Uint8Array([1, 2, 3]),
		avatarMimeType: 'image/png'
	} satisfies Parameters<typeof saveProfileAvatar>[3]
	it('writes bytes and MIME type together without changing identity or display name', async () => {
		const wait = vi.fn().mockResolvedValue(undefined)
		const db = { update: vi.fn().mockReturnValue({ wait }) } satisfies Pick<Db, 'update'>
		await saveProfileAvatar(db, 'profile', userId, avatar)
		expect(db.update).toHaveBeenCalledExactlyOnceWith(app.profiles, 'profile', avatar)
		expect(wait).toHaveBeenCalledExactlyOnceWith({ tier: 'local' })
	})
	it('removes both avatar fields atomically', async () => {
		const wait = vi.fn().mockResolvedValue(undefined)
		const db = { update: vi.fn().mockReturnValue({ wait }) } satisfies Pick<Db, 'update'>
		await saveProfileAvatar(db, 'profile', userId, { avatarData: null, avatarMimeType: null })
		expect(db.update).toHaveBeenCalledExactlyOnceWith(app.profiles, 'profile', {
			avatarData: null,
			avatarMimeType: null
		})
	})
	it('rejects invalid identities before writing', () => {
		const db = { update: vi.fn() } satisfies Pick<Db, 'update'>
		expect(() => saveProfileAvatar(db, 'profile', 'invalid', avatar)).toThrow()
		expect(db.update).not.toHaveBeenCalled()
	})
	it('returns local persistence and propagates write failures', async () => {
		const pending = Promise.withResolvers<void>()
		const wait = vi.fn(() => pending.promise)
		const db = { update: vi.fn().mockReturnValue({ wait }) } satisfies Pick<Db, 'update'>
		const result = saveProfileAvatar(db, 'profile', userId, avatar)
		expect(result).toBe(pending.promise)
		const rejection = expect(result).rejects.toThrow('Avatar write failed')
		pending.reject(new Error('Avatar write failed'))
		await rejection
	})
})
