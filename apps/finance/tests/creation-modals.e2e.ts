import { expect, test, type Page } from '@playwright/test'

async function openCreation(page: Page, route: string, label: string) {
	await page.goto(route)
	const trigger = page.getByRole('main').getByRole('button', { name: label, exact: true }).first()
	await expect(trigger).toBeEnabled()
	await trigger.click()
	const dialog = page.getByRole('dialog', { name: label, exact: true })
	await expect(dialog).toBeVisible()
	return { trigger, dialog }
}

for (const entity of ['category', 'tag']) {
	const category = entity === 'category'
	const label = category ? 'Add Category' : 'Add Tag'
	const route = category ? '/settings/categories' : '/settings/tags'
	const field = category ? 'Category name' : 'Tag name'
	const caption = category ? 'Categories' : 'Tags'
	const errors = category
		? ['Enter Category name', 'Select an option for Transaction type']
		: ['Enter Tag name']

	test(
		`${entity} modal validates, saves, resets and persists`,
		{ tag: [entity === 'category' ? '@categories' : '@tags', '@workflow-completion'] },
		async ({ page }) => {
			const { trigger, dialog } = await openCreation(page, route, label)

			const name = dialog.getByLabel(field, { exact: true })
			await name.fill('   ')
			await dialog.getByRole('button', { name: label, exact: true }).click()
			await expect(dialog.getByRole('alert').locator('p')).toHaveText(errors)

			const savedName = `${entity}-${'longname'.repeat(16)}`
			await name.fill(savedName)
			await dialog.getByRole('button', { name: label, exact: true }).click()
			await expect(dialog.getByRole('status')).toContainText(savedName)
			await dialog.getByRole('button', { name: 'Close', exact: true }).click()
			await trigger.click()
			await expect(name).toHaveValue('')
			await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
			const table = page.getByRole('main').getByRole('table', { name: caption, exact: true })
			await expect(table.getByRole('rowheader', { name: savedName, exact: true })).toBeVisible()
			await page.reload()
			await expect(
				page.getByRole('main').getByRole('rowheader', { name: savedName, exact: true })
			).toBeVisible()
		}
	)
}

for (const route of ['/expenses', '/income', '/expenses/new', '/income/new']) {
	test(
		`first account can be created from ${route} and used for a transaction`,
		{ tag: ['@transactions', '@description', '@accounts'] },
		async ({ page }) => {
			const { dialog } = await openCreation(page, route, 'Add Account')
			await expect(page).toHaveURL((url) => url.pathname === route)
			await dialog.getByLabel('Account name', { exact: true }).fill('First checking')
			await dialog.getByLabel('Account type', { exact: true }).selectOption('bank')
			await dialog.getByRole('button', { name: 'Add Account', exact: true }).click()
			await expect(dialog).not.toBeVisible()
			await expect(page).toHaveURL((url) => url.pathname === route)
			const entry = route.endsWith('/new') ? route : `${route}/new`
			if (entry !== route) await page.goto(entry)
			const main = page.getByRole('main')
			await expect(
				main.getByLabel('Account', { exact: true }).locator('option:checked')
			).toHaveText('First checking · USD')
			await main.getByLabel('Amount', { exact: true }).fill('12.34')
			const description = main.getByLabel('Description', { exact: true })
			const memo = main.getByLabel('Memo (additional notes)', { exact: true })
			await expect(description).toHaveJSProperty('tagName', 'INPUT')
			await expect(memo).toHaveJSProperty('tagName', 'TEXTAREA')
			await description.fill('  First transaction  ')
			await memo.fill('Additional notes\nSecond line')
			await main.getByRole('button', { name: 'Save Transaction', exact: true }).click()
			await expect(page).toHaveURL((url) => url.pathname === route.replace('/new', ''))
			await expect(main.getByText('First transaction', { exact: true })).toBeVisible()
			await expect(main.getByText('Additional notes', { exact: false })).toHaveCount(0)
			await main.getByRole('link', { name: /Transaction details:.*First transaction/ }).click()
			await expect(main.getByLabel('Description', { exact: true })).toHaveValue('First transaction')
			await expect(main.getByLabel('Memo (additional notes)', { exact: true })).toHaveValue(
				'Additional notes\nSecond line'
			)
			await main.getByLabel('Description', { exact: true }).fill('Updated description')
			await main.getByRole('button', { name: 'Save Transaction', exact: true }).click()
			await expect(
				main.getByRole('status').filter({ hasText: /^Transaction saved\.$/ })
			).toBeVisible()
			await page.reload()
			await expect(main.getByLabel('Description', { exact: true })).toHaveValue(
				'Updated description'
			)
			await expect(main.getByLabel('Memo (additional notes)', { exact: true })).toHaveValue(
				'Additional notes\nSecond line'
			)
		}
	)
}

