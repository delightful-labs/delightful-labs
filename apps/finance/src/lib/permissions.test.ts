import { Buffer } from 'node:buffer'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createPolicyTestApp, type PolicyTestApp, type TestDb } from 'jazz-tools/testing'
import { app, type TransactionRow } from './schema.js'
import {
	transactionAttachmentReplacementMachine,
	type AttachmentReplacementInput
} from './machines/transactions/attachments/transaction-attachment-replacement.js'
import { savedTransactionImageEditorMachine } from './machines/transactions/attachments/saved-transaction-image-editor.js'
import { mockEditorPlatform } from './testing/image-editor/fixtures.js'
import { vi } from 'vitest'
import permissions from './permissions.js'
import { createActor, toPromise, waitFor, createAsyncLogic } from 'xstate'

const organizationId = crypto.randomUUID()
const otherOrganizationId = crypto.randomUUID()
const accountId = crypto.randomUUID()
const otherAccountId = crypto.randomUUID()
const foreignAccountId = crypto.randomUUID()
const expenseCategoryId = crypto.randomUUID()
const incomeCategoryId = crypto.randomUUID()
const foreignCategoryId = crypto.randomUUID()
const historicalTagId = crypto.randomUUID()
const historicalLinkId = crypto.randomUUID()
const expenseId = crypto.randomUUID()
const session = {
	user_id: 'permission-integrity',
	authMode: 'local-first',
	claims: {}
} satisfies import('jazz-tools/testing').PolicyTestSession
let fixture: PolicyTestApp
let db: TestDb
const selectedMemberSession = {
	user_id: 'check-selected-member',
	authMode: 'local-first',
	claims: {}
} satisfies import('jazz-tools/testing').PolicyTestSession
const viewerSession = {
	user_id: 'check-viewer',
	authMode: 'local-first',
	claims: {}
} satisfies import('jazz-tools/testing').PolicyTestSession
let selectedMemberDb: TestDb
let viewerDb: TestDb
let selectedMemberId: string

function transaction(kind: 'expense' | 'income') {
	return {
		organizationId,
		accountId,
		categoryId: kind === 'expense' ? expenseCategoryId : incomeCategoryId,
		kind,
		amountMinor: 100,
		currency: 'USD',
		bookedOn: '2026-10-23',
		source: 'manual'
	} satisfies import('jazz-tools').schema.InsertOf<typeof app.transactions>
}

async function createPermissionFixture() {
	const fixture = await createPolicyTestApp(app, permissions, expect)
	const db = fixture.as(session)
	const userId = fixture.accountFor(session)

	for (const id of [organizationId, otherOrganizationId]) {
		await fixture.seed((seed) =>
			seed.insert(
				app.organizations,
				{ name: 'Permission fixture', ownerId: userId, kind: 'personal', defaultCurrency: 'USD' },
				{ id }
			)
		)
		await fixture.seed((seed) =>
			seed.insert(app.organizationMembers, {
				organizationId: id,
				userId,
				role: 'owner',
				accountAccessMode: 'all'
			})
		)
	}
	await fixture.seed((seed) =>
		seed.insert(
			app.accounts,
			{ organizationId, name: 'Ledger', kind: 'cash', currency: 'USD' },
			{ id: accountId }
		)
	)
	for (const [id, scope] of [
		[otherAccountId, organizationId],
		[foreignAccountId, otherOrganizationId]
	] satisfies [string, string][]) {
		await fixture.seed((seed) =>
			seed.insert(
				app.accounts,
				{ organizationId: scope, name: 'Other', kind: 'cash', currency: 'USD' },
				{ id }
			)
		)
	}
	const selectedMemberDb = fixture.as(selectedMemberSession)
	const viewerDb = fixture.as(viewerSession)
	const selectedMemberId = fixture.accountFor(selectedMemberSession)
	const viewerId = fixture.accountFor(viewerSession)
	await fixture.seed((seed) =>
		seed.insert(app.organizationMembers, {
			organizationId,
			userId: selectedMemberId,
			role: 'member',
			accountAccessMode: 'selected'
		})
	)
	await fixture.seed((seed) =>
		seed.insert(app.accountMemberships, {
			organizationId,
			accountId,
			userId: selectedMemberId,
			access: 'write',
			canDelete: false
		})
	)
	await fixture.seed((seed) =>
		seed.insert(app.organizationMembers, {
			organizationId,
			userId: viewerId,
			role: 'viewer',
			accountAccessMode: 'all'
		})
	)
	for (const [id, kind, workspace] of [
		[expenseCategoryId, 'expense', organizationId],
		[incomeCategoryId, 'income', organizationId],
		[foreignCategoryId, 'expense', otherOrganizationId]
	] satisfies [string, 'expense' | 'income', string][]) {
		await fixture.seed((seed) =>
			seed.insert(
				app.categories,
				{ organizationId: workspace, kind, name: kind, isSystem: false },
				{ id }
			)
		)
	}
	await fixture.seed((seed) =>
		seed.insert(app.transactions, transaction('expense'), { id: expenseId })
	)
	await fixture.seed((seed) =>
		seed.insert(
			app.tags,
			{ organizationId, name: 'Historical', kind: 'expense' },
			{ id: historicalTagId }
		)
	)
	await fixture.seed((seed) =>
		seed.insert(
			app.transactionTags,
			{ organizationId, transactionId: expenseId, tagId: historicalTagId },
			{ id: historicalLinkId }
		)
	)
	return { fixture, db, selectedMemberDb, viewerDb, selectedMemberId }
}
beforeAll(async () => {
	;({ fixture, db, selectedMemberDb, viewerDb, selectedMemberId } = await createPermissionFixture())
}, 30_000)
afterAll(async () => {
	await fixture?.shutdown()
})

describe('independent Check permissions', () => {
	async function createCheck(scope = { organizationId, accountId }) {
		return db
			.insert(app.checks, {
				...scope,
				checkNumber: crypto.randomUUID().slice(0, 8),
				checkDate: '2026-10-23'
			})
			.wait({ tier: 'global' })
	}

	it('allows a selected member to create and edit a Check only in a granted account', async () => {
		const check = await selectedMemberDb
			.insert(app.checks, {
				organizationId,
				accountId,
				checkNumber: '101',
				checkDate: '2026-10-23'
			})
			.wait({ tier: 'global' })
		await selectedMemberDb
			.update(app.checks, check.id, { memoOnCheck: 'Updated' })
			.wait({ tier: 'global' })
		expect(
			(await selectedMemberDb.one(app.checks.where({ id: check.id }), { tier: 'remote' }))
				?.memoOnCheck
		).toBe('Updated')
		await expect(
			selectedMemberDb.expectDenied((writer) =>
				writer.insert(app.checks, {
					organizationId,
					accountId: otherAccountId,
					checkNumber: '102',
					checkDate: '2026-10-23'
				})
			)
		).resolves.toBeUndefined()
		await db.update(app.checks, check.id, { accountId: otherAccountId }).wait({ tier: 'global' })
		expect((await db.one(app.checks.where({ id: check.id }), { tier: 'remote' }))?.accountId).toBe(
			otherAccountId
		)
		await expect(
			db.expectDenied((writer) => writer.delete(app.checks, check.id))
		).resolves.toBeUndefined()
	})

	it('keeps Check access within organization and viewer rules', async () => {
		const check = await createCheck()
		expect(await viewerDb.one(app.checks.where({ id: check.id }), { tier: 'remote' })).toBeTruthy()
		await expect(
			viewerDb.expectDenied((writer) => writer.update(app.checks, check.id, { bankName: 'No' }))
		).resolves.toBeUndefined()
		await expect(
			selectedMemberDb.expectDenied((writer) =>
				writer.insert(app.checks, {
					organizationId: otherOrganizationId,
					accountId: foreignAccountId,
					checkNumber: '103',
					checkDate: '2026-10-23'
				})
			)
		).resolves.toBeUndefined()
	})

	it.each(['income', 'expense'] satisfies ('income' | 'expense')[])(
		'allows a direct %s transaction reference to a saved Check',
		async (kind) => {
			const check = await createCheck()
			const row = await db
				.insert(app.transactions, {
					...transaction(kind),
					paymentMethod: 'check',
					checkId: check.id
				})
				.wait({ tier: 'global' })
			expect(row.checkId).toBe(check.id)
		}
	)

	it('rejects missing, mismatched, and simultaneous Check references on direct writes', async () => {
		const check = await createCheck()
		const otherCheck = await createCheck({ organizationId, accountId: otherAccountId })
		const foreignCheck = await createCheck({
			organizationId: otherOrganizationId,
			accountId: foreignAccountId
		})
		for (const checkId of [crypto.randomUUID(), otherCheck.id, foreignCheck.id]) {
			await expect(
				db.expectDenied((writer) =>
					writer.insert(app.transactions, {
						...transaction('expense'),
						paymentMethod: 'check',
						checkId
					})
				)
			).resolves.toBeUndefined()
		}
		await expect(
			db.expectDenied((writer) =>
				writer.insert(app.transactions, {
					...transaction('expense'),
					paymentMethod: 'cash',
					checkId: check.id
				})
			)
		).resolves.toBeUndefined()
		const row = await db.insert(app.transactions, transaction('expense')).wait({ tier: 'global' })
		await expect(
			db.expectDenied((writer) =>
				writer.update(app.transactions, row.id, { paymentMethod: 'check', checkId: otherCheck.id })
			)
		).resolves.toBeUndefined()
		await db
			.update(app.transactions, row.id, { paymentMethod: 'check', checkId: check.id })
			.wait({ tier: 'global' })
		await expect(
			db.expectDenied((writer) =>
				writer.update(app.transactions, row.id, { checkDetailsId: crypto.randomUUID() })
			)
		).resolves.toBeUndefined()
	})
})

