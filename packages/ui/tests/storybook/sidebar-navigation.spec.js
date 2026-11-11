import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
	await page.emulateMedia({ reducedMotion: 'reduce' })
	await page.goto(
		'/iframe.html?id=layout-sidebar-navigation--drawer-composition&viewMode=story'
	)
	await expect(
		page.getByRole('navigation', { name: 'Library', exact: true })
	).toBeVisible()
})

test('sidebar links preserve native navigation and supplementary content', async ({
	page
}) => {
	const nav = page.getByRole('navigation', { name: 'Library', exact: true })
	const inbox = nav.getByRole('link', { name: 'Inbox 12', exact: true })
	await expect(inbox).toHaveAttribute('aria-current', 'page')
	await expect(inbox).toHaveAttribute('href', '#inbox')
	await expect(page.getByRole('menu')).toHaveCount(0)
	await expect(inbox.locator('svg')).toHaveAttribute('aria-hidden', 'true')
	await inbox.focus()
	await inbox.press('Tab')
	const later = nav.getByRole('link', { name: 'Later', exact: true })
	await expect(later).toBeFocused()
	await expect(later).not.toHaveAttribute('aria-current')
	await later.press('Enter')
	await expect(page).toHaveURL(/#later$/)
})

test('disclosure keyboard operation hides descendants and preserves control state', async ({
	page
}) => {
	const summary = page.locator('summary').filter({ hasText: 'Settings' })
	const preferences = page.getByRole('region', { name: 'Display preferences' })
	const progress = preferences.getByRole('checkbox', {
		name: 'Show reading progress'
	})
	await expect(preferences).toBeVisible()
	await progress.check()
	await summary.focus()
	await summary.press('Enter')
	await expect(preferences).toBeHidden()
	await expect(
		page.getByRole('link', { name: 'Account', exact: true })
	).toHaveCount(0)
	await expect(summary).toBeFocused()
	await summary.press('Space')
	await expect(preferences).toBeVisible()
	await expect(progress).toBeChecked()
	await summary.press('Tab')
	await expect(progress).toBeFocused()
	await progress.press('Tab')
	await expect(
		page.getByRole('link', { name: 'Appearance and reading preferences' })
	).toBeFocused()
})

test('narrow drawer keeps long labels and controls within the viewport', async ({
	page
}) => {
	await page.setViewportSize({ width: 320, height: 700 })
	const link = page.getByRole('link', {
		name: 'Appearance and reading preferences'
	})
	await link.focus()
	await expect(link).toBeInViewport()
	const bounds = await link.boundingBox()
	if (!bounds) throw new Error('Expected visible navigation link')
	expect(bounds.x).toBeGreaterThanOrEqual(0)
	expect(bounds.x + bounds.width).toBeLessThanOrEqual(320)
	expect(
		await page.evaluate(() => document.documentElement.scrollWidth)
	).toBeLessThanOrEqual(320)
})
