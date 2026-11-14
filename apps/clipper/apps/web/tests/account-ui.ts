import { expect, type Page } from '@playwright/test'

async function followSidebarLink(page: Page, name: string) {
	if (await page.locator('[popover]:popover-open').count()) {
		await page.keyboard.press('Escape')
		await expect(page.locator('[popover]:popover-open')).toHaveCount(0)
	}
	const toggle = page
		.getByRole('button', { name: /^(Show|Close) account$/ })
		.and(page.locator('[aria-controls]'))
	await expect(toggle).toBeVisible()
	if ((await toggle.getAttribute('aria-expanded')) === 'false')
		await toggle.click({ timeout: 10000 })
	await page
		.getByRole('complementary', { name: 'account', exact: true })
		.getByRole('link', { name, exact: true })
		.click({ timeout: 10000 })
}

export async function expectLibrarySynced(page: Page) {
	const toggle = page
		.getByRole('button', { name: /^(Show|Close) account$/ })
		.and(page.locator('[aria-controls]'))
	await expect(toggle).toBeVisible()
	const wasClosed = (await toggle.getAttribute('aria-expanded')) === 'false'
	if (wasClosed) await toggle.click()
	await expect(
		page
			.getByRole('complementary', { name: 'account', exact: true })
			.getByText('Private library synced.', { exact: true })
	).toBeVisible()
	if (wasClosed) await toggle.click()
}

export async function openAccountSettings(page: Page) {
	if (new URL(page.url()).pathname !== '/account') await followSidebarLink(page, 'account')
	await expect(
		page.getByRole('main').getByRole('heading', { name: 'account', level: 1, exact: true })
	).toBeVisible()
}

export async function openAllArticles(page: Page) {
	await followSidebarLink(page, 'All articles')
	await expect(page.getByRole('region', { name: 'Saved articles', exact: true })).toBeVisible()
}

export async function readRecoveryPhrase(page: Page) {
	const original = page.url()
	await openAccountSettings(page)
	await page.getByRole('button', { name: 'Show recovery phrase', exact: true }).click()
	const dialog = page.getByRole('dialog')
	const phrase = await dialog.getByLabel('Recovery phrase', { exact: true }).inputValue()
	await dialog.getByRole('button', { name: 'Close', exact: true }).click()
	if (original !== page.url()) {
		await page.goBack()
		await expect(page).toHaveURL(original)
		if (new URL(original).pathname.startsWith('/articles/'))
			await expect(page.getByRole('article')).toBeVisible()
	}
	return phrase
}

export async function restoreAccount(page: Page, phrase: string) {
	await openAccountSettings(page)
	await page.getByLabel('Recovery phrase', { exact: true }).fill(phrase)
	await page.getByRole('button', { name: 'Restore account', exact: true }).click()
	await expect(
		page.getByRole('button', { name: 'Show recovery phrase', exact: true })
	).toBeVisible()
	await openAllArticles(page)
}

export async function expectSignedInAccount(page: Page) {
	await openAccountSettings(page)
	await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible({
		timeout: 30000
	})
	await openAllArticles(page)
}
