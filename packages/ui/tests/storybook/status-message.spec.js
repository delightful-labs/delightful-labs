import { expect, test } from '@playwright/test'

test('mounted feedback transitions with one live region and preserves focus', async ({
	page
}) => {
	await page.goto(
		'/iframe.html?id=tests-statusmessagestates--default&viewMode=story'
	)
	const feedback = page.locator('#feedback')
	await expect(feedback).toHaveText('Saving changes')
	await expect(feedback).toHaveAttribute('role', 'status')
	await expect(page.getByRole('status')).toHaveCount(1)
	await page.getByRole('button', { name: 'Complete', exact: true }).click()
	await expect(feedback).toHaveText('Changes saved')
	await expect(feedback.locator('[aria-hidden]')).toHaveCount(0)
	await expect(
		page.getByRole('button', { name: 'Complete', exact: true })
	).toBeFocused()
	await page.getByRole('button', { name: 'Fail', exact: true }).click()
	await expect(page.getByRole('alert')).toHaveText('Save failed')
	await expect(page.getByRole('status')).toHaveCount(0)
	await page.getByRole('button', { name: 'Retry', exact: true }).click()
	await expect(feedback).toHaveText('Saving changes')
	await expect(page.getByRole('status')).toHaveCount(1)
	await page.getByRole('button', { name: 'Toggle visibility' }).click()
	await expect(feedback).toBeHidden()
	await page.getByRole('button', { name: 'Toggle visibility' }).click()
	await expect(feedback).toBeVisible()
})

test('loading text wraps on narrow screens and the spinner respects reduced motion', async ({
	page
}) => {
	await page.setViewportSize({ width: 320, height: 640 })
	await page.emulateMedia({ reducedMotion: 'reduce' })
	await page.goto(
		'/iframe.html?id=feedback-statusmessage--wrapping&viewMode=story'
	)
	const feedback = page.getByRole('status')
	await expect(feedback).toBeVisible()
	const rings = feedback.locator('[aria-hidden="true"]')
	await expect(rings.first()).toBeVisible()
	await expect(rings.last()).toBeHidden()
	const box = await feedback.boundingBox()
	if (!box) throw new Error('Expected feedback geometry')
	expect(box.x + box.width).toBeLessThanOrEqual(320)
	expect(
		await page.evaluate(() => document.documentElement.scrollWidth)
	).toBeLessThanOrEqual(320)
})

test('decorative spinner has no separate status announcement', async ({
	page
}) => {
	await page.goto(
		'/iframe.html?id=feedback-loadingspinner--decorative&viewMode=story'
	)
	await expect(
		page.locator('#storybook-root > [aria-hidden="true"]')
	).toBeVisible()
	await expect(page.getByRole('status')).toHaveCount(0)
})

test('compact feedback transitions between spinner and dots without duplicating announcements or moving focus', async ({
	page
}) => {
	await page.goto(
		'/iframe.html?id=tests-statusmessagestates--compact&viewMode=story'
	)
	const feedback = page.locator('#feedback')
	await expect(feedback).toHaveText('Saving changes')
	await expect(page.getByRole('status')).toHaveCount(1)
	await expect(feedback.locator('span[aria-hidden="true"]')).toHaveCount(0)
	await page.getByRole('button', { name: 'Complete', exact: true }).click()
	await expect(feedback).toHaveText('Changes saved')
	await expect(feedback.locator('span[aria-hidden="true"]')).toHaveCount(1)
	await expect(page.getByRole('status')).toHaveCount(1)
	await expect(
		page.getByRole('button', { name: 'Complete', exact: true })
	).toBeFocused()
	await page.getByRole('button', { name: 'Fail', exact: true }).click()
	await expect(page.getByRole('alert')).toHaveText('Save failed')
	await expect(page.getByRole('status')).toHaveCount(0)
	await expect(feedback.locator('span[aria-hidden="true"]')).toHaveCount(1)
	await page.getByRole('button', { name: 'Retry', exact: true }).click()
	await expect(feedback).toHaveText('Saving changes')
	await expect(feedback.locator('span[aria-hidden="true"]')).toHaveCount(0)
	await expect(page.getByRole('status')).toHaveCount(1)
	await expect(page.getByRole('alert')).toHaveCount(0)
	await page.getByRole('button', { name: 'Toggle visibility' }).click()
	await expect(feedback).toBeHidden()
	await page.getByRole('button', { name: 'Toggle visibility' }).click()
	await expect(feedback).toBeVisible()
})

for (const state of ['offline', 'pending']) {
	test(`compact ${state} stays informational with visible text`, async ({
		page
	}) => {
		await page.goto(
			`/iframe.html?id=feedback-statusmessage--compact-${state}&viewMode=story`
		)
		const feedback = page.getByRole('status')
		await expect(feedback).toContainText(
			state === 'offline' ? 'Offline' : 'Changes waiting to sync'
		)
		await expect(page.getByRole('alert')).toHaveCount(0)
		await expect(feedback.locator('span[aria-hidden="true"]')).toHaveCount(1)
	})
}

test('compact loading respects reduced motion with a single announcement', async ({
	page
}) => {
	await page.emulateMedia({ reducedMotion: 'reduce' })
	await page.goto(
		'/iframe.html?id=feedback-statusmessage--compact-syncing&viewMode=story'
	)
	const feedback = page.getByRole('status')
	await expect(feedback).toHaveText('Syncing changes…')
	await expect(page.getByRole('status')).toHaveCount(1)
	const decorations = feedback.locator('[aria-hidden="true"]')
	await expect(decorations.first()).toBeVisible()
	await expect(decorations.last()).toBeHidden()
})

test('compact text wraps on narrow screens without shrinking its decoration', async ({
	page
}) => {
	await page.setViewportSize({ width: 320, height: 640 })
	await page.goto(
		'/iframe.html?id=feedback-statusmessage--compact-wrapping&viewMode=story'
	)
	const feedback = page.getByRole('status')
	await expect(feedback).toBeVisible()
	await expect(feedback.locator('span[aria-hidden="true"]')).toHaveCount(1)
	const box = await feedback.boundingBox()
	if (!box) throw new Error('Expected compact feedback geometry')
	expect(box.x + box.width).toBeLessThanOrEqual(320)
	expect(
		await page.evaluate(() => document.documentElement.scrollWidth)
	).toBeLessThanOrEqual(320)
})
