import { expect, type Locator, type Page } from '@playwright/test'

export function pageContent(page: Page) {
	return page.locator('.app-shell > .workspace > .content')
}

export async function openSidebarSection(page: Page, label: 'Accounts' | 'Settings') {
	const toggle = page.getByRole('button', { name: 'Toggle Main navigation', exact: true })
	await expect(toggle).toBeVisible()
	if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click()
	const section = page.locator('aside details').filter({
		has: page.locator('summary').filter({ hasText: label })
	})
	await expect(section).toBeVisible()
	if ((await section.getAttribute('open')) === null) await section.locator('summary').click()
	return section
}

export async function prepareSidebar(page: Page) {
	await openSidebarSection(page, 'Accounts')
	await openSidebarSection(page, 'Settings')
}

export async function navigateSidebar(page: Page, label: string) {
	await closeCreationModal(page)
	if (label === 'Accounts') await openSidebarSection(page, 'Accounts')
	if (['Workspaces', 'Banks', 'Account', 'Login'].includes(label))
		await openSidebarSection(page, 'Settings')
	const link = page.locator('aside').getByRole('link', {
		name: label === 'Accounts' ? 'Manage Accounts' : label,
		exact: true
	})
	const href = await link.getAttribute('href')
	if (!href) throw new Error('Missing sidebar destination')
	const destination = new URL(href, page.url()).href
	// A same-URL sidebar click still navigates. Wait for its history commit so
	// a subsequent workspace request cannot be overtaken by that older click.
	await Promise.all([
		page.waitForEvent('framenavigated', {
			predicate: (frame) => frame === page.mainFrame() && frame.url() === destination
		}),
		link.click()
	])
}

export function creationDialog(page: Page, label: string) {
	return page.getByRole('dialog', { name: label, exact: true })
}

export async function openAccountActions(page: Page, name: string) {
	await page
		.getByRole('main')
		.getByRole('button', { name: `Manage ${name}`, exact: true })
		.click()
	const dialog = page.getByRole('dialog', { name, exact: true })
	await expect(dialog).toBeVisible()
	return dialog
}

export async function openCreationModal(page: Page, label: string) {
	const dialog = creationDialog(page, label)
	if (!(await dialog.isVisible())) {
		await page.getByRole('main').getByRole('button', { name: label, exact: true }).first().click()
	}
	await expect(dialog).toBeVisible()
	return dialog
}

export async function closeCreationModal(page: Page) {
	const dialog = page
		.getByRole('dialog')
		.filter({ has: page.getByRole('button', { name: /^(Cancel|Close)$/ }) })
	if (await dialog.isVisible()) {
		await dialog.getByRole('button', { name: /^(Cancel|Close)$/ }).click()
		await expect(dialog).not.toBeVisible()
	}
}

export async function selectWorkspace(selector: Locator, id: string) {
	const page = selector.page()
	await closeCreationModal(page)
	await openSidebarSection(page, 'Settings')
	await selector.selectOption(id)
	await expect(page).toHaveURL((url) => url.searchParams.get('workspace') === id)
	await expect(selector).toHaveValue(id)
}
