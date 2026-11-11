import { pageContent } from './helpers/ui.js'
import { expect, test, type Page } from '@playwright/test'

async function seed(
	page: Page,
	count = 0,
	kind: 'expense' | 'income' = 'expense',
	bookedOn = '2026-10-19'
) {
	await page.goto('/accounts')
	await expect(
		pageContent(page).getByRole('button', { name: 'Add Account', exact: true })
	).toBeEnabled({ timeout: 30_000 })
	return page.evaluate(
		async ({ count, kind, bookedOn }) => {
			const schemaPath = '/src/lib/schema.ts'
			const sessionPath = '/src/lib/runtime/jazz-session.ts'
			const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
			const { getCurrentJazzSession }: typeof import('../src/lib/runtime/jazz-session.js') =
				await import(sessionPath)
			const db = getCurrentJazzSession()?.getSnapshot().client?.db
			if (!db) throw new Error('Missing database')
			const [organization] = await db.all(app.organizations)
			if (!organization) throw new Error('Missing organization')
			const account = await db
				.insert(app.accounts, {
					organizationId: organization.id,
					name: 'Workspace ledger',
					kind: 'cash',
					currency: 'USD'
				})
				.wait({ tier: 'local' })
			const category = (
				await db.all(app.categories.where({ organizationId: organization.id, kind }))
			)[0]
			if (!category) throw new Error('Missing transaction category')
			for (let index = 0; index < count; index++) {
				await db
					.insert(app.transactions, {
						organizationId: organization.id,
						accountId: account.id,
						categoryId: category.id,
						kind,
						amountMinor: 100,
						currency: 'USD',
						bookedOn,
						description: `Seed ${index}`,
						source: 'manual'
					})
					.wait({ tier: 'local' })
			}
			return organization.id
		},
		{ count, kind, bookedOn }
	)
}

