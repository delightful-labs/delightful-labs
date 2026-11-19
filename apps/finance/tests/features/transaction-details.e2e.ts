import { financeFixture } from '../helpers/worker-fixture.js'
import { expect } from '@playwright/test'
import { test, start, installWorkspaceSettingsTest } from '../helpers/workspace.js'
import { navigateSidebar, selectWorkspace } from '../helpers/ui.js'

for (const kind of ['expense', 'income']) {
	test(
		`transaction details ${kind} show related records, authorship, live updates, and reload`,
		{ tag: ['@transactions', '@description'] },
		async ({ page }) => {
			await start(page)
			const organizationId = await page
				.getByLabel('Current Workspace', { exact: true })
				.inputValue()
			const fixture = await financeFixture(page, 'features/transaction-details.e2e:14', {
				organizationId,
				kind
			})
			await page
				.getByRole('navigation')
				.getByRole('link', { name: kind === 'expense' ? 'Expenses' : 'Income', exact: true })
				.click()
			const main = page.getByRole('main')
			const listPath = kind === 'expense' ? '/expenses' : '/income'
			const detailPath = `${listPath}/${fixture.id}?workspace=${organizationId}`
			const link = main.getByRole('link', { name: /Transaction details:.*Detail description/ })
			await expect(link).toHaveAttribute('href', detailPath)
			await link.focus()
			await page.keyboard.press('Enter')
			await expect(page).toHaveURL(detailPath)
			await expect(
				main.getByRole('heading', { name: 'Transaction details', exact: true })
			).toBeVisible()
			await expect(
				main.getByLabel('Account', { exact: true }).locator('option:checked')
			).toHaveText('Detail account · USD')
			await expect(
				main.getByLabel('Category', { exact: true }).locator('option:checked')
			).toHaveText('Detail category')
			await expect(
				main.getByRole('button', { name: 'Remove Detail tag', exact: true })
			).toBeVisible()
			await expect(main.getByLabel('Amount', { exact: true })).toHaveValue('12.34')
			const memo = main.getByLabel('Memo (additional notes)', { exact: true })
			await expect(memo).toHaveValue('Original detail memo')
			await main.locator('summary').filter({ hasText: 'Metadata' }).click()
			await expect(main.getByText('Detail author', { exact: true })).toHaveCount(2)
			await expect(main.locator(`time[datetime="${fixture.createdAt}"]`)).toHaveCount(2)
			await expect(main.getByLabel('Date', { exact: true })).toHaveValue('2026-10-14')
			if (kind === 'income') {
				await expect(main.getByLabel('Payment method', { exact: true })).toHaveValue('check')
				await expect(main.getByLabel('Check number', { exact: true })).toHaveValue('12345')
				await expect(main.getByLabel('Check date', { exact: true })).toHaveValue('2026-10-13')
			} else await expect(main.getByLabel('Check number', { exact: true })).toBeHidden()
			await financeFixture(page, 'features/transaction-details.e2e:132', fixture.id)
			await expect(memo).toHaveValue('Updated detail memo')
			await expect(main.locator(`time[datetime="${fixture.createdAt}"]`)).toHaveCount(1)
			await page.reload()
			await expect(memo).toHaveValue('Updated detail memo')
			await main.locator('summary').filter({ hasText: 'Metadata' }).click()
			await expect(main.getByText('Detail author', { exact: true })).toHaveCount(2)
			await navigateSidebar(page, kind === 'expense' ? 'Expenses' : 'Income')
			await expect(page).toHaveURL(`${listPath}?workspace=${organizationId}`)
			await expect(link).toBeVisible()
		}
	)
}

