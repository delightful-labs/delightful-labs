import { prepareSidebar } from './helpers/ui.js'
import { expect, test, type Page } from '@playwright/test'
import type { OrganizationMember } from '../src/lib/schema.js'

declare global {
	interface Window {
		workspacePermissionTest: {
			db: ReturnType<typeof import('jazz-tools/svelte').getDb>
			app: typeof import('../src/lib/schema.js').app
			userId: string
		}
	}
}
type Role = NonNullable<OrganizationMember['role']>
type Mode = OrganizationMember['accountAccessMode']

const scenarios: {
	name: string
	role?: Role
	mode: Mode
	grant?: 'read' | 'write'
	read: boolean
	write: boolean
	all: boolean
}[] = [
	{ name: 'unrelated user', mode: 'selected', read: false, write: false, all: false },
	{ name: 'admin', role: 'admin', mode: 'selected', read: true, write: true, all: true },
	{
		name: 'member with all access',
		role: 'member',
		mode: 'all',
		read: true,
		write: true,
		all: true
	},
	{
		name: 'viewer with all access',
		role: 'viewer',
		mode: 'all',
		read: true,
		write: false,
		all: true
	},
	{
		name: 'member with no grants',
		role: 'member',
		mode: 'selected',
		read: false,
		write: false,
		all: false
	},
	{
		name: 'member with a read grant',
		role: 'member',
		mode: 'selected',
		grant: 'read',
		read: true,
		write: false,
		all: false
	},
	{
		name: 'member with a write grant',
		role: 'member',
		mode: 'selected',
		grant: 'write',
		read: true,
		write: true,
		all: false
	},
	{
		name: 'viewer with a write grant',
		role: 'viewer',
		mode: 'selected',
		grant: 'write',
		read: true,
		write: false,
		all: false
	},
	{
		name: 'grant without membership',
		mode: 'selected',
		grant: 'write',
		read: false,
		write: false,
		all: false
	}
]

async function start(page: Page) {
	await page.goto('/')
	await expect(page.getByRole('complementary').getByRole('navigation')).toBeVisible()
	await prepareSidebar(page)
	const workspace = page.getByLabel('Current Workspace', { exact: true })
	await expect(workspace).toHaveValue(
		/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
	)
	await page.evaluate(async () => {
		const schemaPath = '/src/lib/schema.ts'
		const sessionPath = '/src/lib/runtime/jazz-session.ts'
		const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
		const { getCurrentJazzSession }: typeof import('../src/lib/runtime/jazz-session.js') =
			await import(sessionPath)
		const snapshot = getCurrentJazzSession()?.getSnapshot()
		if (!snapshot?.client || !snapshot.account)
			throw new Error('Test database session is not ready.')
		window.workspacePermissionTest = { db: snapshot.client.db, app, userId: snapshot.account.id }
	})
}

test(
	'cannot move a category into an unrelated workspace',
	{ tag: ['@permissions', '@workspaces', '@categories'] },
	async ({ page, browser }) => {
		await start(page)
		const targetOrganizationId = await page
			.getByLabel('Current Workspace', { exact: true })
			.inputValue()
		const subjectContext = await browser.newContext({ baseURL: new URL(page.url()).origin })
		try {
			const subject = await subjectContext.newPage()
			await start(subject)
			const organizationId = await subject
				.getByLabel('Current Workspace', { exact: true })
				.inputValue()
			const outcome = await subject.evaluate(
				async ({ organizationId, targetOrganizationId }) => {
					const { app, db } = window.workspacePermissionTest
					const category = await db
						.insert(app.categories, {
							organizationId,
							name: 'Category boundary fixture',
							kind: 'expense',
							isSystem: false
						})
						.wait({ tier: 'global' })
					try {
						await db
							.update(app.categories, category.id, { organizationId: targetOrganizationId })
							.wait({ tier: 'global' })
						return 'accepted'
					} catch (error) {
						return error instanceof Error ? error.message : 'unknown-error'
					}
				},
				{ organizationId, targetOrganizationId }
			)
			expect(outcome).toMatch(/AuthorizationDenied|permission_denied/)
			const injected = await page.evaluate(async (organizationId) => {
				const { app, db } = window.workspacePermissionTest
				return db.all(app.categories.where({ organizationId, name: 'Category boundary fixture' }), {
					tier: 'remote'
				})
			}, targetOrganizationId)
			expect(injected).toHaveLength(0)
		} finally {
			await subjectContext.close()
		}
	}
)