for (const desktop of [true, false]) {
	for (const kind of ['expense', 'income'] satisfies ('expense' | 'income')[]) {
		test(
			`${desktop ? 'desktop' : 'mobile'} ${kind} list filters combine and retain search across reloads`,
			{ tag: ['@transactions'] },
			async ({ page }) => {
				await page.setViewportSize({ width: desktop ? 1440 : 390, height: 900 })
				const dates = await page.evaluate(() => {
					function dateOnly(offset: number) {
						const date = new Date()
						date.setDate(date.getDate() + offset)
						return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
					}
					return {
						today: dateOnly(0),
						week: dateOnly(-6),
						month: dateOnly(-29),
						older: dateOnly(-12),
						tomorrow: dateOnly(1)
					}
				})
				const workspaceId = await seed(page, 27, kind, dates.older)
				const path = kind === 'income' ? '/income' : '/expenses'
				await page.goto(`${path}?workspace=${workspaceId}`)
				const initialList = pageContent(page)
				await expect(initialList.locator('.entries > li')).toHaveCount(25)
				await initialList.getByRole('button', { name: 'Filter Transactions', exact: true }).click()
				await expect(initialList.getByRole('radio', { name: 'Custom', exact: true })).toBeChecked()
				await expect(initialList.getByLabel('Start Date', { exact: true })).toHaveValue('')
				await expect(initialList.getByLabel('End Date', { exact: true })).toHaveValue('')
				await expect(
					initialList.getByRole('combobox', { name: 'Filter Currency', exact: true })
				).toHaveCount(0)
				const fixture = await page.evaluate(
					async ({ workspaceId, kind, bookedOn }) => {
						const schemaPath = '/src/lib/schema.ts'
						const sessionPath = '/src/lib/runtime/jazz-session.ts'
						const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
						const { getCurrentJazzSession }: typeof import('../src/lib/runtime/jazz-session.js') =
							await import(sessionPath)
						const db = getCurrentJazzSession()?.getSnapshot().client?.db
						if (!db) throw new Error('Missing database')
						const account = await db
							.insert(app.accounts, {
								organizationId: workspaceId,
								name: 'TZS ledger',
								kind: 'cash',
								currency: 'TZS'
							})
							.wait({ tier: 'local' })
						const category = await db
							.insert(app.categories, {
								organizationId: workspaceId,
								name: 'Travel filter',
								kind,
								isSystem: false
							})
							.wait({ tier: 'local' })
						const tag = await db
							.insert(app.tags, {
								organizationId: workspaceId,
								name: 'Business tag',
								kind,
								categoryId: category.id
							})
							.wait({ tier: 'local' })
						const row = await db
							.insert(app.transactions, {
								organizationId: workspaceId,
								accountId: account.id,
								categoryId: category.id,
								kind,
								amountMinor: 1234,
								currency: 'TZS',
								bookedOn,
								description: 'Conference ticket',
								memo: 'Client visit',
								source: 'manual'
							})
							.wait({ tier: 'local' })
						await db
							.insert(app.transactionTags, {
								organizationId: workspaceId,
								transactionId: row.id,
								tagId: tag.id
							})
							.wait({ tier: 'local' })
						return { categoryId: category.id }
					},
					{ workspaceId, kind, bookedOn: dates.today }
				)
				await page.goto(`${path}?workspace=${workspaceId}`)
				const main = pageContent(page)
				const rows = main.locator('.entries > li')
				const search = main.getByRole('searchbox', { name: 'Search Transactions', exact: true })
				await expect(rows).toHaveCount(25)
				await main.getByRole('link', { name: 'Page 2', exact: true }).click()
				await expect(rows).toHaveCount(3)
				await main.getByRole('button', { name: 'Search Transactions', exact: true }).click()
				await search.fill('  CLIENT business TRAVEL ticket ')
				await expect(page).toHaveURL(
					(url) =>
						!url.searchParams.has('page') &&
						url.searchParams.get('q') === '  CLIENT business TRAVEL ticket '
				)
				await expect(rows).toHaveCount(1)
				await expect(rows).toContainText('Conference ticket')
				await expect(main.getByLabel('Daily total: TSh 12.34', { exact: true })).toBeVisible()
				await main.getByRole('button', { name: 'Filter Transactions', exact: true }).click()
				await main
					.getByRole('combobox', { name: 'Filter Category', exact: true })
					.selectOption(fixture.categoryId)
				await main
					.getByRole('combobox', { name: 'Filter Currency', exact: true })
					.selectOption('TZS')
				await main.getByLabel('Start Date', { exact: true }).fill(dates.today)
				await main.getByLabel('End Date', { exact: true }).fill(dates.today)
				await expect(rows).toHaveCount(1)
				await page.reload()
				await main.getByRole('button', { name: 'Search Transactions', exact: true }).click()
				await expect(search).toHaveValue('  CLIENT business TRAVEL ticket ')
				await main.getByRole('button', { name: 'Filter Transactions', exact: true }).click()
				await expect(
					main.getByRole('combobox', { name: 'Filter Category', exact: true })
				).toHaveValue(fixture.categoryId)
				await expect(
					main.getByRole('combobox', { name: 'Filter Currency', exact: true })
				).toHaveValue('TZS')
				await expect(rows).toHaveCount(1)
				await main
					.getByRole('combobox', { name: 'Filter Currency', exact: true })
					.selectOption('USD')
				await expect(rows).toHaveCount(0)
				await main.getByRole('combobox', { name: 'Filter Currency', exact: true }).selectOption('')
				await main.getByRole('combobox', { name: 'Filter Category', exact: true }).selectOption('')
				await main.getByRole('button', { name: 'Search Transactions', exact: true }).click()
				await search.fill('')
				const datesGroup = main.getByRole('group', { name: 'Filter Dates', exact: true })
				const week = datesGroup.getByRole('radio', { name: 'Last week', exact: true })
				const month = datesGroup.getByRole('radio', { name: 'Last month', exact: true })
				const custom = datesGroup.getByRole('radio', { name: 'Custom', exact: true })
				const start = main.getByLabel('Start Date', { exact: true })
				const end = main.getByLabel('End Date', { exact: true })
				await main.getByRole('button', { name: 'Filter Transactions', exact: true }).click()
				await week.check()
				await expect(week).toBeChecked()
				await expect(start).toHaveCount(0)
				await expect(end).toHaveCount(0)
				await expect(page).toHaveURL(
					(url) =>
						url.searchParams.get('start') === dates.week &&
						url.searchParams.get('end') === dates.today
				)
				await expect(rows).toHaveCount(1)
				await page.reload()
				await main.getByRole('button', { name: 'Filter Transactions', exact: true }).click()
				await expect(week).toBeChecked()
				await expect(start).toHaveCount(0)
				await week.focus()
				await week.press('ArrowRight')
				await expect(month).toBeChecked()
				await expect(month).toBeFocused()
				await expect(page).toHaveURL(
					(url) =>
						url.searchParams.get('start') === dates.month &&
						url.searchParams.get('end') === dates.today
				)
				await expect(rows).toHaveCount(25)
				await custom.check()
				await expect(start).toHaveValue(dates.month)
				await expect(end).toHaveValue(dates.today)
				await expect(rows).toHaveCount(25)
				await start.fill(dates.week)
				await expect(custom).toBeChecked()
				await expect(start).toBeFocused()
				await expect(end).toBeVisible()
				await expect(rows).toHaveCount(1)
				await month.check()
				await expect(start).toHaveCount(0)
				await expect(rows).toHaveCount(25)
				await expect(main.getByLabel('Daily total: $27.00', { exact: true })).toBeVisible()
				await main.getByRole('button', { name: 'Search Transactions', exact: true }).click()
				await search.fill('Seed')
				await page.keyboard.press('Escape')
				await expect(
					main.getByRole('button', { name: 'Search Transactions', exact: true })
				).toBeFocused()
				await expect(search).not.toBeVisible()
				await main.getByRole('link', { name: 'Page 2', exact: true }).click()
				await expect(rows).toHaveCount(2)
				await main.getByRole('button', { name: 'Search Transactions', exact: true }).click()
				await expect(search).toHaveValue('Seed')
				await expect(page).toHaveURL(
					(url) => url.searchParams.get('q') === 'Seed' && url.searchParams.get('page') === '2'
				)
				await search.fill('no matching transaction')
				await expect(rows).toHaveCount(0)
				await expect(main.getByText('Your recent activity will appear here.')).toBeVisible()
				await main.getByRole('button', { name: 'Filter Transactions', exact: true }).click()
				await custom.check()
				await expect(start).toHaveValue(dates.month)
				await start.fill(dates.tomorrow)
				await expect(
					main.getByText('Enter a start date and an end date on or after the start date.')
				).toBeVisible()
				if (!desktop)
					expect(
						await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
					).toBe(true)
			}
		)
	}
}

