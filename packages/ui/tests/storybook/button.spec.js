import { expect, test } from '@playwright/test'

/** @param {import('@playwright/test').Page} page @param {string} story */
async function openStory(page, story) {
	await page.goto(`/iframe.html?id=controls-button--${story}&viewMode=story`)
	await expect(page.locator('#storybook-root button')).toBeVisible()
	return page.locator('#storybook-root button')
}

test('primary buttons remain available across automatic and explicit theme changes', async ({
	page
}) => {
	await page.emulateMedia({ colorScheme: 'dark' })
	const button = await openStory(page, 'primary')
	await expect(button).toBeEnabled()
	await page.emulateMedia({ colorScheme: 'light' })
	await page.evaluate(() => {
		document.documentElement.dataset.duiTheme = 'dark'
	})
	await expect(button).toBeEnabled()
	await button.hover()
	await page.mouse.move(0, 0)
	await page.evaluate(() => {
		document.documentElement.dataset.duiTheme = 'light'
	})
	await expect(button).toBeEnabled()
})

test('raised and flat buttons remain usable while hovered and pressed', async ({
	page
}) => {
	const raised = await openStory(page, 'default')
	await expect(raised).toBeEnabled()
	await raised.hover()
	await page.mouse.down()
	await page.mouse.up()
	const flat = await openStory(page, 'flat-secondary')
	await expect(flat).toBeEnabled()
	await flat.hover()
	for (const dark of [false, true]) {
		await page.evaluate((dark) => {
			document.documentElement.dataset.duiTheme = dark ? 'dark' : 'light'
		}, dark)
		await page.mouse.down()
		await expect(flat).toBeEnabled()
		await page.mouse.up()
	}
})

test('disabled flat buttons retain native disabled behavior', async ({
	page
}) => {
	const button = await openStory(page, 'flat-disabled')
	await expect(button).toBeDisabled()
	await button.hover({ force: true })
	await page.mouse.down()
	await page.mouse.up()
})

test('aria-disabled buttons remain focusable and do not activate', async ({
	page
}) => {
	const button = await openStory(page, 'aria-disabled')
	await expect(button).toHaveAttribute('aria-disabled', 'true')
	await expect(button).not.toHaveAttribute('disabled')
	await button.focus()
	await expect(button).toBeFocused()
	await button.hover()

	await page.mouse.down()

	await page.mouse.up()
	await button.evaluate((element) => {
		if (element instanceof HTMLButtonElement) element.click()
	})
})

test('flat keys scale with their grid and preserve keyboard focus across motion preferences', async ({
	page
}) => {
	const button = await openStory(page, 'flat-key')
	for (const width of [375, 1280]) {
		await page.setViewportSize({ width, height: 800 })
		const box = await button.boundingBox()
		if (!box) throw new Error('Expected flat key geometry')
		expect(box.width).toBeCloseTo(box.height, 1)
		expect(box.x + box.width).toBeLessThanOrEqual(width)
	}
	await page.emulateMedia({ reducedMotion: 'reduce' })
	await button.focus()
	await expect(button).toBeFocused()
	await button.press('Space')
	await expect(button).toBeFocused()
	await page.emulateMedia({ forcedColors: 'active' })
})
