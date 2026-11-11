import { test, expect, type Page } from '@playwright/test'
import { installWorkspaceSettingsTest as harness } from './helpers/workspace.js'
import {
	selectWorkspace,
	prepareSidebar,
	openCreationModal,
	closeCreationModal,
	creationDialog
} from './helpers/ui.js'
function workspaceId(href: string) {
	const id = new URL(href, 'http://localhost').searchParams.get('workspace')
	if (!id) throw new Error('Missing workspace query')
	return id
}
async function start(page: Page) {
	await page.goto('/settings/workspace')
	await expect(page).toHaveURL((url) => Boolean(url.searchParams.get('workspace')))
	await expect(
		page.getByRole('main').getByRole('button', { name: 'Create Workspace', exact: true })
	).toBeEnabled()
	await harness(page)
}
async function create(page: Page, name: string) {
	// Automatic scoping navigates; finish it before opening a page-owned modal.
	await expect(page).toHaveURL((url) => Boolean(url.searchParams.get('workspace')))
	const dialog = await openCreationModal(page, 'Create Workspace')
	await dialog.getByLabel('Workspace name', { exact: true }).fill(name)
	await dialog.getByRole('button', { name: 'Create Workspace', exact: true }).click()
	await expect(dialog.getByRole('status').filter({ hasText: /^Workspace saved\.$/ })).toBeVisible()
	const href = await page
		.getByRole('link', { name: `Open Workspace: ${name}`, exact: true })
		.getAttribute('href')
	if (!href) throw new Error('Missing created workspace link')
	return href
}

test(
	'an unscoped chooser automatically selects the sole workspace and retains it on reload',
	{ tag: ['@workspaces'] },
	async ({ page }) => {
		await start(page)
		await prepareSidebar(page)
		const manager = page.getByLabel('Select Workspace', { exact: true })
		const drawer = page.getByLabel('Current Workspace', { exact: true })
		await expect(manager.locator('option:not([disabled])')).toHaveCount(1)
		const id = await manager.locator('option:not([disabled])').getAttribute('value')
		if (!id) throw new Error('Expected sole local workspace')
		await expect(page).toHaveURL(`/settings/workspace?workspace=${id}`)
		await expect(manager).toHaveValue(id)
		await expect(drawer).toHaveValue(id)
		await expect(manager).toBeDisabled()
		await expect(drawer).toBeDisabled()
		await page.reload()
		await prepareSidebar(page)
		await expect(manager).toHaveValue(id)
		await expect(drawer).toHaveValue(id)
	}
)

test(
	'workspace creation uses the shared modal and preserves a cancelled draft without writing',
	{ tag: ['@workspaces'] },
	async ({ page }) => {
		await start(page)
		const dialog = await openCreationModal(page, 'Create Workspace')
		await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible()
		await dialog.getByLabel('Workspace name', { exact: true }).fill('Pending workspace')
		await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
		await expect(dialog).not.toBeVisible()
		await openCreationModal(page, 'Create Workspace')
		await expect(dialog.getByLabel('Workspace name', { exact: true })).toHaveValue(
			'Pending workspace'
		)
		expect(
			await page.evaluate(async () => {
				const { db, app } = window.workspaceSettingsTest
				return (await db.all(app.organizations)).length
			})
		).toBe(1)
		await create(page, 'Created in a modal')
		await dialog.getByRole('button', { name: 'Close', exact: true }).click()
		await expect(dialog).not.toBeVisible()
	}
)

test(
	'submitted workspace creation keeps Close and accessible progress without extra visible feedback',
	{ tag: ['@workspaces'] },
	async ({ page }) => {
		await start(page)
		const dialog = await openCreationModal(page, 'Create Workspace')
		await dialog.getByLabel('Workspace name', { exact: true }).fill('Quiet workspace')
		// Hold ID generation so the submitting presentation can be checked without a timing race.
		const gate = await page.evaluateHandle(() => {
			const digest = crypto.subtle.digest.bind(crypto.subtle)
			let release = () => {}
			const pending = new Promise<void>((resolve) => {
				release = resolve
			})
			crypto.subtle.digest = (algorithm, data) => pending.then(() => digest(algorithm, data))
			return {
				release: () => {
					crypto.subtle.digest = digest
					release()
				}
			}
		})
		try {
			await dialog.getByRole('button', { name: 'Create Workspace', exact: true }).click()
			await expect(dialog.getByRole('status')).toHaveText('Preparing your workspace…')
			await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeEnabled()
			await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0)
			await expect(dialog.locator('p').filter({ hasText: 'Preparing your workspace' })).toHaveCount(
				0
			)
			await expect(
				dialog.getByRole('button', { name: 'Create Workspace', exact: true })
			).toBeDisabled()
		} finally {
			await gate.evaluate((control) => control.release())
			await gate.dispose()
		}
		await expect(dialog.getByRole('status')).toHaveText('Workspace saved.')
	}
)

