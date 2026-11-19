import { financeFixture } from './helpers/worker-fixture.js'
import { prepareSidebar, openCreationModal, closeCreationModal } from './helpers/ui.js'
import { expect, test, type Locator } from '@playwright/test'

async function bounds(locator: Locator) {
	const box = await locator.boundingBox()
	if (!box) throw new Error('Expected visible element geometry')
	return box
}

test(
	'inline navigation keeps page height stable and scrolls inside its full-height panel',
	{ tag: ['@navigation'] },
	async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 420 })
		await page.emulateMedia({ reducedMotion: 'no-preference' })
		await page.goto('/accounts')
		await expect(
			page.getByRole('main').getByRole('heading', { name: 'Accounts', exact: true })
		).toBeVisible()
		const sidebar = page.locator('aside.inline-drawer')
		await expect(sidebar).toBeVisible()
		const toggle = page.getByRole('button', { name: 'Toggle Main navigation', exact: true })
		await expect(toggle).toBeVisible()
		const toggleBounds = await bounds(toggle)
		await prepareSidebar(page)
		const pageContent = page
			.getByRole('main')
			.getByRole('heading', { name: 'Accounts', exact: true })
		const before = await bounds(pageContent)
		const mainBefore = await bounds(page.getByRole('main'))
		await expect(page.locator('header.site-header')).toHaveCount(0)
		const panel = sidebar.locator('.inline-panel')
		await toggle.click()
		await expect(toggle).toHaveAttribute('aria-expanded', 'false')
		await toggle.click()
		await expect(toggle).toHaveAttribute('aria-expanded', 'true')
		await expect(sidebar).toBeVisible()
		await expect.poll(async () => (await bounds(sidebar)).width).toBe(320)
		const sidebarBox = await bounds(sidebar)

		expect(sidebarBox.height).toBe(420)
		expect(sidebarBox.y).toBe(0)
		expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(
			420
		)
		expect(sidebarBox.width).toBe(320)
		expect((await bounds(page.getByRole('main'))).x).toBe(mainBefore.x)
		await expect(sidebar.getByRole('button', { name: 'Add Account', exact: true })).toBeVisible()
		const body = sidebar.locator('.drawer-body')
		expect(await body.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true)
		await sidebar.getByRole('button', { name: 'Add Account', exact: true }).focus()
		expect(await body.evaluate((node) => node.scrollTop)).toBeGreaterThan(0)
		const open = page.getByRole('button', { name: 'Toggle Main navigation', exact: true })
		await open.focus()
		await expect(open).toBeFocused()
		await expect
			.poll(async () => await panel.evaluate((node) => getComputedStyle(node).transform))
			.toBe('matrix(1, 0, 0, 1, 0, 0)')
		const openedToggleBounds = await bounds(open)
		expect(openedToggleBounds.x).toBe(toggleBounds.x)
		expect(openedToggleBounds.y).toBe(toggleBounds.y)
		expect(openedToggleBounds.width).toBe(toggleBounds.width)
		expect(openedToggleBounds.height).toBe(toggleBounds.height)
		expect((await bounds(page.getByRole('main'))).x).toBe(mainBefore.x)
		expect((await bounds(pageContent)).y).toBe(before.y)
	}
)

test(
	'sidebar status follows browser connectivity without claiming completed sync',
	{ tag: ['@navigation'] },
	async ({ page, context }) => {
		await page.setViewportSize({ width: 1280, height: 1000 })
		await page.goto('/accounts')
		await expect(
			page.getByRole('main').getByRole('heading', { name: 'Accounts', exact: true })
		).toBeVisible()
		const sidebar = page.locator('aside.inline-drawer')
		const status = sidebar.locator('[role="status"]').nth(1)
		await expect(status).toHaveText('Online')
		await expect(status.locator('[aria-hidden="true"]')).toHaveCount(1)
		const body = await bounds(sidebar.locator('.drawer-body'))
		const indicator = await bounds(status)
		const footer = await bounds(sidebar.locator('.drawer-section').last())
		expect(indicator.y).toBeGreaterThanOrEqual(footer.y)
		expect(indicator.y + indicator.height).toBeLessThanOrEqual(footer.y + footer.height)
		expect(Math.abs(body.y + body.height - footer.y - footer.height)).toBeLessThan(2)
		const modal = await openCreationModal(page, 'Add Account')
		const name = modal.getByLabel('Account name', { exact: true })
		await name.fill('Unsaved draft')
		await name.focus()
		try {
			await context.setOffline(true)
			await expect(status).toHaveText('Offline')
			await expect(name).toBeFocused()
			await expect(name).toHaveValue('Unsaved draft')
		} finally {
			await context.setOffline(false)
		}
		await expect(status).toHaveText('Online')
		await closeCreationModal(page)
		await sidebar.getByRole('link', { name: 'Expenses', exact: true }).click()
		await expect(page).toHaveURL(/\/expenses(?:\?|$)/)
		await expect(status).toHaveText('Online')
	}
)

test(
	'sidebar status does not claim a successful sync when the database is disconnected',
	{ tag: ['@navigation'] },
	async ({ page }) => {
		await page.goto('/accounts')
		await expect(
			page.getByRole('main').getByRole('heading', { name: 'Accounts', exact: true })
		).toBeVisible()
		const status = page.locator('aside.inline-drawer').locator('[role="status"]').nth(1)
		await financeFixture(page, 'ui-integration.e2e:117')
		await expect(status).toHaveText('Online')
		await expect(status).not.toContainText(/synced|connected|saved/i)
	}
)

test(
	'mobile sidebar status stays inside the Drawer and is hidden when it closes',
	{ tag: ['@navigation'] },
	async ({ page, context }) => {
		await page.setViewportSize({ width: 390, height: 650 })
		await page.emulateMedia({ reducedMotion: 'reduce' })
		await page.goto('/accounts')
		await expect(
			page.getByRole('main').getByRole('heading', { name: 'Accounts', exact: true })
		).toBeVisible()
		const open = page.getByRole('button', { name: 'Toggle Main navigation', exact: true })
		await open.click()
		const drawer = page.locator('aside.inline-drawer')
		const status = drawer.locator('[role="status"]').nth(1)
		await expect(status).toHaveText('Online')
		try {
			await context.setOffline(true)
			await expect(status).toHaveText('Offline')
			await status.scrollIntoViewIfNeeded()
			await expect(status).toBeInViewport()
			expect(await drawer.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)
			await page.getByRole('button', { name: 'Close Main navigation', exact: true }).click()
			await expect(drawer).toHaveAttribute('aria-hidden', 'true')
			await expect(open).toBeFocused()
			await expect(drawer.getByRole('status')).toHaveCount(0)
		} finally {
			await context.setOffline(false)
		}
		await open.click()
		await expect(status).toHaveText('Online')
	}
)

test('localized manifest keeps the install URL and declares its language', async ({
	page,
	request
}) => {
	await page.goto('/')
	await expect(page.locator('html')).toHaveAttribute('lang', 'en')
	await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
		'href',
		'/manifest.webmanifest'
	)
	const response = await request.get('/manifest.webmanifest')
	expect(response.ok()).toBe(true)
	expect(response.headers()['content-type']).toContain('application/manifest+json')
	expect(await response.json()).toMatchObject({
		name: 'Delightful Finance',
		short_name: 'Finance',
		description: 'A local-first personal finance tracker.',
		lang: 'en',
		dir: 'ltr',
		id: '/',
		start_url: '/',
		scope: '/'
	})
})
