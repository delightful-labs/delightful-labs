import { expect, test } from '@playwright/test'

const articleName = 'Read Building a local library'

/** @param {import('@playwright/test').Page} page */
async function articles(page) {
	await page.goto(
		'/iframe.html?id=layout-linkedlistrow--articles&viewMode=story'
	)
	return page.getByRole('list', { name: 'Saved articles' })
}

test('each native list row has one link and one keyboard stop', async ({
	page
}) => {
	const list = await articles(page)
	await expect(list.getByRole('listitem')).toHaveCount(2)
	await expect(list.getByRole('link')).toHaveCount(2)
	const first = list.getByRole('link', { name: articleName, exact: true })
	const second = list.getByRole('link', {
		name: 'Read An article without progress',
		exact: true
	})
	await expect(first).toContainText('35%')
	await expect(second).not.toContainText('%')
	await expect(first.locator('svg')).toHaveAttribute('aria-hidden', 'true')
	await first.focus()
	await first.press('Tab')
	await expect(second).toBeFocused()
	await second.press('Enter')
	await expect(page).toHaveURL(/#another-article$/)
})

test('the padding around row content is part of its native link target', async ({
	page
}) => {
	const list = await articles(page)
	const link = list.getByRole('link', { name: articleName, exact: true })
	const bounds = await link.boundingBox()
	if (!bounds) throw new Error('Expected a visible row link')
	const point = { x: bounds.x + 2, y: bounds.y + 2 }
	expect(
		await page.evaluate(
			({ x, y }) => document.elementFromPoint(x, y)?.tagName,
			point
		)
	).toBe('A')
	await page.mouse.click(point.x, point.y)
	await expect(page).toHaveURL(/#saved-article$/)
})

test('middle-click retains the browser option to open the destination in another tab', async ({
	page,
	context
}) => {
	const list = await articles(page)
	const popup = context.waitForEvent('page')
	await list
		.getByRole('link', { name: articleName, exact: true })
		.click({ button: 'middle' })
	const opened = await popup
	await expect(opened).toHaveURL(/#saved-article$/)
	await expect(page).not.toHaveURL(/#saved-article$/)
	await opened.close()
})

test('long content and metadata remain within a narrow viewport', async ({
	page
}) => {
	await page.setViewportSize({ width: 320, height: 700 })
	await page.goto(
		'/iframe.html?id=layout-linkedlistrow--long-content&viewMode=story'
	)
	const link = page.getByRole('link', { name: /^Read A longer article title/ })
	await expect(link).toContainText('100%')
	await link.focus()
	await expect(link).toBeFocused()
	await expect(link).toBeInViewport()
	const box = await link.boundingBox()
	if (!box) throw new Error('Expected a visible row link')
	expect(box.x).toBeGreaterThanOrEqual(0)
	expect(box.x + box.width).toBeLessThanOrEqual(320)
	expect(
		await link.evaluate((element) => element.scrollWidth <= element.clientWidth)
	).toBe(true)
	expect(
		await page.evaluate(() => document.documentElement.scrollWidth)
	).toBeLessThanOrEqual(320)
})