for (const scenario of scenarios) {
	test(
		`workspace access: ${scenario.name}`,
		{ tag: ['@permissions', '@workspaces', '@accounts', '@transactions'] },
		async ({ page, browser }) => {
			await start(page)
			const subjectContext = await browser.newContext({ baseURL: new URL(page.url()).origin })
			try {
				const subject = await subjectContext.newPage()
				await start(subject)
				const subjectId = await subject.evaluate(() => window.workspacePermissionTest.userId)
				if (!subjectId) throw new Error('Test identity is missing.')
				const organizationId = await page
					.getByLabel('Current Workspace', { exact: true })
					.inputValue()
				const fixture = await page.evaluate(
					async ({ organizationId, subjectId, role, mode, grant }) => {
						const { app, db } = window.workspacePermissionTest
						const first = await db
							.insert(app.accounts, {
								organizationId,
								name: 'Shared checking',
								kind: 'bank',
								currency: 'USD'
							})
							.wait({ tier: 'global' })
						const second = await db
							.insert(app.accounts, {
								organizationId,
								name: 'Other checking',
								kind: 'bank',
								currency: 'USD'
							})
							.wait({ tier: 'global' })
						const category = await db.one(
							app.categories.where({ organizationId, kind: 'expense', isSystem: true }),
							{ tier: 'remote' }
						)
						if (!category) throw new Error('Test expense category is missing.')
						const transaction = await db
							.insert(app.transactions, {
								organizationId,
								accountId: first.id,
								categoryId: category.id,
								kind: 'expense',
								amountMinor: 100,
								currency: 'USD',
								bookedOn: '2026-10-13',
								source: 'manual',
								memo: 'Shared expense'
							})
							.wait({ tier: 'global' })
						const connection = await db
							.insert(app.simplefinConnections, {
								organizationId,
								accessUrl: '',
								ownerId: window.workspacePermissionTest.userId,
								credentialVersion: 1,
								credentialId: 'dGVzdA',
								prfSalt: 'dGVzdA',
								iv: 'dGVzdA',
								ciphertext: 'dGVzdA',
								status: 'active',
								claimedAt: new Date()
							})
							.wait({ tier: 'global' })
						if (role)
							await db
								.insert(app.organizationMembers, {
									organizationId,
									userId: subjectId,
									role,
									accountAccessMode: mode
								})
								.wait({ tier: 'global' })
						if (grant)
							await db
								.insert(app.accountMemberships, {
									organizationId,
									accountId: first.id,
									userId: subjectId,
									access: grant,
									canDelete: false
								})
								.wait({ tier: 'global' })
						return {
							firstId: first.id,
							secondId: second.id,
							transactionId: transaction.id,
							connectionId: connection.id
						}
					},
					{
						organizationId,
						subjectId,
						role: scenario.role,
						mode: scenario.mode,
						grant: scenario.grant
					}
				)

				const access = await subject.evaluate(
					async ({ organizationId, fixture }) => {
						const { app, db } = window.workspacePermissionTest
						const rows = await db.all(app.accounts.where({ organizationId }), { tier: 'remote' })
						return {
							workspace: Boolean(
								await db.one(app.organizations.where({ id: organizationId }), { tier: 'remote' })
							),
							transaction: Boolean(
								await db.one(app.transactions.where({ id: fixture.transactionId }), {
									tier: 'remote'
								})
							),
							credentialEnvelope: Boolean(
								await db.one(app.simplefinConnections.where({ id: fixture.connectionId }), {
									tier: 'remote'
								})
							),
							rows: rows.map((row) => row.id)
						}
					},
					{ organizationId, fixture }
				)
				expect(access.workspace).toBe(Boolean(scenario.role))
				expect(access.transaction).toBe(scenario.read)
				expect(access.credentialEnvelope).toBe(scenario.role === 'admin')
				expect(access.rows.sort()).toEqual(
					(scenario.all
						? [fixture.firstId, fixture.secondId]
						: scenario.read
							? [fixture.firstId]
							: []
					).sort()
				)

				const outcome = await subject.evaluate(
					async ({ id, organizationId, read }) => {
						const { app, db } = window.workspacePermissionTest
						try {
							if (read) {
								await db
									.update(app.accounts, id, { name: 'Changed by subject' })
									.wait({ tier: 'global' })
							} else {
								await db
									.insert(app.accounts, {
										organizationId,
										name: 'Forbidden account',
										kind: 'bank',
										currency: 'USD'
									})
									.wait({ tier: 'global' })
							}
							return 'accepted'
						} catch (error) {
							return error instanceof Error ? error.message : 'unknown-error'
						}
					},
					{ id: fixture.firstId, organizationId, read: scenario.read }
				)
				if (scenario.write) expect(outcome).toBe('accepted')
				else expect(outcome).toMatch(/AuthorizationDenied|permission_denied/)
				const savedName = await page.evaluate(async (id) => {
					const { app, db } = window.workspacePermissionTest
					return (await db.one(app.accounts.where({ id }), { tier: 'remote' }))?.name
				}, fixture.firstId)
				expect(savedName).toBe(scenario.write ? 'Changed by subject' : 'Shared checking')
				const savedAccounts = await page.evaluate(async (organizationId) => {
					const { app, db } = window.workspacePermissionTest
					return (await db.all(app.accounts.where({ organizationId }), { tier: 'remote' })).length
				}, organizationId)
				expect(savedAccounts).toBe(2)
			} finally {
				await subjectContext.close()
			}
		}
	)
}