async function expectWorkspaceUrl(
	page: Page,
	path: string,
	workspaceId: string,
	pageNumber?: string
) {
	await expect(page).toHaveURL(
		(url) =>
			url.pathname === path &&
			url.searchParams.get('workspace') === workspaceId &&
			url.searchParams.get('page') === (pageNumber ?? null)
	)
}

async function savedCount(page: Page, description: string) {
	return page.evaluate(async (description) => {
		const schemaPath = '/src/lib/schema.ts'
		const sessionPath = '/src/lib/runtime/jazz-session.ts'
		const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
		const { getCurrentJazzSession }: typeof import('../src/lib/runtime/jazz-session.js') =
			await import(sessionPath)
		const db = getCurrentJazzSession()?.getSnapshot().client?.db
		if (!db) throw new Error('Missing database')
		return (await db.all(app.transactions)).filter((row) => row.description === description).length
	}, description)
}

for (const desktop of [true, false]) {
	for (const kind of ['expense', 'income']) {
		const base = kind === 'income' ? '/income' : '/expenses'
		const label = kind === 'income' ? 'Add Income' : 'Add Expenses'
		for (const valid of [false, true]) {
			test(
				`${desktop ? 'desktop' : 'mobile'} ${kind} Cancel returns to its section without saving ${valid ? 'a valid' : 'an invalid'} draft`,
				{ tag: ['@transactions'] },
				async ({ page }) => {
					await page.setViewportSize({ width: desktop ? 1440 : 390, height: 900 })
					const workspaceId = await seed(page)
					await page.goto(`${base}/new`)
					const main = pageContent(page)
					const amount = main.getByLabel('Amount', { exact: true })
					await expect(amount).toBeEnabled()
					await main.getByLabel('Description', { exact: true }).fill('Cancelled draft')
					if (valid) await amount.fill('12.34')
					expect(
						await main
							.locator('form')
							.evaluate((form) => form instanceof HTMLFormElement && form.checkValidity())
					).toBe(valid)
					const cancel = main.getByRole('button', { name: 'Cancel', exact: true })
					await expect(cancel).toHaveAttribute('type', 'button')
					await expect(cancel).not.toHaveClass(/\bprimary\b/)
					await expect(
						main.getByRole('button', { name: 'Save Transaction', exact: true })
					).toHaveClass(/\bprimary\b/)
					await cancel.click()
					await expectWorkspaceUrl(page, base, workspaceId)
					await expect(
						main.getByRole('heading', {
							name: kind === 'income' ? 'Income' : 'Expenses',
							exact: true
						})
					).toBeVisible()
					await expect.poll(() => savedCount(page, 'Cancelled draft')).toBe(0)
				}
			)
		}
		test(
			`${desktop ? 'desktop' : 'mobile'} ${kind} goes directly from creation to its section, including offline`,
			{ tag: ['@transactions'] },
			async ({ page, context }) => {
				await page.setViewportSize({ width: desktop ? 1440 : 390, height: 900 })
				const workspaceId = await seed(page)
				await page.goto(base)
				const main = pageContent(page)
				const drawer = main.locator('aside[data-side="right"]')
				if (desktop) {
					await expect(drawer).toHaveAttribute('data-open', 'true')
					await expect(
						main.locator('.transaction-content').getByRole('heading', {
							name: kind === 'income' ? 'Income' : 'Expenses',
							exact: true
						})
					).toBeVisible()
				} else await expect(drawer).toHaveCount(0)
				await main.getByRole('link', { name: label, exact: true }).click()
				await expectWorkspaceUrl(page, `${base}/new`, workspaceId)
				const amount = main.getByLabel('Amount', { exact: true })
				await expect(amount).toBeEnabled()
				await main.getByRole('button', { name: 'Save Transaction', exact: true }).click()
				await expectWorkspaceUrl(page, `${base}/new`, workspaceId)
				await expect.poll(() => savedCount(page, 'Saved directly')).toBe(0)
				if (desktop) await expect(drawer).toBeVisible()
				else await expect(main.locator('.entries')).toHaveCount(0)
				await amount.fill('12.34')
				await main.getByLabel('Description', { exact: true }).fill('Saved directly')
				if (desktop) {
					await page.setViewportSize({ width: 390, height: 900 })
					await expect(amount).toHaveValue('12.34')
					await expect(drawer).toHaveCount(0)
					await page.setViewportSize({ width: 1440, height: 900 })
					await expect(amount).toHaveValue('12.34')
				}
				await page.evaluate(() => {
					document.documentElement.dataset.creationFlash = 'no'
					const observer = new MutationObserver(() => {
						if (
							location.pathname.endsWith('/new') &&
							/Add another Transaction|Transaction saved\./.test(
								document.querySelector('main')?.textContent ?? ''
							)
						) {
							document.documentElement.dataset.creationFlash = 'yes'
						}
					})
					observer.observe(document.body, { childList: true, subtree: true })
				})
				await context.setOffline(true)
				await main.getByRole('button', { name: 'Save Transaction', exact: true }).click()
				await expectWorkspaceUrl(page, base, workspaceId)
				await expect(main.getByText('Saved directly', { exact: true })).toBeVisible()
				expect(await page.locator('html').getAttribute('data-creation-flash')).toBe('no')
				await expect.poll(() => savedCount(page, 'Saved directly')).toBe(1)
				await context.setOffline(false)
				await page.goBack()
				await expectWorkspaceUrl(page, base, workspaceId)
				await page.goForward()
				await expectWorkspaceUrl(page, base, workspaceId)
				await main.getByRole('link', { name: /Transaction details:.*Saved directly/ }).click()
				await expect(page).toHaveURL(
					(url) =>
						url.pathname.startsWith(`${base}/`) &&
						!url.pathname.endsWith('/new') &&
						url.searchParams.get('workspace') === workspaceId
				)
				await expect(amount).toHaveValue('12.34')
				await expect(amount).toBeEnabled()
				await expect(
					main.getByRole('button', { name: 'Save Transaction', exact: true })
				).toHaveClass(/\bprimary\b/)
				await amount.fill('15.00')
				await main.getByRole('button', { name: 'Save Transaction', exact: true }).click()
				await expect(main.getByText('Transaction saved.', { exact: true })).toBeVisible()
				await expect(page).not.toHaveURL((url) => url.pathname === base)
				await expect.poll(() => savedCount(page, 'Saved directly')).toBe(1)
				await page.reload()
				await expect(amount).toHaveValue('15.00')
			}
		)
	}
}

