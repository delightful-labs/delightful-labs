import { financeFixture } from './helpers/worker-fixture.js'
import { expect, test, type Page } from '@playwright/test'
import { openSidebarSection } from './helpers/ui.js'

async function seed(page: Page, count = 0, acrossDates = false) {
	await page.goto('/accounts')
	await expect(page).toHaveURL(
		(url) => url.pathname === '/accounts' && Boolean(url.searchParams.get('workspace'))
	)
	await expect(
		page.getByRole('main').getByRole('heading', { name: 'Accounts', exact: true })
	).toBeVisible()
	await financeFixture(page, 'pagination.e2e:12', { count, acrossDates })
	await expect(
		page.getByRole('main').getByRole('cell', { name: 'Pagination account', exact: true })
	).toBeVisible()
}

async function openMenu(page: Page) {
	const trigger = page.getByRole('button', { name: 'Developer menu', exact: true })
	await trigger.focus()
	await trigger.press('Enter')
	const dialog = page.getByRole('dialog', { name: 'Developer menu', exact: true })
	await expect(dialog).toBeVisible()
	return dialog
}

test('global keyboard developer menu saves both sample kinds and retains progress across pages', async ({
	page
}) => {
	const errors: string[] = []
	page.on('pageerror', (error) => errors.push(error.message))
	await seed(page)
	await page.reload()
	await expect(
		page.getByRole('main').getByRole('heading', { name: 'Accounts', exact: true })
	).toBeVisible()
	await page.keyboard.press('Tab')
	await expect(page.getByRole('link', { name: 'Skip to main content', exact: true })).toBeFocused()
	await page.keyboard.press('Tab')
	const trigger = page.getByRole('button', { name: 'Developer menu', exact: true })
	await expect(trigger).toBeFocused()
	const box = await trigger.boundingBox()
	expect(box?.width).toBeGreaterThan(1)
	await page.keyboard.press('Enter')
	const dialog = page.getByRole('dialog', { name: 'Developer menu', exact: true })
	await expect(dialog).toBeVisible()
	const income = dialog.getByRole('button', {
		name: 'Add 25 sample Income Transactions',
		exact: true
	})
	const expense = dialog.getByRole('button', {
		name: 'Add 25 sample Expense Transactions',
		exact: true
	})
	await expect(income).toBeVisible()
	await expense.click()
	await expect(dialog.getByRole('status')).toHaveText('Saved 25 of 25 sample transactions.')
	await page.keyboard.press('Escape')
	await expect(dialog).toBeHidden()
	await expect(trigger).toBeFocused()
	await page.locator('aside').getByRole('link', { name: 'Expenses', exact: true }).click()
	await expect(
		page.getByRole('main').getByRole('link', { name: /^Transaction details:/ })
	).toHaveCount(25)
	await openMenu(page)
	await expect(dialog.getByRole('status')).toHaveText('Saved 25 of 25 sample transactions.')
	await income.click()
	await expect(dialog.getByRole('status')).toHaveCount(2)
	await expect(dialog.getByRole('status')).toHaveText([
		'Saved 25 of 25 sample transactions.',
		'Saved 25 of 25 sample transactions.'
	])
	await dialog.getByRole('button', { name: 'Close', exact: true }).click()
	await page.locator('aside').getByRole('link', { name: 'Income', exact: true }).click()
	await expect(
		page.getByRole('main').getByRole('link', { name: /^Transaction details:/ })
	).toHaveCount(25)
	await page.locator('aside').getByRole('link', { name: 'Login', exact: true }).click()
	await expect(page.getByRole('heading', { name: 'Login', exact: true })).toBeVisible()
	await openMenu(page)
	await expect(income).toBeVisible()
	await expect(expense).toBeVisible()
	expect(errors).toEqual([])
})

