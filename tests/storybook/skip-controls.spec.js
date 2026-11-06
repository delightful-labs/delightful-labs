import { expect, test } from '@playwright/test'

/** @param {import('@playwright/test').Page} page @param {string} story */
async function open(page, story) {
	await page.goto(
		`/iframe.html?id=accessibility-skiplink--${story}&viewMode=story`
	)
}

test('Tab reveals the accessible skip link and leaving focus hides it again', async ({
	page
}) => {
	await open(page, 'skip-to-content')
	const link = page.getByRole('link', {
		name: 'Skip to main content',
		exact: true
	})
	await expect(link).toHaveAttribute('href', '#main-content')
	await expect(link).not.toBeInViewport()
	await page.keyboard.press('Tab')
	await expect(link).toBeFocused()
	await expect(link).toBeInViewport()
	await page.keyboard.press('Tab')
	await expect(
		page.getByRole('link', { name: 'Overview', exact: true })
	).toBeFocused()
	await expect(link).not.toBeInViewport()
	await page.keyboard.press('Shift+Tab')
	await expect(link).toBeFocused()
	await expect(link).toBeInViewport()
})

test('Enter skips navigation, focuses the fragment target and continues inside main content', async ({
	page
}) => {
	await open(page, 'skip-to-content')
	const link = page.getByRole('link', {
		name: 'Skip to main content',
		exact: true
	})
	await page.keyboard.press('Tab')
	await expect(link).toBeFocused()
	await page.keyboard.press('Enter')
	await expect(page).toHaveURL(/#main-content$/)
	await expect(page.getByRole('main')).toBeFocused()
	await expect(link).not.toBeInViewport()
	await page.keyboard.press('Tab')
	await expect(
		page.getByRole('link', { name: 'Continue reading', exact: true })
	).toBeFocused()
})

test('Enter and Space open the caller-owned dialog and dismissal returns focus', async ({
	page
}) => {
	await open(page, 'open-dialog')
	const trigger = page.getByRole('button', { name: 'Open tools', exact: true })
	const dialog = page.getByRole('dialog', { name: 'Tools', exact: true })
	await expect(trigger).toHaveAttribute('type', 'button')
	await expect(trigger).toHaveAttribute('aria-haspopup', 'dialog')
	await expect(trigger).toHaveAttribute('aria-controls', 'example-tools')
	await expect(trigger).not.toBeInViewport()
	await page.keyboard.press('Tab')
	await expect(trigger).toBeFocused()
	await expect(trigger).toBeInViewport()
	for (const key of ['Enter', 'Space']) {
		await trigger.press(key)
		await expect(dialog).toBeVisible()
		await expect(
			dialog.getByRole('button', { name: 'Close', exact: true })
		).toBeFocused()
		if (key === 'Enter') await page.keyboard.press('Escape')
		else
			await dialog.getByRole('button', { name: 'Close', exact: true }).click()
		await expect(dialog).toBeHidden()
		await expect(trigger).toBeFocused()
		await expect(trigger).toBeInViewport()
	}
	await page.keyboard.press('Tab')
	await expect(
		page.getByRole('button', { name: 'Continue', exact: true })
	).toBeFocused()
	await expect(trigger).not.toBeInViewport()
})

test('a disabled skip button cannot be focused or activated', async ({
	page
}) => {
	await open(page, 'disabled-action')
	const trigger = page.getByRole('button', { name: 'Open tools', exact: true })
	await expect(trigger).toBeDisabled()
	await trigger.evaluate((element) => {
		if (!(element instanceof HTMLButtonElement))
			throw new Error('Expected a native button')
		element.addEventListener('click', () =>
			element.setAttribute('data-activated', 'yes')
		)
		element.focus()
		element.click()
	})
	await expect(trigger).not.toBeFocused()
	await expect(trigger).not.toHaveAttribute('data-activated')
	await expect(trigger).not.toBeInViewport()
	await page.keyboard.press('Tab')
	await expect(
		page.getByRole('button', { name: 'Continue', exact: true })
	).toBeFocused()
})
