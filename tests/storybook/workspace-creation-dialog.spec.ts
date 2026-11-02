import { expect, test, type Page } from '@playwright/test'
const story = (name = 'editing') =>
	`/iframe.html?id=workspaces-creation-dialog--${name}&viewMode=story`
async function observe(page: Page, command: string) {
	await page.evaluate(
		(value) => window.postMessage(value, window.location.origin),
		`creation-demo:${command}`
	)
}
async function open(page: Page) {
	await page.goto(story())
	await page.getByRole('button', { name: 'Create workspace', exact: true }).click()
	return page.getByRole('dialog', { name: 'Create workspace', exact: true })
}
async function submit(page: Page, name = 'Personal') {
	const dialog = await open(page)
	await dialog.getByRole('textbox', { name: 'Workspace name' }).fill(name)
	await dialog.getByRole('button', { name: 'Create workspace', exact: true }).click()
	await expect(page.getByRole('status', { name: 'Host attempt' })).toHaveText(name)
	return dialog
}

test('native validation blocks empty submit and Enter submits the draft once ready', async ({
	page
}) => {
	const dialog = await open(page)
	const name = dialog.getByRole('textbox', { name: 'Workspace name' })
	await expect(name).toBeFocused()
	await dialog.getByRole('button', { name: 'Create workspace', exact: true }).click()
	await expect(page.getByRole('status', { name: 'Host phase' })).toHaveText('editing')
	await name.fill('Personal')
	await name.press('Enter')
	await expect(page.getByRole('status', { name: 'Host attempt' })).toHaveText('Personal')
	await expect(name).toBeDisabled()
	await expect(dialog.getByRole('button', { name: 'Create workspace', exact: true })).toBeDisabled()
	await expect(dialog.getByText('Creating workspace', { exact: true }).last()).toBeVisible()
})

test('closing and native Escape retain the draft and restore trigger focus', async ({ page }) => {
	let dialog = await open(page)
	await dialog.getByRole('textbox').fill('Unsubmitted draft')
	await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
	await expect(dialog).not.toBeVisible()
	const trigger = page.getByRole('button', { name: 'Create workspace', exact: true })
	await expect(trigger).toBeFocused()
	await trigger.click()
	dialog = page.getByRole('dialog')
	await expect(dialog.getByRole('textbox')).toHaveValue('Unsubmitted draft')
	await page.keyboard.press('Escape')
	await expect(dialog).not.toBeVisible()
	await expect(trigger).toBeFocused()
})

test('pending dismissal preserves the host attempt; background completion remains available', async ({
	page
}) => {
	const dialog = await submit(page)
	await dialog.getByRole('button', { name: 'Close', exact: true }).click()
	await expect(dialog).not.toBeVisible()
	await expect(page.getByRole('status', { name: 'Host phase' })).toHaveText('working')
	await page.getByRole('button', { name: 'Create workspace', exact: true }).click()
	await expect(dialog.getByRole('textbox')).toBeDisabled()
	await expect(page.getByRole('status', { name: 'Host attempt' })).toHaveText('Personal')
	await observe(page, 'complete')
	await expect(dialog.getByRole('link', { name: 'Open Personal' })).toHaveAttribute(
		'href',
		'#workspace-created'
	)
	await expect(dialog.getByRole('textbox')).toHaveCount(0)
	await expect(dialog.locator('[tabindex="-1"]')).toBeFocused()
	await dialog.getByRole('button', { name: 'Create another workspace', exact: true }).click()
	await expect(dialog.getByRole('textbox')).toHaveValue('')
	await expect(dialog.getByRole('textbox')).toBeFocused()
})

test('failure offers retry for the same retained attempt and focuses feedback', async ({
	page
}) => {
	const dialog = await submit(page, 'Retained')
	await observe(page, 'fail')
	await expect(dialog.getByRole('alert')).toHaveText('Creation failed')
	await expect(dialog.locator('[tabindex="-1"]')).toBeFocused()
	await dialog.getByRole('button', { name: 'Retry', exact: true }).click()
	await expect(page.getByRole('status', { name: 'Host retries' })).toHaveText('1')
	await expect(page.getByRole('status', { name: 'Host attempt' })).toHaveText('Retained')
	await expect(page.getByRole('status', { name: 'Host phase' })).toHaveText('working')
})

