import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
	await page.goto('/')
	await page.getByText('Optional value binding', { exact: true }).click()
	await expect(
		page.getByText('Current text: Preview', { exact: true })
	).toBeVisible()
	await expect(
		page.getByText('Current number: 2.5', { exact: true })
	).toBeVisible()
})

test('submits native FormData with zero, decimals, and successful controls', async ({
	page
}) => {
	await page
		.getByLabel('Description', { exact: false })
		.fill('Edited description')
	await page.getByLabel('Category', { exact: true }).fill('Work')
	await page.getByLabel('Measurement', { exact: true }).fill('12.75')
	await expect(page.getByLabel('Readonly', { exact: true })).not.toBeEditable()
	await expect(page.getByLabel('Disabled', { exact: true })).toBeDisabled()
	await expect(page.getByLabel('Category', { exact: true })).toHaveAttribute(
		'list',
		'category-options'
	)
	await page.getByRole('button', { name: 'Submit', exact: true }).click()

	await expect(page.locator('pre')).toHaveText(
		JSON.stringify(
			[
				['description', 'Edited description'],
				['category', 'Work'],
				['quantity', '0'],
				['measurement', '12.75'],
				['readonly', 'Included'],
				['bound-text', 'Preview'],
				['bound-number', '2.5']
			],
			null,
			2
		)
	)
})

test('resets native defaults and optional bindings after edits and submission', async ({
	page
}) => {
	await page.getByLabel('Description', { exact: false }).fill('Edited')
	await page.getByLabel('Category', { exact: true }).fill('Personal')
	await page.getByLabel('Quantity', { exact: false }).fill('10')
	await page.getByLabel('Measurement', { exact: true }).fill('9.75')
	await page.getByLabel('Bound text', { exact: true }).fill('Changed')
	await page.getByLabel('Bound number', { exact: true }).fill('7.25')
	await expect(
		page.getByText('Current text: Changed', { exact: true })
	).toBeVisible()
	await expect(
		page.getByText('Current number: 7.25', { exact: true })
	).toBeVisible()
	await page.getByRole('button', { name: 'Submit', exact: true }).click()
	await expect(page.locator('pre')).toContainText('Edited')
	await page.getByRole('button', { name: 'Reset', exact: true }).click()

	await expect(page.getByLabel('Description', { exact: false })).toHaveValue(
		'Example'
	)
	await expect(page.getByLabel('Category', { exact: true })).toHaveValue('')
	await expect(page.getByLabel('Quantity', { exact: false })).toHaveValue('0')
	await expect(page.getByLabel('Measurement', { exact: true })).toHaveValue(
		'1.25'
	)
	await expect(page.getByLabel('Bound text', { exact: true })).toHaveValue(
		'Preview'
	)
	await expect(page.getByLabel('Bound number', { exact: true })).toHaveValue(
		'2.5'
	)
	await expect(
		page.getByText('Current text: Preview', { exact: true })
	).toBeVisible()
	await expect(
		page.getByText('Current number: 2.5', { exact: true })
	).toBeVisible()
	await expect(page.locator('pre')).toHaveText('No submission yet.')
})

test('keeps empty optional numeric state undefined and serializes it as empty text', async ({
	page
}) => {
	await page.getByLabel('Bound number', { exact: true }).fill('')
	await expect(
		page.getByText('Current number: undefined', { exact: true })
	).toBeVisible()
	await page.getByRole('button', { name: 'Submit', exact: true }).click()
	await expect(page.locator('pre')).toContainText('"bound-number",\n    ""')
})

test('uses native required, range, and step validation without truncating input', async ({
	page
}) => {
	const description = page.getByLabel('Description', { exact: false })
	const quantity = page.getByLabel('Quantity', { exact: false })
	const measurement = page.getByLabel('Measurement', { exact: true })
	const submit = page.getByRole('button', { name: 'Submit', exact: true })

	await description.fill('')
	await submit.click()
	expect(
		await description.evaluate(
			(input) =>
				input instanceof HTMLInputElement && input.validity.valueMissing
		)
	).toBe(true)
	await expect(page.locator('pre')).toHaveText('No submission yet.')

	await description.fill('Valid')
	await quantity.fill('-1')
	await submit.click()
	expect(
		await quantity.evaluate(
			(input) =>
				input instanceof HTMLInputElement && input.validity.rangeUnderflow
		)
	).toBe(true)
	await expect(page.locator('pre')).toHaveText('No submission yet.')

	await quantity.fill('101')
	await submit.click()
	expect(
		await quantity.evaluate(
			(input) =>
				input instanceof HTMLInputElement && input.validity.rangeOverflow
		)
	).toBe(true)
	await expect(quantity).toHaveValue('101')
	await expect(page.locator('pre')).toHaveText('No submission yet.')

	await quantity.fill('0.5')
	await submit.click()
	expect(
		await quantity.evaluate(
			(input) =>
				input instanceof HTMLInputElement && input.validity.stepMismatch
		)
	).toBe(true)
	await expect(quantity).toHaveValue('0.5')

	await quantity.fill('0')
	await measurement.fill('1.251')
	await submit.click()
	expect(
		await measurement.evaluate(
			(input) =>
				input instanceof HTMLInputElement && input.validity.stepMismatch
		)
	).toBe(true)
	await expect(measurement).toHaveValue('1.251')
	await expect(page.locator('pre')).toHaveText('No submission yet.')
})

test('preserves server IDs through hydration and supports labels and keyboard controls', async ({
	page
}) => {
	const response = await page.request.get('/')
	const html = await response.text()
	const serverIds = Array.from(
		html.matchAll(/<input\b[^>]*\bid="([^"]+)"/g),
		(match) => match[1]
	)
	const clientIds = await page
		.locator('form input')
		.evaluateAll((inputs) => inputs.map((input) => input.id))

	expect(serverIds.length).toBeGreaterThan(1)
	expect(clientIds).toEqual(serverIds)
	expect(new Set(clientIds).size).toBe(clientIds.length)
	await page.getByText('Description', { exact: true }).click()
	await expect(page.getByLabel('Description', { exact: false })).toBeFocused()
	await page.keyboard.press('Tab')
	await expect(page.getByLabel('Category', { exact: true })).toBeFocused()
	await page.keyboard.press('Tab')
	await expect(page.getByLabel('Quantity', { exact: false })).toBeFocused()
	await page.keyboard.press('ArrowUp')
	await expect(page.getByLabel('Quantity', { exact: false })).toHaveValue('1')
})
