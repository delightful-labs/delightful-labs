import { expect, test } from '@playwright/test'
import {
	image,
	png,
	openImageInput,
	openPreview
} from './image-input-helpers.js'

/** @param {import('@playwright/test').Page} page */
async function open(page) {
	await openImageInput(page, 'images', 'Images')
	return page.getByLabel('Images', { exact: true })
}

test('adds images beside the picker, accumulates later selections, submits and removes one file', async ({
	page
}) => {
	const input = await open(page)
	await expect(input).toHaveAttribute('multiple', '')
	await page.getByRole('button', { name: 'Submit', exact: true }).click()
	await expect(input).toBeFocused()
	await expect(page.locator('pre[aria-live="polite"]')).toHaveText(
		'No submission yet.'
	)
	await input.setInputFiles([image('first.png'), image('second.png')])
	await expect(page.getByRole('status')).toHaveText('first.png, second.png')
	await expect(page.getByRole('img')).toHaveCount(2)
	const pickerBox = await input.boundingBox()
	for (const preview of await page.getByRole('img').all()) {
		const box = await preview.boundingBox()
		if (!box || !pickerBox) throw new Error('Missing preview or picker')
		expect(box.x + box.width).toBeLessThanOrEqual(pickerBox.x)
	}
	const chooser = page.waitForEvent('filechooser')
	await input.focus()
	await input.press('Enter')
	await (await chooser).setFiles(image('third.png'))
	await expect(page.getByRole('status')).toHaveText(
		'first.png, second.png, third.png'
	)
	await page.getByRole('button', { name: 'Submit', exact: true }).click()
	await expect(page.locator('pre[aria-live="polite"]')).toHaveText(
		['first.png', 'second.png', 'third.png']
			.map((name) => `${name}: ${png.length} bytes`)
			.join(', ')
	)
	const dialog = await openPreview(page, 'second.png')
	await expect(
		dialog.getByRole('img', { name: 'second.png', exact: true })
	).toBeVisible()
	await page
		.getByRole('button', { name: 'Remove image: second.png', exact: true })
		.focus()
	await page.keyboard.press('Enter')
	await expect(dialog).toBeHidden()
	await expect(input).toBeFocused()
	await expect(page.getByRole('status')).toHaveText('first.png, third.png')
	await page.getByRole('button', { name: 'Submit', exact: true }).click()
	await expect(page.locator('pre[aria-live="polite"]')).toHaveText(
		`first.png: ${png.length} bytes, third.png: ${png.length} bytes`
	)
})

test('parent updates, canceled reset and normal reset preserve the native file list contract', async ({
	page
}) => {
	const input = await open(page)
	await input.setInputFiles(image())
	await page.getByRole('checkbox', { name: 'Prevent reset' }).check()
	await page.getByRole('button', { name: 'Reset', exact: true }).click()
	await expect(page.getByRole('status')).toHaveText('image.png')
	await page.getByRole('button', { name: 'Set images' }).click()
	await expect(page.getByRole('status')).toHaveText('parent.png')
	await expect(page.getByRole('alert')).toHaveText('parent.png')
	await page.getByRole('button', { name: 'Submit', exact: true }).click()
	await expect(page.locator('pre[aria-live="polite"]')).toHaveText(
		'parent.png: 13 bytes'
	)
	await page.getByRole('checkbox', { name: 'Prevent reset' }).uncheck()
	await page.getByRole('button', { name: 'Reset', exact: true }).click()
	await expect(page.getByRole('status')).toHaveText('No images')
	await expect(input).toHaveValue('')
	await expect(page.getByRole('img')).toHaveCount(0)
})

test('disabled controls exclude files from submission and unmount releases every preview URL', async ({
	page
}) => {
	const input = await open(page)
	await input.setInputFiles([image('first.png'), image('second.png')])
	await page.getByRole('button', { name: 'Toggle disabled' }).click()
	await expect(input).toBeDisabled()
	let dialog = await openPreview(page, 'first.png')
	await expect(
		page.getByRole('button', { name: 'Remove image: first.png', exact: true })
	).toBeDisabled()
	await dialog.getByRole('button', { name: 'Close', exact: true }).click()
	dialog = await openPreview(page, 'second.png')
	await expect(
		page.getByRole('button', { name: 'Remove image: second.png', exact: true })
	).toBeDisabled()
	await page.keyboard.press('Escape')
	await expect(dialog).toBeHidden()
	await expect(
		page.getByRole('button', {
			name: 'File information: second.png',
			exact: true
		})
	).toBeFocused()
	await page.getByRole('button', { name: 'Submit', exact: true }).click()
	await expect(page.locator('pre[aria-live="polite"]')).toHaveText(
		'No image field'
	)
	await page.getByRole('button', { name: 'Toggle component' }).click()
	await expect
		.poll(() =>
			page.evaluate(() => {
				const { created, revoked } =
					/** @type {{imageUrls: {created: string[], revoked: string[]}}} */ (
						/** @type {unknown} */ (window)
					).imageUrls
				return (
					created.length > 0 && created.every((url) => revoked.includes(url))
				)
			})
		)
		.toBe(true)
})