test(
	'workspace creation keeps its announcement regions mounted through success and reset',
	{ tag: ['@workspaces'] },
	async ({ page }) => {
		await start(page)
		const dialog = await openCreationModal(page, 'Create Workspace')
		const status = dialog.getByRole('status')
		const alert = dialog.getByRole('alert')
		await expect(status).toHaveText('')
		await expect(alert).toHaveText('')
		const originalStatus = await status.elementHandle()
		const originalAlert = await alert.elementHandle()
		if (!originalStatus || !originalAlert)
			throw new Error('Missing persistent announcement regions')

		await create(page, 'Announcement workspace')
		await expect(status).toHaveText('Workspace saved.')
		await expect(alert).toHaveText('')
		expect(await originalStatus.evaluate((node) => node.isConnected)).toBe(true)
		expect(await originalAlert.evaluate((node) => node.isConnected)).toBe(true)

		await dialog.getByRole('button', { name: 'Create another Workspace', exact: true }).click()
		await expect(dialog.getByLabel('Workspace name', { exact: true })).toHaveValue('')
		await expect(status).toHaveText('')
		await expect(alert).toHaveText('')
		expect(await originalStatus.evaluate((node) => node.isConnected)).toBe(true)
		expect(await originalAlert.evaluate((node) => node.isConnected)).toBe(true)
		await originalStatus.dispose()
		await originalAlert.dispose()
	}
)

test(
	'both workspace selectors preserve the settings page and synchronize their selected value',
	{ tag: ['@workspaces'] },
	async ({ page }) => {
		await start(page)
		const created = await create(page, 'Business')
		await closeCreationModal(page)
		await prepareSidebar(page)
		const manager = page.getByLabel('Select Workspace', { exact: true })
		const drawer = page.getByLabel('Current Workspace', { exact: true })
		const businessId = workspaceId(created)
		await expect(manager.locator('option:not([disabled])')).toHaveCount(2)
		const personalId = await manager
			.locator('option:not([disabled])')
			.evaluateAll(
				(options, businessId) =>
					options
						.map((option) => option.getAttribute('value'))
						.find((value) => value !== businessId),
				businessId
			)
		if (!personalId) throw new Error('Missing personal workspace')
		await manager.selectOption(businessId)
		await expect(page).toHaveURL(`/settings/workspace?workspace=${businessId}`)
		await expect(drawer).toHaveValue(businessId)
		await drawer.selectOption(personalId)
		await expect(page).toHaveURL(`/settings/workspace?workspace=${personalId}`)
		await expect(manager).toHaveValue(personalId)
		await page.reload()
		await prepareSidebar(page)
		await expect(drawer).toHaveValue(personalId)
		await expect(manager).toHaveValue(personalId)
		await page.goto('/expenses?workspace=77777777-7777-4777-8777-777777777777')
		await prepareSidebar(page)
		await expect(drawer).toHaveValue('')
		await expect(drawer.locator('option:checked')).toHaveText('Select Workspace')
	}
)

test(
	'switching away and back clears account filters while ordinary navigation preserves them',
	{ tag: ['@workspaces'] },
	async ({ page }) => {
		await start(page)
		const secondId = workspaceId(await create(page, 'Filter workspace B'))
		await closeCreationModal(page)
		const firstId = await page.evaluate(async (secondId) => {
			const { db, app } = window.workspaceSettingsTest
			const organizations = await db.all(app.organizations)
			const first = organizations.find((organization) => organization.id !== secondId)
			if (!first) throw new Error('Missing initial workspace')
			for (const account of [
				{ organizationId: first.id, name: 'Filter checking' },
				{ organizationId: first.id, name: 'Filter cash' },
				{ organizationId: secondId, name: 'Business checking' }
			]) {
				await db
					.insert(app.accounts, { ...account, kind: 'bank', currency: 'USD' })
					.wait({ tier: 'global' })
			}
			return first.id
		}, secondId)
		await prepareSidebar(page)
		const selector = page.getByLabel('Current Workspace', { exact: true })
		await selectWorkspace(selector, firstId)
		const drawer = page.locator('aside.site-drawer')
		const cash = drawer.getByRole('checkbox', { name: 'Filter cash', exact: true })
		const checking = drawer.getByRole('checkbox', { name: 'Filter checking', exact: true })
		await cash.uncheck()
		await expect(checking).toBeChecked()
		await expect(
			drawer.getByRole('checkbox', { name: 'All Accounts', exact: true })
		).not.toBeChecked()

		await drawer.getByRole('link', { name: 'Expenses', exact: true }).click()
		await expect(page).toHaveURL(`/expenses?workspace=${firstId}`)
		await expect(cash).not.toBeChecked()

		await selectWorkspace(selector, secondId)
		await expect(page).toHaveURL(`/expenses?workspace=${secondId}`)
		await expect(
			drawer.getByRole('checkbox', { name: 'Business checking', exact: true })
		).toBeChecked()
		await selectWorkspace(selector, firstId)
		await expect(page).toHaveURL(`/expenses?workspace=${firstId}`)
		await expect(cash).toBeChecked()
		await expect(checking).toBeChecked()
		await expect(drawer.getByRole('checkbox', { name: 'All Accounts', exact: true })).toBeChecked()
	}
)

