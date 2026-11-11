import { afterAll, afterEach, beforeAll, expect, it } from 'vitest'
import { chromium } from '@playwright/test'
import type { BrowserContext, Page } from '@playwright/test'
import { createServer, searchForWorkspaceRoot } from 'vite'
import type { ViteDevServer } from 'vite'
import { jazzPlugin } from 'jazz-tools/dev/vite'
import { startLocalJazzServer } from 'jazz-tools/testing'
import type { LocalJazzServerHandle } from 'jazz-tools/testing'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { app } from './schema.js'
import permissions from './permissions.js'
import type {} from './browser.js'

let authority: LocalJazzServerHandle, web: ViteDevServer, profile: string
const contexts: BrowserContext[] = []
let url: string
beforeAll(async () => {
	authority = await startLocalJazzServer({ schema: app, permissions })
	profile = await mkdtemp(join(tmpdir(), 'dlf-private-creation-'))
	web = await createServer({
		configFile: false,
		cacheDir: resolve('node_modules/.vite/dlf-private-creation'),
		root: resolve('fixtures/private-creation'),
		plugins: [jazzPlugin({ server: false, appId: authority.appId, inspector: false })],
		server: {
			host: '127.0.0.1',
			port: 6198,
			strictPort: true,
			fs: { allow: [searchForWorkspaceRoot(process.cwd())] }
		}
	})
	await web.listen()
	url = `http://127.0.0.1:6198/?appId=${authority.appId}&serverUrl=${encodeURIComponent(authority.url)}`
})
afterAll(async () => {
	await Promise.all(contexts.map((context) => context.close()))
	await web?.close()
	await authority?.stop()
	if (profile) await rm(profile, { recursive: true, force: true })
})
afterEach(async () => {
	await Promise.all(contexts.splice(0).map((context) => context.close()))
})
async function open(directory = profile) {
	const context = await chromium.launchPersistentContext(directory, {
		headless: true,
		channel: 'chromium'
	})
	contexts.push(context)
	context.setDefaultTimeout(15000)
	const page = await context.newPage()
	page.on('pageerror', (error) => console.error(error.message))
	await page.goto(url)
	await page.waitForFunction(() => Boolean(window.creationFixture))
	return { context, page }
}
async function stage(page: Page, ids: { operationId: string; workspaceId: string }) {
	await page.evaluate((ids) => {
		window.creationFixture.acquire('attempt')
		window.creationFixture.stage('attempt', ids.operationId, ids.workspaceId)
	}, ids)
}
it('confirms exclusive creation, restarts the browser process and recovers the exact immutable pair', async () => {
	const ids = { operationId: crypto.randomUUID(), workspaceId: crypto.randomUUID() }
	let browser = await open()
	const owner = await browser.page.evaluate(() => window.creationFixture.ownerId)
	await stage(browser.page, ids)
	await browser.page.evaluate(() => window.creationFixture.issue('attempt'))
	await browser.page.evaluate(() => window.creationFixture.wait('attempt'))
	await browser.context.close()
	browser = await open()
	expect(await browser.page.evaluate(() => window.creationFixture.ownerId)).toBe(owner)
	const records = await browser.page.evaluate(
		async (ids) => ({
			workspace: await window.creationFixture.readWorkspace(ids.workspaceId, 'local'),
			operation: await window.creationFixture.readOperation(ids.operationId, 'local')
		}),
		ids
	)
	expect(records.workspace?.creationOperationId).toBe(ids.operationId)
	expect(records.operation?.workspaceId).toBe(ids.workspaceId)
	expect(records.workspace?.ownerId).toBe(owner)
	await browser.context.close()
}, 60000)

async function crash(context: BrowserContext) {
	const browser = context.browser()
	if (!browser) throw new Error('Missing browser process')
	const cdp = await browser.newBrowserCDPSession()
	const info = await cdp.send('SystemInfo.getProcessInfo')
	const main = info.processInfo.find((item) => item.type === 'browser')
	if (!main) throw new Error('Missing browser process ID')
	process.kill(main.id, 'SIGKILL')
	await expect.poll(() => browser.isConnected(), { timeout: 15000 }).toBe(false)
	await context.close()
}

it('does not publish staged records when the complete browser process crashes before commit', async () => {
	const ids = { operationId: crypto.randomUUID(), workspaceId: crypto.randomUUID() }
	let browser = await open()
	await stage(browser.page, ids)
	await crash(browser.context)
	browser = await open()
	expect(
		await browser.page.evaluate(
			(ids) => window.creationFixture.readWorkspace(ids.workspaceId, 'remote'),
			ids
		)
	).toBeNull()
	expect(
		await browser.page.evaluate(
			(ids) => window.creationFixture.readOperation(ids.operationId, 'remote'),
			ids
		)
	).toBeNull()
	await browser.context.close()
}, 60000)

it('recovers a committed pair after a full process crash without replaying the write', async () => {
	const ids = { operationId: crypto.randomUUID(), workspaceId: crypto.randomUUID() }
	let browser = await open()
	await stage(browser.page, ids)
	await browser.page.evaluate(() => window.creationFixture.issue('attempt'))
	await browser.page.evaluate(() => window.creationFixture.wait('attempt'))
	await crash(browser.context)
	browser = await open()
	const records = await browser.page.evaluate(
		async (ids) => ({
			workspace: await window.creationFixture.readWorkspace(ids.workspaceId, 'remote'),
			operation: await window.creationFixture.readOperation(ids.operationId, 'remote')
		}),
		ids
	)
	expect(records.workspace?.creationOperationId).toBe(ids.operationId)
	expect(records.operation?.workspaceId).toBe(ids.workspaceId)
	await browser.context.close()
}, 60000)

