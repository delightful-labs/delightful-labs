import { expect, test } from '@playwright/test'

/** @param {import('@playwright/test').Page} page @param {string} story */
async function openStory(page, story) {
	await page.goto(`/iframe.html?id=inputs-radiogroup--${story}&viewMode=story`)
	await expect(page.getByRole('radio').first()).toBeVisible()
}

/** @param {import('@playwright/test').Page} page */
async function openExternalForm(page) {
	await page.goto(
		'/iframe.html?id=tests-radiogroup--external-form&viewMode=story'
	)
	await expect(page.getByRole('group', { name: 'External view' })).toBeVisible()
}

test('only the selected value submits and reset restores the default', async ({
	page
}) => {
	await openStory(page, 'form-submission')
	const result = page.locator('pre[aria-live="polite"]')
	const week = page.getByRole('radio', { name: 'Week', exact: true })
	const month = page.getByRole('radio', { name: 'Month', exact: true })
	await expect(
		page.getByRole('group', { name: 'View', exact: true })
	).toBeVisible()
	await expect(week).toBeChecked()
	await page.getByRole('button', { name: 'Submit', exact: true }).click()
	await expect(result).toHaveText('[["view","week"]]')
	await month.check()
	await expect(week).not.toBeChecked()
	await page.getByRole('button', { name: 'Submit', exact: true }).click()
	await expect(result).toHaveText('[["view","month"]]')
	await page.getByRole('button', { name: 'Reset', exact: true }).click()
	await expect(week).toBeChecked()
	await expect(month).not.toBeChecked()
})

test('Space selects an unselected option and arrows move, wrap and skip disabled options', async ({
	page
}) => {
	await openStory(page, 'no-selection')
	await expect(page.locator('input[type="radio"]:checked')).toHaveCount(0)
	await page.keyboard.press('Tab')
	const day = page.getByRole('radio', { name: 'Day', exact: true })
	const week = page.getByRole('radio', { name: 'Week', exact: true })
	await expect(day).toBeFocused()
	await day.press('Space')
	await expect(day).toBeChecked()
	await day.press('ArrowRight')
	await expect(week).toBeFocused()
	await expect(week).toBeChecked()
	await expect(day).not.toBeChecked()

	await openStory(page, 'disabled-option')
	const month = page.getByRole('radio', { name: 'Month', exact: true })
	await expect(week).toBeDisabled()
	await day.focus()
	await day.press('ArrowRight')
	await expect(month).toBeFocused()
	await expect(month).toBeChecked()
	await month.press('ArrowRight')
	await expect(day).toBeFocused()
	await expect(day).toBeChecked()
	await day.press('ArrowLeft')
	await expect(month).toBeFocused()
	await expect(month).toBeChecked()
})

test('required selection uses native form validation', async ({ page }) => {
	await openStory(page, 'required')
	const day = page.getByRole('radio', { name: 'Day', exact: true })
	const result = page.locator('pre[aria-live="polite"]')
	await page.getByRole('button', { name: 'Submit', exact: true }).click()
	await expect(day).toBeFocused()
	expect(
		await day.evaluate(
			(element) =>
				element instanceof HTMLInputElement && element.validity.valueMissing
		)
	).toBe(true)
	await expect(result).toHaveText('No submission yet.')
	await day.check()
	await page.getByRole('button', { name: 'Submit', exact: true }).click()
	await expect(result).toHaveText('[["view","day"]]')
})

test('binding follows user selection, parent changes, clearing and reset', async ({
	page
}) => {
	await openStory(page, 'optional-binding')
	const selected = page.getByRole('status', { name: 'Selected view' })
	await expect(selected).toHaveText('week')
	await page.getByRole('radio', { name: 'Day', exact: true }).check()
	await expect(selected).toHaveText('day')
	await page.getByRole('button', { name: 'Select month from parent' }).click()
	await expect(
		page.getByRole('radio', { name: 'Month', exact: true })
	).toBeChecked()
	await expect(selected).toHaveText('month')
	await page
		.getByRole('button', { name: 'Clear selection', exact: true })
		.click()
	await expect(page.locator('input[type="radio"]:checked')).toHaveCount(0)
	await expect(selected).toHaveText('None')
	await page.getByRole('button', { name: 'Reset', exact: true }).click()
	await expect(
		page.getByRole('radio', { name: 'Week', exact: true })
	).toBeChecked()
	await expect(selected).toHaveText('week')
})