describe('tag permission integrity', () => {
	it.each([
		{ name: 'wrong category kind', kind: 'expense', categoryId: incomeCategoryId },
		{ name: 'foreign category', kind: 'expense', categoryId: foreignCategoryId }
	] satisfies { name: string; kind: 'expense'; categoryId: string | null }[])(
		'rejects $name',
		async (values) => {
			await expect(
				db.expectDenied((writer) => writer.insert(app.tags, { organizationId, ...values }))
			).resolves.toBeUndefined()
		}
	)
	it('accepts typed tags with matching or absent categories and rejects incompatible updates', async () => {
		for (const kind of ['expense', 'income'] satisfies ('expense' | 'income')[]) {
			const categoryId = kind === 'expense' ? expenseCategoryId : incomeCategoryId
			const tag = await db
				.insert(app.tags, { organizationId, name: kind, kind, categoryId })
				.wait({ tier: 'global' })
			expect(tag.kind).toBe(kind)
			await expect(
				db.expectDenied((writer) =>
					writer.update(app.tags, tag.id, { categoryId: foreignCategoryId })
				)
			).resolves.toBeUndefined()
			await expect(
				db.expectDenied((writer) =>
					writer.update(app.tags, tag.id, {
						categoryId: kind === 'expense' ? incomeCategoryId : expenseCategoryId
					})
				)
			).resolves.toBeUndefined()
			await expect(
				db.expectDenied((writer) =>
					writer.update(app.tags, tag.id, {
						kind: kind === 'expense' ? 'income' : 'expense',
						categoryId: null
					})
				)
			).resolves.toBeUndefined()
			const uncategorized = await db
				.insert(app.tags, { organizationId, name: 'No category', kind })
				.wait({ tier: 'global' })
			expect(uncategorized.kind).toBe(kind)
		}
	})
	it('matches assignment kinds and prevents transaction kind changes', async () => {
		for (const kind of ['expense', 'income'] satisfies ('expense' | 'income')[]) {
			const tag = await db
				.insert(app.tags, { organizationId, name: 'Assignment', kind })
				.wait({ tier: 'global' })
			if (kind === 'income') {
				await expect(
					db.expectDenied((writer) =>
						writer.insert(app.transactionTags, {
							organizationId,
							transactionId: expenseId,
							tagId: tag.id
						})
					)
				).resolves.toBeUndefined()
			} else {
				const link = await db
					.insert(app.transactionTags, { organizationId, transactionId: expenseId, tagId: tag.id })
					.wait({ tier: 'global' })
				expect(link.tagId).toBe(tag.id)
			}
		}
		await expect(
			db.expectDenied((writer) =>
				writer.update(app.transactions, expenseId, {
					kind: 'income',
					categoryId: incomeCategoryId,
					paymentMethod: 'cash'
				})
			)
		).resolves.toBeUndefined()
	})
	it('rejects missing/null kinds on direct SDK inserts and updates', async () => {
		for (const kind of [undefined, null]) {
			const values = {
				organizationId,
				name: 'Invalid',
				kind: 'expense'
			} satisfies import('jazz-tools').schema.InsertOf<typeof app.tags>
			if (kind === undefined) Reflect.deleteProperty(values, 'kind')
			else Reflect.set(values, 'kind', kind)
			await expect(
				Promise.resolve().then(() => db.insert(app.tags, values).wait({ tier: 'global' }))
			).rejects.toThrow()
		}
		const patch: Pick<import('./schema.js').Tag, 'kind'> = { kind: 'expense' }
		Reflect.set(patch, 'kind', null)
		await expect(
			Promise.resolve().then(() =>
				db.update(app.tags, historicalTagId, patch).wait({ tier: 'global' })
			)
		).rejects.toThrow()
		expect((await db.one(app.tags.where({ id: historicalTagId }), { tier: 'remote' }))?.kind).toBe(
			'expense'
		)
	})
	it('preserves archived typed history and permits removing its assignment', async () => {
		await db.update(app.tags, historicalTagId, { archivedAt: new Date() }).wait({ tier: 'global' })
		expect(
			await db.one(app.transactionTags.where({ id: historicalLinkId }), { tier: 'remote' })
		).toBeTruthy()
		await expect(
			db.expectDenied((writer) =>
				writer.insert(app.transactionTags, {
					organizationId,
					transactionId: expenseId,
					tagId: historicalTagId
				})
			)
		).resolves.toBeUndefined()
		await db.delete(app.transactionTags, historicalLinkId).wait({ tier: 'global' })
		expect(
			await db.one(app.transactionTags.where({ id: historicalLinkId }), { tier: 'remote' })
		).toBeNull()
	})
	it('rejects moving a tag or assigning it across workspaces even with access to both', async () => {
		const tag = await db
			.insert(app.tags, { organizationId, name: 'Scope', kind: 'expense' })
			.wait({ tier: 'global' })
		await expect(
			db.expectDenied((writer) =>
				writer.update(app.tags, tag.id, { organizationId: otherOrganizationId })
			)
		).resolves.toBeUndefined()
		const foreign = await db
			.insert(app.tags, { organizationId: otherOrganizationId, name: 'Foreign', kind: 'expense' })
			.wait({ tier: 'global' })
		for (const scope of [organizationId, otherOrganizationId]) {
			await expect(
				db.expectDenied((writer) =>
					writer.insert(app.transactionTags, {
						organizationId: scope,
						transactionId: expenseId,
						tagId: foreign.id
					})
				)
			).resolves.toBeUndefined()
		}
	})
})

