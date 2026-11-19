import { financeFixture } from '../helpers/worker-fixture.js'
import { expect } from '@playwright/test'
import { test, start } from '../helpers/workspace.js'
import { navigateSidebar, selectWorkspace } from '../helpers/ui.js'

test(
	'profile name saves offline, follows workspace selection, and supplies transaction attribution',
	{ tag: ['@workflow-completion', '@identity', '@workspaces'] },
	async ({ page }) => {
		await start(page)
		const organizationId = await page.getByLabel('Current Workspace', { exact: true }).inputValue()
		const fixture = await financeFixture(page, 'features/profiles.e2e:11', organizationId)
		await navigateSidebar(page, 'Account')
		await expect(page).toHaveURL(`/account?workspace=${organizationId}`)
		const main = page.getByRole('main')
		const metadata = main.locator('details').filter({
			has: page.locator('summary').filter({ hasText: 'Metadata' })
		})
		await expect(main.getByLabel('Display name', { exact: true })).toBeEnabled()
		await page.context().setOffline(true)
		try {
			await main.getByLabel('Display name', { exact: true }).fill('Offline profile owner')
			await main.getByRole('button', { name: 'Save', exact: true }).click()
			await expect(
				main.getByRole('status').filter({ hasText: 'Profile Display name saved.' })
			).toHaveText('Profile Display name saved.')
			await expect
				.poll(() => financeFixture(page, 'features/profiles.e2e:68'))
				.toBe('Offline profile owner')
		} finally {
			await page.context().setOffline(false)
		}
		await expect
			.poll(() => financeFixture(page, 'features/profiles.e2e:79'))
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
		await expect(metadata.getByText('Offline profile owner', { exact: true })).toHaveCount(2)
		await navigateSidebar(page, 'Account')
		await main.getByLabel('Display name', { exact: true }).fill('')
		await main.getByRole('button', { name: 'Save', exact: true }).click()
		await expect(
			main.getByRole('status').filter({ hasText: 'Profile Display name saved.' })
		).toHaveText('Profile Display name saved.')
		await page.goto(`/expenses/${fixture.transactionId}?workspace=${organizationId}`)
		await main.locator('summary').filter({ hasText: 'Metadata' }).click()
		await expect(metadata.getByText(fixture.userId, { exact: true })).toHaveCount(2)
		await expect(metadata.getByText('Offline profile owner', { exact: true })).toHaveCount(0)
	}
)

test(
	'profile name edits are owner-only even for members of a shared workspace',
	{ tag: ['@workflow-completion', '@identity', '@workspaces', '@permissions'] },
	async ({ page, browser, baseURL }) => {
		await start(page)
		const organizationId = await page.getByLabel('Current Workspace', { exact: true }).inputValue()
		const owner = await financeFixture(page, 'features/profiles.e2e:114')
		const context = await browser.newContext({ baseURL: baseURL ?? 'http://127.0.0.1:5173' })
		try {
			const subject = await context.newPage()
			await start(subject)
			const subjectId = await financeFixture(subject, 'features/profiles.e2e:127')
			await financeFixture(page, 'features/profiles.e2e:128', { organizationId, subjectId })
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
			const outcome = await financeFixture(subject, 'features/profiles.e2e:155', owner)
			expect(outcome.ownerVisible).toBe(true)
			expect(outcome.edit).toMatch(/AuthorizationDenied|permission_denied/)
			expect(outcome.transfer).toMatch(/AuthorizationDenied|permission_denied/)
			expect(outcome.ownName).toBe('Shared workspace member')
			expect(outcome.ownUserId).toBe(subjectId)
			await expect
				.poll(() => financeFixture(page, 'features/profiles.e2e:197', owner.profileId))
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
			const owner = await financeFixture(page, 'features/profiles.e2e:223')
			const context = await browser.newContext({ baseURL: new URL(page.url()).origin })
			try {
				const subject = await context.newPage()
				await start(subject)
				const subjectProfile = await financeFixture(subject, 'features/profiles.e2e:257')
				const readOwner = () => financeFixture(subject, 'features/profiles.e2e:267', owner.id)
				expect(await readOwner()).toBeNull()
				const membershipId = await financeFixture(page, 'features/profiles.e2e:279', {
					organizationId,
					subjectProfile,
					role
				})
				await expect
					.poll(readOwner)
					.toEqual({ name: 'Shared display profile', bytes: [1, 2, 3], mime: 'image/png' })
				// A membership without a profile reference must not expose an unrelated profile.
				expect(await financeFixture(page, 'features/profiles.e2e:301', subjectProfile.id)).toBe(
					false
				)
				await financeFixture(page, 'features/profiles.e2e:306', {
					membershipId,
					profileId: subjectProfile.id
				})
				await expect
					.poll(() => financeFixture(page, 'features/profiles.e2e:317', subjectProfile.id))
					.toBe('Shared member')
				expect(await financeFixture(subject, 'features/profiles.e2e:326', owner.userId)).toEqual([
					organizationId
				])
				await financeFixture(page, 'features/profiles.e2e:333', membershipId)
				await expect.poll(readOwner).toBeNull()
				await expect
					.poll(() => financeFixture(page, 'features/profiles.e2e:340', subjectProfile.id))
					.toBeNull()
			} finally {
				await context.close()
			}
		}
	)
}
