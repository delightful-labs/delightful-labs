/// <reference types="chrome" />
import { chromium, expect, type BrowserContext, type Browser, type Page } from '@playwright/test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
if (!process.argv[2] || !process.argv[3])
	throw new Error(
		'Usage: node apps/extension/tooling/qualify-production.ts <unpacked-production-package> <result-json>'
	)
const packagePath = resolve(process.argv[2]),
	resultPath = resolve(process.argv[3])
const id = 'inbajlgglggigfebfkmlkfbdenddpphf',
	webUrl = 'https://clipper.delightfullabs.com'
const dir = await mkdtemp(join(tmpdir(), 'clipper-production-qualification-'))
const title = 'Monorepo production extension ' + randomUUID(),
	sourceUrl = 'https://example.com/' + randomUUID()
const result: {
	packagePath: string
	extensionId: string
	checks: string[]
	errors: string[]
	passed: boolean
	failure?: { phase: string; message: string }
} = { packagePath, extensionId: id, checks: [], errors: [], passed: false }
let context: BrowserContext | undefined
let independent: BrowserContext | undefined
let browser: Browser | undefined
let phrase = '',
	phase = 'startup'
const safe = (s: string) =>
	s
		.replaceAll(phrase || '__NO_PHRASE__', '[recovery]')
		.replace(/https?:\/\/\S+/g, '[URL]')
		.slice(0, 900)
const launch = async () => {
	const c = await chromium.launchPersistentContext(join(dir, 'extension'), {
		channel: 'chromium',
		headless: true,
		args: [
			`--disable-extensions-except=${packagePath}`,
			`--load-extension=${packagePath}`,
			'--enable-unsafe-extension-debugging'
		]
	})
	context = c
	c.setDefaultTimeout(30000)
	c.on('page', (p) => p.on('pageerror', (e) => result.errors.push(safe(e.message))))
	await c.route('https://example.com/**', (r) =>
		r.fulfill({
			contentType: 'text/html',
			body: `<!doctype html><html lang="en"><head><title>${title}</title><meta name="description" content="A production package qualification excerpt."><meta name="author" content="Qualification fixture"></head><body><article><h1>${title}</h1><p id="rendered"></p>${'<p>This article checks independent rendered document capture and durable private reading from the production extension package. Useful readable paragraphs preserve the visible words and formatting for later reading.</p>'.repeat(14)}<form><input value="DO_NOT_CAPTURE_FORM_SECRET"></form><script>document.querySelector('#rendered').textContent='Only present after JavaScript rendering.';</script></article></body></html>`
		})
	)
	const worker =
		c.serviceWorkers().find((w) => new URL(w.url()).host === id) ??
		(await c.waitForEvent('serviceworker', { predicate: (w) => new URL(w.url()).host === id }))
	await expect.poll(() => worker.evaluate(() => chrome.action.onClicked.hasListeners())).toBe(true)
	return c
}
const worker = () => {
	const found = context?.serviceWorkers().find((w) => new URL(w.url()).host === id)
	if (!found) throw new Error('Extension background worker unavailable')
	return found
}
const connected = () =>
	worker().evaluate(async () =>
		Boolean((await chrome.storage.local.get('clipper.connection'))['clipper.connection'])
	)
