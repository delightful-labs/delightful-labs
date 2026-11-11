import { expect } from '@playwright/test'
import { test, start } from '../helpers/workspace.js'
import { navigateSidebar, selectWorkspace } from '../helpers/ui.js'

test(
	'profile name saves offline, follows workspace selection, and supplies transaction attribution',
	{ tag: ['@workflow-completion', '@identity', '@workspaces'] },
	async ({ page }) => {
		await start(page)
		const organizationId = await page.getByLabel('Current Workspace', { exact: true }).inputValue()
		const fixture = await page.evaluate(async (organizationId) => {
			const { app, db, userId } = window.workspaceSettingsTest
			const second = await db
				.insert(app.organizations, {
					name: 'Profile second workspace',
					kind: 'business',
					defaultCurrency: 'USD',
					ownerId: userId
				})
				.wait({ tier: 'global' })
			await db
				.insert(app.organizationMembers, {
					organizationId: second.id,
					userId,
					role: 'owner',
					accountAccessMode: 'all'
				})
				.wait({ tier: 'global' })
			const account = await db
				.insert(app.accounts, {
					organizationId,
					name: 'Profile checking',
					kind: 'bank',
					currency: 'USD'
				})
				.wait({ tier: 'global' })
			const category = await db.one(
				app.categories.where({ organizationId, kind: 'expense', isSystem: true })
			)
			if (!category) throw new Error('No Category')
			const transaction = await db
				.insert(app.transactions, {
					organizationId,
					accountId: account.id,
					categoryId: category.id,
					kind: 'expense',
					amountMinor: 100,
					currency: 'USD',
					bookedOn: '2026-10-14',
					source: 'manual'
				})
				.wait({ tier: 'global' })
			return { secondId: second.id, transactionId: transaction.id, userId }
		}, organizationId)
		await navigateSidebar(page, 'Account')
		await expect(page).toHaveURL(`/account?workspace=${organizationId}`)
		const main = page.getByRole('main')
		await expect(main.getByLabel('Display name', { exact: true })).toBeEnabled()
		await page.context().setOffline(true)
		try {
			await main.getByLabel('Display name', { exact: true }).fill('Offline profile owner')
			await main.getByRole('button', { name: 'Save', exact: true }).click()
			await expect(
				main.getByRole('status').filter({ hasText: 'Profile Display name saved.' })
			).toHaveText('Profile Display name saved.')
			await expect
				.poll(() =>
					page.evaluate(async () => {
						const { app, db, userId } = window.workspaceSettingsTest
						return (await db.one(app.profiles.where({ userId })))?.displayName
					})
				)
				.toBe('Offline profile owner')
		} finally {
			await page.context().setOffline(false)
		}
		await expect
			.poll(() =>
				page.evaluate(async () => {
					const { app, db, userId } = window.workspaceSettingsTest
					return (await db.one(app.profiles.where({ userId }), { tier: 'remote' }))?.displayName
				})
			)
			.toBe('Offline profile owner')
		const selector = page.getByLabel('Current Workspace', { exact: true })
		await expect(selector.locator(`option[value="${fixture.secondId}"]`)).toHaveCount(1)
		await selectWorkspace(selector, fixture.secondId)
		await expect(main.getByLabel('Display name', { exact: true })).toHaveValue(
			'Offline profile owner'
		)
		await selectWorkspace(selector, organizationId)
		await page.goto(`/expenses/${fixture.transactionId}?workspace=${organizationId}`)
		await main.locator('summary').filter({ hasText: 'Metadata' }).click()
		await expect(main.getByText('Offline profile owner', { exact: true })).toHaveCount(2)
		await navigateSidebar(page, 'Account')
		await main.getByLabel('Display name', { exact: true }).fill('')
		await main.getByRole('button', { name: 'Save', exact: true }).click()
		await expect(
			main.getByRole('status').filter({ hasText: 'Profile Display name saved.' })
		).toHaveText('Profile Display name saved.')
		await page.goto(`/expenses/${fixture.transactionId}?workspace=${organizationId}`)
		await main.locator('summary').filter({ hasText: 'Metadata' }).click()
		await expect(main.getByText(fixture.userId, { exact: true })).toHaveCount(2)
		await expect(main.getByText('Offline profile owner', { exact: true })).toHaveCount(0)
	}
)

