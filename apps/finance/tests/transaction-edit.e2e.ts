import { expect, test, type Page } from '@playwright/test'
import { seedTransaction, persisted } from './helpers/transactions.js'

test(
	'always-visible form supports reverted drafts, repeated offline saves and retained archived tags',
	{ tag: ['@transactions', '@transaction-edit', '@tags'] },
	async ({ page, context }) => {
		const seed = await seedTransaction(page)
		await page.goto(`/expenses/${seed.id}`)
		const amount = page.getByLabel('Amount', { exact: true })
		const save = page.getByRole('button', { name: 'Save Transaction', exact: true })
		await expect(amount).toHaveValue('12.34')
		await expect(amount).toBeEnabled()
		await expect(page.getByRole('button', { name: 'Edit transaction', exact: true })).toHaveCount(0)
		await expect(save).toBeDisabled()
		await amount.fill('20')
		await expect(save).toBeEnabled()
		await amount.fill('12.34')
		await expect(save).toBeDisabled()
		await context.setOffline(true)
		await amount.fill('56.78')
		await save.click()
		await expect(page.getByText('Transaction saved.', { exact: true })).toBeVisible()
		await expect(amount).toBeEnabled()
		await expect(save).toBeDisabled()
		await page.getByLabel('Memo (additional notes)', { exact: true }).fill('Second save')
		await save.click()
		await expect(save).toBeDisabled()
		await expect
			.poll(() => persisted(page, seed.id))
			.toMatchObject({
				amountMinor: 5678,
				memo: 'Second save',
				links: [{ id: seed.linkId, tagId: seed.tagId }]
			})
		await context.setOffline(false)
		await page.reload()
		await expect(amount).toHaveValue('56.78')
		await expect(page.getByLabel('Memo (additional notes)', { exact: true })).toHaveValue(
			'Second save'
		)
	}
)

for (const scenario of ['viewer', 'archived'] satisfies ('viewer' | 'archived')[]) {
	test(
		`${scenario} transaction remains visible as a non-editable form`,
		{ tag: ['@transactions', '@transaction-edit', '@permissions'] },
		async ({ page }) => {
			const seed = await seedTransaction(page, scenario)
			await page.goto(`/expenses/${seed.id}`)
			await expect(page.getByLabel('Amount', { exact: true })).toHaveValue('12.34')
			await expect(page.getByLabel('Amount', { exact: true })).toBeDisabled()
			if (scenario === 'viewer')
				await expect(
					page.getByRole('main').getByRole('button', { name: 'Add Category', exact: true })
				).toBeDisabled()
			await expect(page.getByLabel('Memo (additional notes)', { exact: true })).toHaveValue(
				'Original memo'
			)
			await expect(
				page.getByLabel('Account', { exact: true }).locator('option:checked')
			).toHaveText('Editable ledger · USD')
			await expect(page.getByRole('button', { name: 'Save Transaction', exact: true })).toHaveCount(
				0
			)
		}
	)
}

test(
	'removing a tag alone enables Save and persists removal',
	{ tag: ['@transactions', '@transaction-edit', '@tags'] },
	async ({ page }) => {
		const seed = await seedTransaction(page)
		await page.goto(`/expenses/${seed.id}`)
		const save = page.getByRole('button', { name: 'Save Transaction', exact: true })
		await expect(save).toBeDisabled()
		await page.getByRole('button', { name: 'Remove Historical', exact: true }).click()
		await expect(save).toBeEnabled()
		await save.click()
		await expect.poll(async () => (await persisted(page, seed.id)).links).toEqual([])
	}
)

