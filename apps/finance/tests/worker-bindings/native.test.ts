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
type Command = Exclude<Operation, { type: 'BROKER_INIT' }>
function send(page: Page, name: string, operation: Command) {
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

		it.each<{ ownership: 'root' | 'child' }>([{ ownership: 'root' }, { ownership: 'child' }])(
			'isolates $ownership-owned generation and broker grants and retains the accepted SharedWorker port after independent closure',
			async ({ ownership }) => {
				retainOnFailure()
				const browser = await browserType.launch({ headless: true })
				try {
					const context = await browser.newContext()
					const page = await boot(context)
					await page.evaluate(async () => {
						await window.financeBindingFixture.create('generation')
						await window.financeBindingFixture.create('broker')
					})
					const generation = await page.evaluate(
						(ownership) => window.financeBindingFixture.bindGeneration('generation', ownership),
						ownership
					)
					const broker = await page.evaluate(
						(ownership) => window.financeBindingFixture.bindBroker('broker', ownership),
						ownership
					)
					expect(generation.scope).not.toBe(broker.scope)
					for (const operation of [
						{ type: 'BROKER_READ', key: generation.key + ':foreign' },
						{ type: 'BROKER_WRITE', key: generation.key + ':foreign', value: '9' },
						{ type: 'BROKER_OPEN', url: broker.url, name: broker.name }
					] satisfies Command[])
						expect(await send(page, 'generation', operation)).toMatchObject({
							type: 'ERROR',
							outcome: 'not-issued'
						})
					for (const operation of [
						{ type: 'BROKER_OPEN', url: broker.url + '?foreign=1', name: broker.name },
						{ type: 'BROKER_OPEN', url: broker.url, name: broker.name + ':foreign' },
						{
							type: 'BROKER_OPEN',
							url: broker.url,
							name: broker.name.replace(':generation-2', ':generation-3')
						},
						{
							type: 'BROKER_OPEN',
							url: broker.url,
							name: broker.name.replace(':generation-2', ':generation-9007199254740992')
						},
						{ type: 'BROKER_READ', key: generation.key },
						{ type: 'BROKER_WRITE', key: generation.key, value: '9' }
					] satisfies Command[])
						expect(await send(page, 'broker', operation)).toMatchObject({
							type: 'ERROR',
							outcome: 'not-issued'
						})
					for (const name of ['generation', 'broker'])
						expect(
							await page.evaluate((name) => window.financeBindingFixture.stats(name), name)
						).toEqual({ opens: [], reads: [], writes: [] })
					expect(
						await send(page, 'generation', { type: 'BROKER_READ', key: generation.key })
					).toMatchObject({ type: 'RESULT', value: 'raw SDK generation value' })
					expect(
						await send(page, 'generation', {
							type: 'BROKER_WRITE',
							key: generation.key,
							value: '3'
						})
					).toMatchObject({ type: 'RESULT' })
					expect(
						await send(page, 'generation', { type: 'BROKER_READ', key: generation.key })
					).toMatchObject({ type: 'RESULT', value: '3' })
					expect(await send(page, 'generation', { type: 'BROKER_CLOSE' })).toMatchObject({
						type: 'RESULT',
						value: { scope: generation.scope, requestId: generation.requestId }
					})
					expect(
						await send(page, 'generation', {
							type: 'BROKER_WRITE',
							key: generation.key,
							value: '4'
						})
					).toMatchObject({ type: 'ERROR', outcome: 'not-issued' })
					expect(
						await send(page, 'broker', { type: 'BROKER_OPEN', url: broker.url, name: broker.name })
					).toMatchObject({ type: 'RESULT' })
					expect(await send(page, 'broker', { type: 'BROKER_CLOSE' })).toMatchObject({
						type: 'RESULT',
						value: { scope: broker.scope, requestId: broker.requestId }
					})
					expect(
						await send(page, 'broker', { type: 'BROKER_OPEN', url: broker.url, name: broker.name })
					).toMatchObject({ type: 'ERROR', outcome: 'not-issued' })
					expect(
						await send(page, 'broker', {
							type: 'BROKER_ECHO',
							value: 'SDK retains its accepted port'
						})
					).toMatchObject({ type: 'RESULT', value: 'SDK retains its accepted port' })
					expect(
						await page.evaluate(() => window.financeBindingFixture.stats('generation'))
					).toEqual({
						opens: [],
						reads: [generation.key, generation.key],
						writes: [{ key: generation.key, value: '3' }]
					})
					expect(await page.evaluate(() => window.financeBindingFixture.stats('broker'))).toEqual({
						opens: [{ url: broker.url, name: broker.name }],
						reads: [],
						writes: []
					})
				} finally {
					await browser.close()
				}
			}
		)
	})
}
