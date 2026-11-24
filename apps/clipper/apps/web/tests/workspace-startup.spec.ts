import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import { startLocalJazzServer } from './browser-core.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let authority: Awaited<ReturnType<typeof startLocalJazzServer>>
let dataDir: string
test.beforeAll(async () => {
	dataDir = await mkdtemp(join(tmpdir(), 'clipper-independent-startup-'))
	authority = await startLocalJazzServer({
		host: '127.0.0.1',
		port: 5181,
		dataDir,
		appId: '2db98ae3-fcf1-41e8-b7d3-9818496bde60'
	})
})
test.afterAll(async () => {
	await authority?.stop()
	if (dataDir) await rm(dataDir, { recursive: true, force: true })
})

async function blank(context: BrowserContext) {
	const page = await context.newPage()
	await page.route('**/native-startup-fixture', (route) =>
		route.fulfill({
			contentType: 'text/html',
			body: '<!doctype html><title>Native startup fixture</title>'
		})
	)
	await page.goto('http://127.0.0.1:5180/native-startup-fixture')
	return page
}
async function open(page: Page, key?: string) {
	return page.evaluate(async (key) => {
		const path = '/tests/workspace-startup/replica.ts'
		return (await import(/* @vite-ignore */ path)).open(key)
	}, key)
}
async function close(page: Page) {
	await page.evaluate(async () => {
		const path = '/tests/workspace-startup/replica.ts'
		await (await import(/* @vite-ignore */ path)).close()
	})
}
test('independent native replicas converge concurrent missing-root startup on one canonical workspace', async ({
	browser
}) => {
	const seed = await browser.newContext()
	const first = await browser.newContext()
	const second = await browser.newContext()
	const pages: Page[] = []
	try {
		const source = await blank(seed)
		pages.push(source)
		const identity = await open(source)
		expect(identity.roots).toEqual([])
		const key = await source.evaluate(async () => {
			const path = '/tests/workspace-startup/replica.ts'
			return (await import(/* @vite-ignore */ path)).credential()
		})
		await close(source)
		const a = await blank(first),
			b = await blank(second)
		pages.push(a, b)
		const opened = await Promise.all([open(a, key), open(b, key)])
		for (const replica of opened) {
			expect(replica.identityId).toBe(identity.identityId)
			expect(replica.roots).toEqual([])
		}
		await Promise.all(
			[a, b].map((page) =>
				page.evaluate(async () => {
					const path = '/tests/workspace-startup/replica.ts'
					const replica = await import(/* @vite-ignore */ path)
					replica.start()
				})
			)
		)
		await expect
			.poll(async () =>
				Promise.all(
					[a, b].map((page) =>
						page.evaluate(async () => {
							const path = '/tests/workspace-startup/replica.ts'
							return (await import(/* @vite-ignore */ path)).observedDiscovery()
						})
					)
				)
			)
			.toEqual(['missing', 'missing'])
		await Promise.all(
			[a, b].map((page) =>
				page.evaluate(async () => {
					const path = '/tests/workspace-startup/replica.ts'
					const replica = await import(/* @vite-ignore */ path)
					replica.releaseDiscovery()
				})
			)
		)
		const results = await Promise.all(
			[a, b].map((page) =>
				page.evaluate(async () => {
					const path = '/tests/workspace-startup/replica.ts'
					return (await import(/* @vite-ignore */ path)).result()
				})
			)
		)
		for (const result of results)
			expect(result).toEqual({
				outcome: 'ready',
				identityId: identity.identityId,
				workspaceId: identity.identityId,
				wrote: true
			})
		const accepted = await Promise.all(
			[a, b].map((page) =>
				page.evaluate(async () => {
					const path = '/tests/workspace-startup/replica.ts'
					return (await import(/* @vite-ignore */ path)).accepted()
				})
			)
		)
		for (const roots of accepted)
			expect(roots).toEqual([
				{ id: identity.identityId, ownerId: identity.identityId, bootstrapVersion: '1' }
			])
	} finally {
		await Promise.all(pages.filter((page) => !page.isClosed()).map(close))
		await Promise.all([seed.close(), first.close(), second.close()])
	}
})