test(
	'creates duplicate-named isolated workspaces without switching, and reconciles reload',
	{ tag: ['@workspaces'] },
	async ({ page }) => {
		await start(page)
		const originalScope = workspaceId(page.url())
		const first = await create(page, 'Same')
		await expect(page).toHaveURL(`/settings/workspace?workspace=${originalScope}`)
		await page.getByRole('button', { name: 'Create another Workspace' }).click()
		const second = await create(page, 'Same')
		expect(second).not.toBe(first)
		await expect(page).toHaveURL(`/settings/workspace?workspace=${originalScope}`)
		await page.reload()
		await expect(page).toHaveURL(`/settings/workspace?workspace=${originalScope}`)
		await expect(
			page
				.getByLabel('Select Workspace', { exact: true })
				.locator('option')
				.filter({ hasText: 'Same · ' })
		).toHaveCount(2)
		await harness(page)
		const state = await page.evaluate(async () => {
			const { db, app, userId } = window.workspaceSettingsTest
			const [organizations, profiles, categories, accounts, transactions, memberships] =
				await Promise.all([
					db.all(app.organizations),
					db.all(app.profiles.where({ userId })),
					db.all(app.categories),
					db.all(app.accounts),
					db.all(app.transactions),
					db.all(app.organizationMembers.where({ userId }))
				])
			return {
				organizations,
				profiles: profiles.length,
				categories,
				accounts: accounts.length,
				transactions: transactions.length,
				memberships
			}
		})
		expect(state.organizations).toHaveLength(3)
		expect(state.profiles).toBe(1)
		expect(state.accounts).toBe(0)
		expect(state.transactions).toBe(0)
		for (const organization of state.organizations) {
			expect(state.categories.filter((row) => row.organizationId === organization.id)).toHaveLength(
				8
			)
			expect(
				state.memberships.some(
					(row) => row.organizationId === organization.id && row.role === 'owner'
				)
			).toBe(true)
		}
		await page.goto(second)
		await expect(page).toHaveURL(second)
	}
)

test(
	'keeps URL scope across tabs/history and discards unfinished transaction input',
	{ tag: ['@workspaces'] },
	async ({ page, context }) => {
		await start(page)
		const second = await create(page, 'Second')
		const ids = await page.evaluate(async () => {
			const { db, app } = window.workspaceSettingsTest
			const organizations = await db.all(app.organizations.orderBy('id'))
			for (const [index, organization] of organizations.entries()) {
				const account = await db
					.insert(app.accounts, {
						organizationId: organization.id,
						name: `Account ${index}`,
						kind: 'cash',
						currency: 'USD',
						archivedAt: null
					})
					.wait({ tier: 'global' })
				const categories = await db.all(
					app.categories.where({ organizationId: organization.id, kind: 'expense', isSystem: true })
				)
				const category = categories[0]
				if (!category) throw new Error('Missing category')
				await db
					.insert(app.transactions, {
						organizationId: organization.id,
						accountId: account.id,
						categoryId: category.id,
						kind: 'expense',
						amountMinor: 100,
						currency: 'USD',
						bookedOn: '2026-10-21',
						description: `Ledger ${organization.id}`,
						source: 'manual'
					})
					.wait({ tier: 'global' })
			}
			return organizations.map((row) => row.id)
		})
		const secondId = workspaceId(second)
		const firstId = ids.find((id) => id !== secondId)
		if (!firstId || !secondId) throw new Error('Missing workspace identities')
		await page.goto(`/expenses?workspace=${firstId}`)
		await expect(page.getByText(`Ledger ${firstId}`, { exact: true })).toBeVisible()
		await expect(page.getByText(`Ledger ${secondId}`, { exact: true })).toHaveCount(0)
		await page.goto(`/expenses/new?workspace=${firstId}`)
		await page.getByLabel('Description', { exact: true }).fill('Discard this input')
		await prepareSidebar(page)
		await selectWorkspace(page.getByLabel('Current Workspace', { exact: true }), secondId)
		await expect(page).toHaveURL(`/expenses?workspace=${secondId}`)
		await expect(page.getByText(`Ledger ${secondId}`, { exact: true })).toBeVisible()
		await page.goBack()
		await expect(page).toHaveURL(`/expenses/new?workspace=${firstId}`)
		await expect(page.getByLabel('Description', { exact: true })).toHaveValue('')
		const other = await context.newPage()
		await other.goto(`/expenses?workspace=${secondId}`)
		await expect(other.getByText(`Ledger ${secondId}`, { exact: true })).toBeVisible()
		await page.reload()
		await expect(page).toHaveURL(`/expenses/new?workspace=${firstId}`)
		await expect(page.getByLabel('Description', { exact: true })).toHaveValue('')
		await other.close()
	}
)