test(
	'inline Check details can be edited and its account moves with the transaction',
	{ tag: ['@transactions', '@transaction-edit'] },
	async ({ page }) => {
		const seed = await seedTransaction(page, 'check')
		const destinationAccountId = seed.destinationAccountId
		if (!destinationAccountId) throw new Error('Missing destination account fixture')
		await page.goto(`/income/${seed.id}`)
		const payment = page.getByLabel('Payment method', { exact: true })
		await expect(payment).toHaveValue('check')
		await expect(payment.locator('option[value="cash"]')).toBeEnabled()
		const check = page.locator('[name="checkNumber"]')
		await expect(check).toHaveValue('100')
		await check.fill('101')
		await page.getByLabel('Account', { exact: true }).selectOption(destinationAccountId)
		await page.getByRole('button', { name: 'Save Transaction', exact: true }).click()
		await expect
			.poll(() => persisted(page, seed.id))
			.toMatchObject({
				checkNumber: '101',
				accountId: destinationAccountId,
				checkAccountId: destinationAccountId
			})
	}
)

for (const viewport of [
	{ width: 1280, height: 900 },
	{ width: 390, height: 844 }
]) {
	test(
		`metadata starts closed and toggles independently of the form at ${viewport.width}px`,
		{ tag: ['@transactions', '@transaction-edit'] },
		async ({ page }) => {
			await page.setViewportSize(viewport)
			const seed = await seedTransaction(page)
			await page.goto(`/expenses/${seed.id}`)
			const main = page.getByRole('main')
			const metadata = main
				.locator('details')
				.filter({ has: page.locator('summary', { hasText: 'Metadata' }) })
			const summary = metadata.locator('summary')
			const amount = main.getByLabel('Amount', { exact: true })
			await expect(amount).toHaveValue('12.34')
			await expect(amount).toBeVisible()
			await expect(metadata).not.toHaveAttribute('open')
			await expect(metadata.locator('dl')).toBeHidden()
			await amount.fill('45.67')
			await summary.click()
			await expect(metadata).toHaveAttribute('open', '')
			await expect(metadata.locator('dl')).toBeVisible()
			await expect(metadata.locator('dt')).toHaveText([
				'Created by',
				'Created at',
				'Last edited by',
				'Last edited at'
			])
			await expect(metadata.locator('.attribution').first()).not.toHaveText('')
			await expect(metadata.locator('.attribution').last()).not.toHaveText('')
			const times = metadata.locator('time')
			await expect(times).toHaveCount(2)
			for (const time of await times.all()) {
				await expect(time).toHaveAttribute('datetime', /^\d{4}-\d{2}-\d{2}T/)
				await expect(time).not.toHaveText('')
			}
			await summary.focus()
			await page.keyboard.press('Enter')
			await expect(metadata).not.toHaveAttribute('open')
			await expect(metadata.locator('dl')).toBeHidden()
			await expect(amount).toBeVisible()
			await expect(amount).toHaveValue('45.67')
			await page.reload()
			await expect(amount).toHaveValue('12.34')
			await expect(metadata).not.toHaveAttribute('open')
		}
	)
}

test(
	'manual amount entry saves above the former ceiling with exact cents',
	{ tag: ['@transactions', '@transaction-edit'] },
	async ({ page }) => {
		const seed = await seedTransaction(page)
		await page.goto(`/expenses/${seed.id}`)
		const amount = page.getByLabel('Amount', { exact: true })
		const save = page.getByRole('button', { name: 'Save Transaction', exact: true })
		for (const [text, amountMinor] of [
			['21474836.48', 2_147_483_648],
			['90071992547409.91', Number.MAX_SAFE_INTEGER]
		] satisfies [string, number][]) {
			await amount.fill(text)
			await save.click()
			await expect(save).toBeDisabled()
			await expect.poll(() => persisted(page, seed.id)).toMatchObject({ amountMinor })
			await page.reload()
			await expect(amount).toHaveValue(text)
		}
		await amount.fill('90071992547409.92')
		await save.click()
		await expect(amount).toHaveAttribute('aria-invalid', 'true')
		await expect(page.getByText('Transaction saved.', { exact: true })).toHaveCount(0)
		await expect
			.poll(() => persisted(page, seed.id))
			.toMatchObject({ amountMinor: Number.MAX_SAFE_INTEGER })
	}
)

