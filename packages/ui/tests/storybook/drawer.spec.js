import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
	await page.emulateMedia({ reducedMotion: 'reduce' })
})

for (const side of ['left', 'right']) {
	test(`inline ${side} reserves space without trapping focus and scopes Escape`, async ({
		page
	}) => {
		await page.setViewportSize({ width: 1100, height: 700 })
		const story = side === 'left' ? 'inline-sidebar' : 'inline-right-sidebar'
		await page.goto(`/iframe.html?id=layout-drawer--${story}&viewMode=story`)
		const toggle = page.getByRole('button', {
			name: 'Toggle sidebar',
			exact: true
		})
		const content = page.getByRole('region', { name: 'Page content' })
		const before = await content.boundingBox()
		await toggle.click()
		const aside = page.getByRole('complementary', {
			name: 'Main menu',
			exact: true
		})
		await expect(aside).toBeVisible()
		await expect(aside).toHaveAttribute('data-side', side)
		await expect(toggle).toBeFocused()
		await expect(toggle).toHaveAttribute('aria-expanded', 'true')
		await expect(page.getByRole('dialog')).toHaveCount(0)
		const after = await content.boundingBox()
		const sidebar = await aside.boundingBox()
		if (!before || !after || !sidebar)
			throw new Error('Expected inline page geometry')
		expect(after.width).toBeLessThan(before.width)
		if (side === 'left') expect(after.x).toBeGreaterThan(before.x)
		else expect(sidebar.x).toBeGreaterThanOrEqual(after.x + after.width)

		const outside = content.getByRole('link', {
			name: 'Continue working',
			exact: true
		})
		await outside.focus()
		await outside.press('Escape')
		await expect(outside).toBeFocused()
		await expect(aside).toBeVisible()
		const accounts = aside.getByRole('link', { name: 'Accounts', exact: true })
		await accounts.focus()
		await accounts.evaluate((element) =>
			element.addEventListener('keydown', (event) => event.preventDefault(), {
				once: true
			})
		)
		await page.keyboard.press('Escape')
		await expect(aside).toBeVisible()
		await page.keyboard.press('Escape')
		await expect(toggle).toBeFocused()
		await expect(toggle).toHaveAttribute('aria-expanded', 'false')
		await expect(page.locator('aside')).toHaveAttribute('aria-hidden', 'true')
		await expect(page.locator('aside')).toHaveAttribute('inert', '')
		await expect(aside).toHaveCount(0)
	})
}

test('initially open drawer closes safely and later restores the actual opening control', async ({
	page
}) => {
	await page.goto(
		'/iframe.html?id=tests-drawerstates--initially-open&viewMode=story'
	)
	const aside = page.getByRole('complementary', {
		name: 'Fixture menu',
		exact: true
	})
	const toggle = page.getByRole('button', {
		name: 'Toggle drawer',
		exact: true
	})
	await aside.getByRole('button', { name: 'Close menu', exact: true }).click()
	await expect(page.locator('aside')).toHaveAttribute('inert', '')
	await toggle.click()
	await aside.getByRole('button', { name: 'Close menu', exact: true }).click()
	await expect(toggle).toBeFocused()
	await toggle.click()
	const external = page.getByRole('button', {
		name: 'Close externally',
		exact: true
	})
	await external.click()
	await expect(page.locator('aside')).toHaveAttribute('aria-hidden', 'true')
	await expect(external).toBeFocused()
})

test('optional close control leaves toggle and scoped Escape available', async ({
	page
}) => {
	await page.goto(
		'/iframe.html?id=tests-drawerstates--without-close-control&viewMode=story'
	)
	const toggle = page.getByRole('button', {
		name: 'Toggle drawer',
		exact: true
	})
	await toggle.click()
	const aside = page.getByRole('complementary', {
		name: 'Fixture menu',
		exact: true
	})
	await expect(aside).toBeVisible()
	await expect(aside.getByRole('button')).toHaveCount(0)
	await aside.getByRole('link', { name: 'Accounts', exact: true }).focus()
	await page.keyboard.press('Escape')
	await expect(toggle).toBeFocused()
	await expect(toggle).toHaveAttribute('aria-expanded', 'false')
})

