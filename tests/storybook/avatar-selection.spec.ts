import { expect, test, type Page } from '@playwright/test'
import { resolve } from 'node:path'

declare global {
	interface Window {
		DLFAvatarSelection: { mountFixture: (target: HTMLElement) => void }
	}
}
const image = {
	name: 'picked.png',
	mimeType: 'image/png',
	buffer: Buffer.from(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
		'base64'
	)
}
async function open(page: Page) {
	await page.goto('/')
	await page.addStyleTag({
		path: resolve('.svelte-kit/avatar-selection-browser/delightful-local-first.css')
	})
	await page.addScriptTag({
		path: resolve('.svelte-kit/avatar-selection-browser/avatar-selection.js')
	})
	await page.evaluate(() => {
		const target = document.createElement('main')
		document.body.replaceChildren(target)
		window.DLFAvatarSelection.mountFixture(target)
	})
}
test('DUI selection, native dismissal and crop acceptance update the bound form', async ({
	page
}) => {
	await open(page)
	const dialog = page.getByRole('dialog', { name: 'Crop avatar' })
	await page.locator('input[type=file]').setInputFiles(image)
	await expect(dialog).toBeVisible()
	await page.keyboard.press('Escape')
	await expect(dialog).toHaveCount(0)
	await expect(page.getByRole('status', { name: 'Selected file' })).toHaveText('unchanged')
	await page.locator('input[type=file]').setInputFiles(image)
	await dialog.getByRole('button', { name: 'Accept crop' }).click()
	await expect(dialog).toHaveCount(0)
	await expect(page.getByRole('status', { name: 'Selected file' })).toHaveText('picked.png')
	await expect(page.getByRole('button', { name: 'Save avatar', exact: true })).toBeVisible()
	await page.getByRole('button', { name: 'Reset draft' }).click()
	await expect(page.getByRole('button', { name: 'Save avatar', exact: true })).toHaveCount(0)
	await expect(page.locator('input[type=file]')).toHaveJSProperty('value', '')
})
test('profile replacement rejects old crop callbacks, invalid files report feedback, and unmount closes the dialog', async ({
	page
}) => {
	await open(page)
	const dialog = page.getByRole('dialog', { name: 'Crop avatar' })
	await page.locator('input[type=file]').setInputFiles(image)
	await dialog.getByRole('button', { name: 'Remember crop' }).click()
	await page
		.getByRole('button', { name: 'Change profile' })
		.evaluate((button: HTMLButtonElement) => button.click())
	await expect(dialog).toHaveCount(0)
	await page.getByRole('button', { name: 'Finish old crop' }).click()
	await expect(page.getByRole('status', { name: 'Selected file' })).toHaveText('unchanged')
	await page
		.locator('input[type=file]')
		.setInputFiles({ name: 'bad.txt', mimeType: 'text/plain', buffer: Buffer.from('bad') })
	await expect(page.getByRole('alert')).toHaveText('Invalid image')
	await expect(page.getByRole('status', { name: 'Selected file' })).toHaveText('none')
	await page.locator('input[type=file]').setInputFiles(image)
	await expect(dialog).toBeVisible()
	await page
		.getByRole('button', { name: 'Unmount form' })
		.evaluate((button: HTMLButtonElement) => button.click())
	await expect(dialog).toHaveCount(0)
})
