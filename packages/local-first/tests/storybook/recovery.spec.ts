import { expect, test } from '@playwright/test'
import { createRecoveryMessages } from '../../src/lib/localization/recovery.js'

const messages = createRecoveryMessages('en')
const syntheticPhrase = 'storybook demonstration only — this is not a real recovery phrase'
const story = (name: string) => `/iframe.html?id=identity-recovery-phrase--${name}&viewMode=story`

for (const dismissal of ['close', 'escape', 'backdrop']) {
	test(`reveals and clears the phrase after ${dismissal}`, async ({ page }) => {
		await page.goto(story('reveal-and-close'))
		const show = page.getByRole('button', { name: messages.show, exact: true })
		await show.click()
		const dialog = page.getByRole('dialog', { name: messages.heading })
		const phrase = dialog.getByRole('textbox', { name: messages.phraseLabel })
		const close = dialog.getByRole('button', { name: messages.close, exact: true })
		await expect(dialog).toHaveAccessibleDescription(messages.warning)
		await expect(dialog.getByText(messages.warning, { exact: true })).toBeFocused()
		await expect(phrase).toHaveValue(syntheticPhrase)
		await expect(phrase).not.toBeEditable()
		await expect(dialog.getByRole('checkbox')).toHaveCount(0)
		await expect(close).toBeEnabled()
		const phraseBounds = await phrase.boundingBox()
		const closeBounds = await close.boundingBox()
		if (!phraseBounds || !closeBounds) throw new Error('Recovery controls are not visible')
		expect(closeBounds.y).toBeGreaterThanOrEqual(phraseBounds.y + phraseBounds.height)
		if (dismissal === 'close') await close.click()
		if (dismissal === 'escape') await page.keyboard.press('Escape')
		if (dismissal === 'backdrop') await page.mouse.click(1, 1)
		await expect(dialog).toHaveCount(0)
		await expect(page.getByRole('textbox', { name: messages.phraseLabel })).toHaveCount(0)
		await expect(show).toBeFocused()
		await show.click()
		await expect(page.getByRole('dialog', { name: messages.heading })).toBeVisible()
	})
}

test('reports unavailable recovery without a dialog or editable secret', async ({ page }) => {
	await page.goto(story('unavailable'))
	await expect(page.getByRole('button', { name: messages.show, exact: true })).toBeDisabled()
	await expect(page.getByRole('status')).toHaveText(messages.unavailable)
	await expect(page.getByRole('dialog')).toHaveCount(0)
	await expect(page.getByRole('textbox')).toHaveCount(0)
})

test('announces one sanitized failure and retries after the host recovers', async ({ page }) => {
	await page.goto(story('retry-a-failure'))
	await page.getByRole('button', { name: messages.show, exact: true }).click()
	await expect(page.getByRole('alert')).toHaveText(messages.failure)
	await expect(page.getByRole('alert')).toHaveCount(1)
	await expect(page.getByText('Synthetic recovery failure', { exact: true })).toHaveCount(0)
	await page.getByRole('button', { name: 'Allow recovery', exact: true }).click()
	await page.getByRole('button', { name: messages.retry, exact: true }).click()
	await expect(page.getByRole('dialog', { name: messages.heading })).toBeVisible()
	await expect(page.getByRole('alert')).toHaveCount(0)
})

test('gives independent instances distinct field and description IDs', async ({ page }) => {
	await page.goto(story('independent-instances'))
	await page.getByRole('button', { name: messages.show, exact: true }).click()
	const first = page.getByRole('dialog', { name: messages.heading })
	const firstField = await first.getByRole('textbox').getAttribute('id')
	const firstDescription = await first.getAttribute('aria-describedby')
	await first.getByRole('button', { name: messages.close, exact: true }).click()
	await page.getByRole('button', { name: 'Show another recovery phrase', exact: true }).click()
	const second = page.getByRole('dialog', { name: messages.heading })
	const secondField = await second.getByRole('textbox').getAttribute('id')
	const secondDescription = await second.getAttribute('aria-describedby')
	expect(firstField).toBeTruthy()
	expect(firstDescription).toBeTruthy()
	expect(secondField).toBeTruthy()
	expect(secondDescription).toBeTruthy()
	expect(secondField).not.toBe(firstField)
	expect(secondDescription).not.toBe(firstDescription)
	await expect(second).toHaveAccessibleDescription(messages.warning)
})

test('updates wording while preserving the revealed interaction', async ({ page }) => {
	await page.goto(story('host-updates'))
	await page.getByRole('button', { name: messages.show, exact: true }).click()
	// A host update can arrive while native modality makes outside controls inert.
	await page
		.getByRole('button', { name: 'Change wording', exact: true, includeHidden: true })
		.evaluate((button: HTMLButtonElement) => button.click())
	const dialog = page.getByRole('dialog', { name: 'Demo account recovery' })
	await expect(dialog.getByRole('textbox', { name: messages.phraseLabel })).toHaveValue(
		syntheticPhrase
	)
	await dialog.getByRole('button', { name: 'Dismiss demo', exact: true }).click()
	await expect(dialog).toHaveCount(0)
})

test('removes secret markup when the host invalidates availability', async ({ page }) => {
	await page.goto(story('host-updates'))
	await page.getByRole('button', { name: messages.show, exact: true }).click()
	await page
		.getByRole('button', { name: 'Toggle availability', exact: true, includeHidden: true })
		.evaluate((button: HTMLButtonElement) => button.click())
	await expect(page.getByRole('textbox')).toHaveCount(0)
	await expect(page.getByRole('status')).toHaveText(messages.unavailable)
	await page.getByRole('button', { name: 'Toggle availability', exact: true }).click()
	await expect(page.getByRole('button', { name: messages.show, exact: true })).toBeEnabled()
	await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('requests cleanup on unmount before the same host remounts the view', async ({ page }) => {
	await page.goto(story('host-updates'))
	await page.getByRole('button', { name: messages.show, exact: true }).click()
	await page
		.getByRole('button', { name: 'Toggle recovery view', exact: true, includeHidden: true })
		.evaluate((button: HTMLButtonElement) => button.click())
	await expect(page.getByRole('textbox')).toHaveCount(0)
	await page.getByRole('button', { name: 'Toggle recovery view', exact: true }).click()
	await expect(page.getByRole('button', { name: messages.show, exact: true })).toBeEnabled()
	await expect(page.getByRole('dialog')).toHaveCount(0)
})