test('URL pages preserve totals, five slots, history, reload and filter reset', async ({
	page
}) => {
	await seed(page, 201)
	await page.goto('/expenses?other=keep')
	const navigation = page.getByRole('navigation', { name: 'Transaction pages', exact: true })
	const entries = page.getByRole('main').getByRole('link', { name: /Pagination fixture/ })
	await expect(entries).toHaveCount(25)
	await expect(page.getByLabel('Daily total: $201.00', { exact: true })).toBeVisible()
	await expect(navigation.getByRole('listitem')).toHaveCount(7)
	await expect(navigation.getByLabel('Previous Page', { exact: true })).toHaveAttribute(
		'aria-disabled',
		'true'
	)
	const workspaceId = new URL(page.url()).searchParams.get('workspace')
	expect(workspaceId).not.toBeNull()
	await navigation.getByRole('link', { name: 'Page 3', exact: true }).click()
	await expect(page).toHaveURL(
		(url) =>
			url.pathname === '/expenses' &&
			url.searchParams.get('other') === 'keep' &&
			url.searchParams.get('page') === '3' &&
			url.searchParams.get('workspace') === workspaceId
	)
	await expect(navigation.locator('[aria-current="page"]')).toHaveText('3')
	await navigation.getByRole('link', { name: 'Next Page', exact: true }).click()
	await expect(navigation.getByRole('listitem')).toHaveCount(7)
	await expect(navigation.locator('[aria-current="page"]')).toHaveText('4')
	await page.goBack()
	await expect(navigation.locator('[aria-current="page"]')).toHaveText('3')
	await page.goForward()
	await expect(navigation.locator('[aria-current="page"]')).toHaveText('4')
	await page.reload()
	await expect(navigation.locator('[aria-current="page"]')).toHaveText('4')
	await navigation.getByRole('link', { name: 'Page 9', exact: true }).click()
	await expect(entries).toHaveCount(1)
	await expect(navigation.getByRole('listitem')).toHaveCount(7)
	await expect(navigation.getByLabel('Next Page', { exact: true })).toHaveAttribute(
		'aria-disabled',
		'true'
	)
	await expect(page.getByLabel('Daily total: $201.00', { exact: true })).toBeVisible()
	await navigation.getByRole('link', { name: 'Page 1', exact: true }).click()
	await expect(page).toHaveURL(
		(url) =>
			url.pathname === '/expenses' &&
			url.searchParams.get('other') === 'keep' &&
			!url.searchParams.has('page') &&
			url.searchParams.get('workspace') === workspaceId
	)
	await page.goto('/expenses?page=999')
	await expect(navigation.locator('[aria-current="page"]')).toHaveText('9')
	await page.goto('/expenses?page=invalid')
	await expect(navigation.locator('[aria-current="page"]')).toHaveText('1')
	await page.goto('/expenses?page=4')
	await expect(navigation.locator('[aria-current="page"]')).toHaveText('4')
	const accounts = await openSidebarSection(page, 'Accounts')
	await accounts.getByRole('checkbox', { name: 'Pagination account', exact: true }).uncheck()
	await expect(page).toHaveURL(
		(url) =>
			url.pathname === '/expenses' &&
			!url.searchParams.has('page') &&
			url.searchParams.get('workspace') === workspaceId
	)
	await expect(navigation).toHaveCount(0)
})

test('pages span date groups while retaining full-day totals', async ({ page }) => {
	await seed(page, 60, true)
	await page.goto('/expenses')
	const main = page.getByRole('main')
	const entries = main.getByRole('link', { name: /Pagination fixture/ })
	const navigation = page.getByRole('navigation', { name: 'Transaction pages', exact: true })
	const day = (date: string) =>
		main.locator('section').filter({ has: page.locator(`time[datetime="${date}"]`) })
	await expect(entries).toHaveCount(25)
	await expect(day('2026-10-19').getByRole('link')).toHaveCount(10)
	await expect(day('2026-10-18').getByRole('link')).toHaveCount(15)
	await expect(day('2026-10-18').getByLabel('Daily total: $20.00', { exact: true })).toBeVisible()
	await expect(day('2026-10-17')).toHaveCount(0)
	await navigation.getByRole('link', { name: 'Page 2', exact: true }).click()
	await expect(entries).toHaveCount(25)
	await expect(day('2026-10-19')).toHaveCount(0)
	await expect(day('2026-10-18').getByRole('link')).toHaveCount(5)
	await expect(day('2026-10-17').getByRole('link')).toHaveCount(20)
	await expect(day('2026-10-18').getByLabel('Daily total: $20.00', { exact: true })).toBeVisible()
	await expect(day('2026-10-17').getByLabel('Daily total: $30.00', { exact: true })).toBeVisible()
	await navigation.getByRole('link', { name: 'Page 3', exact: true }).click()
	await expect(entries).toHaveCount(10)
	await expect(day('2026-10-18')).toHaveCount(0)
	await expect(day('2026-10-17').getByLabel('Daily total: $30.00', { exact: true })).toBeVisible()
})

test('five-page mobile navigation never truncates or changes its item count', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 900 })
	await seed(page, 125)
	await page.goto('/expenses')
	const navigation = page.getByRole('navigation', { name: 'Transaction pages', exact: true })
	for (const number of [1, 3, 4, 5]) {
		await navigation.getByRole('link', { name: `Page ${number}`, exact: true }).click()
		await expect(navigation.locator('[aria-current="page"]')).toHaveText(String(number))
		await expect(navigation.getByRole('listitem')).toHaveCount(7)
		await expect(navigation.getByRole('link', { name: /^Page \d+$/ })).toHaveCount(5)
	}
	const box = await navigation.boundingBox()
	expect(box).not.toBeNull()
	if (box) expect(box.x + box.width).toBeLessThanOrEqual(390)
})