test(
	'account management reuses the modal and the removed account route is unavailable',
	{ tag: ['@accounts'] },
	async ({ page }) => {
		const { dialog } = await openCreation(page, '/accounts', 'Add Account')
		await dialog.getByLabel('Account name', { exact: true }).fill('Modal checking')
		await dialog.getByLabel('Account type', { exact: true }).selectOption('bank')
		await dialog.getByLabel('Currency', { exact: true }).selectOption('TZS')
		await dialog.getByRole('button', { name: 'Add Account', exact: true }).click()
		await expect(dialog.getByRole('status')).toContainText('Modal checking')
		const savedCurrency = await page.evaluate(async () => {
			const schemaPath = '/src/lib/schema.ts'
			const sessionPath = '/src/lib/runtime/jazz-session.ts'
			const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
			const { getCurrentJazzSession }: typeof import('../src/lib/runtime/jazz-session.js') =
				await import(sessionPath)
			const db = getCurrentJazzSession()?.getSnapshot().client?.db
			if (!db) throw new Error('Missing database')
			const [account] = await db.all(app.accounts.where({ name: 'Modal checking' }))
			return account?.currency
		})
		expect(savedCurrency).toBe('TZS')
		await dialog.getByRole('button', { name: 'Close', exact: true }).click()
		await expect(
			page.getByRole('main').getByRole('cell', { name: 'Modal checking', exact: true })
		).toBeVisible()
		const response = await page.goto('/accounts/new')
		expect(response?.status()).toBe(404)
	}
)

for (const entity of ['category', 'tag', 'account']) {
	test(
		`${entity} modal closes and resets its draft when the active workspace changes`,
		{
			tag: [
				entity === 'category' ? '@categories' : entity === 'tag' ? '@tags' : '@accounts',
				'@workspaces'
			]
		},
		async ({ page }) => {
			const route =
				entity === 'account'
					? '/accounts'
					: `/settings/${entity === 'category' ? 'categories' : 'tags'}`
			const label =
				entity === 'account' ? 'Add Account' : entity === 'category' ? 'Add Category' : 'Add Tag'
			const field = `${entity[0]?.toUpperCase()}${entity.slice(1)} name`
			const { dialog } = await openCreation(page, route, label)
			await dialog.getByLabel(field, { exact: true }).fill('Old workspace draft')
			const workspaceId = await page.evaluate(async () => {
				const schemaPath = '/src/lib/schema.ts'
				const sessionPath = '/src/lib/runtime/jazz-session.ts'
				const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
				const { getCurrentJazzSession }: typeof import('../src/lib/runtime/jazz-session.js') =
					await import(sessionPath)
				const snapshot = getCurrentJazzSession()?.getSnapshot()
				if (!snapshot?.client || !snapshot.account) throw new Error('Test session is not ready.')
				const db = snapshot.client.db
				const workspace = await db
					.insert(app.organizations, {
						name: 'Second modal workspace',
						kind: 'business',
						defaultCurrency: 'USD',
						ownerId: snapshot.account.id
					})
					.wait({ tier: 'global' })
				await db
					.insert(app.organizationMembers, {
						organizationId: workspace.id,
						userId: snapshot.account.id,
						role: 'owner',
						accountAccessMode: 'all'
					})
					.wait({ tier: 'global' })
				return workspace.id
			})
			const selector = page.getByLabel('Current Workspace', { exact: true })
			await expect(selector.locator(`option[value="${workspaceId}"]`)).toHaveCount(1)
			// Exercise a scope update while the modal owns focus, as with an external workspace change.
			await selector.evaluate((node, id) => {
				if (!(node instanceof HTMLSelectElement)) throw new Error('Expected workspace selector.')
				node.value = id
				node.dispatchEvent(new Event('change', { bubbles: true }))
			}, workspaceId)
			await expect(dialog).not.toBeVisible()
			const trigger = page
				.getByRole('main')
				.getByRole('button', { name: label, exact: true })
				.first()
			await expect(trigger).toBeEnabled()
			await trigger.click()
			await expect(dialog).toBeVisible()
			await expect(dialog.getByLabel(field, { exact: true })).toHaveValue('')
		}
	)
}