const toolbar = async (page: Page) => {
	await page.bringToFront()
	const nativeBrowser = context?.browser()
	if (!nativeBrowser) throw new Error('Chromium context unavailable')
	const cdp = await nativeBrowser.newBrowserCDPSession()
	try {
		const { targetInfos } = await cdp.send('Target.getTargets', {
			filter: [{ type: 'tab', exclude: false }, { exclude: true }]
		})
		const t = targetInfos.find((t) => t.url === page.url())
		if (!t) throw Error('Missing source tab')
		await cdp.send('Extensions.triggerAction', { id, targetId: t.targetId })
	} finally {
		await cdp.detach()
	}
}
try {
	context = await launch()
	expect(await connected()).toBe(false)
	const web = await context.newPage()
	await web.goto(webUrl + '/account')
	await expect(web.getByText('Private library synced.', { exact: true })).toBeVisible({
		timeout: 60000
	})
	await web.getByRole('button', { name: 'Show recovery phrase', exact: true }).click()
	const field = web.getByRole('dialog').getByLabel('Recovery phrase', { exact: true })
	await expect(field).toBeVisible()
	phrase = await field.inputValue()
	await web.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
	await web.close()
	const source = await context.newPage()
	await source.goto(sourceUrl)
	await expect(
		source.getByText('Only present after JavaScript rendering.', { exact: true })
	).toBeVisible()
	phase = 'signed-out admission'
	const opened = context.waitForEvent('page')
	await toolbar(source)
	const popup = await opened
	await popup.waitForURL(
		(u) => u.protocol === 'chrome-extension:' && u.host === id && u.pathname === '/signin.html'
	)
	await expect(source.locator('delightful-clipper-bar')).toHaveCount(0)
	expect(await connected()).toBe(false)
	result.checks.push(
		'unconnected native toolbar gesture opens trusted extension sign-in without clipping'
	)
	const submit = popup.getByRole('button', { name: /^(Sign in|Restore account)$/ })
	await expect(submit).toBeEnabled()
	await popup.getByLabel('Recovery phrase', { exact: true }).fill('not a valid recovery phrase')
	await submit.click()
	await expect(
		popup.getByText('That recovery phrase is invalid. Check it and try again.', { exact: true })
	).toBeVisible()
	expect(await connected()).toBe(false)
	result.checks.push('invalid recovery phrase rejected without creating a confirmed connection')
	phase = 'restore and capture'
	await popup.getByLabel('Recovery phrase', { exact: true }).fill(phrase)
	const closed = popup.waitForEvent('close')
	await submit.click()
	await closed
	await expect.poll(connected, { timeout: 60000 }).toBe(true)
	await expect(source.getByRole('status')).toHaveText('Article synced.', { timeout: 60000 })
	const href = await source
		.getByRole('link', { name: 'Open article', exact: true })
		.getAttribute('href')
	if (!href) throw new Error('Reader link unavailable')
	expect(new URL(href, webUrl).origin).toBe(webUrl)
	result.checks.push(
		'restoring a disposable production account confirms connection and resumes the original gesture to remote acceptance'
	)
	phase = 'independent web replica'
	browser = await chromium.launch({ headless: true })
	independent = await browser.newContext()
	independent.on('page', (p) => p.on('pageerror', (e) => result.errors.push(safe(e.message))))
	const reader = await independent.newPage()
	reader.setDefaultTimeout(30000)
	await reader.goto(webUrl + '/account')
	await expect(reader.getByText('Private library synced.', { exact: true })).toBeVisible({
		timeout: 60000
	})
	await reader.getByLabel('Recovery phrase', { exact: true }).fill(phrase)
	await reader.getByRole('button', { name: 'Restore account', exact: true }).click()
	await expect
		.poll(
			async () => {
				const b = reader.getByRole('button', { name: 'Show recovery phrase', exact: true })
				if (!(await b.isVisible())) return false
				await b.click()
				const d = reader.getByRole('dialog')
				try {
					await d.getByLabel('Recovery phrase', { exact: true }).waitFor({ state: 'visible' })
					return (await d.getByLabel('Recovery phrase', { exact: true }).inputValue()) === phrase
				} finally {
					await d.getByRole('button', { name: 'Close', exact: true }).click()
				}
			},
			{ timeout: 60000 }
		)
		.toBe(true)
	await reader.getByRole('link', { name: 'All articles', exact: true }).click()
	await expect(reader.getByRole('link', { name: title, exact: true })).toHaveCount(1, {
		timeout: 60000
	})
	await reader.getByRole('link', { name: title, exact: true }).click()
	await expect(
		reader
			.getByRole('article')
			.filter({ has: reader.getByRole('heading', { name: title, exact: true }) })
	).toContainText('Only present after JavaScript rendering.')
	await expect(
		reader
			.getByRole('article')
			.filter({ has: reader.getByRole('heading', { name: title, exact: true }) })
	).not.toContainText('DO_NOT_CAPTURE_FORM_SECRET')
	result.checks.push(
		'independent restored web replica receives rendered content and excludes form values'
	)
	phase = 'duplicate capture'
	await source.getByRole('button', { name: 'Close', exact: true }).click()
	await toolbar(source)
	await expect(source.getByRole('status')).toHaveText('Already saved.')
	result.checks.push(
		'duplicate toolbar gesture reports Already saved without replacing the article'
	)
	phase = 'cold extension restart'
	await context.close()
	context = await launch()
	expect(await connected()).toBe(true)
	const next = await context.newPage()
	await next.goto(sourceUrl + '/second')
	await toolbar(next)
	await expect(next.getByRole('status')).toHaveText('Article synced.', { timeout: 60000 })
	await reader.goto(webUrl + '/')
	await expect(reader.getByRole('link', { name: title, exact: true })).toHaveCount(2, {
		timeout: 60000
	})
	result.checks.push('full browser restart retains confirmed connection and syncs another capture')
	expect(result.errors).toEqual([])
	result.passed = true
} catch (e) {
	result.failure = {
		phase,
		message: safe(e instanceof Error ? e.message : 'Unexpected qualification failure')
	}
} finally {
	phrase = ''
	if (independent) await independent.close().catch(() => {})
	if (browser) await browser.close().catch(() => {})
	if (context) await context.close().catch(() => {})
	await rm(dir, { recursive: true, force: true })
	await writeFile(resultPath, JSON.stringify(result, null, 2) + '\n')
	console.log(JSON.stringify(result))
}
process.exitCode = result.passed ? 0 : 1
