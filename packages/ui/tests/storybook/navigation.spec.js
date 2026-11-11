import { expect, test } from '@playwright/test'

/** @param {import('@playwright/test').Page} page @param {string} story */
async function openStory(page, story) {
	await page.goto(`/iframe.html?id=layout-navigation--${story}&viewMode=story`)
	await expect(page.getByRole('navigation').first()).toBeVisible()
}

test('vertical navigation retains native lists, current links and keyboard activation', async ({
	page
}) => {
	await openStory(page, 'sidebar')
	const nav = page.getByRole('navigation', { name: 'Main navigation' })
	await expect(nav.getByRole('list')).toHaveCount(1)
	await expect(nav.getByRole('link')).toHaveCount(5)
	await expect(nav.getByRole('menu')).toHaveCount(0)

	const overview = nav.getByRole('link', { name: 'Overview' })
	await expect(overview).toHaveAttribute('aria-current', 'page')
	await overview.focus()
	await overview.press('Tab')
	const expenses = nav.getByRole('link', { name: 'Expenses' })
	await expect(expenses).toBeFocused()

	await expenses.press('Enter')
	await expect(page).toHaveURL(/#expenses$/)
})

test('horizontal navigation wraps without page overflow at narrow widths', async ({
	page
}) => {
	await page.setViewportSize({ width: 320, height: 700 })
	await openStory(page, 'horizontal-wrapping')
	const nav = page.getByRole('navigation')

	const first = await nav.getByRole('link', { name: 'Overview' }).boundingBox()
	const last = await nav.getByRole('link', { name: 'Accounts' }).boundingBox()
	if (!first || !last) throw new Error('Expected link geometry')
	expect(last.y).toBeGreaterThan(first.y)
	expect(
		await page.evaluate(() => document.documentElement.scrollWidth)
	).toBeLessThanOrEqual(320)
})

test('multiple landmarks have distinct accessible names', async ({ page }) => {
	await openStory(page, 'multiple-landmarks')
	await expect(page.getByRole('navigation')).toHaveCount(2)
	await expect(
		page.getByRole('navigation', { name: 'Finance', exact: true })
	).toBeVisible()
	await expect(
		page.getByRole('navigation', { name: 'Settings', exact: true })
	).toBeVisible()
})

test('dropdown keyboard order, focus return and expanded state follow disclosure navigation', async ({
	page
}) => {
	await openStory(page, 'with-dropdown')
	const trigger = page.getByRole('button', { name: 'Settings', exact: true })
	const workspace = page.getByRole('link', { name: 'Workspace', exact: true })
	await expect(trigger).toHaveAttribute('aria-expanded', 'false')
	await expect(workspace).toBeHidden()
	await expect(page.getByRole('menu')).toHaveCount(0)
	await expect(trigger).not.toHaveAttribute('aria-haspopup', 'menu')
	await trigger.focus()
	await trigger.press('Enter')
	await expect(trigger).toHaveAttribute('aria-expanded', 'true')
	await expect(trigger).toBeFocused()
	await trigger.press('Tab')
	await expect(workspace).toBeFocused()
	await workspace.press('Tab')
	const categories = page.getByRole('link', { name: 'Categories', exact: true })
	await expect(categories).toBeFocused()
	await categories.press('Shift+Tab')
	await expect(workspace).toBeFocused()
	await workspace.press('Escape')
	await expect(workspace).toBeHidden()
	await expect(trigger).toHaveAttribute('aria-expanded', 'false')
	await expect(trigger).toBeFocused()
	await trigger.press('Space')
	await expect(workspace).toBeVisible()
	await trigger.press('Space')
	await expect(workspace).toBeHidden()
	await expect(trigger).toHaveAttribute('aria-expanded', 'false')
})

test('dropdown links stay nonmodal and close on selection or an outside click', async ({
	page
}) => {
	await openStory(page, 'with-dropdown')
	const trigger = page.getByRole('button', { name: 'Settings', exact: true })
	const workspace = page.getByRole('link', { name: 'Workspace', exact: true })
	await trigger.click()
	await trigger.press('Tab')
	await workspace.press('Tab')
	await page.getByRole('link', { name: 'Categories', exact: true }).press('Tab')
	await page
		.getByRole('link', { name: 'Account recovery', exact: true })
		.press('Tab')
	await expect(
		page.getByRole('link', { name: 'Help', exact: true })
	).toBeFocused()
	await workspace.click()
	await expect(page).toHaveURL(/#workspace$/)
	await expect(workspace).toBeHidden()
	await expect(trigger).toHaveAttribute('aria-expanded', 'false')
	await trigger.click()
	await page.mouse.click(1, 1)
	await expect(workspace).toBeHidden()
	await expect(trigger).toHaveAttribute('aria-expanded', 'false')
})