test(
	'desktop drawer closes/reopens and preserves pagination through selection, creation and reload',
	{ tag: ['@transactions'] },
	async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		const workspaceId = await seed(page, 26)
		await page.goto('/expenses')
		const main = pageContent(page)
		const drawer = main.locator('aside[data-side="right"]')
		const rows = drawer.getByRole('listitem').filter({
			has: page.getByRole('link', { name: /^Transaction details:/ })
		})
		await expect(drawer).toHaveAttribute('data-open', 'true')
		await main.getByRole('button', { name: 'Close Transactions', exact: true }).click()
		await expect(drawer).toHaveAttribute('aria-hidden', 'true')
		const reopen = main.getByRole('button', { name: 'Open Transactions', exact: true })
		await reopen.click()
		await rows.first().getByRole('link').focus()
		await page.keyboard.press('Escape')
		await expect(drawer).toHaveAttribute('aria-hidden', 'true')
		await expect(reopen).toBeFocused()
		await reopen.click()
		const day = drawer.locator('details').first()
		await expect(day).toHaveAttribute('open', '')
		await day.locator('summary').click()
		await expect(day).not.toHaveAttribute('open', '')
		await day.locator('summary').click()
		await drawer.getByRole('link', { name: 'Page 2', exact: true }).click()
		await expectWorkspaceUrl(page, '/expenses', workspaceId, '2')
		await expect(rows).toHaveCount(1)
		const item = rows.first()
		const rowLink = item.getByRole('link')
		await expect(rowLink).toHaveCount(1)
		await expect(item).not.toContainText('Workspace ledger')
		await expect(rowLink).toHaveAccessibleName(/^Transaction details:.*\$1\.00$/)
		await rowLink.focus()
		await expect(rowLink).toBeFocused()
		// The stretched native anchor includes the padding around the row content.
		await item.click({ position: { x: 2, y: 2 } })
		await expect(page).toHaveURL(
			(url) =>
				/^\/expenses\/[^/]+$/.test(url.pathname) &&
				url.searchParams.get('workspace') === workspaceId &&
				url.searchParams.get('page') === '2'
		)
		await expect(main.getByLabel('Amount', { exact: true })).toHaveValue('1.00')
		await expect(rows).toHaveCount(1)
		await page.reload()
		await expect(main.getByLabel('Amount', { exact: true })).toHaveValue('1.00')
		await expect(drawer).toHaveAttribute('data-open', 'true')
		await expect(rows).toHaveCount(1)
		await drawer.getByRole('link', { name: 'Add Expenses', exact: true }).click()
		await expectWorkspaceUrl(page, '/expenses/new', workspaceId, '2')
		await expect(main.getByLabel('Amount', { exact: true })).toHaveValue('')
		await expect(rows).toHaveCount(1)
	}
)