test('consumer navigation can close a drawer with a visually hidden heading', async ({
	page
}) => {
	await page.goto(
		'/iframe.html?id=layout-drawer--compact-navigation&viewMode=story'
	)
	await page
		.getByRole('button', { name: 'Open navigation', exact: true })
		.click()
	const aside = page.getByRole('complementary', {
		name: 'Main navigation',
		exact: true
	})
	await expect(aside).toBeVisible()
	await aside.getByRole('link', { name: 'Accounts', exact: true }).click()
	await expect(page).toHaveURL(/#accounts$/)
	await expect(page.locator('aside')).toHaveAttribute('aria-hidden', 'true')
	await expect(
		page.getByRole('button', { name: 'Open navigation', exact: true })
	).toBeFocused()
})

test('narrow right sidebar stacks in DOM order without horizontal overflow', async ({
	page
}) => {
	await page.setViewportSize({ width: 320, height: 600 })
	await page.goto(
		'/iframe.html?id=layout-drawer--inline-right-sidebar&viewMode=story'
	)
	await page
		.getByRole('button', { name: 'Toggle sidebar', exact: true })
		.click()
	const content = await page
		.getByRole('region', { name: 'Page content' })
		.boundingBox()
	const sidebar = await page
		.getByRole('complementary', { name: 'Main menu', exact: true })
		.boundingBox()
	if (!content || !sidebar) throw new Error('Expected stacked geometry')
	expect(sidebar.y).toBeGreaterThanOrEqual(content.y + content.height)
	expect(
		await page.evaluate(() => document.documentElement.scrollWidth)
	).toBeLessThanOrEqual(320)
})

test('long inline content scrolls inside the drawer with reduced motion', async ({
	page
}) => {
	await page.setViewportSize({ width: 600, height: 600 })
	await page.goto(
		'/iframe.html?id=tests-drawerstates--long-content&viewMode=story'
	)
	await page.getByRole('button', { name: 'Toggle drawer', exact: true }).click()
	const aside = page.getByRole('complementary', {
		name: 'Fixture menu',
		exact: true
	})

	const body = aside.locator('[data-close-button]')
	expect(
		await body.evaluate(
			(element) => element.scrollHeight > element.clientHeight
		)
	).toBe(true)
	const last = aside.getByRole('link', { name: 'Section 39', exact: true })
	await last.focus()
	await expect(last).toBeFocused()
	await expect(last).toBeInViewport()
	expect(await body.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
	await expect(
		aside.getByRole('button', { name: 'Close menu', exact: true })
	).toBeInViewport()
})

test('closing makes descendants inert immediately while layout space animates away', async ({
	page
}) => {
	await page.emulateMedia({ reducedMotion: 'no-preference' })
	await page.goto(
		'/iframe.html?id=layout-drawer--inline-sidebar&viewMode=story'
	)
	const toggle = page.getByRole('button', {
		name: 'Toggle sidebar',
		exact: true
	})
	await toggle.click()
	const aside = page.locator('aside')
	await expect.poll(async () => (await aside.boundingBox())?.width).toBe(288)
	await aside.evaluate((element) =>
		element.style.setProperty('--dui-drawer-duration', '1s')
	)
	const closingWidth = await aside.evaluate((element) => {
		const close = element.querySelector('button')
		if (!close) throw new Error('Expected close control')
		close.click()
		return new Promise((resolve) =>
			requestAnimationFrame(() =>
				resolve(element.getBoundingClientRect().width)
			)
		)
	})
	expect(closingWidth).toBeGreaterThan(0)
	await expect(aside).toHaveAttribute('data-open', 'false')
	await expect(aside).toHaveAttribute('inert', '')
	await expect(aside).toHaveAttribute('aria-hidden', 'true')
	await expect(aside).not.toHaveAttribute('hidden')
	await expect(toggle).toBeFocused()
	await expect(
		page.getByRole('link', { name: 'Accounts', exact: true })
	).toHaveCount(0)
	await expect.poll(async () => (await aside.boundingBox())?.width ?? 0).toBe(0)
})
