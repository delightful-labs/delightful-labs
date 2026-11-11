import { expect, test, type Page } from '@playwright/test'

async function records(page: Page) {
	return page.evaluate(async () => {
		const schemaPath = '/src/lib/schema.ts'
		const sessionPath = '/src/lib/runtime/jazz-session.ts'
		const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
		const { getCurrentJazzSession }: typeof import('../src/lib/runtime/jazz-session.js') =
			await import(sessionPath)
		const db = getCurrentJazzSession()?.getSnapshot().client?.db
		if (!db) throw new Error('No initialized Jazz database')
		const [accounts, transactions] = await Promise.all([
			db.all(app.accounts.orderBy('id'), { tier: 'remote' }),
			db.all(app.transactions.orderBy('id'), { tier: 'remote' })
		])
		return {
			accountIds: accounts.map((row) => row.id),
			transactionIds: transactions.map((row) => row.id),
			kinds: accounts.map((row) => row.kind).sort()
		}
	})
}

test('fake data follows its own flag and survives refresh without duplication', async ({
	page
}, info) => {
	const enabled = info.config.metadata.seedEnabled === true
	const debug = info.config.metadata.debugEnabled === true
	const errors: string[] = []
	page.on('pageerror', (error) => errors.push(error.message))
	await page.goto('/accounts')
	await expect(
		page.getByRole('main').getByRole('heading', { name: 'Accounts', exact: true })
	).toBeVisible()
	// Readiness is independent of optional seeding; wait for its observable data result.
	if (enabled) await expect.poll(async () => (await records(page)).transactionIds.length).toBe(120)
	const initial = await records(page)
	expect(initial.accountIds).toHaveLength(enabled ? 3 : 0)
	expect(initial.transactionIds).toHaveLength(enabled ? 120 : 0)
	if (enabled) expect(initial.kinds).toEqual(['bank', 'card', 'cash'])
	await expect(page.getByRole('button', { name: 'Developer menu', exact: true })).toHaveCount(
		debug ? 1 : 0
	)
	await page.reload()
	await expect(
		page.getByRole('main').getByRole('heading', { name: 'Accounts', exact: true })
	).toBeVisible()
	expect(await records(page)).toEqual(initial)
	if (enabled && debug) {
		const menu = page.getByRole('button', { name: 'Developer menu', exact: true })
		await menu.focus()
		await menu.press('Enter')
		const dialog = page.getByRole('dialog', { name: 'Developer menu', exact: true })
		await dialog
			.getByRole('button', { name: 'Add 25 sample Expense Transactions', exact: true })
			.click()
		await expect(dialog.getByRole('status')).toHaveText('Saved 25 of 25 sample transactions.')
		await expect.poll(async () => (await records(page)).transactionIds.length).toBe(145)
		await page.keyboard.press('Escape')
		await page.reload()
		await expect(
			page.getByRole('main').getByRole('heading', { name: 'Accounts', exact: true })
		).toBeVisible()
		expect((await records(page)).transactionIds).toHaveLength(145)
	}
	expect(errors).toEqual([])
})
