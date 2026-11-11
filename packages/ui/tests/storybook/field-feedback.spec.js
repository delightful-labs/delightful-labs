import { expect, test } from '@playwright/test'

test('linked input has both instructions and errors as its description', async ({
	page
}) => {
	await page.goto(
		'/iframe.html?id=inputs-fieldfeedback--linked-to-an-input&viewMode=story'
	)
	const input = page.getByRole('textbox', { name: 'Account name' })
	await expect(input).toHaveAttribute(
		'aria-describedby',
		'account-name-feedback'
	)
	await expect(input).toHaveAccessibleDescription(
		'Enter the account name used on your statements. Enter an account name.'
	)
	await expect(input).toHaveAttribute('aria-invalid', 'true')
	await expect(page.locator('#account-name-feedback')).toHaveCount(1)
	await expect(page.getByRole('alert')).toHaveCount(0)
})

test('updates descriptions and invalid state, then hides empty feedback without losing its ID', async ({
	page
}) => {
	await page.goto(
		'/iframe.html?id=tests-fieldfeedbackupdates--default&viewMode=story'
	)
	const input = page.locator('input').first()
	const feedback = page.locator('#account-feedback')
	await expect(input).toHaveAttribute('aria-describedby', 'account-feedback')
	await expect(input).toHaveAccessibleDescription('Use your account name.')
	await expect(input).toHaveAttribute('aria-invalid', 'false')
	await page.getByRole('button', { name: 'Show error' }).click()
	await expect(input).toHaveAccessibleDescription(
		'Use your account name. Enter an account name.'
	)
	await expect(input).toHaveAttribute('aria-invalid', 'true')
	await page.getByRole('button', { name: 'Clear feedback' }).click()
	await expect(feedback).toHaveCount(1)
	await expect(feedback).toBeHidden()
	await expect(input).toHaveAccessibleDescription('')
	await expect(input).toHaveAttribute('aria-invalid', 'false')
})
