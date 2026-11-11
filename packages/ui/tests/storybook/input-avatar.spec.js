import { expect, test } from '@playwright/test'

import {
	image,
	png,
	openImageInput as open,
	openPreview
} from './image-input-helpers.js'

test('selection, replacement, removal and preview URL cleanup', async ({
	page
}) => {
	await open(page)
	const input = page.getByLabel('Avatar', { exact: true })
	await input.setInputFiles(image())
	await expect(page.getByRole('status')).toHaveText('image.png')
	await expect(page.locator('img')).toBeVisible()
	await expect
		.poll(() =>
			page
				.locator('img')
				.evaluate((img) =>
					img instanceof HTMLImageElement ? img.naturalWidth : 0
				)
		)
		.toBe(1)
	await input.setInputFiles(image('replacement.png'))
	await expect(page.getByRole('status')).toHaveText('replacement.png')
	await openPreview(page, 'replacement.png')
	await page.getByRole('button', { name: 'Remove', exact: true }).focus()
	await page.keyboard.press('Enter')
	await expect(input).toBeFocused()
	await expect(page.getByRole('status')).toHaveText('No image')
	await expect(page.locator('img')).toHaveCount(0)
	await expect(input).toHaveValue('')
	await input.setInputFiles(image())
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

test('form submission, required validation, parent updates and reset', async ({
	page
}) => {
	await open(page)
	const input = page.getByLabel('Avatar', { exact: true })
	await page.getByRole('button', { name: 'Submit', exact: true }).click()
	await expect(input).toBeFocused()
	await expect(page.locator('pre[aria-live="polite"]')).toHaveText(
		'No submission yet.'
	)
	await input.setInputFiles(image())
	await page.getByRole('button', { name: 'Submit', exact: true }).click()
	await expect(page.locator('pre[aria-live="polite"]')).toHaveText(
		`image.png: ${png.length} bytes`
	)
	await page.getByRole('button', { name: 'Set image', exact: true }).click()
	await expect(page.getByRole('status')).toHaveText('parent.png')
	await expect(page.locator('img')).toHaveCount(0)
	await page.getByRole('button', { name: 'Submit', exact: true }).click()
	await expect(page.locator('pre[aria-live="polite"]')).toHaveText(
		'parent.png: 13 bytes'
	)
	await page.getByRole('button', { name: 'Clear image', exact: true }).click()
	await expect(input).toHaveValue('')
	await input.setInputFiles(image())
	await page.getByRole('button', { name: 'Reset', exact: true }).click()
	await expect(page.getByRole('status')).toHaveText('No image')
	await expect(input).toHaveValue('')
})

test('disabled selection and removal, label association and narrow layout', async ({
	page
}) => {
	await open(page)
	const input = page.getByLabel('Avatar', { exact: true })
	await input.click()
	await expect(input).toBeFocused()
	const filename = `${'long-image-filename-'.repeat(12)}.png`
	await input.setInputFiles(image(filename))
	await page.getByRole('button', { name: 'Toggle disabled' }).click()
	await expect(input).toBeDisabled()
	const dialog = await openPreview(page, filename)
	await expect(
		page.getByRole('button', { name: 'Remove', exact: true })
	).toBeDisabled()
	await dialog.getByRole('button', { name: 'Close', exact: true }).click()
	await page.getByRole('button', { name: 'Submit', exact: true }).click()
	await expect(page.locator('pre[aria-live="polite"]')).toHaveText(
		'No image field'
	)
	await page.setViewportSize({ width: 375, height: 800 })
	await expect(page.locator('img')).toBeVisible()
	for (const locator of [
		page.getByRole('button', {
			name: `File information: ${filename}`,
			exact: true
		}),
		page.locator('img')
	]) {
		const box = await locator.boundingBox()
		if (!box) throw new Error('Expected visible image input or preview')
		expect(box.x).toBeGreaterThanOrEqual(0)
		expect(box.x + box.width).toBeLessThanOrEqual(375)
	}
})

test('tile opens a preview with pointer and keyboard, with replacement inside the modal', async ({
	page
}) => {
	await open(page)
	const input = page.getByLabel('Avatar', { exact: true })
	// Seed the preview; the native chooser interaction under test is replacement below.
	await input.setInputFiles(image())
	const trigger = page.getByRole('button', {
		name: 'File information: image.png',
		exact: true
	})
	await trigger.click()
	const dialog = page.getByRole('dialog', { name: 'image.png', exact: true })
	await expect(
		dialog.getByRole('img', { name: 'image.png', exact: true })
	).toBeVisible()
	await page.keyboard.press('Escape')
	await expect(dialog).toBeHidden()
	await expect(trigger).toBeFocused()
	await trigger.press('Space')
	await expect(dialog).toBeVisible()
	const replacement = dialog.getByLabel('Avatar', { exact: true })
	await replacement.focus()
	await expect(replacement).toBeFocused()
	const picker = page.waitForEvent('filechooser')
	await replacement.press('Enter')
	await (await picker).setFiles(image('new-avatar.png'))
	await expect(dialog).toBeHidden()
	await expect(page.getByRole('status')).toHaveText('new-avatar.png')
})

test('single image replaces the picker in place without moving surrounding content', async ({
	page
}) => {
	await open(page)
	const input = page.getByLabel('Avatar', { exact: true })
	await expect(input).not.toHaveAttribute('multiple')
	const before = await input.boundingBox()
	const below = await page.getByRole('status').boundingBox()
	const picker = page.waitForEvent('filechooser')
	await input.focus()
	await page.keyboard.press('Enter')
	await (await picker).setFiles(image())
	await expect(page.locator('img')).toBeVisible()
	expect(await page.locator('img').boundingBox()).toEqual(
		await page
			.getByRole('button', { name: 'File information: image.png', exact: true })
			.boundingBox()
	)
	expect(
		await page
			.getByRole('button', { name: 'File information: image.png', exact: true })
			.boundingBox()
	).toEqual(before)
	await expect(page.locator('input[type="file"]')).toHaveCount(1)
	expect(await page.getByRole('status').boundingBox()).toEqual(below)
	await openPreview(page, 'image.png')
	await page.getByRole('button', { name: 'Remove', exact: true }).click()
	await expect(input).toBeFocused()
	await expect(input).toHaveValue('')
	expect(await input.boundingBox()).toEqual(before)
	expect(await page.getByRole('status').boundingBox()).toEqual(below)
})

test('visible field label names the input and button labels can be customized', async ({
	page
}) => {
	await page.goto('/iframe.html?id=inputs-avatar--custom-labels&viewMode=story')
	const input = page.getByLabel('Profile photo', { exact: true })
	await expect(input).toHaveAccessibleName('Profile photo')
	await expect(page.locator('label')).toHaveText('Profile photo')
	const picker = page.waitForEvent('filechooser')
	await page.locator('label').click()
	await (await picker).setFiles(image())
	await openPreview(page, 'image.png')
	await page.getByRole('button', { name: 'Delete photo', exact: true }).click()
	await expect(input).toBeFocused()
	await expect(input).toHaveValue('')
})