for (const kind of ['income', 'expense']) {
	test(
		`sample ${kind} batches persist 25 items offline and can run again`,
		{ tag: ['@transactions'] },
		async ({ page, context }) => {
			await seed(page)
			const trigger = page.getByRole('button', { name: 'Developer menu', exact: true })
			await trigger.focus()
			await trigger.click()
			const dialog = page.getByRole('dialog', { name: 'Developer menu', exact: true })
			const subject = kind === 'income' ? 'Income' : 'Expense'
			const add = dialog.getByRole('button', {
				name: `Add 25 sample ${subject} Transactions`,
				exact: true
			})
			await expect(add).toBeEnabled({ timeout: 30_000 })
			await context.setOffline(true)
			try {
				for (const count of [25, 50]) {
					await add.click()
					await expect(dialog.getByRole('status')).toHaveText('Saved 25 of 25 sample transactions.')
					await expect(add).toBeEnabled()
					await expect
						.poll(() =>
							page.evaluate(async (kind) => {
								const schemaPath = '/src/lib/schema.ts'
								const sessionPath = '/src/lib/runtime/jazz-session.ts'
								const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
								const {
									getCurrentJazzSession
								}: typeof import('../src/lib/runtime/jazz-session.js') = await import(sessionPath)
								const db = getCurrentJazzSession()?.getSnapshot().client?.db
								if (!db) throw new Error('Missing database')
								return (await db.all(app.transactions)).filter((row) => row.kind === kind).length
							}, kind)
						)
						.toBe(count)
				}
			} finally {
				await context.setOffline(false)
			}
		}
	)
}