describe('transaction attachment permissions', () => {
	it('scopes file reads through transaction links and permits only transaction writers to add or remove links', async () => {
		const file = await db
			.insert(app.files, {
				transactionId: expenseId,
				fileName: 'receipt.webp',
				mimeType: 'image/webp',
				sizeBytes: 12
			})
			.wait({ tier: 'global' })
		expect(await viewerDb.one(app.files.where({ id: file.id }), { tier: 'remote' })).toBeNull()
		const link = await selectedMemberDb
			.insert(app.transactionAttachments, { transactionId: expenseId, fileId: file.id })
			.wait({ tier: 'global' })
		expect(await viewerDb.one(app.files.where({ id: file.id }), { tier: 'remote' })).toBeTruthy()
		expect(
			await selectedMemberDb.one(app.transactionAttachments.where({ id: link.id }))
		).toBeTruthy()
		await expect(
			viewerDb.expectDenied((writer) =>
				writer.insert(app.transactionAttachments, { transactionId: expenseId, fileId: file.id })
			)
		).resolves.toBeUndefined()
		await expect(
			viewerDb.expectDenied((writer) => writer.delete(app.transactionAttachments, link.id))
		).resolves.toBeUndefined()
		await selectedMemberDb.delete(app.transactionAttachments, link.id).wait({ tier: 'global' })
		expect(await db.one(app.files.where({ id: file.id }), { tier: 'remote' })).toBeNull()
		expect(await db.one(app.files.where({ id: file.id }), { tier: 'local-first' })).toBeNull()
	})
	describe('attachment account and organization boundaries', () => {
		let allowed: Awaited<ReturnType<typeof imageLink>>
		let denied: Awaited<ReturnType<typeof imageLink>>
		let deniedTransactionId: string
		let partId: string
		let stranger: TestDb

		beforeAll(async () => {
			const deniedTransaction = await db
				.insert(app.transactions, { ...transaction('expense'), accountId: otherAccountId })
				.wait({ tier: 'global' })
			allowed = await imageLink()
			denied = await imageLink(deniedTransaction.id)
			const part = await db
				.insert(app.fileParts, {
					fileId: denied.file.id,
					partIndex: 0,
					sizeBytes: 4,
					data: new Uint8Array([5, 6, 7, 8])
				})
				.wait({ tier: 'global' })
			stranger = fixture.as({
				user_id: 'attachment-stranger',
				authMode: 'local-first',
				claims: {}
			})
			// A grant for another organization must not authorize this transaction.
			await fixture.seed((seed) =>
				seed.insert(app.accountMemberships, {
					organizationId: otherOrganizationId,
					accountId: otherAccountId,
					userId: selectedMemberId,
					access: 'write',
					canDelete: false
				})
			)
			deniedTransactionId = deniedTransaction.id
			partId = part.id
		})

		it.each(['selected member', 'nonmember'])(
			'denies %s access to the parent, link, file and parts',
			async (role) => {
				const reader = role === 'selected member' ? selectedMemberDb : stranger

				expect(
					await reader.one(app.transactions.where({ id: deniedTransactionId }), { tier: 'remote' })
				).toBeNull()
				expect(
					await reader.one(app.transactionAttachments.where({ id: denied.link.id }), {
						tier: 'remote'
					})
				).toBeNull()
				expect(
					await reader.one(app.files.where({ id: denied.file.id }), { tier: 'remote' })
				).toBeNull()
				expect(await reader.one(app.fileParts.where({ id: partId }), { tier: 'remote' })).toBeNull()
			}
		)

		it.each(['owner', 'viewer'])(
			'allows an all-account %s to read links, files and bytes',
			async (role) => {
				const reader = role === 'owner' ? db : viewerDb

				expect(
					await reader.one(app.transactionAttachments.where({ id: denied.link.id }), {
						tier: 'remote'
					})
				).toBeTruthy()
				expect(
					await reader.one(app.files.where({ id: denied.file.id }), { tier: 'remote' })
				).toBeTruthy()
				expect(
					(await reader.one(app.fileParts.where({ id: partId }), { tier: 'remote' }))?.data
				).toEqual(new Uint8Array([5, 6, 7, 8]))
			}
		)

		it('allows a selected member to read a file in a granted account', async () => {
			expect(
				await selectedMemberDb.one(app.files.where({ id: allowed.file.id }), { tier: 'remote' })
			).toBeTruthy()
		})

		it.each([
			['admin', 'selected', false, true],
			['member', 'all', false, true],
			['viewer', 'selected', true, true],
			['viewer', 'selected', false, false]
		] satisfies ['admin' | 'member' | 'viewer', 'all' | 'selected', boolean, boolean][])(
			'checks %s access in %s mode with grant=%s (readable=%s)',
			async (role, mode, grant, readable) => {
				const identity = {
					user_id: `attachment-${role}-${mode}-${grant}`,
					authMode: 'local-first',
					claims: {}
				} satisfies import('jazz-tools/testing').PolicyTestSession
				const reader = fixture.as(identity)
				const userId = fixture.accountFor(identity)
				await fixture.seed((seed) =>
					seed.insert(app.organizationMembers, {
						organizationId,
						userId,
						role,
						accountAccessMode: mode
					})
				)
				if (grant)
					await fixture.seed((seed) =>
						seed.insert(app.accountMemberships, {
							organizationId,
							accountId: otherAccountId,
							userId,
							access: 'read',
							canDelete: false
						})
					)
				const link = await reader.one(app.transactionAttachments.where({ id: denied.link.id }), {
					tier: 'remote'
				})
				const file = await reader.one(app.files.where({ id: denied.file.id }), { tier: 'remote' })
				const bytes = await reader.one(app.fileParts.where({ id: partId }), { tier: 'remote' })
				expect(Boolean(link)).toBe(readable)
				expect(Boolean(file)).toBe(readable)
				expect(Boolean(bytes)).toBe(readable)
			}
		)

		it('does not expose another transaction file through a readable link', async () => {
			// A readable transaction link must not expose a different transaction's file.
			await selectedMemberDb
				.insert(app.transactionAttachments, { transactionId: expenseId, fileId: denied.file.id })
				.wait({ tier: 'global' })
			expect(
				await selectedMemberDb.one(app.files.where({ id: denied.file.id }), { tier: 'remote' })
			).toBeNull()
			expect(
				await selectedMemberDb.one(app.fileParts.where({ id: partId }), { tier: 'remote' })
			).toBeNull()
		})
	})
	async function imageLink(transactionId: string = expenseId) {
		const file = await db
			.insert(app.files, {
				transactionId,
				fileName: 'receipt.png',
				mimeType: 'image/png',
				sizeBytes: 4
			})
			.wait({ tier: 'global' })
		const link = await db
			.insert(app.transactionAttachments, { transactionId, fileId: file.id })
			.wait({ tier: 'global' })
		return { file, link }
	}

	it('atomically replaces a saved image for a writer, preserving identity and other references', async () => {
		const { file, link } = await imageLink()
		const companion = await db
			.insert(app.transactionAttachments, { transactionId: expenseId, fileId: file.id })
			.wait({ tier: 'global' })
		const bytes = new Uint8Array([1, 2, 3, 4])
		const replacement = await selectedMemberDb.transaction((tx) => {
			const next = tx.insert(app.files, {
				transactionId: expenseId,
				fileName: 'receipt.png',
				mimeType: 'image/png',
				sizeBytes: bytes.byteLength
			})
			tx.insert(app.fileParts, {
				fileId: next.id,
				partIndex: 0,
				sizeBytes: bytes.byteLength,
				data: bytes
			})
			tx.update(app.transactionAttachments, link.id, { fileId: next.id })
			return next.id
		})
		const newFileId = await replacement.wait({ tier: 'global' })
		expect(
			await selectedMemberDb.one(app.transactionAttachments.where({ id: link.id }), {
				tier: 'remote'
			})
		).toMatchObject({ id: link.id, transactionId: expenseId, fileId: newFileId })
		expect(
			await db.one(app.transactionAttachments.where({ id: companion.id }), { tier: 'remote' })
		).toMatchObject({ fileId: file.id })
		expect(await db.one(app.files.where({ id: file.id }), { tier: 'remote' })).toMatchObject({
			fileName: 'receipt.png'
		})
		const part = await viewerDb.one(app.fileParts.where({ fileId: newFileId }), { tier: 'remote' })
		expect(part?.data).toEqual(bytes)
	})

	it('denies replacement by a viewer, into another transaction file, or without an account grant', async () => {
		const { file, link } = await imageLink()
		const otherTransaction = await db
			.insert(app.transactions, { ...transaction('expense'), accountId: otherAccountId })
			.wait({ tier: 'global' })
		const foreign = await imageLink(otherTransaction.id)
		await expect(
			viewerDb.expectDenied((writer) =>
				writer.update(app.transactionAttachments, link.id, { fileId: file.id })
			)
		).resolves.toBeUndefined()
		await expect(
			selectedMemberDb.expectDenied((writer) =>
				writer.update(app.transactionAttachments, link.id, { fileId: foreign.file.id })
			)
		).resolves.toBeUndefined()
		await expect(async () => {
			await selectedMemberDb
				.update(app.transactionAttachments, foreign.link.id, { fileId: foreign.file.id })
				.wait({ tier: 'global' })
		}).rejects.toMatchObject({ name: 'PersistedWriteRejectedError', code: 'permission_denied' })
		expect(
			await db.one(app.transactionAttachments.where({ id: link.id }), { tier: 'remote' })
		).toMatchObject({ fileId: file.id })
	})
	function replacementInput(
		attachment: { id: string; fileId: string },
		bytes = new Uint8Array([1, 2, 3, 4])
	) {
		return {
			db: selectedMemberDb,
			transaction: { id: expenseId, accountId, organizationId },
			attachment,
			bytes,
			file: { name: 'receipt.png', type: 'image/png', size: bytes.byteLength }
		}
	}

	it('runs the replacement actor against real Jazz with ordered byte chunks and stable link identity', async () => {
		const { file, link } = await imageLink()
		const bytes = Uint8Array.from({ length: 600 * 1024 }, (_, index) => index % 251)
		const actor = createActor(transactionAttachmentReplacementMachine, {
			input: replacementInput({ id: link.id, fileId: file.id }, bytes)
		}).start()
		try {
			await expect(toPromise(actor)).resolves.toEqual({
				outcome: 'replaced',
				settlement: 'locallyPersisted'
			})
			const write = actor.getSnapshot().context.write
			if (!write) throw new Error('Missing replacement settlement')
			await write.wait({ tier: 'global' })
			const current = await selectedMemberDb.one(
				app.transactionAttachments.where({ id: link.id }),
				{ tier: 'remote' }
			)
			expect(current?.id).toBe(link.id)
			expect(current?.fileId).not.toBe(file.id)
			if (!current) throw new Error('Missing replaced attachment')
			const parts = await selectedMemberDb.all(
				app.fileParts.where({ fileId: current.fileId }).orderBy('partIndex'),
				{ tier: 'remote' }
			)
			expect(parts.map(({ sizeBytes }) => sizeBytes)).toEqual([256 * 1024, 256 * 1024, 88 * 1024])
			const savedBytes = Buffer.concat(parts.map(({ data }) => Buffer.from(data ?? [])))
			expect(savedBytes.equals(Buffer.from(bytes))).toBe(true)
		} finally {
			actor.stop()
		}
	})

	it('rolls back an already-observed stale file reference without replacing the attachment', async () => {
		const { file, link } = await imageLink()
		const next = await db
			.insert(app.files, {
				transactionId: expenseId,
				fileName: 'receipt.png',
				mimeType: 'image/png',
				sizeBytes: 4
			})
			.wait({ tier: 'global' })
		await selectedMemberDb
			.update(app.transactionAttachments, link.id, { fileId: next.id })
			.wait({ tier: 'global' })
		const actor = createActor(transactionAttachmentReplacementMachine, {
			input: replacementInput({ id: link.id, fileId: file.id })
		}).start()
		try {
			await expect(toPromise(actor)).resolves.toEqual({
				outcome: 'conflict',
				settlement: 'notStarted'
			})
			expect(
				await selectedMemberDb.one(app.transactionAttachments.where({ id: link.id }), {
					tier: 'local-first'
				})
			).toMatchObject({ fileId: next.id })
		} finally {
			actor.stop()
		}
	})

	it('drains and rolls back a transaction acquired after shutdown', async () => {
		const { file, link } = await imageLink()
		const transaction = selectedMemberDb.beginTransaction()
		const pending = Promise.withResolvers<typeof transaction>()
		const actor = createActor(
			transactionAttachmentReplacementMachine.provide({
				actors: { open: createAsyncLogic({ run: () => pending.promise }) }
			}),
			{ input: replacementInput({ id: link.id, fileId: file.id }) }
		).start()
		actor.send({ type: 'SHUTDOWN' })
		actor.send({ type: 'CANCEL' })
		pending.resolve(transaction)
		try {
			await expect(toPromise(actor)).resolves.toEqual({
				outcome: 'closed',
				settlement: 'notStarted'
			})
			expect(
				await selectedMemberDb.one(app.transactionAttachments.where({ id: link.id }), {
					tier: 'local-first'
				})
			).toMatchObject({ fileId: file.id })
		} finally {
			actor.stop()
		}
	})

	it('hydrates and edits a saved attachment through both real child machines', async () => {
		const { file, link } = await imageLink()
		await db
			.insert(app.fileParts, {
				fileId: file.id,
				partIndex: 0,
				sizeBytes: 4,
				data: new Uint8Array([1, 2, 3, 4])
			})
			.wait({ tier: 'global' })
		const platform = mockEditorPlatform()
		const observation = {
			editable: true,
			images: [{ id: link.id, fileId: file.id }],
			blockedIds: []
		}
		const settle = vi.fn((write: import('jazz-tools').WriteHandle) => write.wait({ tier: 'local' }))
		const actor = createActor(
			savedTransactionImageEditorMachine.provide({
				actors: {
					persist: transactionAttachmentReplacementMachine.provide({
						actors: {
							settle: createAsyncLogic({
								run: ({ input }: { input: import('jazz-tools').WriteHandle }) => settle(input)
							})
						}
					})
				}
			}),
			{
				input: {
					db: selectedMemberDb,
					transaction: { id: expenseId, accountId, organizationId },
					observation
				}
			}
		).start()
		try {
			actor.send({ type: 'EDIT', attachmentId: link.id })
			await waitFor(actor, (snapshot) => snapshot.matches({ editing: 'open' }), { timeout: 5000 })
			const editor = actor.getSnapshot().children.editor
			if (!editor) throw new Error('Missing saved-image editor')
			await waitFor(editor, (snapshot) => snapshot.matches('interactive'))
			expect(platform.decode).toHaveBeenCalledOnce()
			const input = platform.decode.mock.calls[0]?.[0]
			expect(input?.name).toBe('receipt.png')
			expect(input ? [...new Uint8Array(await input.arrayBuffer())] : []).toEqual([1, 2, 3, 4])
			editor.send({ type: 'SET_BLACK_WHITE', value: true })
			editor.send({ type: 'APPLY' })
			await waitFor(actor, (snapshot) => snapshot.matches('idle'), { timeout: 5000 })
			expect(actor.getSnapshot().context.problem).toBeNull()
			const write = settle.mock.calls[0]?.[0]
			if (!write) throw new Error('Missing saved-image write receipt')
			await write.wait({ tier: 'global' })
			const current = await selectedMemberDb.one(
				app.transactionAttachments.where({ id: link.id }),
				{ tier: 'local-first' }
			)
			expect(current?.fileId).not.toBe(file.id)
			expect(current?.id).toBe(link.id)
		} finally {
			actor.send({ type: 'SHUTDOWN' })
			await toPromise(actor)
			actor.stop()
			vi.restoreAllMocks()
			vi.unstubAllGlobals()
		}
	})
	it('rolls back staged metadata when a staging operation fails', async () => {
		const { file, link } = await imageLink()
		const actor = createActor(
			transactionAttachmentReplacementMachine.provide({
				actors: {
					stage: createAsyncLogic({
						run: async ({
							input
						}: {
							input: {
								tx: ReturnType<TestDb['beginTransaction']>
								request: AttachmentReplacementInput
							}
						}): Promise<string> => {
							input.tx.insert(app.files, {
								transactionId: expenseId,
								fileName: 'failed.png',
								mimeType: 'image/png',
								sizeBytes: 4
							})
							throw new Error('Injected part staging failure')
						}
					})
				}
			}),
			{ input: replacementInput({ id: link.id, fileId: file.id }) }
		).start()
		try {
			await expect(toPromise(actor)).resolves.toEqual({
				outcome: 'failed',
				settlement: 'notStarted'
			})
			expect(
				await selectedMemberDb.one(app.transactionAttachments.where({ id: link.id }), {
					tier: 'local-first'
				})
			).toMatchObject({ fileId: file.id })
		} finally {
			actor.stop()
		}
	})

	it('reports uncertain settlement without claiming that the original image is unchanged', async () => {
		const { file, link } = await imageLink()
		const actor = createActor(
			transactionAttachmentReplacementMachine.provide({
				actors: {
					settle: createAsyncLogic({
						run: async (): Promise<void> => {
							throw new Error('Lost settlement acknowledgement')
						}
					})
				}
			}),
			{ input: replacementInput({ id: link.id, fileId: file.id }) }
		).start()
		try {
			await expect(toPromise(actor)).resolves.toEqual({
				outcome: 'failed',
				settlement: 'unresolved'
			})
			const write = actor.getSnapshot().context.write
			if (!write) throw new Error('Missing issued write')
			const [fate] = await Promise.allSettled([write.wait({ tier: 'global' })])
			const current = await selectedMemberDb.one(
				app.transactionAttachments.where({ id: link.id }),
				{ tier: 'remote' }
			)
			expect(current?.id).toBe(link.id)
			if (fate.status === 'fulfilled') expect(current?.fileId).not.toBe(file.id)
			else expect(current?.fileId).toBe(file.id)
		} finally {
			actor.stop()
		}
	})

	it.each(['permission', 'replacement', 'removal'])(
		'cancels saved editing after an observed %s change',
		async (change) => {
			const { file, link } = await imageLink()
			await db
				.insert(app.fileParts, {
					fileId: file.id,
					partIndex: 0,
					sizeBytes: 4,
					data: new Uint8Array([1, 2, 3, 4])
				})
				.wait({ tier: 'global' })
			const platform = mockEditorPlatform()
			const pending = Promise.withResolvers<ImageBitmap>()
			platform.decode.mockReturnValue(pending.promise)
			const observation = {
				editable: true,
				images: [{ id: link.id, fileId: file.id }],
				blockedIds: []
			}
			const actor = createActor(savedTransactionImageEditorMachine, {
				input: {
					db: selectedMemberDb,
					transaction: { id: expenseId, accountId, organizationId },
					observation
				}
			}).start()
			try {
				actor.send({ type: 'EDIT', attachmentId: link.id })
				await waitFor(actor, (snapshot) => snapshot.matches({ editing: 'open' }), { timeout: 5000 })
				actor.send({
					type: 'OBSERVE',
					observation: {
						editable: change !== 'permission',
						images: [
							{ id: link.id, fileId: change === 'replacement' ? crypto.randomUUID() : file.id }
						],
						blockedIds: change === 'removal' ? [link.id] : []
					}
				})
				pending.resolve(platform.bitmap)
				await waitFor(actor, (snapshot) => snapshot.matches('idle'), { timeout: 5000 })
				expect(platform.bitmap.close).toHaveBeenCalledOnce()
				expect(platform.encode).not.toHaveBeenCalled()
				expect(
					await selectedMemberDb.one(app.transactionAttachments.where({ id: link.id }), {
						tier: 'local-first'
					})
				).toMatchObject({ fileId: file.id })
			} finally {
				pending.resolve(platform.bitmap)
				if (actor.getSnapshot().status === 'active') actor.send({ type: 'SHUTDOWN' })
				await toPromise(actor)
				actor.stop()
				vi.restoreAllMocks()
				vi.unstubAllGlobals()
			}
		}
	)
})