for (const kind of ['expense', 'income'] satisfies ('expense' | 'income')[]) {
	test(
		`imported ${kind} supports category, tag and note edits offline without changing provenance`,
		{ tag: ['@transactions', '@transaction-edit', '@description', '@categories', '@tags'] },
		async ({ page, context }) => {
			const seed = await seedTransaction(page, kind === 'expense' ? 'imported' : 'imported-income')
			await page.goto(`/${kind === 'expense' ? 'expenses' : 'income'}/${seed.id}`)
			const amount = page.getByLabel('Amount', { exact: true })
			const save = page.getByRole('button', { name: 'Save Transaction', exact: true })
			await expect(amount).toBeEnabled()
			await expect(save).toBeDisabled()
			if (kind === 'income') {
				const payment = page.getByLabel('Payment method', { exact: true })
				await expect(payment).toBeVisible()
				await expect(payment).toHaveValue('')
			}
			const memo = page.getByLabel('Memo (additional notes)', { exact: true })
			await memo.fill('Changed')
			await expect(save).toBeEnabled()
			await memo.fill('Original memo')
			await expect(save).toBeDisabled()
			const category = page.getByLabel('Category', { exact: true })
			const replacementId = await category
				.locator('option')
				.evaluateAll((options) =>
					options
						.find(
							(option) =>
								option instanceof HTMLOptionElement &&
								!option.disabled &&
								option.value &&
								option.label !== 'Editable category'
						)
						?.getAttribute('value')
				)
			if (!replacementId) throw new Error('Missing alternate category')
			await context.setOffline(true)
			await category.selectOption(replacementId)
			await amount.fill('56.78')
			await page.getByLabel('Description', { exact: true }).fill('User description')
			await memo.fill('User notes')
			const tags = page
				.getByRole('textbox', { name: 'Tags', exact: true })
				.or(page.getByRole('combobox', { name: 'Tags', exact: true }))
			await tags.fill('User tag')
			await tags.press('Enter')
			await save.click()
			await expect(save).toBeDisabled()
			await expect
				.poll(() => persisted(page, seed.id))
				.toMatchObject({
					amountMinor: 5678,
					description: 'User description',
					memo: 'User notes',
					categoryId: replacementId,
					source: 'simplefin',
					externalId: 'imported-edit-test',
					paymentMethod: null
				})
			await expect.poll(async () => (await persisted(page, seed.id)).links.length).toBe(2)
			await context.setOffline(false)
			await page.reload()
			await expect(memo).toHaveValue('User notes')
			await expect(amount).toHaveValue('56.78')
			await expect(page.getByRole('button', { name: 'Remove User tag', exact: true })).toBeVisible()
			await expect(save).toBeDisabled()
		}
	)
}

test(
	'expense edits preserve an existing check without exposing inline payment controls',
	{ tag: ['@transactions', '@transaction-edit'] },
	async ({ page }) => {
		const seed = await seedTransaction(page, 'expense-check')
		const original = await persisted(page, seed.id)
		expect(original.checkId).toBeTruthy()
		await page.goto(`/expenses/${seed.id}`)
		await expect(page.getByLabel('Amount', { exact: true })).toHaveValue('12.34')
		await expect(page.getByLabel('Payment method', { exact: true })).toHaveCount(0)
		await expect(page.locator('[name="checkNumber"]')).toHaveCount(0)
		await expect(page.locator('input[name="paymentMethod"]')).toHaveValue('check')
		await expect(page.locator('input[name="checkId"]')).toHaveValue(original.checkId ?? '')
		await page.getByLabel('Memo (additional notes)', { exact: true }).fill('Expense check retained')
		await page.getByRole('button', { name: 'Save Transaction', exact: true }).click()
		await expect
			.poll(() => persisted(page, seed.id))
			.toMatchObject({
				memo: 'Expense check retained',
				paymentMethod: 'check',
				checkId: original.checkId,
				checkNumber: '100',
				checkAccountId: seed.accountId
			})
	}
)

