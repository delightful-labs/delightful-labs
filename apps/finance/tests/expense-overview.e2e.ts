import { expect, test, type Page } from '@playwright/test'

async function seed(page: Page) {
	await page.goto('/accounts')
	await expect(
		page.getByRole('main').getByRole('button', { name: 'Add Account', exact: true })
	).toBeEnabled()
	await page.evaluate(async () => {
		const schemaPath = '/src/lib/schema.ts'
		const sessionPath = '/src/lib/runtime/jazz-session.ts'
		const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
		const { getCurrentJazzSession }: typeof import('../src/lib/runtime/jazz-session.js') =
			await import(sessionPath)
		const db = getCurrentJazzSession()?.getSnapshot().client?.db
		if (!db) throw new Error('Missing database')
		const [org] = await db.all(app.organizations)
		if (!org) throw new Error('Missing workspace')
		const account = await db
			.insert(app.accounts, {
				organizationId: org.id,
				name: 'Overview ledger',
				kind: 'cash',
				currency: 'USD'
			})
			.wait({ tier: 'local' })
		const tzsAccount = await db
			.insert(app.accounts, {
				organizationId: org.id,
				name: 'TZS ledger',
				kind: 'cash',
				currency: 'TZS'
			})
			.wait({ tier: 'local' })

		const food = await db
			.insert(app.categories, {
				organizationId: org.id,
				name: 'Overview food',
				kind: 'expense',
				isSystem: false
			})
			.wait({ tier: 'local' })
		const travel = await db
			.insert(app.categories, {
				organizationId: org.id,
				name: 'Overview travel',
				kind: 'expense',
				isSystem: false
			})
			.wait({ tier: 'local' })
		function date(days: number) {
			const d = new Date()
			d.setDate(d.getDate() - days)
			return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
		}
		for (const row of [
			{
				description: 'Recent food',
				categoryId: food.id,
				amountMinor: 1000,
				bookedOn: date(0),
				currency: 'USD'
			},
			{
				description: 'Boundary food',
				categoryId: food.id,
				amountMinor: 2000,
				bookedOn: date(6),
				currency: 'USD'
			},
			{
				description: 'Older travel',
				categoryId: travel.id,
				amountMinor: 9000,
				bookedOn: date(29),
				currency: 'USD'
			},
			{
				description: 'Outside range',
				categoryId: food.id,
				amountMinor: 99999,
				bookedOn: date(30),
				currency: 'USD'
			},
			{
				description: 'TZS expense',
				categoryId: food.id,
				amountMinor: 500,
				bookedOn: date(0),
				currency: 'TZS'
			}
		])
			await db
				.insert(app.transactions, {
					...row,
					organizationId: org.id,
					accountId: row.currency === 'TZS' ? tzsAccount.id : account.id,
					kind: 'expense',
					source: 'manual'
				})
				.wait({ tier: 'local' })
	})
	await page.goto('/')
	await expect(page.getByText('Recent food', { exact: true })).toBeVisible()
}

