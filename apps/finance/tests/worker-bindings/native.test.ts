import { createServer } from 'node:http'
import { glob, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { join, resolve, extname } from 'node:path'
import { beforeAll, afterAll, describe, expect, it, onTestFailed } from 'vitest'
import { chromium, firefox, webkit, type BrowserContext, type Page } from '@playwright/test'
import { build } from 'vite'
import { workerRuntimeBuildConfig } from '../../tooling/jazz-wasm.js'
import type { FinanceAccountStoreConfiguration } from '../../src/lib/runtime/worker/account-store.js'
import type { Operation } from './bindings.worker.js'
import type {} from './driver.js'

let directory = '',
	origin = ''
let sdkBrokerPath = ''
let initialized = false,
	preserveFailure = false
let server: ReturnType<typeof createServer> | undefined
beforeAll(async () => {
	await mkdir('.svelte-kit', { recursive: true })
	directory = await mkdtemp(resolve('.svelte-kit/finance-binding-native-'))
	const output = join(directory, 'build')
	await build({
		...workerRuntimeBuildConfig(),
		configFile: false,
		logLevel: 'silent',
		build: {
			outDir: output,
			emptyOutDir: true,
			rolldownOptions: { input: resolve('tests/worker-bindings/index.html') }
		}
	})
	const assets = new Map<string, { bytes: Buffer; type: string }>()
	for await (const file of glob('**/*', { cwd: output })) {
		const path = join(output, file)
		if (!(await stat(path)).isFile()) continue
		assets.set('/' + file, {
			bytes: await readFile(path),
			type:
				extname(file) === '.html'
					? 'text/html'
					: extname(file) === '.js'
						? 'application/javascript'
						: 'application/octet-stream'
		})
	}
	const listener = createServer((request, response) => {
		const pathname = new URL(request.url ?? '/', origin || 'http://fixture.invalid').pathname
		const asset = assets.get(pathname === '/' ? '/tests/worker-bindings/index.html' : pathname)
		response.writeHead(asset ? 200 : 404, {
			'Content-Type': asset?.type ?? 'text/plain',
			'Cache-Control': 'no-store'
		})
		response.end(asset?.bytes ?? 'No app, auth or Jazz endpoint exists in this fixture')
	})
	const brokers = [...assets.keys()].filter(
		(path) =>
			path.startsWith('/_app/immutable/assets/') && /\/jazz-broker-worker[.-][^/]+\.js$/.test(path)
	)
	if (brokers.length !== 1 || !brokers[0])
		throw new Error(`Expected one SDK broker asset, found ${brokers.length}`)
	sdkBrokerPath = brokers[0]
	server = listener
	await new Promise<void>((resolve, reject) => {
		listener.once('error', reject)
		listener.listen(0, '127.0.0.1', resolve)
	})
	const address = listener.address()
	if (!address || typeof address === 'string') throw new Error('Fixture listener address missing')
	origin = `http://127.0.0.1:${address.port}`
	initialized = true
})
afterAll(async () => {
	const listener = server
	if (listener) {
		listener.closeAllConnections()
		await new Promise<void>((resolve, reject) =>
			listener.close((error) => (error ? reject(error) : resolve()))
		)
	}
	if (directory && initialized && !preserveFailure)
		await rm(directory, { recursive: true, force: true })
	else if (directory) console.error('Native binding failure artifacts:', directory)
})

async function boot(context: BrowserContext) {
	const page = await context.newPage()
	await page.goto(origin)
	await page.waitForFunction(() => Boolean(window.financeBindingFixture))
	return page
}
function send(page: Page, name: string, operation: Operation) {
	return page.evaluate(
		({ name, operation }) => window.financeBindingFixture.request(name, operation),
		{ name, operation }
	)
}
const scope = '11111111-1111-4111-8111-111111111111'
function configuration(): FinanceAccountStoreConfiguration {
	return { serverUrl: origin + '/jazz', scope }
}
function retainOnFailure() {
	onTestFailed(() => {
		preserveFailure = true
	})
}

for (const [engine, browserType] of Object.entries({ chromium, firefox, webkit })) {
	describe(engine, () => {
		it('isolates native Window SDK startup from the worker bridge', async () => {
			retainOnFailure()
			const browser = await browserType.launch({ headless: true })
			try {
				const page = await boot(await browser.newContext())
				expect(
					await page.evaluate(
						({ scope, url }) => window.financeSdkFixture.windowControl(scope, url),
						{ scope: crypto.randomUUID(), url: origin + sdkBrokerPath }
					)
				).toBe(true)
			} finally {
				await browser.close()
			}
		})
		it('uses one real SDK worker session for offline Finance saves through cold browser restarts', async () => {
			retainOnFailure()
			const profile = await mkdtemp(join(directory, `sdk-${engine}-`))
			const ids = {
				organizationId: crypto.randomUUID(),
				accountId: crypto.randomUUID(),
				categoryId: crypto.randomUUID(),
				transactionId: crypto.randomUUID()
			}
			const scope = crypto.randomUUID()
			let accountId: string | undefined
			for (let cycle = 0; cycle < 3; cycle++) {
				const context = await browserType.launchPersistentContext(profile, { headless: true })
				try {
					console.log(`SDK ${engine} cold cycle ${cycle + 1}`)
					const page = await boot(context)
					const opened = await page.evaluate(
						({ scope, url }) => window.financeSdkFixture.open(scope, url),
						{ scope, url: origin + sdkBrokerPath }
					)
					if (opened.kind !== 'opened') throw new Error('Expected SDK session')
					expect(opened).toMatchObject({ localFirst: true, windowPresent: false })
					if (cycle === 0) accountId = opened.accountId
					else expect(opened.accountId).toBe(accountId)
					await context.setOffline(true)
					const before = await page.evaluate(
						(organizationId) => window.financeSdkFixture.command({ type: 'READ', organizationId }),
						ids.organizationId
					)
					const native = await page.evaluate(() => window.financeSdkFixture.stats())
					expect(native.opens).toBeGreaterThan(0)
					expect(native.reads).toBeGreaterThan(0)
					expect(before).toEqual({
						kind: 'rows',
						rows:
							cycle === 0
								? []
								: [
										{
											id: ids.transactionId,
											amountMinor: cycle === 1 ? 5678 : 9012,
											memo: 'Stored in the worker'
										}
									]
					})
					if (cycle === 0)
						expect(
							await page.evaluate(
								(ids) => window.financeSdkFixture.command({ type: 'SEED', ...ids }),
								ids
							)
						).toEqual({ kind: 'saved' })
					if (cycle < 2)
						expect(
							await page.evaluate(
								({ transactionId, amountMinor }) =>
									window.financeSdkFixture.command({ type: 'EDIT', transactionId, amountMinor }),
								{ transactionId: ids.transactionId, amountMinor: cycle === 0 ? 5678 : 9012 }
							)
						).toEqual({ kind: 'saved' })
					expect(await page.evaluate(() => window.financeSdkFixture.close())).toEqual({
						kind: 'closed',
						sdkClosed: true,
						hostClosed: true
					})
				} finally {
					await context.close()
				}
			}
		}, 90_000)
		it('serializes canonical worker bindings, isolates profiles and closes the original store', async () => {
			retainOnFailure()
			const browser = await browserType.launch({ headless: true })
			try {
				const context = await browser.newContext()
				const page = await boot(context)
				await page.evaluate(async () => {
					await window.financeBindingFixture.create('A')
					await window.financeBindingFixture.create('B')
				})
				await context.setOffline(true)
				expect(
					await send(page, 'A', {
						type: 'STORE_OPEN',
						slot: 'selection',
						configuration: configuration()
					})
				).toMatchObject({ type: 'RESULT' })
				expect(
					await send(page, 'B', {
						type: 'STORE_OPEN',
						slot: 'selection',
						configuration: { ...configuration(), serverUrl: origin + '/jazz/', scope: ` ${scope} ` }
					})
				).toMatchObject({ type: 'RESULT' })
				expect(await send(page, 'A', { type: 'STORE_READ', slot: 'selection' })).toMatchObject({
					type: 'RESULT',
					value: null
				})
				const isolated = [
					{ slot: 'empty', configuration: { ...configuration(), environment: '' } },
					{ slot: 'production', configuration: { ...configuration(), environment: 'production' } },
					{
						slot: 'endpoint',
						configuration: { ...configuration(), serverUrl: origin + '/other-jazz' }
					},
					{
						slot: 'scope',
						configuration: { ...configuration(), scope: '22222222-2222-4222-8222-222222222222' }
					}
				]
				for (const input of isolated) {
					expect(await send(page, 'A', { type: 'STORE_OPEN', ...input })).toMatchObject({
						type: 'RESULT'
					})
					expect(await send(page, 'A', { type: 'STORE_READ', slot: input.slot })).toMatchObject({
						type: 'RESULT',
						value: null
					})
					expect(
						await send(page, 'A', { type: 'STORE_APPEND', slot: input.slot, value: input.slot })
					).toMatchObject({ type: 'RESULT' })
				}
				const writes = await Promise.all(
					Array.from({ length: 12 }, (_, index) =>
						send(page, index % 2 ? 'A' : 'B', {
							type: 'STORE_APPEND',
							slot: 'selection',
							value: `${index},`
						})
					)
				)
				for (const write of writes) expect(write).toMatchObject({ type: 'RESULT' })
				const read = await send(page, 'A', { type: 'STORE_READ', slot: 'selection' })
				if (read.type !== 'RESULT' || typeof read.value !== 'string')
					throw new Error('Native selection missing')
				expect(
					read.value
						.split(',')
						.filter(Boolean)
						.map(Number)
						.sort((a, b) => a - b)
				).toEqual(Array.from({ length: 12 }, (_, index) => index))
				for (const input of isolated) {
					expect(await send(page, 'A', { type: 'STORE_READ', slot: input.slot })).toMatchObject({
						type: 'RESULT',
						value: input.slot
					})
					expect(await send(page, 'A', { type: 'STORE_CLOSE', slot: input.slot })).toMatchObject({
						type: 'RESULT'
					})
				}
				expect(await send(page, 'A', { type: 'STORE_CLOSE', slot: 'selection' })).toMatchObject({
					type: 'RESULT'
				})
				expect(await send(page, 'B', { type: 'STORE_CLOSE', slot: 'selection' })).toMatchObject({
					type: 'RESULT'
				})
				expect(await send(page, 'A', { type: 'STORE_READ', slot: 'selection' })).toMatchObject({
					type: 'ERROR',
					outcome: 'not-issued',
					reason: 'closed'
				})
			} finally {
				await browser.close()
			}
		})

		it('reuses the Finance selection through two full browser-process restarts with operations offline', async () => {
			retainOnFailure()
			const progress: string[] = []
			onTestFailed(() => console.error('Cold fixture restart progress:', { engine, progress }))
			const profile = join(directory, 'profile-' + engine)
			for (let step = 0; step < 3; step++) {
				progress.push(`step ${step}: launching`)
				const context = await browserType.launchPersistentContext(profile, { headless: true })
				try {
					progress.push(`step ${step}: booting`)
					const page = await boot(context)
					await page.evaluate(() => window.financeBindingFixture.create('store'))
					progress.push(`step ${step}: offline store operations`)
					await context.setOffline(true)
					expect(
						await send(page, 'store', {
							type: 'STORE_OPEN',
							slot: 'selection',
							configuration: configuration()
						})
					).toMatchObject({ type: 'RESULT' })
					expect(
						await send(page, 'store', { type: 'STORE_READ', slot: 'selection' })
					).toMatchObject({
						type: 'RESULT',
						value: step === 0 ? null : step === 1 ? 'saved' : 'saved-offline-edit'
					})
					if (step < 2)
						expect(
							await send(page, 'store', {
								type: 'STORE_APPEND',
								slot: 'selection',
								value: step === 0 ? 'saved' : '-offline-edit'
							})
						).toMatchObject({ type: 'RESULT' })
					expect(
						await send(page, 'store', { type: 'STORE_CLOSE', slot: 'selection' })
					).toMatchObject({ type: 'RESULT' })
				} finally {
					progress.push(`step ${step}: closing browser`)
					await context.close()
					progress.push(`step ${step}: browser closed`)
				}
			}
		})
	})
}
