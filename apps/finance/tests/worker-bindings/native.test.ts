import { createServer } from 'node:http'
import { glob, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { join, resolve, extname } from 'node:path'
import { beforeAll, afterAll, describe, expect, it, onTestFailed } from 'vitest'
import { chromium, firefox, webkit, type BrowserContext, type Page } from '@playwright/test'
import { build } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import type {} from './svelte/client.js'
import type {} from './actor/client.js'
import { workerRuntimeBuildConfig } from '../../tooling/jazz-wasm.js'
import type { FinanceAccountStoreConfiguration } from '../../src/lib/runtime/worker/account-store.js'
import type { Operation } from './bindings.worker.js'
import type {} from './driver.js'

let directory = '',
	origin = ''
let sdkBrokerPath = '',
	actorBrokerPath = ''
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
		plugins: [svelte({ configFile: false })],
		build: {
			outDir: output,
			emptyOutDir: true,
			rolldownOptions: {
				input: [
					resolve('tests/worker-bindings/index.html'),
					resolve('tests/worker-bindings/svelte/index.html')
				]
			}
		}
	})
	const development = join(directory, 'development')
	await build({
		...workerRuntimeBuildConfig(),
		configFile: false,
		logLevel: 'silent',
		base: '/development/',
		resolve: {
			...workerRuntimeBuildConfig().resolve,
			conditions: ['development', 'browser', 'module']
		},
		define: { 'process.env.NODE_ENV': JSON.stringify('development') },
		build: {
			outDir: development,
			emptyOutDir: true,
			rolldownOptions: { input: resolve('tests/worker-bindings/actor/index.html') }
		}
	})
	const assets = new Map<string, { bytes: Buffer; type: string }>()
	for (const source of [
		{ prefix: '', directory: output },
		{ prefix: '/development', directory: development }
	]) {
		for await (const file of glob('**/*', { cwd: source.directory })) {
			const path = join(source.directory, file)
			if (!(await stat(path)).isFile()) continue
			assets.set(source.prefix + '/' + file, {
				bytes: await readFile(path),
				type:
					extname(file) === '.html'
						? 'text/html'
						: extname(file) === '.css'
							? 'text/css'
							: extname(file) === '.js'
								? 'application/javascript'
								: 'application/octet-stream'
			})
		}
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
		(path) => !path.startsWith('/development/') && /\/jazz-broker-worker[.-][^/]+\.js$/.test(path)
	)
	if (brokers.length !== 1 || !brokers[0])
		throw new Error(`Expected one SDK broker asset, found ${brokers.length}`)
	sdkBrokerPath = brokers[0]
	const developmentBrokers = [...assets.keys()].filter(
		(path) => path.startsWith('/development/') && /\/jazz-broker-worker[.-][^/]+\.js$/.test(path)
	)
	if (developmentBrokers.length !== 1 || !developmentBrokers[0])
		throw new Error('Expected one development broker asset')
	actorBrokerPath = developmentBrokers[0]
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
		it.each([{ initial: 'device' }, { initial: 'signed-out' }] satisfies {
			initial: 'device' | 'signed-out'
		}[])(
			'owns an actual %s SDK session inside a dedicated Worker with development XState',
			async ({ initial }) => {
				retainOnFailure()
				const browser = await browserType.launch({ headless: true })
				let page: Page | undefined
				try {
					const actorPage = await browser.newPage()
					page = actorPage
					await actorPage.goto(origin + '/development/tests/worker-bindings/actor/index.html')
					await actorPage.waitForFunction(() => Boolean(window.financeSessionActorFixture))
					await actorPage.evaluate(
						({ initial, scope, broker }) =>
							window.financeSessionActorFixture.open(initial, scope, broker),
						{ initial, scope: crypto.randomUUID(), broker: origin + actorBrokerPath }
					)
					await expect
						.poll(() => actorPage.evaluate(() => window.financeSessionActorFixture.state()), {
							timeout: 10000
						})
						.toMatchObject({ status: initial === 'device' ? 'ready' : 'signed-out' })
					const observed = await actorPage.evaluate(() => window.financeSessionActorFixture.state())
					expect(observed).toMatchObject({
						actorFailed: false,
						windowPresent: false,
						contextFrozen: true,
						acquired: 1,
						subscribed: 1
					})
					if (initial === 'device') {
						expect(observed.localFirst).toBe(true)
						expect(observed.identityId).toMatch(/\S/)
						expect(observed.bound).toBe(1)
						expect(observed.bindingCurrent).toBe(true)
						expect(
							await actorPage.evaluate(() => window.financeSessionActorFixture.readBinding())
						).toBe(0)
					}
					await actorPage.evaluate(() => window.financeSessionActorFixture.close())
					await expect
						.poll(() => actorPage.evaluate(() => window.financeSessionActorFixture.state()), {
							timeout: 10000
						})
						.toMatchObject({
							done: true,
							clean: true,
							closed: 1,
							unsubscribed: 1,
							bindingCurrent: false
						})
					expect(
						await actorPage.evaluate(() => window.financeSessionActorFixture.dispose())
					).toEqual({ sdkClosed: true, storeClosed: true, hostClosed: true })
				} finally {
					if (page)
						await page.evaluate(() => window.financeSessionActorFixture.dispose()).catch(() => {})
					await browser.close()
				}
			}
		)
		it.each([false, true])(
			'signs out through the Worker actor and drains before close (held: %s)',
			async (hold) => {
				retainOnFailure()
				const browser = await browserType.launch({ headless: true })
				let page: Page | undefined
				try {
					const actorPage = await browser.newPage()
					page = actorPage
					await actorPage.goto(origin + '/development/tests/worker-bindings/actor/index.html')
					await actorPage.waitForFunction(() => Boolean(window.financeSessionActorFixture))
					await actorPage.evaluate(
						({ scope, broker }) => window.financeSessionActorFixture.open('device', scope, broker),
						{ scope: crypto.randomUUID(), broker: origin + actorBrokerPath }
					)
					await expect
						.poll(() => actorPage.evaluate(() => window.financeSessionActorFixture.state()))
						.toMatchObject({ status: 'ready' })
					await actorPage.evaluate(() => window.financeSessionActorFixture.signOut(true))
					expect(
						await actorPage.evaluate(() => window.financeSessionActorFixture.state())
					).toMatchObject({
						status: 'ready',
						signOutStarted: 0,
						reports: [{ attempt: 1, outcome: 'bindingChanged' }]
					})
					await actorPage.evaluate(
						(hold) => window.financeSessionActorFixture.signOut(false, hold),
						hold
					)
					await expect
						.poll(() => actorPage.evaluate(() => window.financeSessionActorFixture.state()))
						.toMatchObject({ signOutStarted: 1, signOutCompleted: 1, actorFailed: false })
					if (hold) {
						await actorPage.evaluate(() => window.financeSessionActorFixture.close())
						expect(
							await actorPage.evaluate(() => window.financeSessionActorFixture.state())
						).toMatchObject({
							done: false,
							closed: 0,
							unsubscribed: 0,
							reports: [{ attempt: 1, outcome: 'bindingChanged' }]
						})
						await actorPage.evaluate(() => window.financeSessionActorFixture.releaseChange())
					} else {
						await expect
							.poll(() => actorPage.evaluate(() => window.financeSessionActorFixture.state()))
							.toMatchObject({ status: 'signed-out' })
						await actorPage.evaluate(() => window.financeSessionActorFixture.close())
					}
					await expect
						.poll(() => actorPage.evaluate(() => window.financeSessionActorFixture.state()))
						.toMatchObject({
							done: true,
							clean: true,
							contextFrozen: true,
							windowPresent: false,
							closed: 1,
							unsubscribed: 1,
							signOutStarted: 1,
							signOutCompleted: 1,
							reports: [
								{ attempt: 1, outcome: 'bindingChanged' },
								{ attempt: 2, outcome: 'completed' }
							]
						})
					expect(
						await actorPage.evaluate(() => window.financeSessionActorFixture.dispose())
					).toEqual({
						sdkClosed: true,
						storeClosed: true,
						hostClosed: true
					})
				} finally {
					if (page)
						await page.evaluate(() => window.financeSessionActorFixture.dispose()).catch(() => {})
					await browser.close()
				}
			}
		)
		it.each([false, true])(
			'creates, recovers and restores one native Worker identity (held restore: %s)',
			async (hold) => {
				retainOnFailure()
				const browser = await browserType.launch({ headless: true })
				let page: Page | undefined
				try {
					const actorPage = await browser.newPage()
					page = actorPage
					await actorPage.goto(origin + '/development/tests/worker-bindings/actor/index.html')
					await actorPage.waitForFunction(() => Boolean(window.financeSessionActorFixture))
					await actorPage.evaluate(
						({ scope, broker }) =>
							window.financeSessionActorFixture.open('signed-out', scope, broker),
						{ scope: crypto.randomUUID(), broker: origin + actorBrokerPath }
					)
					await expect
						.poll(() => actorPage.evaluate(() => window.financeSessionActorFixture.state()))
						.toMatchObject({ status: 'signed-out' })
					await actorPage.evaluate(() => window.financeSessionActorFixture.createIdentity())
					await expect
						.poll(() => actorPage.evaluate(() => window.financeSessionActorFixture.state()))
						.toMatchObject({ status: 'ready', created: 1, bound: 1 })
					const initial = await actorPage.evaluate(() => window.financeSessionActorFixture.state())
					expect(initial.identityId).toMatch(/\S/)
					expect(await actorPage.evaluate(() => window.financeSessionActorFixture.recover())).toBe(
						true
					)
					await actorPage.evaluate(() => window.financeSessionActorFixture.signOut())
					await expect
						.poll(() => actorPage.evaluate(() => window.financeSessionActorFixture.state()))
						.toMatchObject({
							status: 'signed-out',
							retiredRecoveryRejected: true,
							firstBindingCurrent: false
						})
					await actorPage.evaluate(
						(hold) => window.financeSessionActorFixture.restoreIdentity(hold),
						hold
					)
					await expect
						.poll(() => actorPage.evaluate(() => window.financeSessionActorFixture.state()))
						.toMatchObject({ restored: 1, bound: 2 })
					if (hold) {
						await actorPage.evaluate(() => window.financeSessionActorFixture.close())
						expect(
							await actorPage.evaluate(() => window.financeSessionActorFixture.state())
						).toMatchObject({
							done: false,
							closed: 0,
							unsubscribed: 0,
							reports: [
								{ attempt: 1, outcome: 'completed' },
								{ attempt: 2, outcome: 'completed' }
							]
						})
						await actorPage.evaluate(() => window.financeSessionActorFixture.releaseChange())
					} else {
						await expect
							.poll(() => actorPage.evaluate(() => window.financeSessionActorFixture.state()))
							.toMatchObject({
								status: 'ready',
								identityId: initial.identityId,
								retiredRecoveryRejected: true,
								firstBindingCurrent: false,
								bindingCurrent: true
							})
						await actorPage.evaluate(() => window.financeSessionActorFixture.close())
					}
					await expect
						.poll(() => actorPage.evaluate(() => window.financeSessionActorFixture.state()))
						.toMatchObject({
							done: true,
							clean: true,
							actorFailed: false,
							contextFrozen: true,
							windowPresent: false,
							created: 1,
							restored: 1,
							closed: 1,
							unsubscribed: 1,
							reports: [
								{ attempt: 1, outcome: 'completed' },
								{ attempt: 2, outcome: 'completed' },
								{ attempt: 3, outcome: 'completed' }
							]
						})
					expect(
						await actorPage.evaluate(() => window.financeSessionActorFixture.dispose())
					).toEqual({ sdkClosed: true, storeClosed: true, hostClosed: true })
				} finally {
					if (page)
						await page.evaluate(() => window.financeSessionActorFixture.dispose()).catch(() => {})
					await browser.close()
				}
			}
		)
		it('closes an actual SDK acquired after its owning actor receives CLOSE without publishing it', async () => {
			retainOnFailure()
			const browser = await browserType.launch({ headless: true })
			let page: Page | undefined
			try {
				const actorPage = await browser.newPage()
				page = actorPage
				await actorPage.goto(origin + '/development/tests/worker-bindings/actor/index.html')
				await actorPage.waitForFunction(() => Boolean(window.financeSessionActorFixture))
				await actorPage.evaluate(
					({ scope, broker }) =>
						window.financeSessionActorFixture.open('device', scope, broker, true),
					{ scope: crypto.randomUUID(), broker: origin + actorBrokerPath }
				)
				await expect
					.poll(() => actorPage.evaluate(() => window.financeSessionActorFixture.state()), {
						timeout: 10000
					})
					.toMatchObject({ acquired: 1 })
				await actorPage.evaluate(() => window.financeSessionActorFixture.close())
				expect(
					await actorPage.evaluate(() => window.financeSessionActorFixture.state())
				).toMatchObject({ done: false, closed: 0, subscribed: 0 })
				await actorPage.evaluate(() => window.financeSessionActorFixture.releaseOpen())
				await expect
					.poll(() => actorPage.evaluate(() => window.financeSessionActorFixture.state()), {
						timeout: 10000
					})
					.toMatchObject({
						done: true,
						actorFailed: false,
						windowPresent: false,
						contextFrozen: true,
						clean: true,
						closed: 1,
						subscribed: 0
					})
				expect(await actorPage.evaluate(() => window.financeSessionActorFixture.dispose())).toEqual(
					{ sdkClosed: true, storeClosed: true, hostClosed: true }
				)
			} finally {
				if (page)
					await page.evaluate(() => window.financeSessionActorFixture.dispose()).catch(() => {})
				await browser.close()
			}
		})

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
		it('uses the native Svelte provider and Finance recovery component without another session', async () => {
			retainOnFailure()
			const browser = await browserType.launch({ headless: true })
			let page: Page | undefined
			try {
				page = await browser.newPage()
				await page.goto(origin + '/tests/worker-bindings/svelte/index.html')
				await page.waitForFunction(() => Boolean(window.financeSvelteFixture))
				await page.evaluate(
					({ scope, brokerUrl }) => window.financeSvelteFixture.open(scope, brokerUrl),
					{ scope: crypto.randomUUID(), brokerUrl: origin + sdkBrokerPath }
				)
				const initial = await page.evaluate(() => window.financeSvelteFixture.state())
				const labels = await page.evaluate(() => window.financeSvelteFixture.labels())
				await page.evaluate(() => window.financeSvelteFixture.show())
				const show = page.getByRole('button', { name: labels.show, exact: true })
				await show.waitFor({ state: 'visible' })
				expect(await show.isEnabled()).toBe(true)
				expect(await page.evaluate(() => window.financeSvelteFixture.state())).toEqual(initial)
				await show.click()
				await page.getByRole('dialog', { name: labels.heading }).waitFor({ state: 'visible' })
				expect(await page.evaluate(() => window.financeSvelteFixture.phraseMatchesNative())).toBe(
					true
				)
				await page.evaluate(() => window.financeSvelteFixture.beginSameAccountRestore())
				await page.getByText('Session loading', { exact: true }).waitFor({ state: 'visible' })
				expect(await page.getByLabel(labels.phraseLabel, { exact: true }).count()).toBe(0)
				await page.evaluate(() => window.financeSvelteFixture.finishRestore())
				await show.waitFor({ state: 'visible' })
				expect(await show.isEnabled()).toBe(true)
				expect(await page.getByLabel(labels.phraseLabel, { exact: true }).count()).toBe(0)
				expect((await page.evaluate(() => window.financeSvelteFixture.state())).accountId).toBe(
					initial.accountId
				)
				await show.click()
				await page.getByRole('dialog', { name: labels.heading }).waitFor({ state: 'visible' })
				expect(await page.evaluate(() => window.financeSvelteFixture.phraseMatchesNative())).toBe(
					true
				)
				await page.evaluate(() => window.financeSvelteFixture.hide())
				expect((await page.evaluate(() => window.financeSvelteFixture.state())).status).toBe(
					'ready'
				)
				expect(await page.getByLabel(labels.phraseLabel, { exact: true }).count()).toBe(0)
				await page.evaluate(() => window.financeSvelteFixture.show())
				await show.waitFor({ state: 'visible' })
				expect(await show.isEnabled()).toBe(true)
				await page.evaluate(() => window.financeSvelteFixture.signOut())
				await page.getByText('Session signed out', { exact: true }).waitFor({ state: 'visible' })
				expect(await page.getByLabel(labels.phraseLabel, { exact: true }).count()).toBe(0)
				await page.evaluate(() => window.financeSvelteFixture.reopen())
				await show.waitFor({ state: 'visible' })
				expect((await page.evaluate(() => window.financeSvelteFixture.state())).accountId).toBe(
					initial.accountId
				)
				await page.evaluate(() => window.financeSvelteFixture.closeSession())
				await page.getByText('Session closed', { exact: true }).waitFor({ state: 'visible' })
				await page.evaluate(() => window.financeSvelteFixture.dispose())
			} finally {
				if (page)
					await page
						.evaluate(async () => {
							await window.financeSvelteFixture.finishRestore()
							await window.financeSvelteFixture.dispose()
						})
						.catch(() => {})
				await browser.close()
			}
		})
		it('closes acquired resources after immediate SDK loader failure and reopens', async () => {
			retainOnFailure()
			const browser = await browserType.launch({ headless: true })
			try {
				const page = await boot(await browser.newContext())
				const input = {
					scope: crypto.randomUUID(),
					url: origin + sdkBrokerPath
				}
				await expect(
					page.evaluate(({ scope, url }) => window.financeSdkFixture.open(scope, url, true), input)
				).rejects.toThrow('Expected SDK loader failure')
				expect(await page.evaluate(() => window.financeSdkFixture.stats())).toEqual({
					opens: 0,
					reads: 0
				})
				expect(await page.evaluate(() => window.financeSdkFixture.close())).toEqual({
					kind: 'closed',
					sdkClosed: true,
					hostClosed: true
				})
				expect(
					await page.evaluate(({ scope, url }) => window.financeSdkFixture.open(scope, url), input)
				).toMatchObject({
					kind: 'opened',
					localFirst: true,
					windowPresent: false
				})
				expect(await page.evaluate(() => window.financeSdkFixture.close())).toEqual({
					kind: 'closed',
					sdkClosed: true,
					hostClosed: true
				})
			} finally {
				await browser.close()
			}
		})
		it('qualifies shared native session recovery, restoration and scope retirement', async () => {
			retainOnFailure()
			const browser = await browserType.launch({ headless: true })
			try {
				const page = await boot(await browser.newContext())
				await page.evaluate(({ scope, url }) => window.financeSdkFixture.open(scope, url), {
					scope: crypto.randomUUID(),
					url: origin + sdkBrokerPath
				})
				expect(
					await page.evaluate(() => window.financeSdkFixture.command({ type: 'QUALIFY_SESSION' }))
				).toEqual({
					kind: 'session-qualified',
					report: {
						observedStatuses: true,
						exportMatchesNative: true,
						userStable: true,
						sameAccountRetiresScope: true,
						replacedBeforeObservation: true,
						abaRetiresScopes: true,
						restorationReportsCurrent: true,
						signedOutUnavailable: true,
						staleReadRejected: true,
						reopenedSameAccount: true,
						getterFailureRejected: true,
						replacedSessionRejected: true,
						foreignScopeRejected: true,
						invalidationPure: true,
						invalidRestorationRejected: true
					}
				})
				expect(await page.evaluate(() => window.financeSdkFixture.close())).toEqual({
					kind: 'closed',
					sdkClosed: true,
					hostClosed: true
				})
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
