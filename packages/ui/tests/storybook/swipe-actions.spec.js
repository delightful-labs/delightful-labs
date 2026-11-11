import { expect, test } from '@playwright/test'

const actionsName = 'Actions for Building a local library'

/** @param {import('@playwright/test').Page} page @param {string} [story] */
async function openStory(page, story = 'both-directions') {
	await page.goto(
		`/iframe.html?id=layout-swipeactions--${story}&viewMode=story`
	)
	const group = page.getByRole('group', { name: actionsName, exact: true })
	await expect(group.getByRole('link')).toBeVisible()
	await expect(group.getByRole('button')).toHaveCount(0)
	return group
}

/** @param {import('@playwright/test').Locator} group @param {'left' | 'right'} direction */
async function gesture(group, direction) {
	const box = await group.boundingBox()
	if (!box) throw new Error('Expected visible swipe row')
	return {
		x: direction === 'right' ? box.x + 12 : box.x + box.width - 12,
		y: box.y + box.height / 2,
		width: box.width,
		sign: direction === 'right' ? 1 : -1
	}
}

/** @param {import('@playwright/test').Page} page @param {import('@playwright/test').Locator} group @param {number} ratio @param {'left' | 'right'} [direction] */
async function drag(page, group, ratio, direction = 'right') {
	const point = await gesture(group, direction)
	await page.mouse.move(point.x, point.y)
	await page.mouse.down()
	await page.mouse.move(point.x + point.sign * point.width * ratio, point.y, {
		steps: 14
	})
	return point
}