describe('income payment method permissions', () => {
	it('allows manual income without a method on insert and update', async () => {
		const row = await db.insert(app.transactions, transaction('income')).wait({ tier: 'global' })
		expect(row.paymentMethod).toBeNull()
		await db.update(app.transactions, row.id, { paymentMethod: null }).wait({ tier: 'global' })
		expect(
			(await db.one(app.transactions.where({ id: row.id }), { tier: 'remote' }))?.paymentMethod
		).toBeNull()
	})
	it.each(['cash', 'transfer', 'electronic'] satisfies ('cash' | 'transfer' | 'electronic')[])(
		'accepts manual %s income',
		async (paymentMethod) => {
			const row = await db
				.insert(app.transactions, { ...transaction('income'), paymentMethod })
				.wait({ tier: 'global' })
			expect(row.paymentMethod).toBe(paymentMethod)
		}
	)
	it('accepts imported income without a method but still requires details for check income', async () => {
		const row = await db
			.insert(app.transactions, {
				...transaction('income'),
				source: 'simplefin',
				externalId: 'provider-income'
			})
			.wait({ tier: 'global' })
		expect(row.paymentMethod).toBeNull()
		await expect(
			db.expectDenied((writer) =>
				writer.insert(app.transactions, { ...transaction('income'), paymentMethod: 'check' })
			)
		).resolves.toBeUndefined()
		await expect(
			db.expectDenied((writer) => writer.update(app.transactions, row.id, { source: 'manual' }))
		).resolves.toBeUndefined()
	})
})