test(
	'date presets, category selection, currencies, empty and invalid ranges',
	{ tag: ['@transactions'] },
	async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 1000 })
		await seed(page)
		const overview = page.getByRole('region', { name: 'Expenses by Category', exact: true })
		const legend = overview.locator('.legend')
		await page.getByRole('button', { name: 'Filter Transactions', exact: true }).click()
		await expect(page.getByRole('radio', { name: 'Last month', exact: true })).toBeChecked()
		await expect(page.getByLabel('Start Date')).toHaveCount(0)
		await expect(page.getByLabel('End Date')).toHaveCount(0)
		await expect(overview).toContainText('Total Expenses: $120.00')
		await expect(page.getByText('Outside range', { exact: true })).toHaveCount(0)
		await page.keyboard.press('Escape')
		await legend.getByRole('button', { name: /Overview travel/ }).click()
		await expect(page.getByText('Older travel', { exact: true })).toBeVisible()
		await expect(page.getByText('Recent food', { exact: true })).toHaveCount(0)
		await overview.getByRole('button', { name: 'All Categories', exact: true }).click()
		await expect(page.getByText('Recent food', { exact: true })).toBeVisible()
		// Keep a node reference: date changes must resize existing arcs, not remount them.
		await overview
			.locator('.chart path')
			.first()
			.evaluate((node) => {
				Reflect.set(window, 'overviewArc', node)
			})
		await page.getByRole('button', { name: 'Filter Transactions', exact: true }).click()
		await page.getByRole('radio', { name: 'Last week', exact: true }).check()
		await expect(overview).toContainText('Total Expenses: $30.00')
		const frames = await overview.locator('.chart').evaluate(async (chart) => {
			const samples = []
			for (let frame = 0; frame < 10; frame++) {
				await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
				samples.push(
					[...chart.querySelectorAll('path')].map((path) => path.getAttribute('d')).join('|')
				)
			}
			return new Set(samples).size
		})
		expect(frames).toBeGreaterThan(1)

		await expect(page.getByText('Boundary food', { exact: true })).toBeVisible()
		await expect(page.getByText('Older travel', { exact: true })).toHaveCount(0)
		expect(
			await overview
				.locator('.chart path')
				.first()
				.evaluate((node) => Reflect.get(window, 'overviewArc') === node)
		).toBe(true)
		await page.getByRole('radio', { name: 'Last month', exact: true }).check()
		await expect(overview).toContainText('Total Expenses: $120.00')
		await page.locator('[popover]').getByLabel('Currency').selectOption('TZS')
		await expect(page.getByText('TZS expense', { exact: true })).toBeVisible()
		await expect(page.getByText('Recent food', { exact: true })).toHaveCount(0)
		await page.getByRole('radio', { name: 'Custom', exact: true }).check()
		await expect(page.getByLabel('Start Date')).toBeVisible()
		await expect(page.getByLabel('End Date')).toBeVisible()
		await page.getByLabel('Start Date').fill('2000-01-01')
		await page.getByLabel('End Date').fill('2000-01-02')
		await expect(overview).toContainText('No Expenses in this time period.')
		await page.getByLabel('Start Date').fill('2001-01-01')
		await expect(overview.getByRole('status')).toContainText('Enter a start date')
	}
)

test(
	'slice clicks filter transactions and layout follows available width',
	{ tag: ['@transactions'] },
	async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 1000 })
		await seed(page)
		const overview = page.getByRole('region', { name: 'Expenses by Category', exact: true })
		const chart = overview.locator('.chart')
		const list = overview.locator('.transactions')
		const desktopChart = await chart.boundingBox()
		const desktopList = await list.boundingBox()
		if (!desktopChart || !desktopList) throw new Error('Missing layout')
		expect(desktopList.x).toBeGreaterThan(desktopChart.x + desktopChart.width - 1)
		await overview.locator('.chart path').filter({ visible: true }).first().click({ force: true })
		await expect(overview.locator('.legend button[aria-pressed="true"]')).toHaveCount(1)
		await overview.getByRole('button', { name: 'All Categories', exact: true }).click()
		await page.setViewportSize({ width: 390, height: 900 })
		await page.getByRole('button', { name: 'Close Main navigation', exact: true }).click()
		await expect
			.poll(async () => {
				const chartBox = await chart.boundingBox()
				const listBox = await list.boundingBox()
				return Boolean(chartBox && listBox && listBox.y > chartBox.y + chartBox.height)
			})
			.toBe(true)
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
		).toBe(true)
		await page.emulateMedia({ reducedMotion: 'reduce' })
		await page.getByRole('button', { name: 'Filter Transactions', exact: true }).click()
		await page.getByRole('radio', { name: 'Last week', exact: true }).check()
		await expect(overview).toContainText('Total Expenses: $30.00')
		await expect(page.getByLabel('Start Date')).toHaveCount(0)
		await page.getByRole('radio', { name: 'Custom', exact: true }).check()
		await expect(page.getByLabel('Start Date')).toBeVisible()
		await expect(page.getByLabel('End Date')).toBeVisible()
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
		).toBe(true)
	}
)