test(
	'creates while warm offline and preserves the attempt through reconnection and reload',
	{ tag: ['@workspaces'] },
	async ({ page, context }) => {
		await start(page)
		await context.setOffline(true)
		const href = await create(page, 'Offline workspace')
		await context.setOffline(false)
		await page.reload()
		await expect(
			page
				.getByLabel('Select Workspace', { exact: true })
				.locator(`option[value="${workspaceId(href)}"]`)
		).toHaveText('Offline workspace')
		await harness(page)
		expect(
			await page.evaluate(async () => {
				const { db, app } = window.workspaceSettingsTest
				return (await db.all(app.organizations)).length
			})
		).toBe(2)
	}
)

test(
	'reload retains an unresolved journaled attempt without replaying writes',
	{ tag: ['@workspaces'] },
	async ({ page }) => {
		await start(page)
		const organizationId = await page.evaluate(async () => {
			const { db, app, userId } = window.workspaceSettingsTest
			const preparationPath = '/src/lib/domain/workspace-creation.ts'
			const journalPath = '/src/lib/machines/workspaces/workspace-creation-journal.ts'
			const { prepareWorkspaceCreation }: typeof import('../src/lib/domain/workspace-creation.js') =
				await import(preparationPath)
			const {
				workspaceCreationJournal
			}: typeof import('../src/lib/machines/workspaces/workspace-creation-journal.js') =
				await import(journalPath)
			const xstatePath = '/node_modules/.vite/deps/xstate.js'
			const { createActor, waitFor }: typeof import('xstate') = await import(xstatePath)
			const profile = (await db.all(app.profiles.where({ userId })))[0]
			if (!profile) throw new Error('Missing profile')
			const attempt = await prepareWorkspaceCreation({
				organizationId: crypto.randomUUID(),
				profileId: profile.id,
				userId,
				name: 'Recovered workspace'
			})
			const config = db.getConfig()
			const environment = JSON.stringify([config.appId, config.serverUrl ?? ''])
			const key = JSON.stringify([environment, userId])
			const actor = createActor(workspaceCreationJournal, {
				input: { key, mode: 'write', record: { key, attempt } }
			}).start()
			const result = await waitFor(actor, (snapshot) => snapshot.status === 'done')
			actor.stop()
			if (result.output?.outcome !== 'succeeded') throw new Error('Journal write failed')
			return attempt.organizationId
		})
		await page.reload()
		await openCreationModal(page, 'Create Workspace')
		const dialog = creationDialog(page, 'Create Workspace')
		const unknownMessage =
			'The save result is unknown. Retry to check the same workspace before issuing another write.'
		await expect(dialog.getByRole('alert').filter({ hasText: unknownMessage })).toBeVisible()
		await dialog.getByRole('button', { name: 'Try again', exact: true }).click()
		await expect(dialog.getByRole('alert').filter({ hasText: unknownMessage })).toBeVisible()
		await expect(
			dialog.getByRole('link', { name: 'Open Workspace: Recovered workspace', exact: true })
		).toHaveCount(0)
		await harness(page)
		const observed = await page.evaluate(async () => {
			const { db, app, userId } = window.workspaceSettingsTest
			const journalPath = '/src/lib/machines/workspaces/workspace-creation-journal.ts'
			const {
				workspaceCreationJournal
			}: typeof import('../src/lib/machines/workspaces/workspace-creation-journal.js') =
				await import(journalPath)
			const xstatePath = '/node_modules/.vite/deps/xstate.js'
			const { createActor, waitFor }: typeof import('xstate') = await import(xstatePath)
			const config = db.getConfig(),
				key = JSON.stringify([JSON.stringify([config.appId, config.serverUrl ?? '']), userId])
			const reader = createActor(workspaceCreationJournal, {
				input: { key, mode: 'read' }
			}).start()
			const read = await waitFor(reader, (snapshot) => snapshot.status === 'done')
			reader.stop()
			if (read.output?.outcome !== 'succeeded' || !read.output.record)
				throw new Error('Original attempt was not retained')
			return {
				ids: (await db.all(app.organizations)).map((row) => row.id),
				journaledId: read.output.record.attempt.organizationId
			}
		})
		expect(observed.journaledId).toBe(organizationId)
		expect(observed.ids).toHaveLength(1)
		expect(observed.ids.includes(organizationId)).toBe(false)
		await page.reload()
		await harness(page)
		const ids = await page.evaluate(async () =>
			(
				await window.workspaceSettingsTest.db.all(window.workspaceSettingsTest.app.organizations)
			).map((row) => row.id)
		)
		expect(ids).toHaveLength(1)
		expect(ids.includes(organizationId)).toBe(false)
	}
)