test(
	'transaction details hide rows from another active workspace and handle missing IDs',
	{ tag: ['@transactions', '@workspaces'] },
	async ({ page }) => {
		await start(page)
		const organizationId = await page.getByLabel('Current Workspace', { exact: true }).inputValue()
		const fixture = await financeFixture(
			page,
			'features/transaction-details.e2e:157',
			organizationId
		)
		await navigateSidebar(page, 'Expenses')
		await page
			.getByRole('main')
			.locator('section ul.entries')
			.getByRole('listitem')
			.getByRole('link')
			.click()
		const main = page.getByRole('main')
		const memo = main.getByLabel('Memo (additional notes)', { exact: true })
		await expect(memo).toHaveValue('Scoped detail')
		const selector = page.getByLabel('Current Workspace', { exact: true })
		await selectWorkspace(selector, fixture.otherId)
		await expect(memo).toHaveCount(0)
		await page.goto(`/expenses/${fixture.id}?workspace=${fixture.otherId}`)
		await expect(
			main.getByText('This transaction is unavailable in the selected workspace.', { exact: true })
		).toBeVisible()
		await expect(memo).toHaveCount(0)
		await selectWorkspace(selector, organizationId)
		await page.goto(`/expenses/${fixture.id}?workspace=${organizationId}`)
		await expect(memo).toHaveValue('Scoped detail')
		await page.goto(`/expenses/${crypto.randomUUID()}?workspace=${organizationId}`)
		await expect(
			main.getByText('This transaction is unavailable in the selected workspace.', { exact: true })
		).toBeVisible()
	}
)

for (const scenario of [
	{
		name: 'viewer with account read access',
		role: 'viewer',
		mode: 'selected',
		grant: true,
		read: true,
		edit: false
	},
	{
		name: 'viewer without account grants',
		role: 'viewer',
		mode: 'selected',
		grant: false,
		read: false,
		edit: false
	},
	{ name: 'member editor', role: 'member', mode: 'all', grant: false, read: true, edit: true }
]) {
	test(
		`transaction details permissions: ${scenario.name}`,
		{ tag: ['@transactions', '@permissions'] },
		async ({ page, browser }) => {
			await start(page)
			const organizationId = await page
				.getByLabel('Current Workspace', { exact: true })
				.inputValue()
			const ownerId = await financeFixture(page, 'features/transaction-details.e2e:257')
			await financeFixture(page, 'features/transaction-details.e2e:258')
			const subjectContext = await browser.newContext({ baseURL: new URL(page.url()).origin })
			try {
				const subject = await subjectContext.newPage()
				await start(subject)
				const subjectId = await financeFixture(subject, 'features/transaction-details.e2e:270')
				const fixture = await financeFixture(page, 'features/transaction-details.e2e:271', {
					organizationId,
					subjectId,
					scenario
				})
				await subject.reload()
				await installWorkspaceSettingsTest(subject)
				const selector = subject.getByLabel('Current Workspace', { exact: true })
				await expect(selector.locator(`option[value="${organizationId}"]`)).toHaveCount(1)
				await selectWorkspace(selector, organizationId)
				if (scenario.edit) {
					await financeFixture(subject, 'features/transaction-details.e2e:345', fixture.id)
				}
				// Direct navigation exercises permission enforcement independently of visible list links.
				await subject.goto(`/expenses/${fixture.id}?workspace=${organizationId}`)
				await expect(
					subject
						.getByLabel('Current Workspace', { exact: true })
						.locator(`option[value="${organizationId}"]`)
				).toHaveCount(1)
				const main = subject.getByRole('main')
				if (scenario.read) {
					await expect(
						main.getByLabel('Account', { exact: true }).locator('option:checked')
					).toHaveText('Shared detail account · USD')
					await expect(
						main.getByRole('button', { name: 'Remove Shared detail tag', exact: true })
					).toBeVisible()
					await main.locator('summary').filter({ hasText: 'Metadata' }).click()
					await expect(main.getByText('Shared author', { exact: true })).toHaveCount(
						scenario.edit ? 1 : 2
					)
					await expect(main.getByText(ownerId, { exact: true })).toHaveCount(0)
					if (scenario.edit) {
						await expect(main.getByText('Detail editor', { exact: true })).toBeVisible()
						await expect(main.getByLabel('Memo (additional notes)', { exact: true })).toHaveValue(
							'Edited by member'
						)
						await expect(main.locator(`time[datetime="${fixture.createdAt}"]`)).toHaveCount(1)
					}
				} else {
					await expect(
						main.getByText('This transaction is unavailable in the selected workspace.', {
							exact: true
						})
					).toBeVisible()
					await expect(main.getByText('Shared detail account', { exact: true })).toHaveCount(0)
					await expect(main.getByText('Shared detail tag', { exact: true })).toHaveCount(0)
					await expect(main.getByText(ownerId, { exact: true })).toHaveCount(0)
				}
			} finally {
				await subjectContext.close()
			}
		}
	)
}