test(
	'transaction tags enforce workspace consistency, active assignment, immutable links, and archived history',
	{ tag: ['@transactions', '@tags', '@workflow-completion', '@permissions', '@workspaces'] },
	async ({ page }) => {
		await start(page)
		const organizationId = await page.getByLabel('Current Workspace', { exact: true }).inputValue()
		const result = await page.evaluate(async (organizationId) => {
			const { app, db, userId } = window.workspacePermissionTest
			const category = await db.one(
				app.categories.where({ organizationId, kind: 'expense', isSystem: true }),
				{ tier: 'remote' }
			)
			if (!category) throw new Error('No expense category')
			const account = await db
				.insert(app.accounts, {
					organizationId,
					name: 'Tag permission account',
					kind: 'cash',
					currency: 'USD'
				})
				.wait({ tier: 'global' })
			const tag = await db
				.insert(app.tags, { organizationId, name: 'Active permission tag', kind: 'expense' })
				.wait({ tier: 'global' })
			const other = await db
				.insert(app.organizations, {
					name: 'Other tag workspace',
					kind: 'business',
					defaultCurrency: 'USD',
					ownerId: userId
				})
				.wait({ tier: 'global' })
			await db
				.insert(app.organizationMembers, {
					organizationId: other.id,
					userId,
					role: 'owner',
					accountAccessMode: 'all'
				})
				.wait({ tier: 'global' })
			const foreignTag = await db
				.insert(app.tags, { organizationId: other.id, name: 'Foreign tag', kind: 'expense' })
				.wait({ tier: 'global' })
			// The transaction and assignment must be accepted together, in either write order.
			const tx = await db.transaction((tx) => {
				const transaction = tx.insert(app.transactions, {
					organizationId,
					accountId: account.id,
					categoryId: category.id,
					kind: 'expense',
					amountMinor: 100,
					currency: 'USD',
					bookedOn: '2026-10-13',
					source: 'manual'
				})
				const link = tx.insert(app.transactionTags, {
					organizationId,
					transactionId: transaction.id,
					tagId: tag.id
				})
				return { transactionId: transaction.id, linkId: link.id }
			})
			const fixture = await tx.wait({ tier: 'global' })
			const outcomes: string[] = []
			async function insertLink(workspaceId: string, transactionId: string, tagId: string) {
				try {
					await db
						.insert(app.transactionTags, { organizationId: workspaceId, transactionId, tagId })
						.wait({ tier: 'global' })
					return 'accepted'
				} catch (error) {
					return error instanceof Error ? error.message : 'unknown-error'
				}
			}
			outcomes.push(await insertLink(organizationId, fixture.transactionId, foreignTag.id))
			outcomes.push(await insertLink(other.id, fixture.transactionId, foreignTag.id))
			outcomes.push(await insertLink(organizationId, crypto.randomUUID(), tag.id))
			outcomes.push(await insertLink(organizationId, fixture.transactionId, crypto.randomUUID()))
			try {
				await db
					.update(app.transactionTags, fixture.linkId, { tagId: foreignTag.id })
					.wait({ tier: 'global' })
				outcomes.push('accepted')
			} catch (error) {
				outcomes.push(error instanceof Error ? error.message : 'unknown-error')
			}
			await db.update(app.tags, tag.id, { archivedAt: new Date() }).wait({ tier: 'global' })
			outcomes.push(await insertLink(organizationId, fixture.transactionId, tag.id))
			const historical = await db.one(app.transactionTags.where({ id: fixture.linkId }), {
				tier: 'remote'
			})
			await db.delete(app.transactionTags, fixture.linkId).wait({ tier: 'global' })
			const removed = await db.one(app.transactionTags.where({ id: fixture.linkId }), {
				tier: 'remote'
			})
			return { outcomes, retained: historical?.tagId === tag.id, removed: !removed }
		}, organizationId)
		expect(result.outcomes).toHaveLength(6)
		for (const outcome of result.outcomes)
			expect(outcome).toMatch(/AuthorizationDenied|permission_denied/)
		expect(result.retained).toBe(true)
		expect(result.removed).toBe(true)
	}
)

