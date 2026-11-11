import { expect, test } from '@playwright/test'

/** @param {import('@playwright/test').Page} page @param {string} story */
async function openStory(page, story) {
	await page.goto(`/iframe.html?id=${story}&viewMode=story`)
	await expect(page.locator('select').first()).toBeVisible()
}

test('single selection submits native FormData and resets to its default', async ({
	page
}) => {
	await openStory(page, 'inputs-select--form-submission')
	const select = page.getByRole('combobox', { name: 'Category' })
	await expect(select).toHaveValue('personal')
	await expect(select.locator('optgroup')).toHaveAttribute(
		'label',
		'Categories'
	)
	await expect(select.locator('option[value="unavailable"]')).toBeDisabled()
	await select.selectOption('work')
	await page.getByRole('button', { name: 'Submit', exact: true }).click()
	await expect(page.locator('pre[aria-live="polite"]')).toHaveText(
		'[["category","work"]]'
	)
	await page.getByRole('button', { name: 'Reset', exact: true }).click()
	await expect(select).toHaveValue('personal')
	await expect(page.locator('pre[aria-live="polite"]')).toHaveText(
		'No submission yet.'
	)
})

test('required placeholder uses native validation and disabled select is omitted from FormData', async ({
	page
}) => {
	await openStory(page, 'inputs-select--required')
	const select = page.getByRole('combobox', { name: 'Category' })
	await expect(select).toHaveValue('')
	await page.getByRole('button', { name: 'Submit', exact: true }).click()
	await expect(select).toBeFocused()
	expect(
		await select.evaluate(
			(element) =>
				element instanceof HTMLSelectElement && element.validity.valueMissing
		)
	).toBe(true)
	await select.selectOption('personal')
	expect(
		await select.evaluate(
			(element) =>
				element instanceof HTMLSelectElement && element.checkValidity()
		)
	).toBe(true)
	await openStory(page, 'inputs-select--disabled')
	const disabled = page.getByRole('combobox', { name: 'Category' })
	await expect(disabled).toBeDisabled()
	const entries = await disabled.evaluate((element) => {
		const form = document.createElement('form')
		element.parentNode?.insertBefore(form, element)
		form.append(element)
		return Array.from(new FormData(form))
	})
	expect(entries).toEqual([])
})

test('multiple selection submits repeated entries and resets defaults', async ({
	page
}) => {
	await openStory(page, 'inputs-select--multiple')
	const select = page.getByRole('listbox', { name: 'Category' })
	await expect(select).toHaveValues(['personal'])
	await select.selectOption(['personal', 'other'])
	await page.getByRole('button', { name: 'Submit', exact: true }).click()
	await expect(page.locator('pre[aria-live="polite"]')).toHaveText(
		'[["category","personal"],["category","other"]]'
	)
	await page.getByRole('button', { name: 'Reset', exact: true }).click()
	await expect(select).toHaveValues(['personal'])
})

test('optional bindings follow native edits, external state and reset', async ({
	page
}) => {
	await openStory(page, 'tests-selectbindings--default')
	const single = page.getByRole('combobox', { name: 'Bound category' })
	const multiple = page.getByRole('listbox', { name: 'Bound channels' })
	const singleState = page.getByRole('status', { name: 'Category state' })
	const multipleState = page.getByRole('status', { name: 'Channels state' })
	await expect(single).toHaveValue('other')
	await expect(multiple).toHaveValues(['work'])
	await expect(multipleState).toHaveText('["work"]')
	await single.selectOption('work')
	await expect(singleState).toHaveText('work')
	await multiple.selectOption(['personal', 'work'])
	await expect(multipleState).toHaveText('["personal","work"]')
	await page.getByRole('button', { name: 'Set selections' }).click()
	await expect(single).toHaveValue('personal')
	await expect(multiple).toHaveValues(['personal', 'other'])
	await page.getByRole('button', { name: 'Clear channels' }).click()
	await expect(multiple).toHaveValues([])
	await expect(multipleState).toHaveText('[]')
	await page.getByRole('button', { name: 'Reset bindings' }).click()
	await expect(single).toHaveValue('work')
	await expect(singleState).toHaveText('work')
	await expect(multiple).toHaveValues(['work'])
	await expect(multipleState).toHaveText('["work"]')
})

test('label and keyboard interaction fit narrow viewports', async ({
	page
}) => {
	await openStory(page, 'inputs-select--form-submission')
	const select = page.getByRole('combobox', { name: 'Category' })
	await page.locator('label').click()
	await expect(select).toBeFocused()
	await select.press('w')
	await expect(select).toHaveValue('work')

	await page.setViewportSize({ width: 375, height: 800 })
	const box = await select.boundingBox()
	if (!box) throw new Error('Expected visible select geometry')
	expect(box.x).toBeGreaterThanOrEqual(0)
	expect(box.x + box.width).toBeLessThanOrEqual(375)
})
