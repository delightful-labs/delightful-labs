import { expect, test } from '@playwright/test'
const story = (name: string) => `/iframe.html?id=workspaces-selector--${name}&viewMode=story`

test('a sole unselected workspace emits intent and waits for the host to apply it', async ({
	page
}) => {
	await page.goto(story('sole-unselected-workspace'))
	const selector = page.getByRole('combobox', { name: 'Current workspace', exact: true })
	await expect(selector).toBeEnabled()
	await expect(selector).toHaveValue('')
	await selector.selectOption('first')
	await expect(page.getByRole('status', { name: 'Requested workspace' })).toHaveText('first')
	await expect(selector).toHaveValue('')
	await page.getByRole('button', { name: 'Apply selection', exact: true }).click()
	await expect(selector).toHaveValue('first')
	await expect(selector).toBeDisabled()
})

test('supports native keyboard requests without selecting implicitly', async ({ page }) => {
	await page.goto(story('multiple-choices'))
	const selector = page.getByRole('combobox', { name: 'Current workspace', exact: true })
	await selector.focus()
	// Native typeahead followed by blur commits the choice on this browser/platform.
	await selector.press('p')
	await selector.press('Tab')
	await expect(page.getByRole('status', { name: 'Requested workspace' })).toHaveText('first')
	await expect(selector).toHaveValue('')
	await expect(selector).toHaveAccessibleDescription('Available on this device.')
	await expect(selector).toHaveAttribute('name', 'workspace')
})

test('keeps duplicate names distinct and updates localized wording without resetting selection', async ({
	page
}) => {
	await page.goto(story('duplicate-names'))
	const selector = page.getByRole('combobox', { name: 'Current workspace', exact: true })
	await expect(selector.getByRole('option', { name: 'Ledger [first]', exact: true })).toHaveCount(1)
	await expect(selector.getByRole('option', { name: 'Ledger [second]', exact: true })).toHaveCount(
		1
	)
	await selector.selectOption('second')
	await page.getByRole('button', { name: 'Apply selection', exact: true }).click()
	await expect(selector).toHaveValue('second')
	const id = await selector.getAttribute('id')
	await page.getByRole('button', { name: 'Change wording', exact: true }).click()
	const translated = page.getByRole('combobox', { name: 'Espace actuel', exact: true })
	await expect(translated).toHaveAttribute('id', id ?? '')
	await expect(translated).toHaveValue('second')
	await expect(
		translated.getByRole('option', { name: 'second — Ledger', exact: true })
	).toHaveCount(1)
	await expect(page.getByRole('status', { name: 'Requested workspace' })).toHaveText('second')
})

test('associates confirmed empty feedback with the disabled native control', async ({ page }) => {
	await page.goto(story('empty-directory'))
	const selector = page.getByRole('combobox', { name: 'Current workspace', exact: true })
	await expect(selector).toBeDisabled()
	await expect(selector).toHaveAccessibleDescription('Available on this device. No workspaces yet')
	await page.getByRole('button', { name: 'Change wording', exact: true }).click()
	await expect(page.getByRole('combobox', { name: 'Espace actuel' })).toHaveAccessibleDescription(
		'Available on this device. Aucun espace'
	)
})

test('does not label an unavailable directory as empty', async ({ page }) => {
	await page.goto(story('unavailable-directory'))
	const selector = page.getByRole('combobox', { name: 'Current workspace', exact: true })
	await expect(selector).toBeDisabled()
	await expect(selector).toHaveAccessibleDescription('Available on this device.')
	await expect(page.getByText('No workspaces yet', { exact: true })).toHaveCount(0)
})

test('respects interaction blocking and ignores a synthetic non-choice change', async ({
	page
}) => {
	await page.goto(story('multiple-choices'))
	const selector = page.getByRole('combobox', { name: 'Current workspace', exact: true })
	await page.getByRole('button', { name: 'Toggle interaction', exact: true }).click()
	await expect(selector).toBeDisabled()
	await selector.evaluate((element: HTMLSelectElement) => {
		element.value = 'first'
		element.dispatchEvent(new Event('change', { bubbles: true }))
	})
	await expect(page.getByRole('status', { name: 'Requested workspace' })).toHaveText('')
	await page.getByRole('button', { name: 'Toggle interaction', exact: true }).click()
	await selector.selectOption('first')
	await expect(page.getByRole('status', { name: 'Requested workspace' })).toHaveText('first')
	await selector.evaluate((element: HTMLSelectElement) => {
		element.value = ''
		element.dispatchEvent(new Event('change', { bubbles: true }))
	})
	await expect(page.getByRole('status', { name: 'Requested workspace' })).toHaveText('first')
})

test('gives two independent instances distinct associated field IDs', async ({ page }) => {
	await page.goto(story('independent-instances'))
	const first = page.getByRole('combobox', { name: 'Current workspace', exact: true })
	const second = page.getByRole('combobox', { name: 'Other workspace', exact: true })
	await expect(first).toBeVisible()
	await expect(second).toBeVisible()
	expect(await first.getAttribute('id')).not.toBe(await second.getAttribute('id'))
	await expect(first).toHaveAccessibleDescription('Available on this device.')
	await expect(second).toHaveAccessibleDescription('Available on this device.')
})

test('preserves the applied selection when wording changes while a request is pending', async ({
	page
}) => {
	await page.goto(story('duplicate-names'))
	const selector = page.getByRole('combobox')
	await selector.selectOption('second')
	await expect(page.getByRole('status', { name: 'Requested workspace' })).toHaveText('second')
	await expect(selector).toHaveValue('')
	await page.getByRole('button', { name: 'Change wording', exact: true }).click()
	await expect(selector).toHaveAccessibleName('Espace actuel')
	await expect(selector.getByRole('option', { name: 'second — Ledger', exact: true })).toHaveCount(
		1
	)
	await expect(selector).toHaveValue('')
	await page.getByRole('button', { name: 'Apply selection', exact: true }).click()
	await expect(selector).toHaveValue('second')
})