describe('exact large money storage', () => {
	it.each([2_147_483_648, Number.MAX_SAFE_INTEGER])(
		'persists %s minor units through the SDK authority without truncation',
		async (amountMinor) => {
			const row = await db
				.insert(app.transactions, { ...transaction('expense'), amountMinor })
				.wait({ tier: 'global' })
			const saved = await db.one(app.transactions.where({ id: row.id }), { tier: 'remote' })
			expect(saved?.amountMinor).toBe(amountMinor)
		}
	)
})

describe('immutable transaction provenance', () => {
	it.each(['expense', 'income'] satisfies ('expense' | 'income')[])(
		'allows %s annotations but rejects provider identity and source changes',
		async (kind) => {
			const row = await db
				.insert(app.transactions, {
					...transaction(kind),
					source: 'simplefin',
					externalId: `immutable-${kind}`
				})
				.wait({ tier: 'global' })
			await db
				.update(app.transactions, row.id, { description: 'User description', memo: 'User notes' })
				.wait({ tier: 'global' })
			await expect(
				db.expectDenied((writer) =>
					writer.update(app.transactions, row.id, { externalId: 'changed' })
				)
			).resolves.toBeUndefined()
			await expect(
				Promise.resolve().then(() =>
					db.update(app.transactions, row.id, { externalId: null }).wait({ tier: 'global' })
				)
			).rejects.toThrow()
			await expect(
				db.expectDenied((writer) =>
					writer.update(app.transactions, row.id, {
						source: 'manual',
						paymentMethod: kind === 'income' ? 'cash' : null
					})
				)
			).resolves.toBeUndefined()
			const saved = await db.one(app.transactions.where({ id: row.id }), { tier: 'remote' })
			expect(saved).toMatchObject({
				source: 'simplefin',
				externalId: `immutable-${kind}`,
				description: 'User description',
				memo: 'User notes',
				paymentMethod: null
			})
		}
	)
	it('rejects converting a manual expense into a provider transaction', async () => {
		const row = await db.insert(app.transactions, transaction('expense')).wait({ tier: 'global' })
		await expect(
			db.expectDenied((writer) =>
				writer.update(app.transactions, row.id, { source: 'simplefin', externalId: 'forged' })
			)
		).resolves.toBeUndefined()
	})
})

describe('internal transfer read safety during unlink recovery', () => {
	it('reveals conflicting links only when the user can read both endpoint accounts', async () => {
		const effectiveTransferId = crypto.randomUUID()
		const conflictingTransferId = crypto.randomUUID()
		const expenseTransactionId = crypto.randomUUID()
		const effectiveIncomeId = crypto.randomUUID()
		const conflictingIncomeId = crypto.randomUUID()

		await fixture.seed((seed) =>
			seed.insert(
				app.transactions,
				{ ...transaction('expense'), internalTransferId: effectiveTransferId },
				{ id: expenseTransactionId }
			)
		)
		for (const [id, transferId] of [
			[effectiveIncomeId, effectiveTransferId],
			[conflictingIncomeId, conflictingTransferId]
		] satisfies [string, string][]) {
			await fixture.seed((seed) =>
				seed.insert(
					app.transactions,
					{
						...transaction('income'),
						accountId: otherAccountId,
						internalTransferId: transferId
					},
					{ id }
				)
			)
		}
		for (const [id, incomeTransactionId] of [
			[effectiveTransferId, effectiveIncomeId],
			[conflictingTransferId, conflictingIncomeId]
		] satisfies [string, string][]) {
			await fixture.seed((seed) =>
				seed.insert(
					app.internalTransfers,
					{
						organizationId,
						expenseTransactionId,
						incomeTransactionId,
						expenseAccountId: accountId,
						incomeAccountId: otherAccountId,
						amountMinor: 100,
						currency: 'USD'
					},
					{ id }
				)
			)
		}

		expect(
			(await db.one(app.internalTransfers.where({ id: conflictingTransferId }), { tier: 'remote' }))
				?.id
		).toBe(conflictingTransferId)
		expect(
			await selectedMemberDb.one(app.internalTransfers.where({ id: conflictingTransferId }), {
				tier: 'remote'
			})
		).toBeNull()
	})

	it('reveals a pending unlink only to a user who can read both endpoint accounts', async () => {
		const transferId = crypto.randomUUID()
		const pendingExpenseId = crypto.randomUUID()
		const pendingIncomeId = crypto.randomUUID()
		await fixture.seed((seed) =>
			seed.insert(
				app.transactions,
				{ ...transaction('expense'), internalTransferId: transferId },
				{ id: pendingExpenseId }
			)
		)
		await fixture.seed((seed) =>
			seed.insert(
				app.transactions,
				{
					...transaction('income'),
					accountId: otherAccountId,
					internalTransferId: transferId
				},
				{ id: pendingIncomeId }
			)
		)
		await fixture.seed((seed) =>
			seed.insert(
				app.internalTransfers,
				{
					organizationId,
					expenseTransactionId: pendingExpenseId,
					incomeTransactionId: pendingIncomeId,
					expenseAccountId: accountId,
					incomeAccountId: otherAccountId,
					amountMinor: 100,
					currency: 'USD'
				},
				{ id: transferId }
			)
		)
		const linked = app.internalTransfers.where({ id: transferId })
		expect((await db.one(linked, { tier: 'remote' }))?.id).toBe(transferId)
		expect(await selectedMemberDb.one(linked, { tier: 'remote' })).toBeNull()

		const clearMarkers = await db.transaction((tx) => {
			tx.update(app.transactions, pendingExpenseId, { internalTransferId: null })
			tx.update(app.transactions, pendingIncomeId, { internalTransferId: null })
		})
		await clearMarkers.wait({ tier: 'global' })

		expect((await db.one(linked, { tier: 'remote' }))?.id).toBe(transferId)
		expect(await selectedMemberDb.one(linked, { tier: 'remote' })).toBeNull()
	}, 30_000)
})

describe('linked transaction update safety', () => {
	it('allows metadata edits and rejects one-sided amount, account, or currency changes', async () => {
		const transferId = crypto.randomUUID()
		const linkedExpenseId = crypto.randomUUID()
		const incomeId = crypto.randomUUID()
		await fixture.seed((seed) =>
			seed.insert(
				app.transactions,
				{ ...transaction('expense'), internalTransferId: transferId },
				{ id: linkedExpenseId }
			)
		)
		await fixture.seed((seed) =>
			seed.insert(
				app.transactions,
				{
					...transaction('income'),
					accountId: otherAccountId,
					internalTransferId: transferId
				},
				{ id: incomeId }
			)
		)
		await fixture.seed((seed) =>
			seed.insert(
				app.internalTransfers,
				{
					organizationId,
					expenseTransactionId: linkedExpenseId,
					incomeTransactionId: incomeId,
					expenseAccountId: accountId,
					incomeAccountId: otherAccountId,
					amountMinor: 100,
					currency: 'USD'
				},
				{ id: transferId }
			)
		)

		await db
			.update(app.transactions, linkedExpenseId, { description: 'Card payment' })
			.wait({ tier: 'global' })
		await expect(
			db.expectDenied((writer) =>
				writer.update(app.transactions, linkedExpenseId, { amountMinor: 101 })
			)
		).resolves.toBeUndefined()
		await expect(
			db.expectDenied((writer) =>
				writer.update(app.transactions, linkedExpenseId, { accountId: otherAccountId })
			)
		).resolves.toBeUndefined()
		await expect(
			db.expectDenied((writer) =>
				writer.update(app.transactions, linkedExpenseId, { currency: 'CAD' })
			)
		).resolves.toBeUndefined()
		const saved = await db.one(app.transactions.where({ id: linkedExpenseId }), { tier: 'remote' })
		expect(saved).toMatchObject({
			amountMinor: 100,
			accountId,
			currency: 'USD',
			description: 'Card payment'
		})
	}, 30_000)
})

