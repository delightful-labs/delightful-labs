import { financeFixture } from './helpers/worker-fixture.js'
import { expect, test, type Page } from '@playwright/test'
import type { OrganizationMember } from '../src/lib/queries.js'

type Scenario = {
	name: string
	role?: OrganizationMember['role']
	mode: OrganizationMember['accountAccessMode']
	grant?: 'read' | 'write'
	read: boolean
	write: boolean
}
const scenarios: Scenario[] = [
	{ name: 'owner', role: 'owner', mode: 'selected', read: true, write: true },
	{ name: 'admin', role: 'admin', mode: 'selected', read: true, write: true },
	{ name: 'all-account member', role: 'member', mode: 'all', read: true, write: true },
	{
		name: 'selected member with write grant',
		role: 'member',
		mode: 'selected',
		grant: 'write',
		read: true,
		write: true
	},
	{
		name: 'selected member with read grant',
		role: 'member',
		mode: 'selected',
		grant: 'read',
		read: true,
		write: false
	},
	{
		name: 'selected member without grants',
		role: 'member',
		mode: 'selected',
		read: false,
		write: false
	},
	{ name: 'all-account viewer', role: 'viewer', mode: 'all', read: true, write: false },
	{
		name: 'viewer with write grant',
		role: 'viewer',
		mode: 'selected',
		grant: 'write',
		read: true,
		write: false
	},
	{ name: 'unrelated user', mode: 'selected', read: false, write: false },
	{ name: 'orphan write grant', mode: 'selected', grant: 'write', read: false, write: false }
]

async function start(page: Page) {
	await page.goto('/accounts')
	await expect(
		page.getByRole('main').getByRole('button', { name: 'Add Account', exact: true })
	).toBeEnabled()
	return financeFixture(page, 'offline-access.e2e:57', page.url())
}

for (const scenario of scenarios) {
	test(`offline cached access and reconnection: ${scenario.name}`, async ({ page, browser }) => {
		const owner = await start(page)
		const context = await browser.newContext({ baseURL: new URL(page.url()).origin })
		try {
			const subject = await context.newPage()
			const identity = await start(subject)
			const fixture = await financeFixture(page, 'offline-access.e2e:76', {
				owner,
				identity,
				scenario
			})
			// Warm the same scoped finance queries before disconnecting. Never treat an
			// offline cache miss as evidence that the remote workspace is empty.
			const online = await financeFixture(subject, 'offline-access.e2e:150', {
				organizationId: owner.organizationId,
				fixture
			})
			expect(online.readable).toBe(scenario.read)
			expect(online.otherReadable).toBe(
				scenario.role === 'owner' ||
					scenario.role === 'admin' ||
					(Boolean(scenario.role) && scenario.mode === 'all')
			)
			if (scenario.read) {
				await subject.goto(`/expenses/${fixture.transactionId}?workspace=${owner.organizationId}`)
				await expect(subject.getByLabel('Amount', { exact: true })).toHaveValue('1.00')
			}
			await context.setOffline(true)
			const cached = await financeFixture(subject, 'offline-access.e2e:178', {
				organizationId: owner.organizationId,
				fixture
			})
			expect(cached).toEqual(online)
			if (scenario.read) {
				const amount = subject.getByLabel('Amount', { exact: true })
				if (scenario.write) {
					await expect(amount).toBeEnabled()
					await amount.fill('3.21')
					await subject.getByRole('button', { name: 'Save Transaction', exact: true }).click()
					await expect(
						subject.getByRole('status').filter({ hasText: /^Transaction saved\.$/ })
					).toBeVisible()
				} else {
					await expect(amount).toBeDisabled()
					await expect(
						subject.getByRole('button', { name: 'Save Transaction', exact: true })
					).toHaveCount(0)
				}
			}
			await context.setOffline(false)
			await expect
				.poll(() => financeFixture(page, 'offline-access.e2e:217', fixture.transactionId))
				.toBe(scenario.write ? 321 : 100)
		} finally {
			await context.setOffline(false)
			await context.close()
		}
	})
}