test(
	'list and overview show archived tag names and react to renaming',
	{ tag: ['@transactions', '@transaction-edit', '@tags'] },
	async ({ page }) => {
		const seed = await seedTransaction(page)
		await page.evaluate(async (id) => {
			const schemaPath = '/src/lib/schema.ts'
			const sessionPath = '/src/lib/runtime/jazz-session.ts'
			const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
			const { getCurrentJazzSession }: typeof import('../src/lib/runtime/jazz-session.js') =
				await import(sessionPath)
			const db = getCurrentJazzSession()?.getSnapshot().client?.db
			if (!db) throw new Error('Missing database')
			const date = new Date()
			const bookedOn = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
			await db
				.update(app.transactions, id, { bookedOn, description: 'Tagged cleanup row' })
				.wait({ tier: 'local' })
		}, seed.id)
		for (const path of ['/expenses', '/']) {
			await page.goto(path)
			const row = page
				.getByRole('listitem')
				.filter({ has: page.getByText('Tagged cleanup row', { exact: true }) })
			await expect(row.getByText('Historical', { exact: true })).toBeVisible()
		}
		await page.evaluate(async (id) => {
			const schemaPath = '/src/lib/schema.ts'
			const sessionPath = '/src/lib/runtime/jazz-session.ts'
			const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
			const { getCurrentJazzSession }: typeof import('../src/lib/runtime/jazz-session.js') =
				await import(sessionPath)
			const db = getCurrentJazzSession()?.getSnapshot().client?.db
			if (!db) throw new Error('Missing database')
			await db.update(app.tags, id, { name: 'Renamed historical' }).wait({ tier: 'local' })
		}, seed.tagId)
		const row = page
			.getByRole('listitem')
			.filter({ has: page.getByText('Tagged cleanup row', { exact: true }) })
		await expect(row.getByText('Renamed historical', { exact: true })).toBeVisible()
		await page.goto('/expenses')
		await expect(row.getByText('Renamed historical', { exact: true })).toBeVisible()
	}
)