describe('linked transaction deletion permissions', () => {
	it('globally deletes an ordinary transaction', async () => {
		const transactionId = crypto.randomUUID()
		await fixture.seed((seed) =>
			seed.insert(app.transactions, transaction('expense'), { id: transactionId })
		)
		await db.delete(app.transactions, transactionId).wait({ tier: 'global' })
		expect(
			await db.one(app.transactions.where({ id: transactionId }), { tier: 'remote' })
		).toBeNull()
	})

	async function configureMemberDeleteGrants(expenseCanDelete: boolean, incomeCanDelete: boolean) {
		const sourceGrant = await db.one(
			app.accountMemberships.where({
				organizationId,
				accountId,
				userId: selectedMemberId
			})
		)
		if (!sourceGrant) throw new Error('Missing selected member source grant')
		await db
			.update(app.accountMemberships, sourceGrant.id, {
				access: 'write',
				canDelete: expenseCanDelete
			})
			.wait({ tier: 'global' })
		const destinationGrant = await db.one(
			app.accountMemberships.where({
				organizationId,
				accountId: otherAccountId,
				userId: selectedMemberId
			})
		)
		if (destinationGrant) {
			await db
				.update(app.accountMemberships, destinationGrant.id, {
					access: 'write',
					canDelete: incomeCanDelete
				})
				.wait({ tier: 'global' })
			return
		}
		await db
			.insert(app.accountMemberships, {
				organizationId,
				accountId: otherAccountId,
				userId: selectedMemberId,
				access: 'write',
				canDelete: incomeCanDelete
			})
			.wait({ tier: 'global' })
	}

	async function seedTransferPair() {
		const transferId = crypto.randomUUID()
		const linkedExpenseId = crypto.randomUUID()
		const linkedIncomeId = crypto.randomUUID()
		await fixture.seed((seed) =>
			seed.insert(
				app.transactions,
				{ ...transaction('expense'), internalTransferId: transferId },
				{ id: linkedExpenseId }
			)
		)
		await fixture.seed((seed) =>
			seed.insert(
				app.transactions,
				{
					...transaction('income'),
					accountId: otherAccountId,
					internalTransferId: transferId
				},
				{ id: linkedIncomeId }
			)
		)
		await fixture.seed((seed) =>
			seed.insert(
				app.internalTransfers,
				{
					organizationId,
					expenseTransactionId: linkedExpenseId,
					incomeTransactionId: linkedIncomeId,
					expenseAccountId: accountId,
					incomeAccountId: otherAccountId,
					amountMinor: 100,
					currency: 'USD'
				},
				{ id: transferId }
			)
		)
		return { transferId, linkedExpenseId, linkedIncomeId }
	}

	async function clearTransferMarkers(
		writer: TestDb,
		linkedExpenseId: string,
		linkedIncomeId: string
	) {
		const write = await writer.transaction((tx) => {
			tx.update(app.transactions, linkedExpenseId, { internalTransferId: null })
			tx.update(app.transactions, linkedIncomeId, { internalTransferId: null })
		})
		await write.wait({ tier: 'global' })
	}

	it('globally deletes a linked transfer after marker clearing settles', async () => {
		const { transferId, linkedExpenseId, linkedIncomeId } = await seedTransferPair()
		await clearTransferMarkers(db, linkedExpenseId, linkedIncomeId)
		const deletion = await db.transaction((tx) => {
			tx.delete(app.internalTransfers, transferId)
			tx.delete(app.transactions, linkedExpenseId)
			tx.delete(app.transactions, linkedIncomeId)
		})
		await deletion.wait({ tier: 'global' })

		expect(
			await db.one(app.internalTransfers.where({ id: transferId }), { tier: 'remote' })
		).toBeNull()
		expect(
			await db.one(app.transactions.where({ id: linkedExpenseId }), { tier: 'remote' })
		).toBeNull()
		expect(
			await db.one(app.transactions.where({ id: linkedIncomeId }), { tier: 'remote' })
		).toBeNull()
	}, 10_000)

	it('allows a selected member to delete the transfer with write access to both accounts', async () => {
		const { transferId, linkedExpenseId, linkedIncomeId } = await seedTransferPair()
		await configureMemberDeleteGrants(false, false)
		await clearTransferMarkers(selectedMemberDb, linkedExpenseId, linkedIncomeId)
		await selectedMemberDb.delete(app.internalTransfers, transferId).wait({ tier: 'global' })

		expect(
			await db.one(app.internalTransfers.where({ id: transferId }), { tier: 'remote' })
		).toBeNull()
	}, 10_000)

	it('denies transfer deletion when a selected member can write to only one endpoint account', async () => {
		const { transferId, linkedExpenseId, linkedIncomeId } = await seedTransferPair()
		await configureMemberDeleteGrants(false, false)
		const incomeGrant = await db.one(
			app.accountMemberships.where({
				organizationId,
				accountId: otherAccountId,
				userId: selectedMemberId
			})
		)
		if (!incomeGrant) throw new Error('Missing selected member income grant')
		await db
			.update(app.accountMemberships, incomeGrant.id, { access: 'read' })
			.wait({ tier: 'global' })
		await clearTransferMarkers(db, linkedExpenseId, linkedIncomeId)

		await expect(
			selectedMemberDb.expectDenied((writer) => writer.delete(app.internalTransfers, transferId))
		).resolves.toBeUndefined()
		expect(
			(await db.one(app.internalTransfers.where({ id: transferId }), { tier: 'remote' }))?.id
		).toBe(transferId)
	}, 10_000)

	it('rejects endpoint deletion without that account delete grant', async () => {
		const { linkedIncomeId } = await seedTransferPair()
		await configureMemberDeleteGrants(true, false)
		const linkedExpenseId = (
			await db.one(app.internalTransfers.where({ incomeTransactionId: linkedIncomeId }))
		)?.expenseTransactionId
		if (!linkedExpenseId) throw new Error('Missing seeded transfer expense')
		await clearTransferMarkers(selectedMemberDb, linkedExpenseId, linkedIncomeId)
		await expect(
			selectedMemberDb.expectDenied((writer) => writer.delete(app.transactions, linkedIncomeId))
		).resolves.toBeUndefined()
		expect(
			(await db.one(app.transactions.where({ id: linkedIncomeId }), { tier: 'remote' }))?.id
		).toBe(linkedIncomeId)
	})
})

const moveCases = [
	{
		label: 'owner',
		role: 'owner',
		mode: 'selected',
		source: 'none',
		target: 'none',
		allowed: true
	},
	{
		label: 'admin',
		role: 'admin',
		mode: 'selected',
		source: 'none',
		target: 'none',
		allowed: true
	},
	{
		label: 'all-account member',
		role: 'member',
		mode: 'all',
		source: 'none',
		target: 'none',
		allowed: true
	},
	{
		label: 'selected member with both writes',
		role: 'member',
		mode: 'selected',
		source: 'write',
		target: 'write',
		allowed: true
	},
	{
		label: 'selected member with only source write',
		role: 'member',
		mode: 'selected',
		source: 'write',
		target: 'none',
		allowed: false
	},
	{
		label: 'selected member with only destination write',
		role: 'member',
		mode: 'selected',
		source: 'none',
		target: 'write',
		allowed: false
	},
	{
		label: 'selected member with source read',
		role: 'member',
		mode: 'selected',
		source: 'read',
		target: 'write',
		allowed: false
	},
	{
		label: 'selected member with destination read',
		role: 'member',
		mode: 'selected',
		source: 'write',
		target: 'read',
		allowed: false
	},
	{
		label: 'selected member with no grants',
		role: 'member',
		mode: 'selected',
		source: 'none',
		target: 'none',
		allowed: false
	},
	{
		label: 'all-account viewer',
		role: 'viewer',
		mode: 'all',
		source: 'write',
		target: 'write',
		allowed: false
	},
	{
		label: 'selected viewer with both grants',
		role: 'viewer',
		mode: 'selected',
		source: 'write',
		target: 'write',
		allowed: false
	},
	{
		label: 'nonmember with orphan grants',
		role: null,
		mode: 'selected',
		source: 'write',
		target: 'write',
		allowed: false
	}
] satisfies {
	label: string
	role: 'owner' | 'admin' | 'member' | 'viewer' | null
	mode: 'all' | 'selected'
	source: 'write' | 'read' | 'none'
	target: 'write' | 'read' | 'none'
	allowed: boolean
}[]

