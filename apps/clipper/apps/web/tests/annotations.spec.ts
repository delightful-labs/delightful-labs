import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { startLocalJazzServer } from './browser-core.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from '../src/lib/backend/jazz/jazz.generated.js'
import permissions from '../src/lib/backend/jazz/jazz.permissions.json'
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

test('saves a Unicode highlight and note across reload, then removes without offering restore', async ({
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
	await group.getByRole('button', { name: 'Remove note', exact: true }).click()
	await expect(group.getByRole('textbox')).toHaveCount(0)
	await expect(page.getByRole('blockquote')).toHaveText(quote)
	await group.getByRole('button', { name: 'Add note', exact: true }).click()
	await note.fill('Another attached note.')
	await expect(page.getByText('note synced', { exact: true })).toBeVisible()
	await group.getByRole('button', { name: 'Remove highlight', exact: true }).click()
	await expect(group).toHaveCount(0)
	await expect(page.getByRole('textbox', { name: 'note', exact: true })).toHaveCount(0)
	await expect(page.getByRole('button', { name: 'Restore highlight', exact: true })).toHaveCount(0)
	await expect(page.getByRole('region', { name: 'highlights', exact: true })).toHaveAttribute(
		'aria-busy',
		'false'
	)
	await page.reload()
	await expect(page.getByRole('button', { name: 'Add note', exact: true })).toBeEnabled()
	await expect(group).toHaveCount(0)
	await expect(page.getByRole('button', { name: 'Restore highlight', exact: true })).toHaveCount(0)
})

test('autosaves a document note through the native text adapter without a selection', async ({
	page
}) => {
	await seed(page)
	await page.getByRole('button', { name: 'Add note', exact: true }).click()
	const field = page.getByRole('textbox', { name: 'note', exact: true })
	const text = 'A document note typed while reader updates are arriving.'
	await field.pressSequentially(text)
	await expect(field).toHaveValue(text)
	await expect(page.getByText('note synced', { exact: true })).toBeVisible()
	await expect(page.getByRole('region', { name: 'highlights', exact: true })).toHaveAttribute(
		'aria-busy',
		'false'
	)
	await page.reload()
	await expect(field).toHaveValue(text)
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

test('marks an edit pending before worker delivery and clears the previous synced message', async ({
	page
}) => {
	await page.addInitScript(() => {
		const post = Worker.prototype.postMessage
		let held = true
		const waiting: (() => void)[] = []
		window.releaseAnnotationEdit = () => {
			held = false
			for (const deliver of waiting.splice(0)) deliver()
		}
		Worker.prototype.postMessage = function (
			this: Worker,
			message: import('../src/lib/runtime/worker/protocol.js').RuntimeCommand,
			options: StructuredSerializeOptions | Transferable[] = []
		) {
			const deliver = () => Reflect.apply(post, this, [message, options])
			if (
				held &&
				message.type === 'LIBRARY' &&
				message.event.type === 'ANNOTATION' &&
				message.event.command.type === 'EDIT_NOTE'
			)
				waiting.push(deliver)
			else deliver()
		}
	})
	await seed(page)
	await page.getByRole('button', { name: 'Add note', exact: true }).click()
	await expect(page.getByText('note synced', { exact: true })).toBeVisible()
	const field = page.getByRole('textbox', { name: 'note', exact: true })
	await field.fill('An edit waiting for worker delivery.')
	await expect(page.getByRole('region', { name: 'highlights', exact: true })).toHaveAttribute(
		'aria-busy',
		'true'
	)
	await expect(page.getByText('note synced', { exact: true })).toHaveCount(0)
	await page.evaluate(() => window.releaseAnnotationEdit())
	await expect(page.getByText('note synced', { exact: true })).toBeVisible()
	await expect(page.getByRole('region', { name: 'highlights', exact: true })).toHaveAttribute(
		'aria-busy',
		'false'
	)
	await page.reload()
	await expect(field).toHaveValue('An edit waiting for worker delivery.')
})

declare global {
	interface Window {
		releaseAnnotationEdit: () => void
	}
}
