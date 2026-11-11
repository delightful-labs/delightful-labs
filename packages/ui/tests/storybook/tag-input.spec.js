import { expect, test } from '@playwright/test'

test.use({ hasTouch: true, viewport: { width: 390, height: 844 } })

/** @param {import('@playwright/test').Page} page */
async function openSuggestions(page) {
	await page.goto('/iframe.html?id=inputs-tags--suggestions&viewMode=story')
	const input = page.getByRole('combobox', { name: 'Tags' })
	await input.tap()
	await expect(input).toHaveAttribute('aria-expanded', 'true')
	await expect(page.getByRole('listbox', { name: 'Tags' })).toBeVisible()
	return input
}

test('touch selects a suggestion and keeps the input ready for another tag', async ({
	page
}) => {
	const input = await openSuggestions(page)
	await page.getByRole('option', { name: 'Personal', exact: true }).tap()
	await expect(
		page.getByRole('button', { name: 'Remove Personal', exact: true })
	).toBeVisible()
	await expect(input).toHaveValue('')
	await expect(input).toBeFocused()
	await expect(input).toHaveAttribute('aria-expanded', 'false')
	await input.fill('Rec')
	await expect(
		page.getByRole('option', { name: 'Recipes', exact: true })
	).toBeVisible()
})

test('suggestions remain usable without native popover support', async ({
	page
}) => {
	await page.addInitScript(() => {
		Object.defineProperty(HTMLElement.prototype, 'showPopover', {
			value: undefined,
			configurable: true
		})
	})
	const input = await openSuggestions(page)
	await input.fill('Pers')
	await expect(page.getByRole('option')).toHaveCount(1)
	await page.getByRole('option', { name: 'Personal', exact: true }).tap()
	await expect(
		page.getByRole('button', { name: 'Remove Personal', exact: true })
	).toBeVisible()
	await expect(page.getByRole('listbox')).toBeHidden()
	await input.tap()
	await expect(page.getByRole('listbox')).toBeVisible()
	await input.press('Escape')
	await expect(input).toHaveAttribute('aria-expanded', 'false')
	await expect(page.getByRole('listbox')).toBeHidden()
})

for (const inputType of ['insertLineBreak', 'insertParagraph']) {
	test(`mobile ${inputType} adds the draft once and ignores composition`, async ({
		page
	}) => {
		const input = await openSuggestions(page)
		await input.fill('New tag')
		await input.evaluate(
			(node, inputType) =>
				node.dispatchEvent(
					new InputEvent('beforeinput', {
						bubbles: true,
						cancelable: true,
						inputType,
						isComposing: true
					})
				),
			inputType
		)
		await expect(
			page.getByRole('button', { name: 'Remove New tag', exact: true })
		).toHaveCount(0)
		await expect(input).toHaveValue('New tag')
		await input.evaluate(
			(node, inputType) =>
				node.dispatchEvent(
					new InputEvent('beforeinput', {
						bubbles: true,
						cancelable: true,
						inputType
					})
				),
			inputType
		)
		await expect(
			page.getByRole('button', { name: 'Remove New tag', exact: true })
		).toHaveCount(1)
		await expect(input).toHaveValue('')
		await input.evaluate(
			(node, inputType) =>
				node.dispatchEvent(
					new InputEvent('beforeinput', {
						bubbles: true,
						cancelable: true,
						inputType
					})
				),
			inputType
		)
		await expect(
			page.getByRole('button', { name: 'Remove New tag', exact: true })
		).toHaveCount(1)
	})
}

test('custom normalization shares duplicate, suggestion and query comparison without changing labels', async ({
	page
}) => {
	await page.goto(
		'/iframe.html?id=inputs-tags--custom-normalization&viewMode=story'
	)
	const input = page.getByRole('combobox', { name: 'Tags' })
	await input.tap()
	await expect(
		page.getByRole('option', { name: 'STRASSE', exact: true })
	).toHaveCount(0)
	await expect(
		page.getByRole('option', { name: 'Cafe\u0301', exact: true })
	).toHaveCount(0)
	await expect(
		page.getByRole('option', { name: 'Fußball', exact: true })
	).toBeVisible()
	await expect(
		page.getByRole('option', { name: 'FUSSBALL', exact: true })
	).toHaveCount(0)
	await input.fill('STRASSE')
	await input.press('Enter')
	await expect(page.getByRole('status')).toHaveText('STRASSE is already added')
	await expect(
		page.getByRole('list', { name: 'Selected tags' }).getByRole('listitem')
	).toHaveCount(2)
	await expect(input).toHaveValue('STRASSE')
	await input.fill('Cafe\u0301')
	await input.press('Enter')
	await expect(page.getByRole('status')).toHaveText(
		'Cafe\u0301 is already added'
	)
	await expect(
		page.getByRole('button', { name: 'Remove Café', exact: true })
	).toBeVisible()
	await input.fill('FUSS')
	await expect(
		page.getByRole('option', { name: 'Fußball', exact: true })
	).toBeVisible()
	await input.press('ArrowDown')
	await input.press('Enter')
	await expect(
		page.getByRole('button', { name: 'Remove Fußball', exact: true })
	).toBeVisible()
	await expect(page.getByRole('status')).toHaveText('Fußball added')
	await input.fill('Cafe\u0301 N')
	await expect(
		page.getByRole('option', { name: 'Café Notes', exact: true })
	).toBeVisible()
	await page.getByRole('button', { name: 'Remove Fußball', exact: true }).tap()
	await expect(
		page.getByRole('button', { name: 'Remove Fußball', exact: true })
	).toHaveCount(0)
})

test('default comparison still rejects case-insensitive duplicates and preserves the draft', async ({
	page
}) => {
	const input = await openSuggestions(page)
	await input.fill('WORK')
	await input.press('Enter')
	await expect(page.getByRole('status')).toHaveText('WORK is already added')
	await expect(
		page.getByRole('list', { name: 'Selected tags' }).getByRole('listitem')
	).toHaveCount(1)
	await expect(input).toHaveValue('WORK')
})