for (const scenario of scenarios) {
	test(
		`transaction tag permissions: ${scenario.name}`,
		{ tag: ['@transactions', '@permissions', '@tags'] },
		async ({ page, browser }) => {
			await start(page)
			const organizationId = await page
				.getByLabel('Current Workspace', { exact: true })
				.inputValue()
			const subjectContext = await browser.newContext({ baseURL: new URL(page.url()).origin })
			try {
				const subject = await subjectContext.newPage()
				await start(subject)
				const subjectId = await subject.evaluate(() => window.workspacePermissionTest.userId)
				const fixture = await page.evaluate(
					async ({ organizationId, subjectId, role, mode, grant }) => {
						const { app, db } = window.workspacePermissionTest
						if (role)
							await db
								.insert(app.organizationMembers, {
									organizationId,
									userId: subjectId,
									role,
									accountAccessMode: mode
								})
								.wait({ tier: 'global' })
						const account = await db
							.insert(app.accounts, {
								organizationId,
								name: 'Tag shared account',
								kind: 'cash',
								currency: 'USD'
							})
							.wait({ tier: 'global' })
						if (grant)
							await db
								.insert(app.accountMemberships, {
									organizationId,
									userId: subjectId,
									accountId: account.id,
									access: grant,
									canDelete: false
								})
								.wait({ tier: 'global' })
						const category = await db.one(
							app.categories.where({ organizationId, kind: 'expense', isSystem: true }),
							{ tier: 'remote' }
						)
						if (!category) throw new Error('No expense category')
						const transaction = await db
							.insert(app.transactions, {
								organizationId,
								accountId: account.id,
								categoryId: category.id,
								kind: 'expense',
								amountMinor: 100,
								currency: 'USD',
								bookedOn: '2026-10-13',
								source: 'manual'
							})
							.wait({ tier: 'global' })
						const tag = await db
							.insert(app.tags, { organizationId, name: 'Tag shared assignment', kind: 'expense' })
							.wait({ tier: 'global' })
						const link = await db
							.insert(app.transactionTags, {
								organizationId,
								transactionId: transaction.id,
								tagId: tag.id
							})
							.wait({ tier: 'global' })
						return { transactionId: transaction.id, tagId: tag.id, linkId: link.id }
					},
					{
						organizationId,
						subjectId,
						role: scenario.role,
						mode: scenario.mode,
						grant: scenario.grant
					}
				)
				const access = await subject.evaluate(
					async ({ organizationId, fixture }) => {
						const { app, db } = window.workspacePermissionTest
						const read = Boolean(
							await db.one(app.transactionTags.where({ id: fixture.linkId }), { tier: 'remote' })
						)
						let insert = 'accepted'
						try {
							await db
								.insert(app.transactionTags, {
									organizationId,
									transactionId: fixture.transactionId,
									tagId: fixture.tagId
								})
								.wait({ tier: 'global' })
						} catch (error) {
							insert = error instanceof Error ? error.message : 'unknown-error'
						}
						let remove = 'accepted'
						try {
							await db.delete(app.transactionTags, fixture.linkId).wait({ tier: 'global' })
						} catch (error) {
							remove = error instanceof Error ? error.message : 'unknown-error'
						}
						return { read, insert, remove }
					},
					{ organizationId, fixture }
				)
				expect(access.read).toBe(scenario.read)
				if (scenario.write) {
					expect(access.insert).toBe('accepted')
					expect(access.remove).toBe('accepted')
				} else {
					expect(access.insert).toMatch(/AuthorizationDenied|permission_denied/)
					expect(access.remove).toMatch(/AuthorizationDenied|permission_denied/)
				}
				const retained = await page.evaluate(async (id) => {
					const { app, db } = window.workspacePermissionTest
					return Boolean(await db.one(app.transactionTags.where({ id }), { tier: 'remote' }))
				}, fixture.linkId)
				expect(retained).toBe(!scenario.write)
			} finally {
				await subjectContext.close()
			}
		}
	)
}