describe.each(['income', 'expense'] satisfies ('income' | 'expense')[])(
	'atomic %s transaction and Check account movement',
	(kind) => {
		it.each(moveCases)('$label', async ({ label, role, mode, source, target, allowed }) => {
			const actorSession = {
				user_id: `check-move-${kind}-${label}`,
				authMode: 'local-first',
				claims: {}
			} satisfies import('jazz-tools/testing').PolicyTestSession
			const writer = fixture.as(actorSession)
			const userId = fixture.accountFor(actorSession)
			if (role !== null)
				await fixture.seed((seed) =>
					seed.insert(app.organizationMembers, {
						organizationId,
						userId,
						role,
						accountAccessMode: mode
					})
				)
			for (const [id, access] of [
				[accountId, source],
				[otherAccountId, target]
			] satisfies [string, 'write' | 'read' | 'none'][]) {
				if (access === 'write' || access === 'read')
					await fixture.seed((seed) =>
						seed.insert(app.accountMemberships, {
							organizationId,
							userId,
							accountId: id,
							access,
							canDelete: false
						})
					)
			}
			const check = await db
				.insert(app.checks, {
					organizationId,
					accountId,
					checkNumber: 'move',
					checkDate: '2026-10-23'
				})
				.wait({ tier: 'global' })
			const row = await db
				.insert(app.transactions, {
					...transaction(kind),
					paymentMethod: 'check',
					checkId: check.id
				})
				.wait({ tier: 'global' })
			const write = await writer.transaction((tx) => {
				tx.update(app.checks, check.id, { accountId: otherAccountId })
				tx.update(app.transactions, row.id, { accountId: otherAccountId })
			})
			if (allowed) await write.wait({ tier: 'global' })
			else await expect(write.wait({ tier: 'global' })).rejects.toThrow()
			const expectedAccountId = allowed ? otherAccountId : accountId
			expect(
				(await db.one(app.checks.where({ id: check.id }), { tier: 'remote' }))?.accountId
			).toBe(expectedAccountId)
			const saved = await db.one(app.transactions.where({ id: row.id }), { tier: 'remote' })
			expect(saved).toMatchObject({ accountId: expectedAccountId, checkId: check.id })
		})

		it.each(['foreign', 'archived', 'invalid-category'])(
			'rejects a %s destination or ledger update without moving either record',
			async (scenario) => {
				const archived =
					scenario === 'archived'
						? await fixture.seed((seed) =>
								seed.insert(app.accounts, {
									organizationId,
									name: 'Archived move target',
									kind: 'cash',
									currency: 'USD',
									archivedAt: new Date()
								})
							)
						: null
				const targetId =
					archived?.id ?? (scenario === 'foreign' ? foreignAccountId : otherAccountId)
				const check = await db
					.insert(app.checks, {
						organizationId,
						accountId,
						checkNumber: 'denied-move',
						checkDate: '2026-10-23'
					})
					.wait({ tier: 'global' })
				const row = await db
					.insert(app.transactions, {
						...transaction(kind),
						paymentMethod: 'check',
						checkId: check.id
					})
					.wait({ tier: 'global' })
				const write = await db.transaction((tx) => {
					tx.update(app.checks, check.id, { accountId: targetId })
					tx.update(app.transactions, row.id, {
						accountId: targetId,
						...(scenario === 'invalid-category' ? { categoryId: crypto.randomUUID() } : {})
					})
				})
				await expect(write.wait({ tier: 'global' })).rejects.toThrow()
				expect(
					(await db.one(app.checks.where({ id: check.id }), { tier: 'remote' }))?.accountId
				).toBe(accountId)
				expect(
					(await db.one(app.transactions.where({ id: row.id }), { tier: 'remote' }))?.accountId
				).toBe(accountId)
			}
		)
	}
)

