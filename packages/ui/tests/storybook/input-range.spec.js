import { expect, test } from '@playwright/test'

test('keyboard arrows respect steps and stay within native bounds', async ({
	page
}) => {
	await page.goto('/iframe.html?id=inputs-range--default&viewMode=story')
	const slider = page.getByRole('slider', { name: 'Contrast', exact: true })
	await expect(slider).toHaveValue('100')
	await slider.focus()
	await slider.press('ArrowRight')
	await expect(slider).toHaveValue('101')
	await slider.press('ArrowLeft')
	await expect(slider).toHaveValue('100')
	await slider.press('Home')
	await slider.press('ArrowLeft')
	await expect(slider).toHaveValue('0')
	await slider.press('End')
	await slider.press('ArrowRight')
	await expect(slider).toHaveValue('200')
})

test('fractional steps remain precise', async ({ page }) => {
	await page.goto(
		'/iframe.html?id=inputs-range--fractional-steps&viewMode=story'
	)
	const slider = page.getByRole('slider', { name: 'Contrast', exact: true })
	await expect(slider).toHaveValue('1')
	await slider.focus()
	await slider.press('ArrowRight')
	await expect(slider).toHaveValue('1.05')
	await slider.press('ArrowLeft')
	await expect(slider).toHaveValue('1')
})

test('disabled sliders use native disabled semantics', async ({ page }) => {
	await page.goto('/iframe.html?id=inputs-range--disabled&viewMode=story')
	await expect(
		page.getByRole('slider', { name: 'Contrast', exact: true })
	).toBeDisabled()
})

test('numeric bindings follow user edits, parent updates, native submission and reset', async ({
	page
}) => {
	await page.goto(
		'/iframe.html?id=inputs-range--form-submission&viewMode=story'
	)
	const slider = page.getByRole('slider', { name: 'Contrast', exact: true })
	const bound = page.getByRole('status', { name: 'Bound value' })
	await expect(bound).toHaveText('number: 100')
	await slider.focus()
	await slider.press('ArrowRight')
	await expect(bound).toHaveText('number: 101')
	await page.getByRole('button', { name: 'Set contrast', exact: true }).click()
	await expect(slider).toHaveValue('150')
	await expect(bound).toHaveText('number: 150')
	await page.getByRole('button', { name: 'Submit', exact: true }).click()
	await expect(page.locator('pre[aria-live="polite"]')).toHaveText(
		'[["contrast","150"]]'
	)
	await page.getByRole('button', { name: 'Reset', exact: true }).click()
	await expect(slider).toHaveValue('100')
	await expect(bound).toHaveText('number: 100')
})

test('contrast popover supports keyboard entry, live binding, dismissal and reset', async ({
	page
}) => {
	await page.goto(
		'/iframe.html?id=inputs-range--contrast-popover&viewMode=story'
	)
	const trigger = page.getByRole('button', {
		name: 'Adjust contrast',
		exact: true
	})
	const popover = page.getByLabel('Adjust contrast', { exact: true })
	await expect(popover).toBeHidden()
	await trigger.focus()
	await trigger.press('Enter')
	await expect(popover).toBeVisible()
	await page.keyboard.press('Tab')
	const slider = popover.getByRole('slider', { name: 'Contrast', exact: true })
	await expect(slider).toBeFocused()
	await slider.press('ArrowRight')
	await expect(popover.getByRole('status')).toHaveText('101%')
	await slider.press('Escape')
	await expect(popover).toBeHidden()
	await expect(trigger).toBeFocused()
	await trigger.press('Space')
	await expect(slider).toHaveValue('101')
	await popover.getByRole('button', { name: 'Reset', exact: true }).click()
	await expect(slider).toHaveValue('100')
	await expect(popover.getByRole('status')).toHaveText('100%')
})