test('locale changes preserve an open draft and its field identity', async ({ page }) => {
	const dialog = await open(page)
	const name = dialog.getByRole('textbox')
	await name.fill('Keep this draft')
	const id = await name.getAttribute('id')
	await observe(page, 'locale')
	const translated = page.getByRole('dialog', { name: 'Créer un espace', exact: true })
	await expect(translated).toBeVisible()
	await expect(translated.getByRole('textbox', { name: 'Nom de l’espace' })).toHaveValue(
		'Keep this draft'
	)
	await expect(translated.getByRole('textbox')).toHaveAttribute('id', id ?? '')
	await translated.getByRole('button', { name: 'Créer', exact: true }).click()
	await expect(page.getByRole('status', { name: 'Host attempt' })).toHaveText('Keep this draft')
})

test('scope replacement clears the draft and closes; unavailable host closes and disables', async ({
	page
}) => {
	const dialog = await open(page)
	await dialog.getByRole('textbox').fill('Old identity')
	await observe(page, 'scope')
	await expect(dialog).not.toBeVisible()
	await page.getByRole('button', { name: 'Create workspace', exact: true }).click()
	await expect(dialog.getByRole('textbox')).toHaveValue('')
	await observe(page, 'block')
	await expect(dialog).not.toBeVisible()
	await expect(page.getByRole('button', { name: 'Create workspace', exact: true })).toBeDisabled()
})

test('an unavailable trigger cannot open a dialog', async ({ page }) => {
	await page.goto(story('unavailable'))
	await expect(page.getByRole('button', { name: 'Create workspace', exact: true })).toBeDisabled()
	await expect(page.getByRole('dialog')).not.toBeVisible()
})

test('two instances retain independent drafts and associated field IDs', async ({ page }) => {
	await page.goto(story('independent-instances'))
	await page.getByRole('button', { name: 'Create workspace', exact: true }).click()
	let dialog = page.getByRole('dialog', { name: 'Create workspace', exact: true })
	const firstId = await dialog.getByRole('textbox').getAttribute('id')
	await dialog.getByRole('textbox').fill('First draft')
	await page.keyboard.press('Escape')
	await page.getByRole('button', { name: 'Create another workspace', exact: true }).click()
	dialog = page.getByRole('dialog', { name: 'Create another workspace', exact: true })
	expect(await dialog.getByRole('textbox').getAttribute('id')).not.toBe(firstId)
	await expect(dialog.getByRole('textbox')).toHaveValue('')
	await page.keyboard.press('Escape')
	await page.getByRole('button', { name: 'Create workspace', exact: true }).click()
	await expect(page.getByRole('dialog').getByRole('textbox')).toHaveValue('First draft')
})

test('backdrop dismissal and unmount leave pending ownership with the host', async ({ page }) => {
	const dialog = await submit(page)
	const box = await dialog.boundingBox()
	if (!box) throw new Error('Expected visible modal')
	await page.mouse.click(Math.max(1, box.x - 5), Math.max(1, box.y - 5))
	await expect(dialog).not.toBeVisible()
	await expect(page.getByRole('status', { name: 'Host phase' })).toHaveText('working')
	await page.getByRole('button', { name: 'Create workspace', exact: true }).click()
	await observe(page, 'unmount')
	await expect(page.getByRole('dialog')).toHaveCount(0)
	await expect(page.getByRole('status', { name: 'Host phase' })).toHaveText('working')
	await expect(page.getByRole('status', { name: 'Host attempt' })).toHaveText('Personal')
})

test('dialog and bottom controls remain reachable on a narrow viewport', async ({ page }) => {
	await page.setViewportSize({ width: 320, height: 480 })
	const dialog = await submit(
		page,
		'A long workspace name that should remain readable on a small screen'
	)
	await observe(page, 'complete')
	const close = dialog.getByRole('button', { name: 'Close', exact: true })
	await close.scrollIntoViewIfNeeded()
	await expect(close).toBeInViewport()
	const box = await dialog.boundingBox()
	expect(box).not.toBeNull()
	if (!box) return
	expect(box.x).toBeGreaterThanOrEqual(0)
	expect(box.x + box.width).toBeLessThanOrEqual(320)
	await close.click()
	await expect(dialog).not.toBeVisible()
})

test('reopening a completed attempt requests a fresh host draft', async ({ page }) => {
	const dialog = await submit(page, 'Completed workspace')
	await dialog.getByRole('button', { name: 'Close', exact: true }).click()
	await observe(page, 'complete')
	await expect(page.getByRole('status', { name: 'Host phase' })).toHaveText('complete')
	await page.getByRole('button', { name: 'Create workspace', exact: true }).click()
	await expect(dialog.getByRole('textbox', { name: 'Workspace name' })).toHaveValue('')
	await expect(dialog.getByRole('textbox')).toBeFocused()
	await expect(page.getByRole('status', { name: 'Host phase' })).toHaveText('editing')
	await expect(page.getByRole('status', { name: 'Host attempt' })).toHaveText('')
})