describe('new paired transfer insertion', () => {
	let fixture: PolicyTestApp
	let db: TestDb
	// These cases must not inherit the earlier tests' records and session clients.
	beforeEach(async () => {
		;({ fixture, db } = await createPermissionFixture())
	}, 30_000)
	afterEach(async () => {
		await fixture?.shutdown()
	})

	const invalidTransferFacts = [
		{ label: 'amount', overrides: { expenseAmountMinor: 101 } },
		{ label: 'currency', overrides: { incomeCurrency: 'TZS' } },
		{ label: 'account', overrides: { expenseAccountId: otherAccountId } },
		{ label: 'workspace', overrides: { organizationId: otherOrganizationId } },
		{ label: 'endpoint', overrides: { incomeTransactionId: crypto.randomUUID() } }
	]

	it.each(moveCases)(
		'globally authorizes linking accepted provider endpoints for $label: $allowed',
		async ({ label, role, mode, source, target, allowed }) => {
			const actorSession = {
				user_id: `provider-link-${label}`,
				authMode: 'local-first',
				claims: {}
			} satisfies import('jazz-tools/testing').PolicyTestSession
			const writer = fixture.as(actorSession)
			const userId = fixture.accountFor(actorSession)
			if (role !== null)
				await fixture.seed((seed) =>
					seed.insert(app.organizationMembers, {
						organizationId,
						userId,
						role,
						accountAccessMode: mode
					})
				)
			for (const [id, access] of [
				[accountId, source],
				[otherAccountId, target]
			] satisfies [string, 'write' | 'read' | 'none'][]) {
				if (access !== 'none')
					await fixture.seed((seed) =>
						seed.insert(app.accountMemberships, {
							organizationId,
							userId,
							accountId: id,
							access,
							canDelete: false
						})
					)
			}
			const expense = await db
				.insert(app.transactions, {
					...transaction('expense'),
					source: 'simplefin',
					externalId: `accepted-expense-${label}`
				})
				.wait({ tier: 'global' })
			const income = await db
				.insert(app.transactions, {
					...transaction('income'),
					accountId: otherAccountId,
					source: 'simplefin',
					externalId: `accepted-income-${label}`
				})
				.wait({ tier: 'global' })
			const transferId = crypto.randomUUID()
			const write = await writer.transaction((tx) => {
				tx.update(app.transactions, expense.id, { internalTransferId: transferId })
				tx.update(app.transactions, income.id, { internalTransferId: transferId })
				tx.insert(
					app.internalTransfers,
					{
						organizationId,
						expenseTransactionId: expense.id,
						incomeTransactionId: income.id,
						expenseAccountId: accountId,
						incomeAccountId: otherAccountId,
						expenseAmountMinor: 100,
						incomeAmountMinor: 100,
						expenseCurrency: 'USD',
						incomeCurrency: 'USD'
					},
					{ id: transferId }
				)
			})
			if (allowed) {
				await write.wait({ tier: 'global' })
				expect(
					(await db.one(app.internalTransfers.where({ id: transferId }), { tier: 'remote' }))?.id
				).toBe(transferId)
			} else {
				await expect(write.wait({ tier: 'global' })).rejects.toThrow(
					/permission_denied|AuthorizationDenied|Write rejected by server authorization/
				)
				expect(
					await db.one(app.internalTransfers.where({ id: transferId }), { tier: 'remote' })
				).toBeNull()
			}
			const expectedMarker = allowed ? transferId : null
			expect(
				await db.one(app.transactions.where({ id: expense.id }), { tier: 'remote' })
			).toMatchObject({
				internalTransferId: expectedMarker,
				source: 'simplefin',
				externalId: `accepted-expense-${label}`,
				amountMinor: 100
			})
			expect(
				await db.one(app.transactions.where({ id: income.id }), { tier: 'remote' })
			).toMatchObject({
				internalTransferId: expectedMarker,
				source: 'simplefin',
				externalId: `accepted-income-${label}`,
				amountMinor: 100
			})
		}
	)

	function pairRecords(
		income: Pick<TransactionRow, 'accountId' | 'amountMinor' | 'currency'> = {
			accountId: otherAccountId,
			amountMinor: 100,
			currency: 'USD'
		}
	) {
		const transferId = crypto.randomUUID()
		const expenseTransactionId = crypto.randomUUID()
		const incomeTransactionId = crypto.randomUUID()
		return {
			transferId,
			expenseTransactionId,
			incomeTransactionId,
			expense: { ...transaction('expense'), internalTransferId: transferId },
			income: { ...transaction('income'), ...income, internalTransferId: transferId },
			transfer: {
				organizationId,
				expenseTransactionId,
				incomeTransactionId,
				expenseAccountId: accountId,
				incomeAccountId: income.accountId,
				expenseAmountMinor: 100,
				incomeAmountMinor: income.amountMinor,
				expenseCurrency: 'USD',
				incomeCurrency: income.currency
			}
		}
	}

	it.each(moveCases)(
		'globally authorizes a new pair for $label: $allowed',
		async ({ label, role, mode, source, target, allowed }) => {
			const actorSession = {
				user_id: `paired-create-${label}`,
				authMode: 'local-first',
				claims: {}
			} satisfies import('jazz-tools/testing').PolicyTestSession
			const writer = fixture.as(actorSession)
			const userId = fixture.accountFor(actorSession)
			if (role !== null)
				await fixture.seed((seed) =>
					seed.insert(app.organizationMembers, {
						organizationId,
						userId,
						role,
						accountAccessMode: mode
					})
				)
			for (const [id, access] of [
				[accountId, source],
				[otherAccountId, target]
			] satisfies [string, 'write' | 'read' | 'none'][]) {
				if (access !== 'none')
					await fixture.seed((seed) =>
						seed.insert(app.accountMemberships, {
							organizationId,
							userId,
							accountId: id,
							access,
							canDelete: false
						})
					)
			}
			const pair = pairRecords()
			const write = await writer.transaction((tx) => {
				tx.insert(app.transactions, pair.expense, { id: pair.expenseTransactionId })
				tx.insert(app.transactions, pair.income, { id: pair.incomeTransactionId })
				tx.insert(app.internalTransfers, pair.transfer, { id: pair.transferId })
			})
			if (allowed) {
				await write.wait({ tier: 'global' })
				expect(
					(
						await writer.one(app.internalTransfers.where({ id: pair.transferId }), {
							tier: 'remote'
						})
					)?.id
				).toBe(pair.transferId)
			} else {
				await expect(write.wait({ tier: 'global' })).rejects.toThrow(
					/permission_denied|AuthorizationDenied|Write rejected by server authorization/
				)
				expect(
					await db.one(app.internalTransfers.where({ id: pair.transferId }), { tier: 'remote' })
				).toBeNull()
				expect(
					await db.one(app.transactions.where({ id: pair.expenseTransactionId }), {
						tier: 'remote'
					})
				).toBeNull()
				expect(
					await db.one(app.transactions.where({ id: pair.incomeTransactionId }), { tier: 'remote' })
				).toBeNull()
			}
		}
	)

	it('globally accepts a cross-currency pair without converting its amounts', async () => {
		const account = await db
			.insert(app.accounts, { organizationId, name: 'Paired TZS', kind: 'cash', currency: 'TZS' })
			.wait({ tier: 'global' })
		const pair = pairRecords({ accountId: account.id, amountMinor: 65000, currency: 'TZS' })
		const write = await db.transaction((tx) => {
			tx.insert(app.transactions, pair.expense, { id: pair.expenseTransactionId })
			tx.insert(app.transactions, pair.income, { id: pair.incomeTransactionId })
			tx.insert(app.internalTransfers, pair.transfer, { id: pair.transferId })
		})
		await write.wait({ tier: 'global' })
		expect(
			await db.one(app.internalTransfers.where({ id: pair.transferId }), { tier: 'remote' })
		).toMatchObject({
			expenseAmountMinor: 100,
			expenseCurrency: 'USD',
			incomeAmountMinor: 65000,
			incomeCurrency: 'TZS'
		})
	})

	it.each(invalidTransferFacts)(
		'rejects forged transfer $label facts atomically',
		async ({ overrides }) => {
			const pair = pairRecords()
			const write = await db.transaction((tx) => {
				tx.insert(app.transactions, pair.expense, { id: pair.expenseTransactionId })
				tx.insert(app.transactions, pair.income, { id: pair.incomeTransactionId })
				tx.insert(
					app.internalTransfers,
					{ ...pair.transfer, ...overrides },
					{ id: pair.transferId }
				)
			})
			await expect(write.wait({ tier: 'global' })).rejects.toThrow(
				/permission_denied|AuthorizationDenied|Write rejected by server authorization/
			)
			expect(
				await db.one(app.internalTransfers.where({ id: pair.transferId }), { tier: 'remote' })
			).toBeNull()
			expect(
				await db.one(app.transactions.where({ id: pair.expenseTransactionId }), { tier: 'remote' })
			).toBeNull()
			expect(
				await db.one(app.transactions.where({ id: pair.incomeTransactionId }), { tier: 'remote' })
			).toBeNull()
		}
	)

	it('globally accepts a financially matching pending-unlink record with both markers clear', async () => {
		const pair = pairRecords()
		await db
			.insert(
				app.transactions,
				{ ...pair.expense, internalTransferId: null },
				{ id: pair.expenseTransactionId }
			)
			.wait({ tier: 'global' })
		await db
			.insert(
				app.transactions,
				{ ...pair.income, internalTransferId: null },
				{ id: pair.incomeTransactionId }
			)
			.wait({ tier: 'global' })
		await db
			.insert(app.internalTransfers, pair.transfer, { id: pair.transferId })
			.wait({ tier: 'global' })
		expect(
			(await db.one(app.internalTransfers.where({ id: pair.transferId }), { tier: 'remote' }))?.id
		).toBe(pair.transferId)
		expect(
			(await db.one(app.transactions.where({ id: pair.expenseTransactionId }), { tier: 'remote' }))
				?.internalTransferId
		).toBeNull()
		expect(
			(await db.one(app.transactions.where({ id: pair.incomeTransactionId }), { tier: 'remote' }))
				?.internalTransferId
		).toBeNull()
	})

	it.each(invalidTransferFacts)(
		'rejects forged $label facts even when both accepted markers are clear',
		async ({ overrides }) => {
			const pair = pairRecords()
			await db
				.insert(
					app.transactions,
					{ ...pair.expense, internalTransferId: null },
					{ id: pair.expenseTransactionId }
				)
				.wait({ tier: 'global' })
			await db
				.insert(
					app.transactions,
					{ ...pair.income, internalTransferId: null },
					{ id: pair.incomeTransactionId }
				)
				.wait({ tier: 'global' })
			await expect(
				db.expectDenied((writer) =>
					writer.insert(
						app.internalTransfers,
						{ ...pair.transfer, ...overrides },
						{ id: pair.transferId }
					)
				)
			).resolves.toBeUndefined()
			expect(
				await db.one(app.internalTransfers.where({ id: pair.transferId }), { tier: 'remote' })
			).toBeNull()
		}
	)

	it.each(['both marked', 'one marked'])(
		'rejects a new transfer claiming endpoints already owned by another link: %s',
		async (state) => {
			const pair = pairRecords()
			const write = await db.transaction((tx) => {
				tx.insert(app.transactions, pair.expense, { id: pair.expenseTransactionId })
				tx.insert(app.transactions, pair.income, { id: pair.incomeTransactionId })
				tx.insert(app.internalTransfers, pair.transfer, { id: pair.transferId })
			})
			await write.wait({ tier: 'global' })
			if (state === 'one marked')
				await db
					.update(app.transactions, pair.incomeTransactionId, { internalTransferId: null })
					.wait({ tier: 'global' })
			const claimantId = crypto.randomUUID()
			await expect(
				db.expectDenied((writer) =>
					writer.insert(app.internalTransfers, pair.transfer, { id: claimantId })
				)
			).resolves.toBeUndefined()
			expect(
				await db.one(app.internalTransfers.where({ id: claimantId }), { tier: 'remote' })
			).toBeNull()
			expect(
				(
					await db.one(app.transactions.where({ id: pair.expenseTransactionId }), {
						tier: 'remote'
					})
				)?.internalTransferId
			).toBe(pair.transferId)
		}
	)

	it('admits a standalone manual marker under account access but still rejects inventing one by update', async () => {
		const marker = crypto.randomUUID()
		const orphan = await db
			.insert(app.transactions, { ...transaction('expense'), internalTransferId: marker })
			.wait({ tier: 'global' })
		expect(
			(await db.one(app.transactions.where({ id: orphan.id }), { tier: 'remote' }))
				?.internalTransferId
		).toBe(marker)
		const ordinary = await db
			.insert(app.transactions, transaction('expense'))
			.wait({ tier: 'global' })
		await expect(
			db.expectDenied((writer) =>
				writer.update(app.transactions, ordinary.id, { internalTransferId: marker })
			)
		).resolves.toBeUndefined()
	})

	it('does not admit a new provider transaction with an orphan marker', async () => {
		await expect(
			db.expectDenied((writer) =>
				writer.insert(app.transactions, {
					...transaction('expense'),
					source: 'simplefin',
					externalId: 'forged-transfer-marker',
					internalTransferId: crypto.randomUUID()
				})
			)
		).resolves.toBeUndefined()
	})
})