test(
	'unavailable explicit scope stays unavailable and legacy details resolve their own workspace',
	{ tag: ['@workspaces'] },
	async ({ page }) => {
		await start(page)
		const { workspaceId, transactionId } = await page.evaluate(async () => {
			const { db, app } = window.workspaceSettingsTest
			const workspace = (await db.all(app.organizations))[0]
			if (!workspace) throw new Error('Missing workspace')
			const account = await db
				.insert(app.accounts, {
					organizationId: workspace.id,
					name: 'Legacy account',
					kind: 'cash',
					currency: 'USD',
					archivedAt: null
				})
				.wait({ tier: 'global' })
			const category = (
				await db.all(
					app.categories.where({ organizationId: workspace.id, kind: 'expense', isSystem: true })
				)
			)[0]
			if (!category) throw new Error('Missing category')
			const transaction = await db
				.insert(app.transactions, {
					organizationId: workspace.id,
					accountId: account.id,
					categoryId: category.id,
					kind: 'expense',
					amountMinor: 100,
					currency: 'USD',
					bookedOn: '2026-10-21',
					description: 'Legacy detail',
					source: 'manual'
				})
				.wait({ tier: 'global' })
			return { workspaceId: workspace.id, transactionId: transaction.id }
		})
		await page.goto(`/expenses/${transactionId}`)
		await expect(page).toHaveURL(`/expenses/${transactionId}?workspace=${workspaceId}`)
		await page.goto('/expenses?workspace=77777777-7777-4777-8777-777777777777')
		await expect(
			page.getByRole('main').locator('p[aria-hidden="true"]').filter({
				hasText: 'This workspace or transaction is unavailable. Select a workspace you can access.'
			})
		).toBeVisible()
		await expect(page).toHaveURL(/\/expenses\?workspace=77777777-7777-4777-8777-777777777777$/)
	}
)

test(
	'repairs profile links without creating missing categories and preserves workspace edits',
	{ tag: ['@workspaces'] },
	async ({ page }) => {
		await start(page)
		const legacyId = await page.evaluate(async () => {
			const { db, app, userId } = window.workspaceSettingsTest
			const profile = (await db.all(app.profiles.where({ userId })))[0]
			if (!profile) throw new Error('Missing profile')
			await db
				.update(app.profiles, profile.id, { displayName: 'Preserved identity' })
				.wait({ tier: 'global' })
			const workspace = await db
				.insert(app.organizations, {
					name: 'Legacy business',
					kind: 'business',
					ownerId: userId,
					defaultCurrency: 'USD'
				})
				.wait({ tier: 'global' })
			await db
				.insert(app.organizationMembers, {
					organizationId: workspace.id,
					userId,
					role: 'owner',
					accountAccessMode: 'all',
					profileId: null
				})
				.wait({ tier: 'global' })
			return workspace.id
		})
		await page.goto(`/expenses?workspace=${legacyId}`)
		await expect(page.getByRole('heading', { name: 'Expenses', exact: true })).toBeVisible()
		await harness(page)
		await expect
			.poll(async () =>
				page.evaluate(async (id) => {
					const { db, app, userId } = window.workspaceSettingsTest
					const categories = await db.all(app.categories.where({ organizationId: id }), {
						tier: 'remote'
					})
					const member = (
						await db.all(app.organizationMembers.where({ organizationId: id, userId }), {
							tier: 'remote'
						})
					)[0]
					return {
						count: categories.length,
						system: categories.every((row) => row.isSystem),
						linked: member?.profileId != null
					}
				}, legacyId)
			)
			.toEqual({ count: 0, system: true, linked: true })
		await page.goto('/settings/workspace')
		await expect(
			page.getByRole('main').getByRole('button', { name: 'Create Workspace', exact: true })
		).toBeEnabled()
		const href = await create(page, 'Edited workspace')
		await harness(page)
		await page.evaluate(async (id) => {
			const { db, app } = window.workspaceSettingsTest
			const optional = (
				await db.all(app.categories.where({ organizationId: id, isSystem: false }))
			)[0]
			if (!optional) throw new Error('Missing optional starter')
			await db.delete(app.categories, optional.id).wait({ tier: 'global' })
			await db
				.update(app.organizations, id, { name: 'Edited after creation' })
				.wait({ tier: 'global' })
		}, workspaceId(href))
		await page.reload()
		await expect(
			page
				.getByLabel('Select Workspace', { exact: true })
				.locator(`option[value="${workspaceId(href)}"]`)
		).toHaveText('Edited after creation')
		await harness(page)
		expect(
			await page.evaluate(async (id) => {
				const { db, app, userId } = window.workspaceSettingsTest
				return {
					count: (await db.all(app.categories.where({ organizationId: id }))).length,
					profile: (await db.all(app.profiles.where({ userId })))[0]?.displayName
				}
			}, workspaceId(href))
		).toEqual({ count: 7, profile: 'Preserved identity' })
	}
)

