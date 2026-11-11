import { expect, test } from '@playwright/test'

/** @param {import('@playwright/test').Page} page @param {string} story */
async function openStory(page, story) {
	await page.goto(`/iframe.html?id=inputs-checkbox--${story}&viewMode=story`)
	await expect(page.getByRole('checkbox')).toBeVisible()
}

test('checked values submit, unchecked values are omitted and reset restores the default', async ({
	page
}) => {
	await openStory(page, 'form-submission')
	const checkbox = page.getByRole('checkbox', {
		name: 'Receive updates',
		exact: true
	})
	const result = page.locator('pre[aria-live="polite"]')
	await expect(checkbox).toBeChecked()
	await page.getByRole('button', { name: 'Submit', exact: true }).click()
	await expect(result).toHaveText('[["updates","yes"]]')
	await checkbox.uncheck()
	await page.getByRole('button', { name: 'Submit', exact: true }).click()
	await expect(result).toHaveText('[]')
	await page.getByRole('button', { name: 'Reset', exact: true }).click()
	await expect(checkbox).toBeChecked()
	await expect(result).toHaveText('No submission yet.')
})

test('native default value is on and disabled checked controls remain omitted', async ({
	page
}) => {
	await openStory(page, 'form-submission')
	await page
		.getByRole('checkbox')
		.evaluate((element) => element.removeAttribute('value'))
	await page.getByRole('button', { name: 'Submit', exact: true }).click()
	await expect(page.locator('pre[aria-live="polite"]')).toHaveText(
		'[["updates","on"]]'
	)
	await openStory(page, 'disabled')
	const checkbox = page.getByRole('checkbox')
	await expect(checkbox).toBeChecked()
	await expect(checkbox).toBeDisabled()
	const entries = await checkbox.evaluate((element) => {
		const form = document.createElement('form')
		element.parentNode?.insertBefore(form, element)
		form.append(element)
		return Array.from(new FormData(form))
	})
	expect(entries).toEqual([])
})

test('required checkbox uses native validation before submission', async ({
	page
}) => {
	await openStory(page, 'required')
	const checkbox = page.getByRole('checkbox', {
		name: 'Accept the terms'
	})
	await expect(checkbox).not.toBeChecked()
	await page.getByRole('button', { name: 'Submit', exact: true }).click()
	await expect(checkbox).toBeFocused()
	expect(
		await checkbox.evaluate(
			(element) =>
				element instanceof HTMLInputElement && element.validity.valueMissing
		)
	).toBe(true)
	await expect(page.locator('pre[aria-live="polite"]')).toHaveText(
		'No submission yet.'
	)
	await checkbox.check()
	await page.getByRole('button', { name: 'Submit', exact: true }).click()
	await expect(page.locator('pre[aria-live="polite"]')).toHaveText(
		'[["accepted","yes"]]'
	)
})

test('optional binding follows user interaction, parent updates and reset', async ({
	page
}) => {
	await openStory(page, 'optional-binding')
	const checkbox = page.getByRole('checkbox')
	const output = page.getByRole('status', { name: 'Checked state' })
	await expect(output).toHaveText('true')
	await checkbox.uncheck()
	await expect(output).toHaveText('false')
	await page
		.getByRole('button', { name: 'Check from parent', exact: true })
		.click()
	await expect(checkbox).toBeChecked()
	await page
		.getByRole('button', { name: 'Uncheck from parent', exact: true })
		.click()
	await expect(checkbox).not.toBeChecked()
	await page.getByRole('button', { name: 'Reset', exact: true }).click()
	await expect(checkbox).toBeChecked()
	await expect(output).toHaveText('true')
})

test('clickable labels and Space preserve native focus and narrow layout', async ({
	page
}) => {
	await openStory(page, 'long-label')
	const checkbox = page.getByRole('checkbox')
	await page.locator('label span').click()
	await expect(checkbox).toBeChecked()
	await expect(checkbox).toBeFocused()
	await checkbox.press('Space')
	await expect(checkbox).not.toBeChecked()
	await expect(checkbox).toBeFocused()

	await page.setViewportSize({ width: 375, height: 800 })
	for (const element of [page.locator('label'), checkbox]) {
		const box = await element.boundingBox()
		if (!box) throw new Error('Expected visible checkbox geometry')
		expect(box.x).toBeGreaterThanOrEqual(0)
		expect(box.x + box.width).toBeLessThanOrEqual(375)
	}
})