test(
	'overview filters persist in this tab across page navigation',
	{ tag: ['@transactions'] },
	async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 1000 })
		await seed(page)
		const overview = page.getByRole('region', { name: 'Expenses by Category', exact: true })
		const start = page.getByLabel('Start Date')
		const end = page.getByLabel('End Date')
		await page.getByRole('button', { name: 'Filter Transactions', exact: true }).click()
		await page.getByRole('radio', { name: 'Last week', exact: true }).check()
		await page.getByRole('radio', { name: 'Custom', exact: true }).check()
		const savedStart = await start.inputValue()
		const savedEnd = await end.inputValue()
		await page.locator('[popover]').getByLabel('Currency').selectOption('TZS')
		await page.keyboard.press('Escape')
		await overview
			.locator('.legend')
			.getByRole('button', { name: /Overview food/ })
			.click()
		await expect(overview.locator('.legend button[aria-pressed="true"]')).toHaveCount(1)
		const storedFilters = await page.evaluate(() => {
			const key = Object.keys(sessionStorage).find((item) =>
				item.startsWith('finance-overview-filters:')
			)
			return key ? { key, value: sessionStorage.getItem(key) } : null
		})
		expect(storedFilters).not.toBeNull()
		expect(storedFilters?.value).toContain(savedStart)
		expect(storedFilters?.value).toContain(savedEnd)

		await page.getByRole('link', { name: 'Expenses', exact: true }).click()
		await expect(page).toHaveURL(/\/expenses/)
		await page.getByRole('link', { name: 'Overview', exact: true }).click()
		const restoredOverview = page.getByRole('region', { name: 'Expenses by Category', exact: true })
		await page.getByRole('button', { name: 'Filter Transactions', exact: true }).click()
		await expect(page.getByRole('radio', { name: 'Last week', exact: true })).toBeChecked()
		await expect(page.getByLabel('Start Date')).toHaveCount(0)
		await page.getByRole('radio', { name: 'Custom', exact: true }).check()
		await expect(page.getByLabel('Start Date')).toHaveValue(savedStart)
		await expect(page.getByLabel('End Date')).toHaveValue(savedEnd)
		await expect(page.locator('[popover]').getByLabel('Currency')).toHaveValue('TZS')
		await expect(restoredOverview.locator('.legend button[aria-pressed="true"]')).toHaveCount(1)
		await expect(restoredOverview.locator('.legend button[aria-pressed="true"]')).toContainText(
			'Overview food'
		)
	}
)

test(
	'overview header popovers separate search and filters',
	{ tag: ['@transactions'] },
	async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 1000 })
		await seed(page)
		const heading = page.getByRole('heading', { name: 'Overview', exact: true })
		const searchButton = page.getByRole('button', { name: 'Search Transactions', exact: true })
		const filterButton = page.getByRole('button', { name: 'Filter Transactions', exact: true })
		const search = page.getByRole('searchbox', { name: 'Search Transactions', exact: true })
		await expect(search).not.toBeVisible()
		const titleBox = await heading.boundingBox()
		const buttonBox = await searchButton.boundingBox()
		if (!titleBox || !buttonBox) throw new Error('Missing header controls')
		expect(buttonBox.x).toBeGreaterThan(titleBox.x + titleBox.width)
		expect(buttonBox.y).toBeLessThan(titleBox.y + titleBox.height)
		expect(buttonBox.y + buttonBox.height).toBeGreaterThan(titleBox.y)
		await searchButton.click()
		await expect(search).toBeVisible()
		await expect(page.getByRole('radio', { name: 'Last week', exact: true })).not.toBeVisible()
		await search.fill('Recent food')
		await expect(page.getByText('Recent food', { exact: true })).toBeVisible()
		await expect(page.getByText('Older travel', { exact: true })).toHaveCount(0)
		await filterButton.click()
		await expect(search).not.toBeVisible()
		await expect(page.getByRole('radio', { name: 'Last month', exact: true })).toBeVisible()
		await expect(page.getByRole('combobox', { name: 'Filter Category', exact: true })).toBeVisible()
		await page.keyboard.press('Escape')
		await expect(filterButton).toBeFocused()
		await searchButton.click()
		await search.fill('')
		await expect(page.getByText('Older travel', { exact: true })).toBeVisible()
	}
)
