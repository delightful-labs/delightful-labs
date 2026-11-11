import { expect, test, type Page } from '@playwright/test'
import type { OrganizationMember } from '../src/lib/schema.js'

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
	return page.evaluate(async () => {
		const path = '/src/lib/runtime/jazz-session.ts'
		const { getCurrentJazzSession }: typeof import('../src/lib/runtime/jazz-session.js') =
			await import(path)
		const snapshot = getCurrentJazzSession()?.getSnapshot()
		if (!snapshot?.account) throw new Error('Missing offline fixture identity')
		const organizationId = new URL(location.href).searchParams.get('workspace')
		if (!organizationId) throw new Error('Missing offline fixture workspace')
		return { userId: snapshot.account.id, organizationId }
	})
}

for (const scenario of scenarios) {
	test(`offline cached access and reconnection: ${scenario.name}`, async ({ page, browser }) => {
		const owner = await start(page)
		const context = await browser.newContext({ baseURL: new URL(page.url()).origin })
		try {
			const subject = await context.newPage()
			const identity = await start(subject)
			const fixture = await page.evaluate(
				async ({ owner, identity, scenario }) => {
					const schemaPath = '/src/lib/schema.ts'
					const sessionPath = '/src/lib/runtime/jazz-session.ts'
					const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
					const { getCurrentJazzSession }: typeof import('../src/lib/runtime/jazz-session.js') =
						await import(sessionPath)
					const db = getCurrentJazzSession()?.getSnapshot().client?.db
					if (!db) throw new Error('Missing owner database')
					const category = await db.one(
						app.categories.where({
							organizationId: owner.organizationId,
							kind: 'expense',
							isSystem: true
						})
					)
					if (!category) throw new Error('Missing expense category')
					const tx = db.beginTransaction()
					const account = tx.insert(app.accounts, {
						organizationId: owner.organizationId,
						name: 'Offline shared ledger',
						kind: 'cash',
						currency: 'USD'
					})
					const hiddenAccount = tx.insert(app.accounts, {
						organizationId: owner.organizationId,
						name: 'Other offline ledger',
						kind: 'cash',
						currency: 'USD'
					})
					const transaction = tx.insert(app.transactions, {
						organizationId: owner.organizationId,
						accountId: account.id,
						categoryId: category.id,
						kind: 'expense',
						amountMinor: 100,
						currency: 'USD',
						bookedOn: '2026-10-25',
						source: 'manual',
						description: 'Offline access fixture'
					})
					const hidden = tx.insert(app.transactions, {
						organizationId: owner.organizationId,
						accountId: hiddenAccount.id,
						categoryId: category.id,
						kind: 'expense',
						amountMinor: 200,
						currency: 'USD',
						bookedOn: '2026-10-25',
						source: 'manual',
						description: 'Other account fixture'
					})
					if (scenario.role)
						tx.insert(app.organizationMembers, {
							organizationId: owner.organizationId,
							userId: identity.userId,
							role: scenario.role,
							accountAccessMode: scenario.mode
						})
					if (scenario.grant)
						tx.insert(app.accountMemberships, {
							organizationId: owner.organizationId,
							userId: identity.userId,
							accountId: account.id,
							access: scenario.grant,
							canDelete: false
						})
					await tx.commit().wait({ tier: 'global' })
					return { transactionId: transaction.id, hiddenId: hidden.id }
				},
				{ owner, identity, scenario }
			)
			// Warm the same scoped finance queries before disconnecting. Never treat an
			// offline cache miss as evidence that the remote workspace is empty.
			const online = await subject.evaluate(
				async ({ organizationId, fixture }) => {
					const schemaPath = '/src/lib/schema.ts'
					const sessionPath = '/src/lib/runtime/jazz-session.ts'
					const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
					const { getCurrentJazzSession }: typeof import('../src/lib/runtime/jazz-session.js') =
						await import(sessionPath)
					const db = getCurrentJazzSession()?.getSnapshot().client?.db
					if (!db) throw new Error('Missing subject database')
					const rows = await db.all(app.transactions.where({ organizationId }), { tier: 'remote' })
					return {
						readable: rows.some((row) => row.id === fixture.transactionId),
						otherReadable: rows.some((row) => row.id === fixture.hiddenId)
					}
				},
				{ organizationId: owner.organizationId, fixture }
			)
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
			const cached = await subject.evaluate(
				async ({ organizationId, fixture }) => {
					const schemaPath = '/src/lib/schema.ts'
					const sessionPath = '/src/lib/runtime/jazz-session.ts'
					const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
					const { getCurrentJazzSession }: typeof import('../src/lib/runtime/jazz-session.js') =
						await import(sessionPath)
					const db = getCurrentJazzSession()?.getSnapshot().client?.db
					if (!db) throw new Error('Missing offline database')
					const rows = await db.all(app.transactions.where({ organizationId }), {
						tier: 'local-first'
					})
					return {
						readable: rows.some((row) => row.id === fixture.transactionId),
						otherReadable: rows.some((row) => row.id === fixture.hiddenId)
					}
				},
				{ organizationId: owner.organizationId, fixture }
			)
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
				.poll(() =>
					page.evaluate(async (id) => {
						const schemaPath = '/src/lib/schema.ts'
						const sessionPath = '/src/lib/runtime/jazz-session.ts'
						const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
						const { getCurrentJazzSession }: typeof import('../src/lib/runtime/jazz-session.js') =
							await import(sessionPath)
						const db = getCurrentJazzSession()?.getSnapshot().client?.db
						if (!db) throw new Error('Missing owner verification database')
						return (await db.one(app.transactions.where({ id }), { tier: 'remote' }))?.amountMinor
					}, fixture.transactionId)
				)
				.toBe(scenario.write ? 321 : 100)
		} finally {
			await context.setOffline(false)
			await context.close()
		}
	})
}
