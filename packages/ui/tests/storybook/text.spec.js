import { expect, test } from '@playwright/test'

test('text wraps between words and keeps an oversized word on one line', async ({
	page
}) => {
	await page.goto(
		'/iframe.html?id=typography-text--word-wrapping&viewMode=story'
	)
	const text = page.getByText('alpha beta gamma', { exact: true })
	await expect(text).toBeVisible()
	const lines = await text.evaluate((element) => {
		const node = [...element.childNodes].find(
			(child) => child.nodeType === Node.TEXT_NODE
		)
		if (!node) throw new Error('Expected text content')
		const value = node.textContent ?? ''
		return [...value.matchAll(/\S+/g)].map((word) => {
			const range = document.createRange()
			range.setStart(node, word.index)
			range.setEnd(node, word.index + word[0].length)
			return [...range.getClientRects()].map((rect) => rect.y)
		})
	})
	expect(lines).toHaveLength(3)
	for (const word of lines) expect(word).toHaveLength(1)
	expect(new Set(lines.flat()).size).toBeGreaterThan(1)
	const longWord = page.getByText('uninterruptedword', { exact: true })
	await expect(longWord).toBeVisible()
	const fragments = await longWord.evaluate((element) => {
		const range = document.createRange()
		range.selectNodeContents(element)
		return [...range.getClientRects()].map((rect) => rect.y)
	})
	expect(new Set(fragments).size).toBe(1)
})
