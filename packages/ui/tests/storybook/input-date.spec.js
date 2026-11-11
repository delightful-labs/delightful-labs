import { expect, test } from '@playwright/test'

/** @param {import('@playwright/test').Page} page @param {string} story */
async function openStory(page, story) {
	await page.goto(`/iframe.html?id=inputs-date--${story}&viewMode=story`)
	await expect(page.locator('input[type="date"]')).toBeVisible()
}

test('date-only FormData, empty submission and reset retain string values', async ({
	page
}) => {
	await openStory(page, 'form-submission')
	const field = page.getByLabel('Date', { exact: true })
	const result = page.locator('pre[aria-live="polite"]')
	await expect(field).toHaveValue('2026-10-13')
	await field.fill('2026-10-21')
	await page.getByRole('button', { name: 'Submit', exact: true }).click()
	await expect(result).toHaveText('[["date","2026-10-21"]]')
	await field.fill('')
	await page.getByRole('button', { name: 'Submit', exact: true }).click()
	await expect(result).toHaveText('[["date",""]]')
	await page.getByRole('button', { name: 'Reset', exact: true }).click()
	await expect(field).toHaveValue('2026-10-13')
})

test('optional binding follows edits, parent updates, clearing and reset', async ({
	page
}) => {
	await openStory(page, 'optional-binding')
	const field = page.getByLabel('Date', { exact: true })
	const output = page.getByRole('status', { name: 'Date value' })
	await expect(output).toHaveText('2026-10-13')
	await field.fill('2026-10-15')
	await expect(output).toHaveText('2026-10-15')
	await page.getByRole('button', { name: 'Set date' }).click()
	await expect(field).toHaveValue('2026-10-21')
	await page.getByRole('button', { name: 'Clear date' }).click()
	await expect(field).toHaveValue('')
	await expect(output).toHaveText('')
	await page.getByRole('button', { name: 'Reset', exact: true }).click()
	await expect(field).toHaveValue('2026-10-13')
	await expect(output).toHaveText('2026-10-13')
})

test('required, range and day-step constraints use native validity', async ({
	page
}) => {
	await openStory(page, 'constraints')
	const field = page.getByLabel('Date', { exact: true })
	const submit = page.getByRole('button', { name: 'Submit', exact: true })
	await submit.click()
	await expect(field).toBeFocused()
	for (const [value, flag] of [
		['', 'valueMissing'],
		['2026-09-29', 'rangeUnderflow'],
		['2026-11-02', 'rangeOverflow'],
		['2026-10-14', 'stepMismatch']
	]) {
		await field.fill(value)
		const validity = await field.evaluate((element) => {
			if (!(element instanceof HTMLInputElement))
				throw new Error('Expected date input')
			return {
				valueMissing: element.validity.valueMissing,
				rangeUnderflow: element.validity.rangeUnderflow,
				rangeOverflow: element.validity.rangeOverflow,
				stepMismatch: element.validity.stepMismatch
			}
		})
		expect(validity).toHaveProperty(flag, true)
		await submit.click()
		await expect(page.locator('pre[aria-live="polite"]')).toHaveText(
			'No submission yet.'
		)
	}
	await field.fill('2026-10-15')
	await submit.click()
	await expect(page.locator('pre[aria-live="polite"]')).toHaveText(
		'[["date","2026-10-15"]]'
	)
})

test('readonly dates remain successful while disabled dates are omitted', async ({
	page
}) => {
	for (const story of ['readonly', 'disabled']) {
		await openStory(page, story)
		const field = page.getByLabel('Date', { exact: true })
		await expect(field).not.toBeEditable()
		const entries = await field.evaluate((element) => {
			const form = document.createElement('form')
			element.parentNode?.insertBefore(form, element)
			form.append(element)
			return Array.from(new FormData(form))
		})
		expect(entries).toEqual(
			story === 'readonly' ? [['date', '2026-10-13']] : []
		)
	}
})

test('label focus and keyboard stepping retain date strings and narrow bounds', async ({
	page
}) => {
	await openStory(page, 'optional-binding')
	const field = page.getByLabel('Date', { exact: true })
	await page.locator('label').click()
	await expect(field).toBeFocused()
	await field.press('ArrowUp')
	await expect(field).not.toHaveValue('2026-10-13')
	const value = await field.inputValue()
	expect(value).toMatch(/^\d{4}-\d{2}-\d{2}$/)
	await expect(page.getByRole('status', { name: 'Date value' })).toHaveText(
		value
	)

	await page.setViewportSize({ width: 375, height: 800 })
	const box = await field.boundingBox()
	if (!box) throw new Error('Expected date input geometry')
	expect(box.x).toBeGreaterThanOrEqual(0)
	expect(box.x + box.width).toBeLessThanOrEqual(375)
})

test('date-only values are stable across browser timezone and locale settings', async ({
	browser,
	baseURL
}) => {
	for (const timezoneId of ['Pacific/Honolulu', 'Asia/Tokyo']) {
		const context = await browser.newContext({
			baseURL,
			timezoneId,
			locale: 'en-GB'
		})
		try {
			const page = await context.newPage()
			await openStory(page, 'form-submission')
			await expect(page.getByLabel('Date', { exact: true })).toHaveValue(
				'2026-10-13'
			)
			await page.getByRole('button', { name: 'Submit', exact: true }).click()
			await expect(page.locator('pre[aria-live="polite"]')).toHaveText(
				'[["date","2026-10-13"]]'
			)
		} finally {
			await context.close()
		}
	}
})
