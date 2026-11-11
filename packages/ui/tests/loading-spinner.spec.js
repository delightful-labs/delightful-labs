import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
	await page.goto('/')
})

test('loading state controls busy content and status visibility without moving focus', async ({
	page
}) => {
	const section = page.getByRole('region', {
		name: 'LoadingSpinner',
		exact: true
	})
	const spinner = section.locator('#loading-state-preview')
	const toggle = section.getByRole('button', { name: 'Toggle loading preview' })
	await expect(spinner).toBeHidden()
	await expect(section.getByRole('status')).toHaveCount(2)
	await expect(section.locator('[aria-busy]')).toHaveAttribute(
		'aria-busy',
		'false'
	)
	await toggle.click()
	await expect(spinner).toBeVisible()
	await expect(spinner).toHaveText('Loading preview content')
	await expect(section.getByRole('status')).toHaveCount(3)
	await expect(section.locator('[aria-busy]')).toHaveAttribute(
		'aria-busy',
		'true'
	)
	await expect(toggle).toHaveAttribute('aria-pressed', 'true')
	await expect(toggle).toBeFocused()
	await toggle.press('Space')
	await expect(spinner).toBeHidden()
	await expect(section.locator('[aria-busy]')).toHaveAttribute(
		'aria-busy',
		'false'
	)
	await expect(toggle).toHaveAttribute('aria-pressed', 'false')
	await expect(toggle).toBeFocused()
})

test('default and compact ripples stay within their bounds', async ({
	page
}) => {
	await page.emulateMedia({ reducedMotion: 'no-preference' })
	const section = page.getByRole('region', {
		name: 'LoadingSpinner',
		exact: true
	})
	const spinners = section.getByRole('status')
	for (const [index, size, border] of [
		[0, 80, 4],
		[1, 32, 2]
	]) {
		const spinner = spinners.nth(index)

		const rings = spinner.locator('[aria-hidden="true"]')
		await expect(rings).toHaveCount(2)
		for (const ring of await rings.all()) {
			expect(
				await ring.evaluate((element) => element.getAnimations().length)
			).toBe(1)
			// Sample a defined animation phase rather than racing its live geometry.
			await ring.evaluate((element) => {
				for (const animation of element.getAnimations()) {
					animation.pause()
					animation.currentTime = 750
				}
			})
			const parentBox = await spinner.boundingBox()
			const ringBox = await ring.boundingBox()
			if (!parentBox || !ringBox) throw new Error('Expected spinner geometry')
			expect(ringBox.width).toBeGreaterThan(2 * border)
			expect(ringBox.x).toBeGreaterThanOrEqual(parentBox.x - 1)
			expect(ringBox.y).toBeGreaterThanOrEqual(parentBox.y - 1)
			expect(ringBox.x + ringBox.width).toBeLessThanOrEqual(
				parentBox.x + size + 1
			)
			expect(ringBox.y + ringBox.height).toBeLessThanOrEqual(
				parentBox.y + size + 1
			)
		}
	}
})

test('reduced motion presents a visible static ring at desktop and narrow widths', async ({
	page
}) => {
	await page.emulateMedia({ reducedMotion: 'reduce' })
	const section = page.getByRole('region', {
		name: 'LoadingSpinner',
		exact: true
	})
	for (const width of [1280, 375]) {
		await page.setViewportSize({ width, height: 800 })
		for (const spinner of await section.getByRole('status').all()) {
			const rings = spinner.locator('[aria-hidden="true"]')
			await expect(rings.first()).toBeVisible()
			await expect(rings.last()).toBeHidden()

			const parentBox = await spinner.boundingBox()
			const ringBox = await rings.first().boundingBox()
			if (!parentBox || !ringBox)
				throw new Error('Expected static ring geometry')
			expect(ringBox.width).toBeCloseTo(parentBox.width, 1)
			expect(ringBox.height).toBeCloseTo(parentBox.height, 1)
			expect(parentBox.x).toBeGreaterThanOrEqual(0)
			expect(parentBox.x + parentBox.width).toBeLessThanOrEqual(width)
		}
	}
})