test(
	'profile name edits are owner-only even for members of a shared workspace',
	{ tag: ['@workflow-completion', '@identity', '@workspaces', '@permissions'] },
	async ({ page, browser, baseURL }) => {
		await start(page)
		const organizationId = await page.getByLabel('Current Workspace', { exact: true }).inputValue()
		const owner = await page.evaluate(async () => {
			const { app, db, userId } = window.workspaceSettingsTest
			const profile = await db.one(app.profiles.where({ userId }), { tier: 'remote' })
			if (!profile) throw new Error('Missing profile')
			await db
				.update(app.profiles, profile.id, { displayName: 'Protected profile owner' })
				.wait({ tier: 'global' })
			return { profileId: profile.id, userId }
		})
		const context = await browser.newContext({ baseURL: baseURL ?? 'http://127.0.0.1:5173' })
		try {
			const subject = await context.newPage()
			await start(subject)
			const subjectId = await subject.evaluate(() => window.workspaceSettingsTest.userId)
			await page.evaluate(
				async ({ organizationId, subjectId }) => {
					const { app, db } = window.workspaceSettingsTest
					await db
						.insert(app.organizationMembers, {
							organizationId,
							userId: subjectId,
							role: 'member',
							accountAccessMode: 'all'
						})
						.wait({ tier: 'global' })
				},
				{ organizationId, subjectId }
			)
			const selector = subject.getByLabel('Current Workspace', { exact: true })
			await expect(selector.locator(`option[value="${organizationId}"]`)).toHaveCount(1)
			await selectWorkspace(selector, organizationId)
			await navigateSidebar(subject, 'Account')
			await expect(subject).toHaveURL(`/account?workspace=${organizationId}`)
			await subject.getByLabel('Display name', { exact: true }).fill('Shared workspace member')
			await subject.getByRole('button', { name: 'Save', exact: true }).click()
			await expect(
				subject
					.getByRole('main')
					.getByRole('status')
					.filter({ hasText: 'Profile Display name saved.' })
			).toHaveText('Profile Display name saved.')
			const outcome = await subject.evaluate(async (owner) => {
				const { app, db, userId } = window.workspaceSettingsTest
				const own = await db.one(app.profiles.where({ userId }), { tier: 'remote' })
				if (!own) throw new Error('Missing member profile')
				const visibleOwner = await db.one(app.profiles.where({ id: owner.profileId }), {
					tier: 'remote'
				})
				let edit = 'accepted'
				let transfer = 'accepted'
				try {
					await db
						.upsert(app.profiles, owner.profileId, {
							userId: owner.userId,
							displayName: 'Hijacked name',
							avatarData: new Uint8Array([1]),
							avatarMimeType: 'image/png'
						})
						.wait({ tier: 'global' })
				} catch (error) {
					edit = error instanceof Error ? error.message : 'unknown-error'
				}
				try {
					await db.update(app.profiles, own.id, { userId: owner.userId }).wait({ tier: 'global' })
				} catch (error) {
					transfer = error instanceof Error ? error.message : 'unknown-error'
				}
				const retained = await db.one(app.profiles.where({ id: own.id }), { tier: 'remote' })
				return {
					edit,
					transfer,
					ownerVisible: Boolean(visibleOwner),
					ownName: retained?.displayName,
					ownUserId: retained?.userId
				}
			}, owner)
			expect(outcome.ownerVisible).toBe(true)
			expect(outcome.edit).toMatch(/AuthorizationDenied|permission_denied/)
			expect(outcome.transfer).toMatch(/AuthorizationDenied|permission_denied/)
			expect(outcome.ownName).toBe('Shared workspace member')
			expect(outcome.ownUserId).toBe(subjectId)
			await expect
				.poll(() =>
					page.evaluate(async (id) => {
						const { app, db } = window.workspaceSettingsTest
						const profile = await db.one(app.profiles.where({ id }), { tier: 'remote' })
						return {
							name: profile?.displayName,
							hasAvatar: Boolean(profile?.avatarData),
							mimeType: profile?.avatarMimeType ?? null
						}
					}, owner.profileId)
				)
				.toEqual({ name: 'Protected profile owner', hasAvatar: false, mimeType: null })
		} finally {
			await context.close()
		}
	}
)

