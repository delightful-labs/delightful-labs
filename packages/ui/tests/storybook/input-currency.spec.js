import { expect, test } from '@playwright/test'

test('raw drafts submit as strings and native reset restores the default', async ({
	page
}) => {
	await page.goto(
		'/iframe.html?id=inputs-inputcurrency--form-submission&viewMode=story'
	)
	const input = page.getByRole('textbox', { name: 'Amount' })
	await expect(input).toHaveAccessibleDescription('USD')
	await input.fill('1.')
	await page.getByRole('button', { name: 'Submit', exact: true }).click()
	await expect(page.locator('pre[aria-live="polite"]')).toHaveText(
		'[["amount","1."]]'
	)
	await page.getByRole('button', { name: 'Reset', exact: true }).click()
	await expect(input).toHaveValue('12.50')
	await input.fill('')
	await page.getByRole('button', { name: 'Submit', exact: true }).click()
	await expect(input).toBeFocused()
})

test('currency and field feedback both describe the control', async ({
	page
}) => {
	await page.goto(
		'/iframe.html?id=inputs-inputcurrency--with-feedback&viewMode=story'
	)
	await expect(
		page.getByRole('textbox', { name: 'Amount' })
	).toHaveAccessibleDescription(
		'Enter the amount using a decimal point. Enter a valid amount. USD'
	)
})

test('comma drafts, disabled and read-only states use native text behavior', async ({
	page
}) => {
	await page.goto(
		'/iframe.html?id=inputs-inputcurrency--comma-decimal&viewMode=story'
	)
	await expect(page.getByRole('textbox')).toHaveValue('12,50')
	await page.goto(
		'/iframe.html?id=inputs-inputcurrency--disabled&viewMode=story'
	)
	await expect(page.getByRole('textbox')).toBeDisabled()
	await page.goto(
		'/iframe.html?id=inputs-inputcurrency--read-only&viewMode=story'
	)
	await expect(page.getByRole('textbox')).toHaveAttribute('readonly', '')
})