test(
	'startup does not backfill a missing initialization marker or create replacement data',
	{ tag: ['@workspaces'] },
	async ({ page }) => {
		await start(page)
		const before = await page.evaluate(async () => {
			const { db, app, userId } = window.workspaceSettingsTest
			const profile = (await db.all(app.profiles.where({ userId })))[0]
			if (!profile) throw new Error('Missing initial profile')
			await db
				.update(app.profiles, profile.id, { initialWorkspaceId: null })
				.wait({ tier: 'global' })
			return {
				profileId: profile.id,
				organizations: (await db.all(app.organizations)).map((row) => row.id).sort(),
				memberships: (await db.all(app.organizationMembers.where({ userId })))
					.map((row) => row.id)
					.sort()
			}
		})
		await page.reload()
		await expect(
			page.getByText('Your workspaces could not be prepared.', { exact: true })
		).toBeVisible()
		await harness(page)
		const after = await page.evaluate(async () => {
			const { db, app, userId } = window.workspaceSettingsTest
			const profiles = await db.all(app.profiles.where({ userId }), { tier: 'remote' })
			return {
				profiles: profiles.map((row) => ({
					id: row.id,
					initialWorkspaceId: row.initialWorkspaceId
				})),
				organizations: (await db.all(app.organizations)).map((row) => row.id).sort(),
				memberships: (await db.all(app.organizationMembers.where({ userId })))
					.map((row) => row.id)
					.sort()
			}
		})
		expect(after).toEqual({
			profiles: [{ id: before.profileId, initialWorkspaceId: null }],
			organizations: before.organizations,
			memberships: before.memberships
		})
	}
)

test(
	'lost membership does not resurrect the initial workspace or select a replacement',
	{ tag: ['@workspaces'] },
	async ({ page }) => {
		await start(page)
		const workspaceId = await page.evaluate(async () => {
			const { db, app, userId } = window.workspaceSettingsTest
			const member = (await db.all(app.organizationMembers.where({ userId })))[0]
			if (!member) throw new Error('Missing membership')
			await db.delete(app.organizationMembers, member.id).wait({ tier: 'global' })
			return member.organizationId
		})
		await page.goto(`/expenses?workspace=${workspaceId}`)
		await expect(
			page.getByRole('main').locator('p[aria-hidden="true"]').filter({
				hasText: 'This workspace or transaction is unavailable. Select a workspace you can access.'
			})
		).toBeVisible()
		await page.reload()
		await expect(
			page.getByRole('main').locator('p[aria-hidden="true"]').filter({
				hasText: 'This workspace or transaction is unavailable. Select a workspace you can access.'
			})
		).toBeVisible()
		await harness(page)
		expect(
			await page.evaluate(async () => {
				const { db, app, userId } = window.workspaceSettingsTest
				return {
					memberships: (await db.all(app.organizationMembers.where({ userId }))).length,
					profiles: (await db.all(app.profiles.where({ userId }))).length
				}
			})
		).toEqual({ memberships: 0, profiles: 1 })
	}
)

