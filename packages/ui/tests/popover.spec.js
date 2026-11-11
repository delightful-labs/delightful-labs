import { expect, test } from '@playwright/test'

/** @param {import('@playwright/test').Page} page */
const trigger = (page) =>
	page.getByRole('button', { name: 'About amounts', exact: true })
/** @param {import('@playwright/test').Page} page */
const panel = (page) => page.locator('#amount-info')

/** @param {import('@playwright/test').Locator} locator */
async function bounds(locator) {
	const box = await locator.boundingBox()
	if (!box) throw new Error('Expected visible popover or trigger geometry')
	return box
}

test.beforeEach(async ({ page }) => {
	await page.goto('/')
})

test('native triggers, keyboard interaction and dismissal', async ({
	page
}) => {
	await expect(panel(page)).toBeHidden()
	await trigger(page).focus()
	await page.keyboard.press('Enter')
	await expect(panel(page)).toBeVisible()
	await page.keyboard.press('Tab')
	await expect(panel(page).getByRole('link')).toBeFocused()
	await page.keyboard.press('Escape')
	await expect(panel(page)).toBeHidden()
	await expect(trigger(page)).toBeFocused()
	await page.keyboard.press('Space')
	await expect(panel(page)).toBeVisible()
	await panel(page).getByText('Enter the total amount, including tax.').click()
	await expect(panel(page)).toBeVisible()
	await panel(page).getByRole('button').click()
	await expect(panel(page)).toBeHidden()
	await trigger(page).click()
	await trigger(page).click()
	await expect(panel(page)).toBeHidden()
	await trigger(page).click()
	await page.getByRole('heading', { name: 'Popover', exact: true }).click()
	await expect(panel(page)).toBeHidden()
})

test('multiple triggers and unrelated auto popovers', async ({ page }) => {
	await page
		.getByRole('button', { name: 'More amount information', exact: true })
		.click()
	await expect(panel(page)).toBeVisible()
	await page
		.getByRole('button', { name: 'Help information', exact: true })
		.click()
	await expect(panel(page)).toBeHidden()
	await expect(page.locator('#help-info')).toBeVisible()
})

test('anchored geometry stays bounded and follows scroll and resize', async ({
	page
}) => {
	for (const width of [1280, 375]) {
		await page.setViewportSize({ width, height: 800 })
		await trigger(page).click()
		await expect(panel(page)).toBeVisible()
		const anchor = await bounds(trigger(page))
		const box = await bounds(panel(page))
		expect(box.x).toBeGreaterThanOrEqual(0)
		expect(box.x + box.width).toBeLessThanOrEqual(width)
		expect(box.y).toBeGreaterThanOrEqual(anchor.y + anchor.height)
		await page.evaluate(() => window.scrollBy(0, 20))
		await expect
			.poll(async () => {
				const moved = await bounds(panel(page))
				const movedAnchor = await bounds(trigger(page))
				return moved.y - movedAnchor.y
			})
			.toBeCloseTo(box.y - anchor.y, 0)
		await page.setViewportSize({ width: width - 30, height: 700 })
		const resized = await bounds(panel(page))
		expect(resized.x).toBeGreaterThanOrEqual(0)
		expect(resized.x + resized.width).toBeLessThanOrEqual(width - 30)
		await page.keyboard.press('Escape')
		await page.evaluate(() => window.scrollTo(0, 0))
	}
})

test('flips above a trigger near the viewport bottom', async ({ page }) => {
	await trigger(page).evaluate((element) => {
		element.style.position = 'fixed'
		element.style.bottom = '8px'
		element.style.left = '50%'
	})
	await trigger(page).click()
	const anchor = await bounds(trigger(page))
	const box = await bounds(panel(page))
	expect(box.y).toBeGreaterThanOrEqual(0)
	expect(box.y + box.height).toBeLessThanOrEqual(anchor.y)
})

test('native centered placement works without anchor styles', async ({
	page
}) => {
	await page.addStyleTag({
		content:
			'#amount-info { position-area: none; position-anchor: none; inset: 0; margin: auto; }'
	})
	await trigger(page).click()
	const box = await bounds(panel(page))
	const viewport = page.viewportSize()
	if (!viewport) throw new Error('Expected a configured viewport')
	expect(box.x + box.width / 2).toBeCloseTo(viewport.width / 2, 0)
	expect(box.y + box.height / 2).toBeCloseTo(viewport.height / 2, 0)
})
