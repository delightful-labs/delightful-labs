import { expect, test } from '@playwright/test'

/** @param {import('@playwright/test').Page} page @param {string} story */
async function openStory(page, story) {
	await page.goto(`/iframe.html?id=inputs-textarea--${story}&viewMode=story`)
	await expect(page.locator('textarea')).toBeVisible()
}

test('multiline FormData uses native text and reset restores defaults', async ({
	page
}) => {
	await openStory(page, 'form-submission')
	const field = page.getByRole('textbox', { name: 'Notes', exact: true })
	await expect(field).toHaveValue('First line\nSecond line')
	await field.fill('Edited line\nNext line')
	await page.getByRole('button', { name: 'Submit', exact: true }).click()
	await expect(page.locator('pre[aria-live="polite"]')).toHaveText(
		JSON.stringify([['notes', 'Edited line\nNext line']])
	)
	await page.getByRole('button', { name: 'Reset', exact: true }).click()
	await expect(field).toHaveValue('First line\nSecond line')
	await expect(page.locator('pre[aria-live="polite"]')).toHaveText(
		'No submission yet.'
	)
})

test('optional binding follows typing, external updates, clearing and reset', async ({
	page
}) => {
	await openStory(page, 'optional-binding')
	const field = page.getByRole('textbox', { name: 'Notes', exact: true })
	const output = page.getByRole('status', { name: 'Notes value' })
	await expect(field).toHaveValue('First line\nSecond line')
	await expect(output).toHaveText('First line\nSecond line')
	await field.fill('Typed notes')
	await expect(output).toHaveText('Typed notes')
	await page.getByRole('button', { name: 'Set value' }).click()
	await expect(field).toHaveValue('Updated by parent')
	await page.getByRole('button', { name: 'Clear value' }).click()
	await expect(field).toHaveValue('')
	await expect(output).toHaveText('')
	await page.getByRole('button', { name: 'Reset', exact: true }).click()
	await expect(field).toHaveValue('First line\nSecond line')
	await expect(output).toHaveText('First line\nSecond line')
})

test('required and length constraints use native validation and editing', async ({
	page
}) => {
	await openStory(page, 'required')
	const field = page.getByRole('textbox', { name: 'Notes' })
	await page.getByRole('button', { name: 'Submit', exact: true }).click()
	await expect(field).toBeFocused()
	expect(
		await field.evaluate(
			(element) =>
				element instanceof HTMLTextAreaElement && element.validity.valueMissing
		)
	).toBe(true)
	await field.pressSequentially('abc')
	await page.getByRole('button', { name: 'Submit', exact: true }).click()
	expect(
		await field.evaluate(
			(element) =>
				element instanceof HTMLTextAreaElement && element.validity.tooShort
		)
	).toBe(true)
	await field.fill('')
	await field.pressSequentially('x'.repeat(45))
	await expect(field).toHaveValue('x'.repeat(40))
	await page.getByRole('button', { name: 'Submit', exact: true }).click()
	await expect(page.locator('pre[aria-live="polite"]')).toHaveText(
		JSON.stringify([['notes', 'x'.repeat(40)]])
	)
})

test('readonly stays successful while disabled is omitted from native forms', async ({
	page
}) => {
	for (const story of ['readonly', 'disabled']) {
		await openStory(page, story)
		const field = page.getByRole('textbox', { name: 'Notes', exact: true })
		await expect(field).not.toBeEditable()
		const entries = await field.evaluate((element) => {
			const form = document.createElement('form')
			element.parentNode?.insertBefore(form, element)
			form.append(element)
			return Array.from(new FormData(form))
		})
		expect(entries).toEqual(
			story === 'readonly' ? [['notes', 'First line\nSecond line']] : []
		)
	}
})

test('label focus and multiline keyboard editing retain value and narrow bounds', async ({
	page
}) => {
	await openStory(page, 'form-submission')
	const field = page.getByRole('textbox', { name: 'Notes', exact: true })
	await page.locator('label').click()
	await expect(field).toBeFocused()
	await field.fill('Line')
	await field.press('End')
	await field.press('Enter')
	await field.pressSequentially('Next')
	await expect(field).toHaveValue('Line\nNext')

	await page.setViewportSize({ width: 375, height: 800 })
	const box = await field.boundingBox()
	if (!box) throw new Error('Expected textarea geometry')
	expect(box.x).toBeGreaterThanOrEqual(0)
	expect(box.x + box.width).toBeLessThanOrEqual(375)
})