test(
	'Check references enforce scope and permit reuse without an exclusivity rule',
	{ tag: ['@permissions', '@workspaces', '@transactions'] },
	async ({ page }) => {
		await start(page)
		const result = await page.evaluate(async () => {
			const { app, db, userId } = window.workspacePermissionTest
			const organization = await db.one(app.organizations.where({ ownerId: userId }), {
				tier: 'remote'
			})
			if (!organization) throw new Error('Missing workspace')
			const category = await db.one(
				app.categories.where({ organizationId: organization.id, kind: 'income', isSystem: true }),
				{ tier: 'remote' }
			)
			if (!category) throw new Error('Missing category')
			const account = await db
				.insert(app.accounts, {
					organizationId: organization.id,
					name: 'Check integrity',
					kind: 'cash',
					currency: 'USD'
				})
				.wait({ tier: 'global' })
			const otherAccount = await db
				.insert(app.accounts, {
					organizationId: organization.id,
					name: 'Other Check account',
					kind: 'cash',
					currency: 'USD'
				})
				.wait({ tier: 'global' })
			const check = await db
				.insert(app.checks, {
					organizationId: organization.id,
					accountId: account.id,
					checkNumber: '123',
					checkDate: '2026-10-14'
				})
				.wait({ tier: 'global' })
			const transactionValues = {
				organizationId: organization.id,
				accountId: account.id,
				categoryId: category.id,
				kind: 'income',
				amountMinor: 100,
				currency: 'USD',
				bookedOn: '2026-10-14',
				source: 'manual',
				paymentMethod: 'check',
				checkId: check.id
			} satisfies import('jazz-tools').schema.InsertOf<typeof app.transactions>
			const first = await db.insert(app.transactions, transactionValues).wait({ tier: 'global' })
			const second = await db.insert(app.transactions, transactionValues).wait({ tier: 'global' })
			const attempt = async (write: () => Promise<unknown>) => {
				try {
					await write()
					return 'accepted'
				} catch (error) {
					return error instanceof Error ? error.message : 'rejected'
				}
			}
			const missingCheck = await attempt(() =>
				db
					.insert(app.transactions, { ...transactionValues, checkId: crypto.randomUUID() })
					.wait({ tier: 'global' })
			)
			const mismatchedMethod = await attempt(() =>
				db
					.insert(app.transactions, { ...transactionValues, paymentMethod: 'cash' })
					.wait({ tier: 'global' })
			)
			const mismatchedAccount = await attempt(() =>
				db
					.insert(app.transactions, { ...transactionValues, accountId: otherAccount.id })
					.wait({ tier: 'global' })
			)
			await db
				.update(app.checks, check.id, { checkNumber: '456', checkDate: '2026-10-15' })
				.wait({ tier: 'global' })
			const retained = await db.one(app.checks.where({ id: check.id }), { tier: 'remote' })
			return {
				firstId: first.id,
				secondId: second.id,
				missingCheck,
				mismatchedMethod,
				mismatchedAccount,
				retained
			}
		})
		expect(result.firstId).not.toBe(result.secondId)
		for (const outcome of [result.missingCheck, result.mismatchedMethod, result.mismatchedAccount])
			expect(outcome).toMatch(/AuthorizationDenied|permission_denied/)
		expect(result.retained).toMatchObject({ checkNumber: '456', checkDate: '2026-10-15' })
	}
)