test('generated names keep separate groups independent', async ({ page }) => {
	await openStory(page, 'independent-groups')
	const calendar = page.getByRole('group', { name: 'Calendar view' })
	const report = page.getByRole('group', { name: 'Report view' })
	await calendar.getByRole('radio', { name: 'Week', exact: true }).check()
	await expect(
		calendar.getByRole('radio', { name: 'Week', exact: true })
	).toBeChecked()
	await expect(
		report.getByRole('radio', { name: 'Month', exact: true })
	).toBeChecked()
	await report.getByRole('radio', { name: 'Day', exact: true }).check()
	await expect(
		calendar.getByRole('radio', { name: 'Week', exact: true })
	).toBeChecked()
	await expect(
		report.getByRole('radio', { name: 'Day', exact: true })
	).toBeChecked()
})

test('disabled groups retain selection and prevent interaction', async ({
	page
}) => {
	await openStory(page, 'disabled')
	for (const radio of await page.getByRole('radio').all())
		await expect(radio).toBeDisabled()
	await expect(
		page.getByRole('radio', { name: 'Week', exact: true })
	).toBeChecked()
	await page
		.getByRole('radio', { name: 'Day', exact: true })
		.click({ force: true })
	await expect(
		page.getByRole('radio', { name: 'Week', exact: true })
	).toBeChecked()
	await expect(
		page.getByRole('radio', { name: 'Day', exact: true })
	).not.toBeChecked()
})

test('long button labels remain reachable within a narrow viewport', async ({
	page
}) => {
	await page.setViewportSize({ width: 320, height: 800 })
	await openStory(page, 'long-labels')
	for (const radio of await page.getByRole('radio').all()) {
		const box = await radio.boundingBox()
		if (!box) throw new Error('Expected visible radio geometry')
		expect(box.x).toBeGreaterThanOrEqual(0)
		expect(box.x + box.width).toBeLessThanOrEqual(320)
		await radio.click()
		await expect(radio).toBeChecked()
		await expect(radio).toBeFocused()
	}
})

test('external form submits explicit initial values, forwards changes and restores defaults', async ({
	page
}) => {
	await openExternalForm(page)
	const result = page.locator('pre[aria-live="polite"]')
	const selected = page.getByRole('status', { name: 'Selected view' })
	await expect(
		page.getByRole('radio', { name: 'Month', exact: true })
	).toBeChecked()
	await page.getByRole('button', { name: 'Submit', exact: true }).click()
	await expect(result).toHaveText('[["view","month"]]')
	await page.getByRole('radio', { name: 'Day', exact: true }).check()
	await expect(selected).toHaveText('day')
	await expect(page.getByRole('status', { name: 'Last change' })).toHaveText(
		'view:day'
	)
	await page.getByRole('button', { name: 'Reset', exact: true }).click()
	await expect(
		page.getByRole('radio', { name: 'Week', exact: true })
	).toBeChecked()
	await expect(selected).toHaveText('week')
	await page.getByRole('button', { name: 'Submit', exact: true }).click()
	await expect(result).toHaveText('[["view","week"]]')
})

test('cancelled resets preserve selection and binding', async ({ page }) => {
	await openExternalForm(page)
	await page.getByRole('checkbox', { name: 'Cancel reset' }).check()
	await page.getByRole('radio', { name: 'Day', exact: true }).check()
	await page.getByRole('button', { name: 'Reset', exact: true }).click()
	await expect(
		page.getByRole('radio', { name: 'Day', exact: true })
	).toBeChecked()
	await expect(page.getByRole('status', { name: 'Selected view' })).toHaveText(
		'day'
	)
	await page.getByRole('checkbox', { name: 'Cancel reset' }).uncheck()
	await page.getByRole('button', { name: 'Reset', exact: true }).click()
	await expect(
		page.getByRole('radio', { name: 'Week', exact: true })
	).toBeChecked()
	await expect(page.getByRole('status', { name: 'Selected view' })).toHaveText(
		'week'
	)
})

test('disabled and unselected groups are omitted from form submission', async ({
	page
}) => {
	await openExternalForm(page)
	const result = page.locator('pre[aria-live="polite"]')
	await page
		.getByRole('button', { name: 'Toggle disabled', exact: true })
		.click()
	for (const radio of await page.getByRole('radio').all())
		await expect(radio).toBeDisabled()
	await page.getByRole('button', { name: 'Submit', exact: true }).click()
	await expect(result).toHaveText('[]')
	await page
		.getByRole('button', { name: 'Toggle disabled', exact: true })
		.click()
	await page
		.getByRole('button', { name: 'Remove default', exact: true })
		.click()
	await page.getByRole('button', { name: 'Reset', exact: true }).click()
	await expect(page.locator('input[type="radio"]:checked')).toHaveCount(0)
	await expect(page.getByRole('status', { name: 'Selected view' })).toHaveText(
		'None'
	)
	await page.getByRole('button', { name: 'Submit', exact: true }).click()
	await expect(result).toHaveText('[]')
})