test(
	'journal storage failure blocks creation and permits explicit recovery',
	{ tag: ['@workspaces'] },
	async ({ page }) => {
		await page.addInitScript(() => {
			sessionStorage.setItem('deny-workspace-journal', 'true')
			const open = indexedDB.open.bind(indexedDB)
			indexedDB.open = (name, version) => {
				if (
					name === 'delightful-finances-workspace-attempts' &&
					sessionStorage.getItem('deny-workspace-journal') === 'true'
				)
					throw new DOMException('Journal unavailable', 'QuotaExceededError')
				return open(name, version)
			}
		})
		await page.goto('/settings/workspace')
		const dialog = await openCreationModal(page, 'Create Workspace')
		await expect(
			dialog.locator('p').filter({
				hasText:
					'Workspace creation could not finish. Check local storage and retry the same attempt.'
			})
		).toBeVisible()
		await expect(dialog.getByRole('alert')).toHaveText(
			'Workspace creation could not finish. Check local storage and retry the same attempt.'
		)
		await harness(page)
		expect(
			await page.evaluate(async () => {
				const { db, app } = window.workspaceSettingsTest
				return (await db.all(app.organizations)).length
			})
		).toBe(1)
		await page.evaluate(() => sessionStorage.removeItem('deny-workspace-journal'))
		await creationDialog(page, 'Create Workspace')
			.getByRole('button', { name: 'Try again', exact: true })
			.click()
		await expect(
			creationDialog(page, 'Create Workspace').getByLabel('Workspace name', { exact: true })
		).toBeEnabled()
		await create(page, 'Recovered storage')
	}
)

test(
	'server accepts creator bootstrap and rejects another identity changing its workspace',
	{ tag: ['@workspaces'] },
	async ({ page, browser }) => {
		await start(page)
		const href = await create(page, 'Protected workspace')
		const id = workspaceId(href)
		await expect
			.poll(async () =>
				page.evaluate(async (workspaceId) => {
					const { db, app } = window.workspaceSettingsTest
					return (await db.all(app.organizations.where({ id: workspaceId }), { tier: 'remote' }))[0]
						?.name
				}, id)
			)
			.toBe('Protected workspace')
		const other = await browser.newContext()
		try {
			const outsider = await other.newPage()
			await start(outsider)
			const rejected = await outsider.evaluate(async (workspaceId) => {
				const { db, app } = window.workspaceSettingsTest
				try {
					await db
						.update(app.organizations, workspaceId, { name: 'Unauthorized rename' })
						.wait({ tier: 'global' })
					return false
				} catch {
					return true
				}
			}, id)
			expect(rejected).toBe(true)
			expect(
				await page.evaluate(async (workspaceId) => {
					const { db, app } = window.workspaceSettingsTest
					return (await db.all(app.organizations.where({ id: workspaceId }), { tier: 'remote' }))[0]
						?.name
				}, id)
			).toBe('Protected workspace')
		} finally {
			await other.close()
		}
	}
)

test(
	'has one management link and preserves workspace scope in copyable sidebar URLs',
	{ tag: ['@workspaces'] },
	async ({ page, context }) => {
		await start(page)
		await create(page, 'Scoped link workspace')
		await closeCreationModal(page)
		await prepareSidebar(page)
		const sidebar = page.getByRole('complementary')
		await expect(sidebar.getByRole('link', { name: 'Workspaces', exact: true })).toHaveCount(1)
		await expect(sidebar.locator('a[aria-current="page"]')).toHaveCount(1)
		await expect(sidebar.getByRole('link', { name: 'Expenses', exact: true })).not.toHaveAttribute(
			'aria-current',
			'page'
		)
		const choice = page.getByLabel('Select Workspace', { exact: true })
		const id = await choice.locator('option:not([disabled])').first().getAttribute('value')
		if (!id) throw new Error('Missing workspace choice')
		await choice.selectOption(id)
		await expect(page).toHaveURL(`/settings/workspace?workspace=${id}`)
		await expect(
			page.getByRole('main').getByRole('textbox', { name: 'Workspace name', exact: true })
		).toBeEnabled()
		await expect(sidebar.getByLabel('Current Workspace', { exact: true })).toHaveValue(id)
		const expenses = sidebar.getByRole('link', { name: 'Expenses', exact: true })
		await expect(expenses).toHaveAttribute('href', `/expenses?workspace=${id}`)
		const copied = await expenses.getAttribute('href')
		if (!copied) throw new Error('Missing scoped expenses link')
		const other = await context.newPage()
		await other.goto(copied)
		await expect(other).toHaveURL(`/expenses?workspace=${id}`)
		await expect(other.getByRole('heading', { name: 'Expenses', exact: true })).toBeVisible()
		await other.close()
		await expect(page).toHaveURL(`/settings/workspace?workspace=${id}`)
	}
)

