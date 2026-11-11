import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
	await page.goto('/')
})

/** @param {import('@playwright/test').Page} page */
async function openDialog(page) {
	await page.getByRole('button', { name: 'Open dialog', exact: true }).click()
	const dialog = page.getByRole('dialog', {
		name: 'Review dialog',
		exact: true
	})
	await expect(dialog).toBeVisible()
	await expect(
		page.getByText('Dialog state: open', { exact: true })
	).toBeVisible()
	return dialog
}

test('modal focus, submission, reopening and Escape preserve native behavior', async ({
	page
}) => {
	const dialog = await openDialog(page)
	const note = dialog.getByRole('textbox', { name: 'Dialog note' })
	await expect(note).toBeFocused()
	expect(await dialog.evaluate((element) => element.matches(':modal'))).toBe(
		true
	)
	await note.fill('Edited')
	await dialog.getByRole('button', { name: 'Save dialog', exact: true }).click()
	await expect(
		page.getByText('Last dialog result: save', { exact: true })
	).toBeVisible()
	await expect(
		page.getByText('Dialog state: closed', { exact: true })
	).toBeVisible()
	await expect(
		page.getByRole('button', { name: 'Open dialog', exact: true })
	).toBeFocused()
	await openDialog(page)
	await expect(note).toHaveValue('Edited')
	await page.keyboard.press('Escape')
	await expect(
		page.getByText('Last dialog result: No return value', { exact: true })
	).toBeVisible()
	await expect(page.locator('#review-dialog')).not.toBeVisible()
})

test('native closure allows immediate reopening before queued close events', async ({
	page
}) => {
	const dialog = await openDialog(page)
	await dialog.evaluate((element) => {
		if (!(element instanceof HTMLDialogElement))
			throw new Error('Expected a native dialog')
		const opener = Array.from(document.querySelectorAll('button')).find(
			(button) => button.textContent?.trim() === 'Open dialog'
		)
		if (!opener) throw new Error('Expected the dialog opener')
		element.close()
		opener.click()
	})
	await expect(dialog).toBeVisible()
	await expect(
		page.getByText('Dialog state: open', { exact: true })
	).toBeVisible()
})

test('required validation blocks save while formnovalidate permits cancel', async ({
	page
}) => {
	const dialog = await openDialog(page)
	await dialog.getByRole('textbox', { name: 'Dialog note' }).fill('')
	await dialog.getByRole('button', { name: 'Save dialog', exact: true }).click()
	await expect(dialog).toBeVisible()
	await expect(dialog.getByRole('textbox')).toBeFocused()
	await dialog
		.getByRole('button', { name: 'Cancel dialog', exact: true })
		.click()
	await expect(
		page.getByText('Last dialog result: cancel', { exact: true })
	).toBeVisible()
	await expect(dialog).not.toBeVisible()
})

test('opening and Escape cancellation synchronize bound state', async ({
	page
}) => {
	await page
		.getByRole('button', { name: 'Prevent opening', exact: true })
		.click()
	await page.getByRole('button', { name: 'Open dialog', exact: true }).click()
	await expect(
		page.getByText('Dialog state: closed', { exact: true })
	).toBeVisible()
	await expect(page.locator('#review-dialog')).not.toBeVisible()
	await page
		.getByRole('button', { name: 'Prevent opening', exact: true })
		.click()
	const dialog = await openDialog(page)
	await dialog
		.getByRole('button', { name: 'Prevent Escape', exact: true })
		.click()
	await page.keyboard.press('Escape')
	await expect(dialog.getByRole('status')).toHaveText('Escape prevented')
	await expect(dialog).toBeVisible()
	await dialog
		.getByRole('button', { name: 'Cancel dialog', exact: true })
		.click()
	await expect(dialog).not.toBeVisible()
})

test('state closure and removal release modal focus and allow remounting', async ({
	page
}) => {
	let dialog = await openDialog(page)
	await dialog
		.getByRole('button', { name: 'Close with state', exact: true })
		.click()
	await expect(
		page.getByText('Dialog state: closed', { exact: true })
	).toBeVisible()
	await expect(
		page.getByRole('button', { name: 'Open dialog', exact: true })
	).toBeFocused()
	dialog = await openDialog(page)
	await dialog.getByRole('textbox').fill('Discarded')
	await dialog
		.getByRole('button', { name: 'Remove dialog', exact: true })
		.click()
	await expect(page.locator('#review-dialog')).toHaveCount(0)
	await expect(page.locator('dialog:modal')).toHaveCount(0)
	dialog = await openDialog(page)
	await expect(dialog.getByRole('textbox')).toHaveValue('Draft')
})

test('backdrop dismissal is opt-in and bound state follows native dismissal', async ({
	page
}) => {
	const dialog = await openDialog(page)
	await page.mouse.click(2, 2)
	await expect(dialog).toBeVisible()
	await page.keyboard.press('Escape')
	await expect(dialog).not.toBeVisible()
	await page
		.getByRole('button', { name: 'Open light-dismiss dialog', exact: true })
		.click()
	const light = page.getByRole('dialog', {
		name: 'Light-dismiss dialog',
		exact: true
	})
	await expect(light).toBeVisible()
	await page.mouse.click(2, 2)
	await expect(light).not.toBeVisible()
	await expect(
		page.getByText('Light-dismiss state: closed', { exact: true })
	).toBeVisible()
})