for (const kind of ['expense', 'income'] satisfies ('expense' | 'income')[]) {
	test(
		`permission integrity: ${kind} tag compatibility and income methods`,
		{ tag: ['@permissions', '@tags', '@transactions'] },
		async ({ page }) => {
			await start(page)
			const organizationId = await page
				.getByLabel('Current Workspace', { exact: true })
				.inputValue()
			const results = await page.evaluate(
				async ({ organizationId, kind }) => {
					const { app, db } = window.workspacePermissionTest
					const categories = await db.all(
						app.categories.where({ organizationId, isSystem: true }),
						{
							tier: 'remote'
						}
					)
					const category = categories.find((row) => row.kind === kind)
					const opposite = categories.find((row) => row.kind !== kind)
					if (!category || !opposite) throw new Error('Missing categories')
					const account = await db
						.insert(app.accounts, {
							organizationId,
							name: 'Integrity',
							kind: 'cash',
							currency: 'USD'
						})
						.wait({ tier: 'global' })
					const attempt = async (write: () => Promise<unknown>) => {
						try {
							await write()
							return 'accepted'
						} catch (error) {
							return error instanceof Error ? error.message : 'unknown-error'
						}
					}
					const denied = []
					const invalidKinds = []
					for (const invalidKind of [undefined, null]) {
						const invalid = { organizationId, name: 'Invalid kind', kind }
						if (invalidKind === undefined) Reflect.deleteProperty(invalid, 'kind')
						else Reflect.set(invalid, 'kind', invalidKind)
						invalidKinds.push(
							await attempt(() => db.insert(app.tags, invalid).wait({ tier: 'global' }))
						)
					}
					denied.push(
						await attempt(() =>
							db
								.insert(app.tags, {
									organizationId,
									name: 'Wrong category',
									kind,
									categoryId: opposite.id
								})
								.wait({ tier: 'global' })
						)
					)
					const tag = await db
						.insert(app.tags, { organizationId, name: 'Matching', kind, categoryId: category.id })
						.wait({ tier: 'global' })
					const wrongTag = await db
						.insert(app.tags, { organizationId, name: 'Other kind', kind: opposite.kind })
						.wait({ tier: 'global' })
					const values = {
						organizationId,
						accountId: account.id,
						categoryId: category.id,
						kind,
						amountMinor: 100,
						currency: 'USD',
						bookedOn: '2026-10-23',
						source: 'manual',
						...(kind === 'income' ? { paymentMethod: 'cash' } : {})
					} satisfies import('jazz-tools').schema.InsertOf<typeof app.transactions>
					const row = await db.insert(app.transactions, values).wait({ tier: 'global' })
					const link = await db
						.insert(app.transactionTags, { organizationId, transactionId: row.id, tagId: tag.id })
						.wait({ tier: 'global' })
					denied.push(
						await attempt(() =>
							db
								.insert(app.transactionTags, {
									organizationId,
									transactionId: row.id,
									tagId: wrongTag.id
								})
								.wait({ tier: 'global' })
						)
					)
					denied.push(
						await attempt(() =>
							db
								.update(app.tags, tag.id, { kind: opposite.kind, categoryId: null })
								.wait({ tier: 'global' })
						)
					)
					denied.push(
						await attempt(() =>
							db
								.update(app.transactions, row.id, {
									kind: opposite.kind,
									categoryId: opposite.id,
									paymentMethod: 'cash'
								})
								.wait({ tier: 'global' })
						)
					)
					let imported = null
					let manualWithoutMethod = null
					if (kind === 'income') {
						const manual = await db
							.insert(app.transactions, { ...values, paymentMethod: null })
							.wait({ tier: 'global' })
						await db
							.update(app.transactions, row.id, { paymentMethod: null })
							.wait({ tier: 'global' })
						manualWithoutMethod = manual.id
						const saved = await db
							.insert(app.transactions, {
								...values,
								source: 'simplefin',
								externalId: 'permission-import',
								paymentMethod: null
							})
							.wait({ tier: 'global' })
						imported = saved.id
					}
					const retained = await db.one(app.transactionTags.where({ id: link.id }), {
						tier: 'remote'
					})
					return {
						denied,
						invalidKinds,
						retained: retained?.tagId === tag.id,
						imported,
						manualWithoutMethod
					}
				},
				{ organizationId, kind }
			)
			for (const outcome of results.denied)
				expect(outcome).toMatch(/AuthorizationDenied|permission_denied/)
			for (const outcome of results.invalidKinds) expect(outcome).not.toBe('accepted')
			expect(results.retained).toBe(true)
			if (kind === 'income') {
				expect(results.imported).toBeTruthy()
				expect(results.manualWithoutMethod).toBeTruthy()
			}
		}
	)
}
