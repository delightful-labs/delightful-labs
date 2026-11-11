import { expect, test, type Page } from '@playwright/test'

const story = '/iframe.html?id=identity-owned-recovery-integration--host-lifetime&viewMode=story'
const syntheticPhrase = 'synthetic owned integration phrase — not a real credential'
const show = (page: Page) => page.getByRole('button', { name: 'Show Recovery phrase', exact: true })
const counters = (subscriptions: number, releases: number, reads: number, settlements = 0) =>
	`Subscriptions: ${subscriptions}; releases: ${releases}; reads: ${reads}; settlements: ${settlements}.`

test('owns one subscription, preserves it on Close, and releases it on unmount', async ({
	page
}) => {
	await page.goto(story)
	await expect(page.getByText(counters(1, 0, 0), { exact: true })).toBeVisible()
	await show(page).click()
	await expect(page.getByRole('textbox')).toHaveValue(syntheticPhrase)
	await page.getByRole('button', { name: 'Close', exact: true }).click()
	await expect(page.getByText(counters(1, 0, 1), { exact: true })).toBeVisible()
	await page.getByRole('button', { name: 'Toggle composition', exact: true }).click()
	await expect(page.getByText(counters(1, 1, 1), { exact: true })).toBeVisible()
	await page.getByRole('button', { name: 'Toggle composition', exact: true }).click()
	await expect(page.getByText(counters(2, 1, 1), { exact: true })).toBeVisible()
	await expect(
		page.getByText('Subscription events: subscribe → release → subscribe.', { exact: true })
	).toBeVisible()
	await expect(show(page)).toBeEnabled()
})

test('changes messages without restarting the actor or exporting again', async ({ page }) => {
	await page.goto(story)
	await show(page).click()
	await page
		.getByRole('button', { name: 'Change messages', includeHidden: true })
		.evaluate((button: HTMLButtonElement) => button.click())
	const dialog = page.getByRole('dialog', { name: 'Updated recovery heading' })
	await expect(dialog.getByRole('textbox')).toHaveValue(syntheticPhrase)
	await expect(page.getByText(counters(1, 0, 1), { exact: true })).toBeAttached()
	await dialog.getByRole('button', { name: 'Dismiss updated view', exact: true }).click()
})

test('replaces the binding and clears its view when the source changes', async ({ page }) => {
	await page.goto(story)
	await show(page).click()
	await page
		.getByRole('button', { name: 'Replace source', includeHidden: true })
		.evaluate((button: HTMLButtonElement) => button.click())
	await expect(page.getByRole('dialog')).toHaveCount(0)
	await expect(page.getByText(counters(2, 1, 1), { exact: true })).toBeVisible()
	await expect(
		page.getByText('Subscription events: subscribe → release → subscribe.', { exact: true })
	).toBeVisible()
	await show(page).click()
	await expect(page.getByRole('textbox')).toHaveValue(syntheticPhrase)
	await expect(page.getByText(counters(2, 1, 2), { exact: true })).toBeAttached()
})

test('discards a delayed export when its capability is replaced', async ({ page }) => {
	await page.goto(story)
	await page.getByRole('button', { name: 'Delay exports', exact: true }).click()
	await show(page).click()
	await expect(page.getByRole('status')).toHaveText('Loading your recovery phrase…')
	await page.getByRole('button', { name: 'Replace capability', exact: true }).click()
	await expect(page.getByText(counters(2, 1, 1), { exact: true })).toBeVisible()
	await expect(
		page.getByText('Subscription events: subscribe → release → subscribe.', { exact: true })
	).toBeVisible()
	await page.getByRole('button', { name: 'Complete pending export', exact: true }).click()
	await expect(page.getByText(counters(2, 1, 1, 1), { exact: true })).toBeVisible()
	await expect(page.getByRole('dialog')).toHaveCount(0)
	await expect(show(page)).toBeEnabled()
})

test('discards a delayed export after unmount and remount', async ({ page }) => {
	await page.goto(story)
	await page.getByRole('button', { name: 'Delay exports', exact: true }).click()
	await show(page).click()
	await expect(page.getByRole('status')).toHaveText('Loading your recovery phrase…')
	await page.getByRole('button', { name: 'Toggle composition', exact: true }).click()
	await page.getByRole('button', { name: 'Complete pending export', exact: true }).click()
	await page.getByRole('button', { name: 'Toggle composition', exact: true }).click()
	await expect(page.getByText(counters(2, 1, 1, 1), { exact: true })).toBeVisible()
	await expect(page.getByRole('dialog')).toHaveCount(0)
	await expect(show(page)).toBeEnabled()
})

test('clears an already revealed phrase on a host scope invalidation', async ({ page }) => {
	await page.goto(story)
	await show(page).click()
	await page
		.getByRole('button', { name: 'Invalidate scope', includeHidden: true })
		.evaluate((button: HTMLButtonElement) => button.click())
	await expect(page.getByRole('textbox')).toHaveCount(0)
	await expect(show(page)).toBeDisabled()
	await expect(page.getByRole('status')).toHaveText(
		'A recovery phrase is not available for this account.'
	)
	await expect(page.getByText(counters(1, 0, 1), { exact: true })).toBeVisible()
})

test('closes the old binding and sanitizes a new source acquisition failure', async ({ page }) => {
	await page.goto(story)
	await page.getByRole('button', { name: 'Break source', exact: true }).click()
	await expect(page.getByText('Recovery scope subscription failed', { exact: true })).toBeVisible()
	await expect(page.getByText('Synthetic private source detail', { exact: true })).toHaveCount(0)
	await expect(page.getByText(counters(1, 1, 0), { exact: true })).toBeVisible()
})
