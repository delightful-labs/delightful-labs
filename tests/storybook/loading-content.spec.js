import { expect, test } from '@playwright/test'

test('loading excludes controls from keyboard navigation and releases them when ready', async ({
	page
}) => {
	await page.goto(
		'/iframe.html?id=feedback-loadingcontent--retained-content&viewMode=story'
	)
	const region = page.getByRole('region', { name: 'Editable content' })
	const toggle = page.getByRole('button', {
		name: 'Finish loading',
		exact: true
	})
	const draft = region.getByLabel('Draft', { exact: true })
	const after = page.getByRole('link', { name: 'Continue after content' })
	await expect(region).toHaveAttribute('aria-busy', 'true')
	await expect(region.getByRole('status')).toHaveText('Loading content')
	await expect(region.getByRole('textbox')).toHaveCount(0)
	await expect(draft).toBeAttached()
	await draft.evaluate((element) => element.focus())
	await expect(draft).not.toBeFocused()
	await toggle.focus()
	await toggle.press('Tab')
	await expect(after).toBeFocused()
	await toggle.click()
	await expect(region).toHaveAttribute('aria-busy', 'false')
	await expect(region.getByRole('status')).toHaveCount(0)
	const start = page.getByRole('button', { name: 'Start loading', exact: true })
	await expect(start).toBeFocused()
	await start.press('Tab')
	await expect(draft).toBeFocused()
	await draft.press('Tab')
	await expect(region.getByRole('button', { name: 'Save draft' })).toBeFocused()
})

test('repeated loading preserves the same mounted input, edited draft, and content geometry', async ({
	page
}) => {
	await page.goto(
		'/iframe.html?id=feedback-loadingcontent--retained-content&viewMode=story'
	)
	const region = page.getByRole('region', { name: 'Editable content' })
	const draft = region.getByLabel('Draft', { exact: true })
	await page
		.getByRole('button', { name: 'Finish loading', exact: true })
		.click()
	await draft.fill('A draft worth keeping')
	await draft.evaluate((element) =>
		element.setAttribute('data-retained', 'yes')
	)
	const position = () =>
		draft.evaluate((element) => {
			const root = element.closest('[role="region"]')
			if (!root) throw new Error('Missing content region')
			const control = element.getBoundingClientRect()
			const region = root.getBoundingClientRect()
			return {
				x: control.x - region.x,
				y: control.y - region.y,
				width: control.width,
				height: control.height
			}
		})
	const before = await position()
	for (let cycle = 0; cycle < 2; cycle += 1) {
		await page
			.getByRole('button', { name: 'Start loading', exact: true })
			.click()
		await expect(region).toHaveAttribute('aria-busy', 'true')
		expect(await position()).toEqual(before)
		await expect(draft).toHaveValue('A draft worth keeping')
		await expect(draft).toHaveAttribute('data-retained', 'yes')
		await page
			.getByRole('button', { name: 'Finish loading', exact: true })
			.click()
		await expect(region).toHaveAttribute('aria-busy', 'false')
		await expect(draft).toHaveValue('A draft worth keeping')
		await expect(draft).toHaveAttribute('data-retained', 'yes')
		expect(await position()).toEqual(before)
	}
})

test('standalone loading and error feedback use the existing status and alert semantics', async ({
	page
}) => {
	await page.goto(
		'/iframe.html?id=feedback-loadingcontent--standalone&viewMode=story'
	)
	await expect(page.getByRole('status')).toHaveText('Loading content')
	await expect(page.locator('[aria-busy]')).toHaveCount(0)
	await page.goto(
		'/iframe.html?id=feedback-loadingcontent--error&viewMode=story'
	)
	await expect(page.getByRole('alert')).toHaveText(
		'Content could not be opened'
	)
	await expect(page.getByRole('status')).toHaveCount(0)
	await expect(page.locator('[aria-busy]')).toHaveCount(0)
})