test('native links remain usable by click and keyboard while closed', async ({
	page
}) => {
	let group = await openStory(page)
	await group.getByRole('link').click()
	await expect(page).toHaveURL(/#saved-article$/)
	group = await openStory(page)
	await group.getByRole('link').focus()
	await group.getByRole('link').press('Enter')
	await expect(page).toHaveURL(/#saved-article$/)
})

test('keyboard arrows slide the same hidden drawer without an extra menu or button', async ({
	page,
	browserName
}) => {
	const group = await openStory(page)
	const row = group.getByRole('link')
	const original = await group.boundingBox()
	await row.focus()
	await row.press('ArrowRight')
	const archive = group.getByRole('button', { name: 'Archive', exact: true })
	await expect(archive).toBeFocused()
	await expect(
		group.getByRole('button', { name: 'Favorite', exact: true })
	).toHaveCount(0)
	const revealed = await group.boundingBox()
	if (!original || !revealed) throw new Error('Expected row bounds')
	expect(revealed.height).toBe(original.height)
	// WebKit's default macOS keyboard mode uses Option+Tab to include buttons.
	await archive.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab')
	await expect(
		group.getByRole('button', { name: 'Delete', exact: true })
	).toBeFocused()
	await page.keyboard.press('Escape')
	await expect(row).toBeFocused()
	await expect(group.getByRole('button')).toHaveCount(0)
	await row.press('ArrowLeft')
	await expect(
		group.getByRole('button', { name: 'Favorite', exact: true })
	).toBeFocused()
	await group
		.getByRole('button', { name: 'Favorite', exact: true })
		.press('Enter')
	await expect(page.locator('output[aria-label="Chosen action"]')).toHaveText(
		'favorite / right / button'
	)
	await expect(page.locator('output[aria-label="Action count"]')).toHaveText(
		'1'
	)
	await expect(row).toBeFocused()
	await expect(group.getByRole('button')).toHaveCount(0)
})

for (const { direction, first, last, side } of [
	{ direction: 'right', first: 'Archive', last: 'delete', side: 'left' },
	{ direction: 'left', first: 'Favorite', last: 'unread', side: 'right' }
]) {
	test(`short ${direction} swipes reveal native buttons without following the link`, async ({
		page
	}) => {
		const group = await openStory(page)
		const closed = await group.boundingBox()
		await drag(page, group, 0.18, direction === 'right' ? 'right' : 'left')
		await page.mouse.up()
		await expect(
			group.getByRole('button', { name: first, exact: true })
		).toBeVisible()
		const opened = await group.boundingBox()
		const content = await group.getByRole('link').boundingBox()
		if (!closed || !opened || !content) throw new Error('Expected row bounds')
		expect(opened.height).toBe(closed.height)
		expect(opened.y).toBe(closed.y)
		expect(
			direction === 'right' ? content.x > closed.x : content.x < closed.x
		).toBe(true)
		await expect(page.locator('output[aria-label="Action count"]')).toHaveText(
			'0'
		)
		await expect(page).not.toHaveURL(/#saved-article$/)
		await group.getByRole('button', { name: first, exact: true }).click()
		await expect(page.locator('output[aria-label="Chosen action"]')).toHaveText(
			`${first.toLowerCase()} / ${side} / button`
		)
		await expect(page.locator('output[aria-label="Action count"]')).toHaveText(
			'1'
		)
	})

	test(`full ${direction} swipes choose the final action only on release`, async ({
		page
	}) => {
		const group = await openStory(page)
		await drag(page, group, 0.91, direction === 'right' ? 'right' : 'left')
		await expect(page.locator('output[aria-label="Action count"]')).toHaveText(
			'0'
		)
		await expect(group.getByRole('status')).toHaveText(
			side === 'left' ? 'Delete' : 'Mark unread'
		)
		await page.mouse.up()
		await expect(page.locator('output[aria-label="Chosen action"]')).toHaveText(
			`${last} / ${side} / swipe`
		)
		await expect(page.locator('output[aria-label="Action count"]')).toHaveText(
			'1'
		)
		await expect(page).not.toHaveURL(/#saved-article$/)
		if (side === 'left') await expect(group).toHaveCount(0)
		else await expect(group.getByRole('link')).toBeVisible()
	})
}

test('progressive actions can be armed and reversed before release', async ({
	page
}) => {
	const group = await openStory(page, 'three-progressive-actions')
	const point = await drag(page, group, 0.4)
	await expect(group.getByRole('status')).toHaveText('Archive')
	await page.mouse.move(point.x + point.width * 0.7, point.y, { steps: 8 })
	await expect(group.getByRole('status')).toHaveText('Move to trash')
	await page.mouse.move(point.x + point.width * 0.92, point.y, { steps: 8 })
	await expect(group.getByRole('status')).toHaveText('Delete permanently')
	await page.mouse.move(point.x + point.width * 0.7, point.y, { steps: 8 })
	await expect(group.getByRole('status')).toHaveText('Move to trash')
	await page.mouse.up()
	await expect(page.locator('output[aria-label="Chosen action"]')).toHaveText(
		'trash / left / swipe'
	)
	await expect(page.locator('output[aria-label="Action count"]')).toHaveText(
		'1'
	)
})

test('the three-action preview dismisses its row on the final full swipe', async ({
	page
}) => {
	const group = await openStory(page, 'three-progressive-actions')
	await drag(page, group, 0.91)
	await expect(group.getByRole('status')).toHaveText('Delete permanently')
	await page.mouse.up()
	await expect(page.locator('output[aria-label="Chosen action"]')).toHaveText(
		'delete / left / swipe'
	)
	await expect(page.locator('output[aria-label="Action count"]')).toHaveText(
		'1'
	)
	await expect(group).toHaveCount(0)
	await page.getByRole('button', { name: 'Reset item', exact: true }).click()
	await expect(group.getByRole('link')).toBeVisible()
})

for (const { direction, expected } of [
	{ direction: 'right', expected: 'trash / left / swipe' },
	{ direction: 'left', expected: 'archive / right / swipe' }
]) {
	test(`an opted-in final action slides out ${direction} before notifying and can be reset`, async ({
		page
	}) => {
		const group = await openStory(page, 'dismiss-on-full-swipe')
		const row = page.getByRole('group', {
			name: actionsName,
			exact: true,
			includeHidden: true
		})
		const original = await row.boundingBox()
		if (!original) throw new Error('Expected row bounds')
		await row.evaluate((element) =>
			element.style.setProperty('--dui-swipe-duration', '1s')
		)
		await drag(page, group, 0.91, direction === 'right' ? 'right' : 'left')
		await page.mouse.up()
		const running = await row.evaluate((element) => {
			const animations = element.getAnimations({ subtree: true })
			animations.forEach((animation) => animation.pause())
			return animations.length
		})
		expect(running).toBeGreaterThan(0)
		await expect(page.locator('output[aria-label="Action count"]')).toHaveText(
			'0'
		)
		await expect(row).toHaveAttribute('inert', '')
		const finalFill = row
			.getByRole('button', {
				name: direction === 'right' ? 'Trash' : 'Archive',
				exact: true,
				includeHidden: true
			})
			.last()
			.locator('span[aria-hidden="true"]')
		const exit = await finalFill.evaluate((fill) => {
			const element = fill.closest('[role="group"]')
			const link = element?.querySelector('a')
			if (!element || !link) throw new Error('Expected the retained swipe row')
			element
				.getAnimations({ subtree: true })
				.forEach((animation) => animation.finish())
			const { left, right } = link.getBoundingClientRect()
			const expanded = fill.getBoundingClientRect()
			return {
				left,
				right,
				fillLeft: expanded.left,
				fillRight: expanded.right,
				fillHeight: expanded.height
			}
		})
		expect(exit.fillLeft).toBeLessThanOrEqual(original.x + 0.1)
		expect(exit.fillRight).toBeGreaterThanOrEqual(
			original.x + original.width - 0.1
		)
		expect(exit.fillHeight).toBeCloseTo(original.height, 1)
		if (direction === 'right')
			expect(exit.left).toBeGreaterThanOrEqual(
				original.x + original.width - 0.1
			)
		else expect(exit.right).toBeLessThanOrEqual(original.x + 0.1)
		await expect(page.locator('output[aria-label="Chosen action"]')).toHaveText(
			expected
		)
		await expect(page.locator('output[aria-label="Action count"]')).toHaveText(
			'1'
		)
		await expect(row).toHaveAttribute('hidden', '')
		await expect(page).not.toHaveURL(/#saved-article$/)
		await page.getByRole('button', { name: 'Reset item', exact: true }).click()
		await expect(group.getByRole('link')).toBeVisible()
		await expect(page.locator('output[aria-label="Action count"]')).toHaveText(
			'1'
		)
	})
}

test('dismissal finishes with reduced motion without waiting for a transition event', async ({
	page
}) => {
	await page.emulateMedia({ reducedMotion: 'reduce' })
	const group = await openStory(page, 'dismiss-on-full-swipe')
	await drag(page, group, 0.91)
	await page.mouse.up()
	await expect(page.locator('output[aria-label="Chosen action"]')).toHaveText(
		'trash / left / swipe'
	)
	await expect(page.locator('output[aria-label="Action count"]')).toHaveText(
		'1'
	)
	await expect(group).toHaveCount(0)
})

test('tapping a dismissal action after a short swipe still reports an ordinary button choice', async ({
	page
}) => {
	const group = await openStory(page, 'dismiss-on-full-swipe')
	await drag(page, group, 0.18)
	await page.mouse.up()
	await group.getByRole('button', { name: 'Trash', exact: true }).click()
	await expect(page.locator('output[aria-label="Chosen action"]')).toHaveText(
		'trash / left / button'
	)
	await expect(group.getByRole('link')).toBeVisible()
})

test('an opted-in full swipe can be cancelled or reversed before release', async ({
	page
}) => {
	const group = await openStory(page, 'dismiss-on-full-swipe')
	const original = await group.boundingBox()
	if (!original) throw new Error('Expected row bounds')
	await drag(page, group, 0.91)
	await page.keyboard.press('Escape')
	await page.mouse.up()
	await expect(group.getByRole('link')).toBeVisible()
	await expect(page.locator('output[aria-label="Action count"]')).toHaveText(
		'0'
	)
	await expect
		.poll(async () => (await group.getByRole('link').boundingBox())?.x)
		.toBeCloseTo(original.x, 1)
	const point = await drag(page, group, 0.91)
	await page.mouse.move(point.x + point.width * 0.18, point.y, { steps: 12 })
	await page.mouse.up()
	await expect(
		group.getByRole('button', { name: 'Trash', exact: true })
	).toBeVisible()
	await expect(page.locator('output[aria-label="Action count"]')).toHaveText(
		'0'
	)
})

for (const direction of /** @type {const} */ (['right', 'left'])) {
	test(`wrapped text keeps its line layout throughout a ${direction} swipe`, async ({
		page
	}) => {
		await page.setViewportSize({ width: 390, height: 844 })
		const group = await openStory(page, 'wrapping-labels')
		await page.evaluate(() => document.fonts.ready)
		const point = await drag(page, group, 0.18, direction)
		const originalRow = await group.boundingBox()
		const textLayout = () =>
			group.evaluate((element) => {
				/** @param {Element} target */
				function lines(target) {
					const top = target.getBoundingClientRect().top
					const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT)
					const result = []
					let text
					while ((text = walker.nextNode())) {
						if (!text.textContent?.trim()) continue
						const range = document.createRange()
						range.selectNodeContents(text)
						for (const rect of range.getClientRects())
							result.push({
								y: rect.top - top,
								width: rect.width,
								height: rect.height
							})
					}
					return result
				}
				const link = element.querySelector('a')
				if (!link) throw new Error('Expected a row link')
				return {
					row: lines(link),
					actions: [...element.querySelectorAll('button')].map(lines)
				}
			})
		const originalText = await textLayout()
		expect(originalText.row.length).toBeGreaterThan(2)
		expect(originalText.actions.every((lines) => lines.length > 1)).toBe(true)
		for (const ratio of [0.4, 0.7, 0.92, 0.7, 0.4, 0.18]) {
			await page.mouse.move(
				point.x + point.sign * point.width * ratio,
				point.y,
				{ steps: 8 }
			)
			const currentText = await textLayout()
			const originalLines = [originalText.row, ...originalText.actions]
			for (const [index, lines] of [
				currentText.row,
				...currentText.actions
			].entries()) {
				expect(lines).toHaveLength(originalLines[index].length)
				for (const [lineIndex, line] of lines.entries()) {
					const original = originalLines[index][lineIndex]
					// Transforms can introduce tiny floating-point differences in DOM rectangles.
					expect(line.y).toBeCloseTo(original.y, 1)
					expect(line.width).toBeCloseTo(original.width, 1)
					expect(line.height).toBeCloseTo(original.height, 1)
				}
			}
			expect(await group.boundingBox()).toEqual(originalRow)
		}
		// Crossing an action threshold must not redistribute space between buttons.
		const labelBounds = () =>
			group.locator('button > span:not([aria-hidden])').evaluateAll((labels) =>
				labels.map((label) => {
					const { x, width, height } = label.getBoundingClientRect()
					return { x, width, height }
				})
			)
		for (const threshold of [0.35, 0.625, 0.9]) {
			const x = point.x + point.sign * point.width * threshold
			await page.mouse.move(x - point.sign, point.y, { steps: 8 })
			const before = await labelBounds()
			await page.mouse.move(x + point.sign, point.y)
			const after = await labelBounds()
			for (const [index, label] of after.entries()) {
				expect(Math.abs(label.x - before[index].x)).toBeLessThanOrEqual(2.05)
				expect(label.width).toBeCloseTo(before[index].width, 2)
				expect(label.height).toBeCloseTo(before[index].height, 2)
			}
		}
		await page.mouse.move(point.x + point.sign * point.width * 0.18, point.y, {
			steps: 8
		})
		await page.mouse.up()
		await expect(page.locator('output[aria-label="Action count"]')).toHaveText(
			'0'
		)
	})
}

test('an armed swipe can retreat to a drawer and Escape cancels without navigation', async ({
	page
}) => {
	const group = await openStory(page)
	const point = await drag(page, group, 0.91)
	await page.mouse.move(point.x + point.width * 0.18, point.y, { steps: 12 })
	await page.mouse.up()
	await expect(
		group.getByRole('button', { name: 'Archive', exact: true })
	).toBeVisible()
	await expect(page.locator('output[aria-label="Action count"]')).toHaveText(
		'0'
	)
	await group.getByRole('button', { name: 'Archive', exact: true }).focus()
	await page.keyboard.press('Escape')
	await expect(group.getByRole('link')).toBeFocused()
	await drag(page, group, 0.5)
	await page.keyboard.press('Escape')
	await page.mouse.up()
	await expect(page.locator('output[aria-label="Action count"]')).toHaveText(
		'0'
	)
	await expect(page).not.toHaveURL(/#saved-article$/)
})

test('dragging toward an unavailable side does not activate the link', async ({
	page
}) => {
	const group = await openStory(page, 'one-side')
	await drag(page, group, 0.7, 'left')
	await page.mouse.up()
	await expect(page.locator('output[aria-label="Action count"]')).toHaveText(
		'0'
	)
	await expect(page).not.toHaveURL(/#saved-article$/)
	await group.getByRole('link').click()
	await expect(page).toHaveURL(/#saved-article$/)
})

test('disabled action buttons remain disabled and the first enabled action receives focus', async ({
	page
}) => {
	const group = await openStory(page, 'disabled-actions')
	await group.getByRole('link').focus()
	await group.getByRole('link').press('ArrowRight')
	await expect(
		group.getByRole('button', { name: 'Archive', exact: true })
	).toBeDisabled()
	await expect(
		group.getByRole('button', { name: 'Delete', exact: true })
	).toBeFocused()
	await group
		.getByRole('button', { name: 'Delete', exact: true })
		.press('Enter')
	await expect(page.locator('output[aria-label="Chosen action"]')).toHaveText(
		'delete / left / button'
	)
})

test('disabling an armed interaction cancels its action and compatibility click', async ({
	page
}) => {
	const group = await openStory(page, 'disable-while-swiping')
	await drag(page, group, 0.5)
	await expect(group.getByRole('status')).toHaveText('Archive')
	await page
		.getByRole('button', { name: 'Toggle swipe actions' })
		.evaluate((button) => {
			if (button instanceof HTMLButtonElement) button.click()
		})
	await expect(group.getByRole('status')).toHaveText('')
	await page.mouse.up()
	await expect(page.locator('output[aria-label="Action count"]')).toHaveText(
		'0'
	)
	await expect(page).not.toHaveURL(/#saved-article$/)
})

test('a row-width change cancels an armed interaction', async ({ page }) => {
	await page.setViewportSize({ width: 700, height: 844 })
	const group = await openStory(page)
	await drag(page, group, 0.5)
	await expect(group.getByRole('status')).toHaveText('Archive')
	await page.setViewportSize({ width: 320, height: 844 })
	await expect(group.getByRole('status')).toHaveText('')
	await page.mouse.up()
	await expect(page.locator('output[aria-label="Action count"]')).toHaveText(
		'0'
	)
	await expect(page).not.toHaveURL(/#saved-article$/)
})

test('the underlying drawer fits a narrow viewport and works with reduced motion', async ({
	page
}) => {
	await page.setViewportSize({ width: 320, height: 700 })
	await page.emulateMedia({ reducedMotion: 'reduce' })
	const group = await openStory(page)
	await group.getByRole('link').focus()
	await group.getByRole('link').press('ArrowLeft')
	for (const button of await group.getByRole('button').all()) {
		const box = await button.boundingBox()
		if (!box) throw new Error('Expected a visible action button')
		expect(box.x).toBeGreaterThanOrEqual(0)
		expect(box.x + box.width).toBeLessThanOrEqual(320)
	}
	await group.getByRole('button', { name: 'Favorite', exact: true }).click()
	await expect(page.locator('output[aria-label="Chosen action"]')).toHaveText(
		'favorite / right / button'
	)
})

test('opening another row closes the previous row without stealing focus', async ({
	page
}) => {
	await page.goto(
		'/iframe.html?id=layout-swipeactions--scrollable-mobile-list&viewMode=story'
	)
	const first = page.getByRole('group', {
		name: 'Actions for article 1',
		exact: true
	})
	const second = page.getByRole('group', {
		name: 'Actions for article 2',
		exact: true
	})
	await first.getByRole('link').focus()
	await first.getByRole('link').press('ArrowRight')
	await expect(
		first.getByRole('button', { name: 'Archive', exact: true })
	).toBeFocused()
	await second.getByRole('link').focus()
	await second.getByRole('link').press('ArrowRight')
	await expect(
		second.getByRole('button', { name: 'Archive', exact: true })
	).toBeFocused()
	await expect(
		first.getByRole('button', { name: 'Archive', exact: true })
	).toHaveCount(0)
})

test('mobile taps select buttons in the revealed underlying drawer', async ({
	page,
	isMobile
}) => {
	test.skip(!isMobile, 'Uses a touch-enabled mobile browser context')
	const group = await openStory(page)
	await drag(page, group, 0.18, 'left')
	await page.mouse.up()
	await group.getByRole('button', { name: 'Favorite', exact: true }).tap()
	await expect(page.locator('output[aria-label="Chosen action"]')).toHaveText(
		'favorite / right / button'
	)
})

/** @param {import('@playwright/test').Page} page @param {import('@playwright/test').CDPSession} session @param {{x:number,y:number}[]} points @param {boolean} [cancel] */
async function touchGesture(page, session, points, cancel = false) {
	const first = points[0]
	if (!first) throw new Error('Touch gesture needs a start point')
	await session.send('Input.dispatchTouchEvent', {
		type: 'touchStart',
		touchPoints: [{ ...first, id: 0 }]
	})
	for (const point of points.slice(1)) {
		await session.send('Input.dispatchTouchEvent', {
			type: 'touchMove',
			touchPoints: [{ ...point, id: 0 }]
		})
		await page.evaluate(
			() => new Promise((resolve) => requestAnimationFrame(resolve))
		)
	}
	await session.send('Input.dispatchTouchEvent', {
		type: cancel ? 'touchCancel' : 'touchEnd',
		touchPoints: []
	})
}

/** @param {{x:number,y:number}} from @param {{x:number,y:number}} to */
function path(from, to) {
	return Array.from({ length: 16 }, (_, index) => ({
		x: from.x + ((to.x - from.x) * index) / 15,
		y: from.y + ((to.y - from.y) * index) / 15
	}))
}

test.describe('native mobile touch gestures', () => {
	test.beforeEach(({ browserName, isMobile }) => {
		test.skip(
			browserName !== 'chromium' || !isMobile,
			'Native touch movement uses Chromium CDP; WebKit uses native taps and pointer tests'
		)
	})

	test('full touch swipes dismiss in both directions and report one action each', async ({
		page
	}) => {
		const group = await openStory(page, 'dismiss-on-full-swipe')
		const session = await page.context().newCDPSession(page)
		for (const { direction, expected } of [
			{ direction: 'right', expected: 'trash / left / swipe' },
			{ direction: 'left', expected: 'archive / right / swipe' }
		]) {
			const point = await gesture(
				group,
				direction === 'right' ? 'right' : 'left'
			)
			await touchGesture(
				page,
				session,
				path(point, {
					x: point.x + point.sign * point.width * 0.91,
					y: point.y
				})
			)
			await expect(
				page.locator('output[aria-label="Chosen action"]')
			).toHaveText(expected)
			await expect(group).toHaveCount(0)
			await page.getByRole('button', { name: 'Reset item', exact: true }).tap()
			await expect(group.getByRole('link')).toBeVisible()
		}
		await expect(page.locator('output[aria-label="Action count"]')).toHaveText(
			'2'
		)
		await expect(page).not.toHaveURL(/#saved-article$/)
		await session.detach()
	})

	test('short touch swipes reveal the underlay for a native action tap in both directions', async ({
		page
	}) => {
		const group = await openStory(page)
		const session = await page.context().newCDPSession(page)
		const closed = await group.boundingBox()
		for (const { direction, label, expected } of [
			{
				direction: 'right',
				label: 'Archive',
				expected: 'archive / left / button'
			},
			{
				direction: 'left',
				label: 'Favorite',
				expected: 'favorite / right / button'
			}
		]) {
			const p = await gesture(group, direction === 'right' ? 'right' : 'left')
			await touchGesture(
				page,
				session,
				path(p, { x: p.x + p.sign * p.width * 0.18, y: p.y })
			)
			const action = group.getByRole('button', { name: label, exact: true })
			await expect(action).toBeVisible()
			const opened = await group.boundingBox()
			if (!closed || !opened) throw new Error('Expected row bounds')
			expect(opened.height).toBe(closed.height)
			await action.tap()
			await expect(
				page.locator('output[aria-label="Chosen action"]')
			).toHaveText(expected)
			await expect(page).not.toHaveURL(/#saved-article$/)
		}
		await expect(page.locator('output[aria-label="Action count"]')).toHaveText(
			'2'
		)
		await session.detach()
	})

	test('touch swipes choose progressive actions in both directions without navigating', async ({
		page
	}) => {
		const group = await openStory(page)
		const session = await page.context().newCDPSession(page)
		for (const { direction, ratio, expected } of [
			{ direction: 'right', ratio: 0.45, expected: 'archive / left / swipe' },
			{ direction: 'left', ratio: 0.91, expected: 'unread / right / swipe' }
		]) {
			const p = await gesture(group, direction === 'right' ? 'right' : 'left')
			await touchGesture(
				page,
				session,
				path(p, { x: p.x + p.sign * p.width * ratio, y: p.y })
			)
			await expect(
				page.locator('output[aria-label="Chosen action"]')
			).toHaveText(expected)
			await expect(page).not.toHaveURL(/#saved-article$/)
		}
		await expect(page.locator('output[aria-label="Action count"]')).toHaveText(
			'2'
		)
		await session.detach()
	})

	test('touch cancellation cannot choose an armed action', async ({ page }) => {
		const group = await openStory(page)
		const session = await page.context().newCDPSession(page)
		const p = await gesture(group, 'right')
		await touchGesture(
			page,
			session,
			path(p, { x: p.x + p.width * 0.5, y: p.y }),
			true
		)
		await expect(page.locator('output[aria-label="Action count"]')).toHaveText(
			'0'
		)
		await expect(group.getByRole('status')).toHaveText('')
		await expect(page).not.toHaveURL(/#saved-article$/)
		await session.detach()
	})

	test('vertical touch scrolling remains native and chooses no row action', async ({
		page
	}) => {
		await page.goto(
			'/iframe.html?id=layout-swipeactions--scrollable-mobile-list&viewMode=story'
		)
		const region = page.getByRole('region', {
			name: 'Scrollable saved articles'
		})
		await expect(region).toBeVisible()
		const box = await region.boundingBox()
		if (!box) throw new Error('Expected a visible scroll region')
		const session = await page.context().newCDPSession(page)
		const from = { x: box.x + box.width / 2, y: box.y + box.height - 30 }
		await touchGesture(
			page,
			session,
			path(from, { x: from.x + 2, y: box.y + 35 })
		)
		await expect
			.poll(() => region.evaluate((node) => node.scrollTop))
			.toBeGreaterThan(0)
		await expect(page.locator('output[aria-label="Action count"]')).toHaveText(
			'0'
		)
		await expect(page).not.toHaveURL(/#article-\d+$/)
		await session.detach()
	})
})
