import { expect, test } from '@playwright/test'

const png = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=',
	'base64'
)
const image = (name = 'image.png') => ({
	name,
	mimeType: 'image/png',
	buffer: png
})

/** @param {import('@playwright/test').Page} page */
async function open(page) {
	await page.addInitScript(() => {
		const tracked = Object.assign(window, {
			imageUrls: {
				created: /** @type {string[]} */ ([]),
				revoked: /** @type {string[]} */ ([])
			}
		})
		const create = URL.createObjectURL.bind(URL)
		const revoke = URL.revokeObjectURL.bind(URL)
		URL.createObjectURL = (file) => {
			const url = create(file)
			tracked.imageUrls.created.push(url)
			return url
		}
		URL.revokeObjectURL = (url) => {
			tracked.imageUrls.revoked.push(url)
			revoke(url)
		}
	})
	await page.goto('/iframe.html?id=inputs-image--bound-form&viewMode=story')
	await expect(page.getByLabel('Image', { exact: true })).toBeVisible()
}

test('selection, replacement, removal and preview URL cleanup', async ({
	page
}) => {
	await open(page)
	const input = page.getByLabel('Image', { exact: true })
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
	await page.getByRole('button', { name: 'Remove image', exact: true }).focus()
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
	const input = page.getByLabel('Image', { exact: true })
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
	const input = page.getByLabel('Image', { exact: true })
	await page.locator('label').click()
	await expect(input).toBeFocused()
	const filename = `${'long-image-filename-'.repeat(12)}.png`
	await input.setInputFiles(image(filename))
	await page.getByRole('button', { name: 'Toggle disabled' }).click()
	await expect(input).toBeDisabled()
	await expect(
		page.getByRole('button', { name: 'Remove image', exact: true })
	).toBeDisabled()
	await page.getByRole('button', { name: 'Submit', exact: true }).click()
	await expect(page.locator('pre[aria-live="polite"]')).toHaveText(
		'No image field'
	)
	await page.setViewportSize({ width: 375, height: 800 })
	await expect(page.locator('img')).toBeVisible()
	for (const locator of [input, page.locator('img')]) {
		const box = await locator.boundingBox()
		if (!box) throw new Error('Expected visible image input or preview')
		expect(box.x).toBeGreaterThanOrEqual(0)
		expect(box.x + box.width).toBeLessThanOrEqual(375)
	}
})