for (const duplicate of [false, true]) {
	test(
		`explicit ${duplicate ? 'duplicate' : 'malformed'} workspace query fails closed`,
		{ tag: ['@workspaces'] },
		async ({ page }) => {
			await start(page)
			const id = await page.evaluate(async () => {
				const { db, app } = window.workspaceSettingsTest
				const row = (await db.all(app.organizations))[0]
				if (!row) throw new Error('Missing workspace')
				return row.id
			})
			const href = duplicate
				? `/expenses?workspace=${id}&workspace=${id}`
				: '/expenses?workspace=invalid'
			await page.goto(href)
			await expect(
				page.getByRole('main').locator('p[aria-hidden="true"]').filter({
					hasText:
						'This workspace or transaction is unavailable. Select a workspace you can access.'
				})
			).toBeVisible()
			await expect(page).toHaveURL(href)
		}
	)
}

test(
	'submitted workspace creation survives selecting another workspace',
	{ tag: ['@workspaces'] },
	async ({ page }) => {
		const errors: string[] = []
		page.on('pageerror', (error) => errors.push(error.message))
		page.on('console', (message) => {
			if (message.type() === 'warning' && message.text().includes('sent to stopped actor'))
				errors.push(message.text())
		})
		await start(page)
		const target = workspaceId(await create(page, 'Selection destination'))
		await closeCreationModal(page)
		const first = await page.evaluate(async (target) => {
			const { db, app } = window.workspaceSettingsTest
			const row = (await db.all(app.organizations)).find((row) => row.id !== target)
			if (!row) throw new Error('Missing initial workspace')
			return row.id
		}, target)
		const selector = page.getByLabel('Select Workspace', { exact: true })
		await selector.selectOption(first)
		await expect(page).toHaveURL(`/settings/workspace?workspace=${first}`)
		const dialog = await openCreationModal(page, 'Create Workspace')
		await expect(dialog.getByLabel('Workspace name', { exact: true })).toBeEnabled()
		await dialog.getByLabel('Workspace name', { exact: true }).fill('Creation across selection')
		await expect(dialog.getByLabel('Workspace name', { exact: true })).toHaveValue(
			'Creation across selection'
		)
		const gate = await page.evaluateHandle(() => {
			const digest = crypto.subtle.digest.bind(crypto.subtle)
			let release = () => {}
			const pending = new Promise<void>((resolve) => {
				release = resolve
			})
			crypto.subtle.digest = (algorithm, data) => pending.then(() => digest(algorithm, data))
			return {
				release: () => {
					crypto.subtle.digest = digest
					release()
				}
			}
		})
		try {
			await dialog.getByRole('button', { name: 'Create Workspace', exact: true }).click()
			await expect(dialog.getByRole('status')).toHaveText('Preparing your workspace…')
			await dialog.getByRole('button', { name: 'Close', exact: true }).click()
			await selector.selectOption(target)
			await expect(page).toHaveURL(`/settings/workspace?workspace=${target}`)
			await openCreationModal(page, 'Create Workspace')
			await expect(dialog.getByRole('status')).toHaveText('Preparing your workspace…')
		} finally {
			await gate.evaluate((control) => control.release())
			await gate.dispose()
		}
		await expect(dialog.getByRole('status')).toHaveText('Workspace saved.')
		await expect(page).toHaveURL(`/settings/workspace?workspace=${target}`)
		expect(
			await page.evaluate(async () => {
				const { db, app } = window.workspaceSettingsTest
				return (await db.all(app.organizations)).filter(
					(row) => row.name === 'Creation across selection'
				).length
			})
		).toBe(1)
		expect(errors).toEqual([])
	}
)

test(
	'workspace creation preserves a rejected draft and resets only for an explicit new creation',
	{ tag: ['@workspaces'] },
	async ({ page }) => {
		await start(page)
		const dialog = await openCreationModal(page, 'Create Workspace')
		const name = dialog.getByLabel('Workspace name', { exact: true })
		await name.fill('   ')
		await dialog.getByRole('button', { name: 'Create Workspace', exact: true }).click()
		await expect(dialog.getByRole('alert')).not.toHaveText('')
		await expect(name).toHaveValue('   ')
		await expect(name).toBeEnabled()
		await create(page, 'Corrected workspace')
		await dialog.getByRole('button', { name: 'Close', exact: true }).click()
		await openCreationModal(page, 'Create Workspace')
		await expect(name).toHaveValue('')
		await expect(name).toBeFocused()
		await expect(dialog.getByRole('alert')).toHaveText('')
	}
)
