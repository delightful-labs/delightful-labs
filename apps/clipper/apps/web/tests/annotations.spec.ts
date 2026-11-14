import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { startLocalJazzServer } from './browser-core.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from '../src/lib/backend/jazz/schema.js'
import permissions from '../src/lib/backend/jazz/permissions.js'
let authority: Awaited<ReturnType<typeof startLocalJazzServer>>, directory: string

test.beforeAll(async () => {
	directory = await mkdtemp(join(tmpdir(), 'clipper-annotations-browser-'))
	authority = await startLocalJazzServer({
		appId: '2db98ae3-fcf1-41e8-b7d3-9818496bde60',
		host: '127.0.0.1',
		port: 5181,
		dataDir: directory,
		schema: app,
		permissions
	})
})
test.afterAll(async () => {
	await authority?.stop()
	await rm(directory, { recursive: true, force: true })
})
async function seed(page: Page) {
	await page.goto('/')
	await expect(page.getByRole('region', { name: 'Saved articles', exact: true })).toBeVisible()
	const id = await page.evaluate(async () => {
		const path = '/tests/reader-driver.ts'
		return (await import(/* @vite-ignore */ path)).seedReader(
			'https://example.com/annotation-browser',
			1
		)
	})
	await page.getByRole('link', { name: 'Reader experience fixture', exact: true }).click()
	await expect(page).toHaveURL(new RegExp('/articles/' + id))
	await expect(page.getByRole('button', { name: 'Add note', exact: true })).toBeEnabled()
}

test('creates a Unicode highlight, autosaves a native note and restores both after reload and removal', async ({
	page
}) => {
	await seed(page)
	const paragraph = page
		.getByRole('article')
		.getByRole('paragraph')
		.filter({ hasText: 'Paragraph 1.' })
		.first()
	const quote = await paragraph.evaluate((node) => {
		const text = node.firstChild
		if (!(text instanceof Text)) throw new Error('Expected paragraph text')
		const range = document.createRange()
		range.setStart(text, 0)
		range.setEnd(text, 50)
		const selection = window.getSelection()
		if (!selection) throw new Error('Selection unavailable')
		selection.removeAllRanges()
		selection.addRange(range)
		return range.toString()
	})
	await page.getByRole('button', { name: 'Add highlight', exact: true }).click()
	await expect(page.getByRole('blockquote')).toHaveText(quote)
	const group = page.getByRole('group', { name: 'highlight', exact: true })
	await group.getByRole('button', { name: 'Add note', exact: true }).click()
	const note = group.getByRole('textbox', { name: 'note', exact: true })
	await note.fill('Remember the café and 🦊 passage.')
	await expect(page.getByText('note synced', { exact: true })).toBeVisible()
	await expect(page.getByRole('region', { name: 'highlights', exact: true })).toHaveAttribute(
		'aria-busy',
		'false'
	)
	await page.reload()
	await expect(page.getByRole('blockquote')).toHaveText(quote)
	await expect(group.getByRole('textbox', { name: 'note', exact: true })).toHaveValue(
		'Remember the café and 🦊 passage.'
	)
	await expect
		.poll(() => page.evaluate(() => CSS.highlights.get('clipper-annotations')?.size ?? 0))
		.toBe(1)
	await group.getByRole('button', { name: 'Remove highlight', exact: true }).click()
	await expect(page.getByRole('blockquote')).toHaveCount(0)
	await page.getByRole('button', { name: 'Restore highlight', exact: true }).click()
	await expect(page.getByRole('blockquote')).toHaveText(quote)
	await expect(group.getByRole('textbox', { name: 'note', exact: true })).toHaveValue(
		'Remember the café and 🦊 passage.'
	)
	await group.getByRole('button', { name: 'Remove note', exact: true }).click()
	await expect(group.getByRole('textbox')).toHaveCount(0)
	await expect(page.getByRole('blockquote')).toHaveText(quote)
})

test('autosaves a document note through the native text adapter without a selection', async ({
	page
}) => {
	await seed(page)
	await page.getByRole('button', { name: 'Add note', exact: true }).click()
	const field = page.getByRole('textbox', { name: 'note', exact: true })
	await field.pressSequentially('A document note.')
	await expect(page.getByText('note synced', { exact: true })).toBeVisible()
	await expect(page.getByRole('region', { name: 'highlights', exact: true })).toHaveAttribute(
		'aria-busy',
		'false'
	)
	await page.reload()
	await expect(field).toHaveValue('A document note.')
})

test('retains oversized input locally across reload, then saves an explicitly shortened recovery', async ({
	page
}) => {
	await seed(page)
	await page.getByRole('button', { name: 'Add note', exact: true }).click()
	const field = page.getByRole('textbox', { name: 'note', exact: true })
	await field.fill('Previously saved text.')
	await expect(page.getByText('note synced', { exact: true })).toBeVisible()
	await expect(page.getByRole('region', { name: 'highlights', exact: true })).toHaveAttribute(
		'aria-busy',
		'false'
	)
	const pasted = 'Recoverable café 🦊 input. '.repeat(180)
	await field.fill(pasted)
	await expect(
		page.getByText('note exceeds the current save limit.', { exact: true })
	).toBeVisible()
	await expect(page.getByRole('region', { name: 'highlights', exact: true })).toHaveAttribute(
		'aria-busy',
		'false'
	)
	await page.reload()
	await expect(page.getByRole('textbox', { name: 'note', exact: true }).first()).toHaveValue(
		'Previously saved text.'
	)
	await expect(page.getByRole('textbox', { name: 'note', exact: true }).nth(1)).toHaveValue(pasted)
	await page.getByRole('button', { name: 'Keep this text', exact: true }).click()
	await expect(page.getByRole('textbox', { name: 'note', exact: true }).first()).toHaveValue(pasted)
	await page
		.getByRole('textbox', { name: 'note', exact: true })
		.first()
		.fill('Explicitly shortened recovery.')
	await expect(page.getByText('note synced', { exact: true })).toBeVisible()
	await expect(page.getByRole('region', { name: 'highlights', exact: true })).toHaveAttribute(
		'aria-busy',
		'false'
	)
	await page.reload()
	await expect(page.getByRole('textbox', { name: 'note', exact: true })).toHaveValue(
		'Explicitly shortened recovery.'
	)
})