it('reconciles stable IDs after killing the process immediately after commit issuance without retaining a transaction ID', async () => {
	const ids = { operationId: crypto.randomUUID(), workspaceId: crypto.randomUUID() }
	let browser = await open()
	await stage(browser.page, ids)
	await browser.page.evaluate(() => window.creationFixture.issue('attempt'))
	// No wait or transaction-ID journal write occurs before process termination.
	await crash(browser.context)
	browser = await open()
	const records = await browser.page.evaluate(
		async (ids) => ({
			workspace: await window.creationFixture.readWorkspace(ids.workspaceId, 'remote'),
			operation: await window.creationFixture.readOperation(ids.operationId, 'remote')
		}),
		ids
	)
	// The transport race may leave neither row or the complete accepted set. A missing set is
	// unresolved evidence, not permission to retry. This test performs no replacement write.
	expect(Boolean(records.workspace)).toBe(Boolean(records.operation))
	if (records.workspace && records.operation) {
		expect(records.workspace.creationOperationId).toBe(ids.operationId)
		expect(records.operation.workspaceId).toBe(ids.workspaceId)
	}
	await browser.context.close()
}, 60000)

it('admits only one competing exclusive creation for the same workspace across independent restored profiles', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'dlf-private-creation-peer-'))
	try {
		const first = await open(),
			second = await open(directory)
		const credential = await first.page.evaluate(() => window.creationFixture.credential())
		await second.page.evaluate(
			(credential) => window.creationFixture.restore(credential),
			credential
		)
		await second.page.reload()
		await second.page.waitForFunction(() => Boolean(window.creationFixture))
		const owner = await first.page.evaluate(() => window.creationFixture.ownerId)
		expect(await second.page.evaluate(() => window.creationFixture.ownerId)).toBe(owner)
		const workspaceId = crypto.randomUUID()
		const a = { operationId: crypto.randomUUID(), workspaceId },
			b = { operationId: crypto.randomUUID(), workspaceId }
		await stage(first.page, a)
		await stage(second.page, b)
		const results = await Promise.all(
			[first.page, second.page].map((page) =>
				page.evaluate(async () => {
					window.creationFixture.issue('attempt')
					try {
						await window.creationFixture.wait('attempt')
						return 'accepted'
					} catch (error) {
						if (
							!(error instanceof Error) ||
							!/reject|denied|conflict|duplicate|exist/i.test(error.message)
						)
							throw error
						return 'rejected'
					}
				})
			)
		)
		expect(results.filter((result) => result === 'accepted')).toHaveLength(1)
		expect(results.filter((result) => result === 'rejected')).toHaveLength(1)
		const winningId = results[0] === 'accepted' ? a.operationId : b.operationId
		const losingId = results[0] === 'accepted' ? b.operationId : a.operationId
		for (const page of [first.page, second.page]) {
			const rows = await page.evaluate(
				async (ids) => ({
					workspace: await window.creationFixture.readWorkspace(ids.workspaceId, 'remote'),
					winner: await window.creationFixture.readOperation(ids.winningId, 'remote'),
					loser: await window.creationFixture.readOperation(ids.losingId, 'remote')
				}),
				{ workspaceId, winningId, losingId }
			)
			expect(rows.workspace?.creationOperationId).toBe(winningId)
			expect(rows.winner?.workspaceId).toBe(workspaceId)
			expect(rows.loser).toBeNull()
		}
		await first.context.close()
		await second.context.close()
	} finally {
		await Promise.all(contexts.splice(0).map((context) => context.close()))
		await rm(directory, { recursive: true, force: true })
	}
}, 60000)

it('reads the persisted accepted pair after process kill with the authority stopped', async () => {
	const ids = { operationId: crypto.randomUUID(), workspaceId: crypto.randomUUID() }
	let browser = await open()
	await stage(browser.page, ids)
	await browser.page.evaluate(() => window.creationFixture.issue('attempt'))
	await browser.page.evaluate(() => window.creationFixture.wait('attempt'))
	// Establish the local read-back before destroying every browser runtime owner.
	const before = await browser.page.evaluate(
		async (ids) => ({
			workspace: await window.creationFixture.readWorkspace(ids.workspaceId, 'local'),
			operation: await window.creationFixture.readOperation(ids.operationId, 'local')
		}),
		ids
	)
	expect(before.workspace?.creationOperationId).toBe(ids.operationId)
	expect(before.operation?.workspaceId).toBe(ids.workspaceId)
	await authority.stop()
	await crash(browser.context)
	browser = await open()
	const after = await browser.page.evaluate(
		async (ids) => ({
			workspace: await window.creationFixture.readWorkspace(ids.workspaceId, 'local'),
			operation: await window.creationFixture.readOperation(ids.operationId, 'local')
		}),
		ids
	)
	expect(after).toEqual(before)
	await browser.context.close()
}, 60000)