test(
	'drawer toggles stay in place while headers scroll independently and pagination retains its gap',
	{ tag: ['@transactions', '@navigation'] },
	async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 420 })
		await page.emulateMedia({ reducedMotion: 'reduce' })
		const workspaceId = await seed(page)
		await page.goto(`/expenses/new?workspace=${workspaceId}`)
		const workspace = page.locator('.transaction-workspace')
		const drawer = workspace.locator('aside[data-side="right"]')
		const rightToggle = workspace.locator('.drawer-toggle button')
		const leftToggle = page.getByRole('button', { name: 'Toggle Main navigation', exact: true })
		const mainScroll = workspace.locator('.transaction-page > .page-layout')
		const listScroll = drawer.locator('.page-layout')
		await expect(drawer.locator('.entries > li')).toHaveCount(0)
		await expect(
			drawer.locator('.page-heading').getByRole('heading', { name: 'Transactions', exact: true })
		).toBeVisible()
		await expect(
			mainScroll.getByRole('heading', { name: 'Add Expenses', exact: true })
		).toBeVisible()
		await expect(rightToggle).toHaveAttribute('aria-expanded', 'true')

		const gaps = () =>
			drawer.evaluate((node) => {
				const buttons = node.querySelectorAll('.filter-actions > button')
				const close = document.querySelector('.drawer-toggle button')
				const search = buttons[0]?.getBoundingClientRect()
				const filter = buttons[1]?.getBoundingClientRect()
				const toggle = close?.getBoundingClientRect()
				if (!search || !filter || !toggle) throw new Error('Missing drawer controls')
				return { searchFilter: filter.left - search.right, filterClose: toggle.left - filter.right }
			})
		await expect
			.poll(async () => {
				const gap = await gaps()
				return Math.abs(gap.searchFilter - gap.filterClose)
			})
			.toBeLessThan(1)
		expect((await gaps()).searchFilter).toBeGreaterThan(0)
		const beforeData = await rightToggle.boundingBox()
		if (!beforeData) throw new Error('Missing initial control geometry')
		await page.evaluate(async (workspaceId) => {
			const schemaPath = '/src/lib/schema.ts'
			const sessionPath = '/src/lib/runtime/jazz-session.ts'
			const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
			const { getCurrentJazzSession }: typeof import('../src/lib/runtime/jazz-session.js') =
				await import(sessionPath)
			const db = getCurrentJazzSession()?.getSnapshot().client?.db
			if (!db) throw new Error('Missing database')
			const account = (await db.all(app.accounts.where({ organizationId: workspaceId })))[0]
			const category = (
				await db.all(app.categories.where({ organizationId: workspaceId, kind: 'expense' }))
			)[0]
			if (!account || !category) throw new Error('Missing ledger fixture')
			for (let index = 0; index < 26; index++) {
				await db
					.insert(app.transactions, {
						organizationId: workspaceId,
						accountId: account.id,
						categoryId: category.id,
						kind: 'expense',
						amountMinor: 100,
						currency: 'USD',
						bookedOn: '2026-10-19',
						description: `Layout fixture ${index}`,
						source: 'manual'
					})
					.wait({ tier: 'local' })
			}
		}, workspaceId)
		await expect(drawer.locator('.entries > li')).toHaveCount(25)
		await expect.poll(async () => (await rightToggle.boundingBox())?.x).toBe(beforeData.x)
		await expect
			.poll(async () => {
				const gap = await gaps()
				return Math.abs(gap.searchFilter - gap.filterClose)
			})
			.toBeLessThan(1)

		const rightBefore = await rightToggle.boundingBox()
		const leftBefore = await leftToggle.boundingBox()
		if (!rightBefore || !leftBefore) throw new Error('Missing toggle geometry')
		await rightToggle.evaluate((node) => node.setAttribute('data-persistent-toggle', 'yes'))
		for (const toggle of [leftToggle, rightToggle]) {
			const style = await toggle.evaluate((node) => ({
				radius: getComputedStyle(node).borderRadius,
				shadow: getComputedStyle(node).boxShadow
			}))
			expect(style.radius).toBe('0px')
			expect(style.shadow).not.toBe('none')
		}

		const pageHeading = mainScroll.locator('.page-heading')
		const listHeading = listScroll.locator('.page-heading')
		const pageHeadingBefore = await pageHeading.boundingBox()
		const listHeadingBefore = await listHeading.boundingBox()
		if (!pageHeadingBefore || !listHeadingBefore) throw new Error('Missing headings')
		expect(await mainScroll.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true)
		expect(await listScroll.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true)
		await mainScroll.evaluate((node) => {
			node.scrollTop = 150
		})
		await expect.poll(() => listScroll.evaluate((node) => node.scrollTop)).toBe(0)
		expect((await pageHeading.boundingBox())?.y).toBeLessThan(pageHeadingBefore.y - 100)
		await listScroll.evaluate((node) => {
			node.scrollTop = 150
		})
		expect((await listHeading.boundingBox())?.y).toBeLessThan(listHeadingBefore.y - 100)
		expect(await mainScroll.evaluate((node) => node.scrollTop)).toBe(150)
		expect((await rightToggle.boundingBox())?.y).toBe(rightBefore.y)
		expect((await leftToggle.boundingBox())?.y).toBe(leftBefore.y)
		expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(
			420
		)

		await mainScroll.evaluate((node) => {
			node.scrollTop = 0
		})
		await listScroll.evaluate((node) => {
			node.scrollTop = 0
		})
		for (const open of [false, true]) {
			await rightToggle.click()
			await expect(rightToggle).toHaveAttribute('aria-expanded', String(open))
			await expect(rightToggle).toHaveAttribute('data-persistent-toggle', 'yes')
			await expect.poll(async () => (await rightToggle.boundingBox())?.x).toBe(rightBefore.x)
			expect((await rightToggle.boundingBox())?.y).toBe(rightBefore.y)
		}
		for (const open of [false, true]) {
			await leftToggle.click()
			await expect(leftToggle).toHaveAttribute('aria-expanded', String(open))
			expect((await leftToggle.boundingBox())?.x).toBe(leftBefore.x)
			expect((await leftToggle.boundingBox())?.y).toBe(leftBefore.y)
		}
		await expect
			.poll(async () => {
				const gap = await gaps()
				return Math.abs(gap.searchFilter - gap.filterClose)
			})
			.toBeLessThan(1)

		const pagination = drawer.getByRole('navigation', { name: 'Transaction pages', exact: true })
		const group = drawer.locator('section').last()
		const paginationBox = await pagination.boundingBox()
		const groupBox = await group.boundingBox()
		if (!paginationBox || !groupBox) throw new Error('Missing pagination geometry')
		const grid = pagination.locator('..')
		expect(await grid.evaluate((node) => getComputedStyle(node).display)).toBe('grid')
		const gap = await grid.evaluate((node) => parseFloat(getComputedStyle(node).rowGap))
		expect(gap).toBeGreaterThan(0)
		expect(paginationBox.y - groupBox.y - groupBox.height).toBeCloseTo(gap, 0)
	}
)
