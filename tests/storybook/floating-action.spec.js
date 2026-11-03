import { expect, test } from '@playwright/test'

/** @param {import('@playwright/test').Page} page @param {string} story */
async function open(page, story) {
	await page.goto(
		`/iframe.html?id=actions-floatingaction--${story}&viewMode=story`
	)
}

test('link has an accessible name and decorative icon, and supports keyboard navigation', async ({
	page
}) => {
	await open(page, 'link')
	const link = page.getByRole('link', { name: 'Add an item', exact: true })
	await expect(link).toHaveAttribute('href', '#new-item')
	await expect(link).toHaveAttribute('title', 'Add an item')
	await expect(link.locator('svg')).toHaveAttribute('aria-hidden', 'true')
	await link.focus()
	await link.press('Enter')
	await expect(page).toHaveURL(/#new-item$/)
})

test('link middle-click uses the browser new-tab behavior', async ({
	page,
	context
}) => {
	await open(page, 'link')
	const nextPage = context.waitForEvent('page')
	await page
		.getByRole('link', { name: 'Add an item' })
		.click({ button: 'middle' })
	const opened = await nextPage
	await expect(opened).toHaveURL(/#new-item$/)
	await expect(page).not.toHaveURL(/#new-item$/)
	await opened.close()
})

test('button callbacks activate through both Enter and Space without link semantics', async ({
	page
}) => {
	await open(page, 'button')
	const button = page.getByRole('button', { name: 'Add an item' })
	await expect(button).toHaveAttribute('type', 'button')
	await expect(page.getByRole('link')).toHaveCount(0)
	await expect(page.getByRole('status')).toHaveText('Actions: 0')
	await button.focus()
	await button.press('Enter')
	await expect(page.getByRole('status')).toHaveText('Actions: 1')
	await button.press('Space')
	await expect(page.getByRole('status')).toHaveText('Actions: 2')
})

test('disabled button cannot receive keyboard focus or dispatch a native click', async ({
	page
}) => {
	await open(page, 'disabled')
	const button = page.getByRole('button', { name: 'Add an item' })
	await expect(button).toBeDisabled()
	await button.evaluate((element) => {
		if (!(element instanceof HTMLButtonElement))
			throw new Error('Expected native button')
		element.addEventListener('click', () =>
			element.setAttribute('data-activated', 'yes')
		)
		element.focus()
		element.click()
	})
	await expect(button).not.toBeFocused()
	await expect(button).not.toHaveAttribute('data-activated')
})

test('explicit submit respects native form validation and submits when valid', async ({
	page
}) => {
	await open(page, 'form-submission')
	const input = page.getByRole('textbox', { name: 'Item name' })
	const save = page.getByRole('button', { name: 'Save item' })
	await save.click()
	await expect(input).toBeFocused()
	await expect(page.getByRole('status')).toHaveText('Submissions: 0')
	await input.fill('New item')
	await save.focus()
	await save.press('Enter')
	await expect(page.getByRole('status')).toHaveText('Submissions: 1')
})

test('floating link stays within its scrolling region at narrow widths', async ({
	page
}) => {
	await page.setViewportSize({ width: 320, height: 700 })
	await open(page, 'scrolling-content')
	const region = page.getByRole('region', { name: 'Scrollable content' })
	const action = region.getByRole('link', { name: 'Add an item' })
	await expect(action).toBeVisible()
	for (const end of [false, true]) {
		await region.evaluate((element, end) => {
			element.scrollTop = end ? element.scrollHeight : 0
		}, end)
		const container = await region.boundingBox()
		const control = await action.boundingBox()
		if (!container || !control)
			throw new Error('Expected scroll region and action geometry')
		expect(control.x).toBeGreaterThanOrEqual(container.x)
		expect(control.y).toBeGreaterThanOrEqual(container.y)
		expect(control.x + control.width).toBeLessThanOrEqual(
			container.x + container.width
		)
		expect(control.y + control.height).toBeLessThanOrEqual(
			container.y + container.height
		)
		expect(control.width).toBeGreaterThanOrEqual(44)
		expect(control.height).toBeGreaterThanOrEqual(44)
	}
	expect(
		await page.evaluate(() => document.documentElement.scrollWidth)
	).toBeLessThanOrEqual(320)
})
