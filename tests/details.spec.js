import { expect, test } from '@playwright/test'

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} summary
 */
function disclosure(page, summary) {
	return page
		.locator('details')
		.filter({ has: page.locator('summary').filter({ hasText: summary }) })
}

test.beforeEach(async ({ page }) => {
	await page.goto('/')
	await page
		.getByRole('heading', { name: 'Details', exact: true })
		.scrollIntoViewIfNeeded()
	await expect(
		page.getByText('Start panel: closed', { exact: true })
	).toBeVisible()
})

test('inline disclosure supports native keyboard activation and stays open outside', async ({
	page
}) => {
	const inline = disclosure(page, 'Inline details')
	const summary = inline.locator('summary')
	await expect(inline).toHaveAttribute('open', '')
	await summary.focus()
	await page.keyboard.press('Space')
	await expect(inline).not.toHaveAttribute('open')
	await page.keyboard.press('Enter')
	await expect(inline).toHaveAttribute('open', '')
	await page.keyboard.press('Tab')
	await expect(inline.getByRole('link')).toBeFocused()
	await page.getByRole('heading', { name: 'Details', exact: true }).click()
	await expect(inline).toHaveAttribute('open', '')
	await summary.focus()
	await page.keyboard.press('Escape')
	await expect(inline).toHaveAttribute('open', '')
})

test('bound absolute state follows external controls and the native summary', async ({
	page
}) => {
	const start = disclosure(page, 'Start-aligned panel')
	await page
		.getByRole('button', { name: 'Open start panel', exact: true })
		.click()
	await expect(start).toHaveAttribute('open', '')
	await expect(
		page.getByText('Start panel: open', { exact: true })
	).toBeVisible()
	await page
		.getByRole('button', { name: 'Close start panel', exact: true })
		.click()
	await expect(start).not.toHaveAttribute('open')
	await expect(
		page.getByText('Start panel: closed', { exact: true })
	).toBeVisible()
	await start.locator('summary').click()
	await expect(
		page.getByText('Start panel: open', { exact: true })
	).toBeVisible()
	await start.locator('summary').click()
	await expect(
		page.getByText('Start panel: closed', { exact: true })
	).toBeVisible()
})

test('absolute panels allow interior interaction and return focus on Escape', async ({
	page
}) => {
	const start = disclosure(page, 'Start-aligned panel')
	const summary = start.locator('summary')
	await summary.click()
	await start.getByRole('link', { name: 'View input examples' }).click()
	await expect(start).toHaveAttribute('open', '')
	await summary.focus()
	await page.keyboard.press('Tab')
	await expect(start.getByRole('link')).toBeFocused()
	await page.keyboard.press('Escape')
	await expect(start).not.toHaveAttribute('open')
	await expect(
		page.getByText('Start panel: closed', { exact: true })
	).toBeVisible()
	await expect(summary).toBeFocused()
})

test('outside-pointer dismissal leaves focus on the clicked destination', async ({
	page
}) => {
	const start = disclosure(page, 'Start-aligned panel')
	await start.locator('summary').click()
	await expect(start).toHaveAttribute('open', '')
	const destination = page
		.getByRole('button', { name: 'Save', exact: true })
		.first()
	await destination.click()
	await expect(start).not.toHaveAttribute('open')
	await expect(
		page.getByText('Start panel: closed', { exact: true })
	).toBeVisible()
	await expect(destination).toBeFocused()
	await expect(disclosure(page, 'Inline details')).toHaveAttribute('open', '')
})

test('native name grouping synchronizes bound state and toggle callbacks', async ({
	page
}) => {
	const start = disclosure(page, 'Start-aligned panel')
	const end = disclosure(page, 'End-aligned panel')
	await page
		.getByRole('button', { name: 'Open start panel', exact: true })
		.click()
	await expect(start).toHaveAttribute('open', '')
	await end.evaluate((element) => {
		if (element instanceof HTMLDetailsElement) element.open = true
	})
	await expect(end).toHaveAttribute('open', '')
	await expect(start).not.toHaveAttribute('open')
	await expect(
		page.getByText('Start panel: closed', { exact: true })
	).toBeVisible()
	await expect(
		page.getByText('End panel opened', { exact: true })
	).toBeVisible()
	await end.locator('summary').click()
	await expect(
		page.getByText('End panel closed', { exact: true })
	).toBeVisible()
})

test('absolute panels align without shifting flow at desktop and narrow widths', async ({
	page
}) => {
	for (const width of [1280, 375]) {
		await page.setViewportSize({ width, height: 800 })
		for (const label of ['Start-aligned panel', 'End-aligned panel']) {
			const details = disclosure(page, label)
			const summary = details.locator('summary')
			const control = page.getByRole('button', {
				name: 'Open start panel',
				exact: true
			})
			await summary.scrollIntoViewIfNeeded()
			// Document coordinates distinguish layout movement from browser scrolling.
			const documentTop = () =>
				control.evaluate(
					(element) => element.getBoundingClientRect().top + window.scrollY
				)
			const before = await documentTop()
			await summary.click()
			await expect(details).toHaveAttribute('open', '')
			await expect(
				page.getByText(
					label === 'Start-aligned panel'
						? 'Start panel: open'
						: 'End panel opened',
					{ exact: true }
				)
			).toBeVisible()
			const trigger = await summary.boundingBox()
			const panel = await details
				.getByRole('link', {
					name:
						label === 'Start-aligned panel'
							? 'View input examples'
							: 'View button examples'
				})
				.boundingBox()
			const after = await documentTop()
			if (!trigger || !panel)
				throw new Error('Expected visible disclosure geometry')
			expect(after).toBeCloseTo(before, 1)
			expect(panel.y).toBeGreaterThanOrEqual(trigger.y + trigger.height)

			expect(panel.x).toBeGreaterThanOrEqual(0)
			expect(panel.x + panel.width).toBeLessThanOrEqual(width)
			await summary.press('Escape')
			await expect(details).not.toHaveAttribute('open')
		}
	}
})
