import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import { startLocalJazzServer } from './browser-core.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSilentJazzProxy } from '../../../../../scripts/testing/silent-jazz-proxy.js'

let authority: Awaited<ReturnType<typeof startLocalJazzServer>>
let dataDir: string
async function startAuthority() {
	authority = await startLocalJazzServer({
		host: '127.0.0.1',
		port: 5181,
		dataDir,
		appId: '2db98ae3-fcf1-41e8-b7d3-9818496bde60'
	})
}
test.beforeAll(async () => {
	dataDir = await mkdtemp(join(tmpdir(), 'clipper-independent-startup-'))
	await startAuthority()
})

for (const connection of ['offline', 'unanswered']) {
	test(`a partial native replica starts with ${connection} authority and reconciles without resetting existing content`, async ({
		browser
	}) => {
		const seed = await browser.newContext()
		const partial = await browser.newContext()
		const pages: Page[] = []
		const existingUrl = 'https://example.com/partial-replica-existing'
		const offlineUrl = 'https://example.com/partial-replica-offline'
		let silent: ReturnType<typeof createSilentJazzProxy> | undefined
		try {
			const source = await blank(seed)
			pages.push(source)
			const identity = await open(source)
			const key = await source.evaluate(async (url) => {
				const path = '/tests/workspace-startup/replica.ts'
				const replica = await import(/* @vite-ignore */ path)
				replica.start()
				replica.releaseDiscovery()
				await replica.result()
				if ((await replica.save(url)) !== 'saved') throw new Error('Seed content was not saved')
				await replica.accepted()
				return replica.credential()
			}, existingUrl)
			await close(source)
			const page = await blank(partial)
			pages.push(page)
			// Restore identity without issuing any application root/content query.
			await page.evaluate(async (key) => {
				const path = '/tests/workspace-startup/replica.ts'
				await (await import(/* @vite-ignore */ path)).open(key, false)
			}, key)
			await authority.stop()
			if (connection === 'unanswered') {
				silent = createSilentJazzProxy('http://127.0.0.1:5181')
				silent.silence()
				await silent.listen(5181)
				await expect.poll(() => silent?.observed.opened ?? 0).toBeGreaterThan(0)
				await expect.poll(() => silent?.observed.clientBytes ?? 0).toBeGreaterThan(0)
			}
			expect(
				await page.evaluate(async () => {
					const path = '/tests/workspace-startup/replica.ts'
					const replica = await import(/* @vite-ignore */ path)
					return { roots: await replica.localRoots(), documents: await replica.documents() }
				})
			).toEqual({ roots: [], documents: [] })
			const result = await page.evaluate(async (url) => {
				const path = '/tests/workspace-startup/replica.ts'
				const replica = await import(/* @vite-ignore */ path)
				replica.start()
				replica.releaseDiscovery()
				return { startup: await replica.result(), save: await replica.save(url) }
			}, offlineUrl)
			expect(result).toEqual({
				startup: {
					outcome: 'ready',
					identityId: identity.identityId,
					workspaceId: identity.identityId,
					wrote: true
				},
				save: 'saved'
			})
			await silent?.close()
			silent = undefined
			await startAuthority()
			const reconciled = await page.evaluate(async () => {
				const path = '/tests/workspace-startup/replica.ts'
				const replica = await import(/* @vite-ignore */ path)
				return { roots: await replica.accepted(), documents: await replica.documents(true) }
			})
			expect(reconciled.roots).toEqual([
				{ id: identity.identityId, ownerId: identity.identityId, bootstrapVersion: '1' }
			])
			expect(reconciled.documents).toHaveLength(2)
			expect(reconciled.documents).toEqual(
				expect.arrayContaining([
					{ libraryId: identity.identityId, sourceUrl: existingUrl },
					{ libraryId: identity.identityId, sourceUrl: offlineUrl }
				])
			)
		} finally {
			await silent?.close()
			await Promise.all(pages.filter((page) => !page.isClosed()).map(close))
			await Promise.all([seed.close(), partial.close()])
		}
	})
}
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