for (const role of ['admin', 'member', 'viewer']) {
	test(
		`shared profile visibility: ${role}, isolation, and membership removal`,
		{ tag: ['@identity', '@permissions'] },
		async ({ page, browser }) => {
			await start(page)
			const organizationId = await page
				.getByLabel('Current Workspace', { exact: true })
				.inputValue()
			const owner = await page.evaluate(async () => {
				const { app, db, userId } = window.workspaceSettingsTest
				const profile = await db.one(app.profiles.where({ userId }), { tier: 'remote' })
				if (!profile) throw new Error('Missing owner profile')
				await db
					.update(app.profiles, profile.id, {
						displayName: 'Shared display profile',
						avatarData: new Uint8Array([1, 2, 3]),
						avatarMimeType: 'image/png'
					})
					.wait({ tier: 'global' })
				const privateWorkspace = await db
					.insert(app.organizations, {
						name: 'Private workspace',
						kind: 'business',
						defaultCurrency: 'USD',
						ownerId: userId
					})
					.wait({ tier: 'global' })
				await db
					.insert(app.organizationMembers, {
						organizationId: privateWorkspace.id,
						userId,
						profileId: profile.id,
						role: 'owner',
						accountAccessMode: 'all'
					})
					.wait({ tier: 'global' })
				return { id: profile.id, userId }
			})
			const context = await browser.newContext({ baseURL: new URL(page.url()).origin })
			try {
				const subject = await context.newPage()
				await start(subject)
				const subjectProfile = await subject.evaluate(async () => {
					const { app, db, userId } = window.workspaceSettingsTest
					const profile = await db.one(app.profiles.where({ userId }), { tier: 'remote' })
					if (!profile) throw new Error('Missing member profile')
					await db
						.update(app.profiles, profile.id, { displayName: 'Shared member' })
						.wait({ tier: 'global' })
					return { id: profile.id, userId }
				})
				const readOwner = () =>
					subject.evaluate(async (id) => {
						const { app, db } = window.workspaceSettingsTest
						const profile = await db.one(app.profiles.where({ id }), { tier: 'remote' })
						return profile
							? {
									name: profile.displayName,
									bytes: Array.from(profile.avatarData ?? []),
									mime: profile.avatarMimeType
								}
							: null
					}, owner.id)
				expect(await readOwner()).toBeNull()
				const membershipId = await page.evaluate(
					async ({ organizationId, subjectProfile, role }) => {
						const { app, db } = window.workspaceSettingsTest
						if (role !== 'admin' && role !== 'member' && role !== 'viewer')
							throw new Error('Invalid role')
						const membership = await db
							.insert(app.organizationMembers, {
								organizationId,
								userId: subjectProfile.userId,
								role,
								accountAccessMode: 'selected'
							})
							.wait({ tier: 'global' })
						return membership.id
					},
					{ organizationId, subjectProfile, role }
				)
				await expect
					.poll(readOwner)
					.toEqual({ name: 'Shared display profile', bytes: [1, 2, 3], mime: 'image/png' })
				// A membership without a profile reference must not expose an unrelated profile.
				expect(
					await page.evaluate(async (id) => {
						const { app, db } = window.workspaceSettingsTest
						return Boolean(await db.one(app.profiles.where({ id }), { tier: 'remote' }))
					}, subjectProfile.id)
				).toBe(false)
				await page.evaluate(
					async ({ membershipId, profileId }) => {
						const { app, db } = window.workspaceSettingsTest
						await db
							.update(app.organizationMembers, membershipId, { profileId })
							.wait({ tier: 'global' })
					},
					{ membershipId, profileId: subjectProfile.id }
				)
				await expect
					.poll(() =>
						page.evaluate(async (id) => {
							const { app, db } = window.workspaceSettingsTest
							return (
								(await db.one(app.profiles.where({ id }), { tier: 'remote' }))?.displayName ?? null
							)
						}, subjectProfile.id)
					)
					.toBe('Shared member')
				expect(
					await subject.evaluate(async (ownerId) => {
						const { app, db } = window.workspaceSettingsTest
						return (await db.all(app.organizations.where({ ownerId }), { tier: 'remote' })).map(
							(organization) => organization.id
						)
					}, owner.userId)
				).toEqual([organizationId])
				await page.evaluate(async (id) => {
					const { app, db } = window.workspaceSettingsTest
					await db.delete(app.organizationMembers, id).wait({ tier: 'global' })
				}, membershipId)
				await expect.poll(readOwner).toBeNull()
				await expect
					.poll(() =>
						page.evaluate(async (id) => {
							const { app, db } = window.workspaceSettingsTest
							return (
								(await db.one(app.profiles.where({ id }), { tier: 'remote' }))?.displayName ?? null
							)
						}, subjectProfile.id)
					)
					.toBeNull()
			} finally {
				await context.close()
			}
		}
	)
}