test('developer sample controls stay disabled while runtime startup is pending', async ({
	page,
	context
}) => {
	const release = Promise.withResolvers<void>()
	let held = 0
	await context.route(/\.wasm(?:\?|$)/, async (route) => {
		held += 1
		await release.promise
		await route.continue()
	})
	try {
		await page.goto('/accounts', { waitUntil: 'domcontentloaded' })
		await expect.poll(() => held).toBeGreaterThan(0)
		const dialog = await openMenu(page)
		for (const kind of ['Income', 'Expense']) {
			await expect(
				dialog.getByRole('button', { name: `Add 25 sample ${kind} Transactions`, exact: true })
			).toBeDisabled()
		}
	} finally {
		release.resolve()
	}
	await page
		.getByRole('dialog', { name: 'Developer menu', exact: true })
		.getByRole('button', { name: 'Close', exact: true })
		.click()
	await expect(
		page.getByRole('main').getByRole('heading', { name: 'Accounts', exact: true })
	).toBeVisible()
})

test('sample transactions save offline and synchronize after reconnection', async ({
	page,
	context
}) => {
	await seed(page)
	await page.locator('aside').getByRole('link', { name: 'Expenses', exact: true }).click()
	await expect(
		page.getByRole('main').getByRole('heading', { name: 'Expenses', exact: true })
	).toBeVisible()
	const dialog = await openMenu(page)
	const add = dialog.getByRole('button', {
		name: 'Add 25 sample Expense Transactions',
		exact: true
	})
	await expect(add).toBeEnabled()
	await context.setOffline(true)
	try {
		await add.click()
		await expect(dialog.getByRole('status')).toHaveText('Saved 25 of 25 sample transactions.')
		await dialog.getByRole('button', { name: 'Close', exact: true }).click()
		await expect(
			page.getByRole('main').getByRole('link', { name: /^Transaction details:/ })
		).toHaveCount(25)
	} finally {
		await context.setOffline(false)
	}
	await expect.poll(() => financeFixture(page, 'pagination.e2e:306', page.url())).toBe(25)
	await page.reload()
	await expect(
		page.getByRole('main').getByRole('link', { name: /^Transaction details:/ })
	).toHaveCount(25)
})

test('live result shrink clamps pages without rewriting the requested URL', async ({ page }) => {
	await seed(page, 76)
	await page.goto('/expenses?page=4')
	const entries = page.getByRole('main').getByRole('link', { name: /Pagination fixture/ })
	const navigation = page.getByRole('navigation', { name: 'Transaction pages', exact: true })
	await expect(entries).toHaveCount(1)
	await expect(navigation.locator('[aria-current="page"]')).toHaveText('4')
	async function retain(count: number) {
		await financeFixture(page, 'pagination.e2e:338', count, page.url())
	}
	await retain(26)
	await expect(navigation.locator('[aria-current="page"]')).toHaveText('2')
	await expect(entries).toHaveCount(1)
	await expect(page.getByLabel('Daily total: $26.00', { exact: true })).toBeVisible()
	await expect(page).toHaveURL((url) => url.searchParams.get('page') === '4')
	await retain(25)
	await expect(navigation).toHaveCount(0)
	await expect(entries).toHaveCount(25)
	await expect(page.getByLabel('Daily total: $25.00', { exact: true })).toBeVisible()
	await retain(0)
	await expect(entries).toHaveCount(0)
	await expect(navigation).toHaveCount(0)
	await expect(page).toHaveURL((url) => url.searchParams.get('page') === '4')
})

declare global {
	interface Window {
		paginationBatchGate: { started: boolean; release: () => void; restore: () => void }
	}
}

test(
	'workspace replacement drains the issued sample and never retargets subsequent entries',
	{ tag: ['@workspaces'] },
	async ({ page }) => {
		await seed(page)
		const fixture = await financeFixture(page, 'pagination.e2e:380', page.url())
		try {
			const dialog = await openMenu(page)
			const add = dialog.getByRole('button', {
				name: 'Add 25 sample Expense Transactions',
				exact: true
			})
			await expect(add).toBeEnabled()
			await add.click()
			await expect.poll(() => financeFixture(page, 'pagination.e2e:465')).toBe(true)
			await dialog.getByRole('button', { name: 'Close', exact: true }).click()
			const settings = await openSidebarSection(page, 'Settings')
			await settings
				.getByLabel('Current Workspace', { exact: true })
				.selectOption(fixture.destinationId)
			await expect(page).toHaveURL(
				(url) => url.searchParams.get('workspace') === fixture.destinationId
			)
			await openMenu(page)
			await expect(add).toBeDisabled()
			await expect(dialog.getByRole('status').filter({ hasText: /1 of 25/ })).toHaveCount(0)
			await expect
				.poll(() => financeFixture(page, 'pagination.e2e:480', fixture))
				.toEqual({ source: 1, destination: 0 })
			await financeFixture(page, 'pagination.e2e:474')
			await expect(add).toBeEnabled()
			await expect(dialog.getByRole('status').filter({ hasText: /1 of 25/ })).toHaveCount(0)
			await expect
				.poll(() => financeFixture(page, 'pagination.e2e:480', fixture))
				.toEqual({ source: 1, destination: 0 })
		} finally {
			await financeFixture(page, 'pagination.e2e:497')
		}
	}
)