for (const kind of ['expense', 'income'] satisfies ('expense' | 'income')[]) {
	test(
		`inline ${kind} category creation preserves drafts, binds kind and selects repeated additions offline`,
		{ tag: ['@transactions', '@transaction-edit', '@categories'] },
		async ({ page, context }) => {
			const seed = await seedTransaction(page, kind === 'income' ? 'imported-income' : 'manual')
			await page.goto(`/${kind === 'income' ? 'income' : 'expenses'}/${seed.id}`)
			const main = page.getByRole('main')
			const category = main.getByLabel('Category', { exact: true })
			const memo = main.getByLabel('Memo (additional notes)', { exact: true })
			const save = main.getByRole('button', { name: 'Save Transaction', exact: true })
			await expect(category).toHaveValue(seed.categoryId)
			await memo.fill('Unsaved category draft')
			const add = main.getByRole('button', { name: 'Add Category', exact: true })
			await expect(add).toBeEnabled()
			await context.setOffline(true)
			await add.click()
			const dialog = page.getByRole('dialog', { name: 'Add Category', exact: true })
			await expect(dialog).toBeVisible()
			await expect(dialog.getByRole('combobox')).toHaveCount(0)
			await dialog.getByLabel('Category name', { exact: true }).fill('Cancelled category')
			await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
			await expect(category).toHaveValue(seed.categoryId)
			await expect(memo).toHaveValue('Unsaved category draft')
			for (const name of ['First inline category', 'Second inline category']) {
				await add.click()
				await dialog.getByLabel('Category name', { exact: true }).fill(name)
				// A forged hidden kind cannot override the transaction's observed kind.
				await dialog.locator('input[name="kind"]').evaluate((input) => {
					if (input instanceof HTMLInputElement)
						input.value = input.value === 'income' ? 'expense' : 'income'
				})
				await dialog.getByRole('button', { name: 'Add Category', exact: true }).click()
				await expect(dialog.getByRole('status')).toContainText(name)
				await dialog.getByRole('button', { name: 'Close', exact: true }).click()
				await expect(category.locator('option:checked')).toHaveText(name)
				await expect(memo).toHaveValue('Unsaved category draft')
				await expect(save).toBeEnabled()
				await expect
					.poll(() => persisted(page, seed.id))
					.toMatchObject({ categoryId: seed.categoryId, memo: 'Original memo' })
			}
			const selectedId = await category.inputValue()
			await category.selectOption(seed.categoryId)
			await memo.fill('Still my chosen category')
			await expect(category).toHaveValue(seed.categoryId)
			await category.selectOption(selectedId)
			await save.click()
			await expect(save).toBeDisabled()
			await expect
				.poll(() => persisted(page, seed.id))
				.toMatchObject({ categoryId: selectedId, memo: 'Still my chosen category' })
			await context.setOffline(false)
			await page.reload()
			await expect(category).toHaveValue(selectedId)
			await expect(memo).toHaveValue('Still my chosen category')
			await expect(save).toBeDisabled()
			await add.click()
			await dialog.getByLabel('Category name', { exact: true }).fill('Category only change')
			await dialog.getByRole('button', { name: 'Add Category', exact: true }).click()
			await expect(dialog.getByRole('status')).toContainText('Category only change')
			await dialog.getByRole('button', { name: 'Close', exact: true }).click()
			await expect(category.locator('option:checked')).toHaveText('Category only change')
			await expect(save).toBeEnabled()
			const categoryOnlyId = await category.inputValue()
			const createdRows = await page.evaluate(async () => {
				const schemaPath = '/src/lib/schema.ts'
				const sessionPath = '/src/lib/runtime/jazz-session.ts'
				const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
				const { getCurrentJazzSession }: typeof import('../src/lib/runtime/jazz-session.js') =
					await import(sessionPath)
				const db = getCurrentJazzSession()?.getSnapshot().client?.db
				if (!db) throw new Error('Missing database')
				return (await db.all(app.categories))
					.filter((row) =>
						[
							'First inline category',
							'Second inline category',
							'Category only change',
							'Cancelled category'
						].includes(row.name)
					)
					.map(({ id, name, kind }) => ({ id, name, kind }))
			})
			expect(createdRows).toHaveLength(3)
			expect(createdRows.every((row) => row.kind === kind)).toBe(true)
			await save.click()
			await expect
				.poll(() => persisted(page, seed.id))
				.toMatchObject({ categoryId: categoryOnlyId })
		}
	)
}

test(
	'inline category rejects duplicate names without changing the draft selection',
	{ tag: ['@transactions', '@transaction-edit', '@categories'] },
	async ({ page }) => {
		const seed = await seedTransaction(page)
		await page.goto(`/expenses/${seed.id}`)
		await page.getByRole('main').getByRole('button', { name: 'Add Category', exact: true }).click()
		const dialog = page.getByRole('dialog', { name: 'Add Category', exact: true })
		await dialog.getByLabel('Category name', { exact: true }).fill('Editable category')
		await dialog.getByRole('button', { name: 'Add Category', exact: true }).click()
		await expect(
			dialog.getByText('An active item with this name already exists. Choose another name.', {
				exact: true
			})
		).toBeVisible()
		await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
		await expect(page.getByLabel('Category', { exact: true })).toHaveValue(seed.categoryId)
		await expect(page.getByRole('button', { name: 'Save Transaction', exact: true })).toBeDisabled()
	}
)

for (const kind of ['expense', 'income'] satisfies ('expense' | 'income')[]) {
	test(
		`${kind} list abbreviates month names and preserves date semantics`,
		{ tag: ['@transactions', '@transaction-edit'] },
		async ({ page }) => {
			await seedTransaction(page, kind === 'income' ? 'imported-income' : 'manual')
			await page.goto(kind === 'income' ? '/income' : '/expenses')
			const date = page.getByRole('main').locator('time[datetime="2026-10-18"]')
			await expect(date).toHaveText('Sun, Oct 18, 2026')
		}
	)
}
