import svg from '@poppanator/sveltekit-svg'
import { createServer } from 'node:http'
import { glob, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import { build } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { expect as playwrightExpect, chromium, firefox, webkit, type Page } from '@playwright/test'
import { workerRuntimeBuildConfig } from '../../tooling/jazz-wasm.js'
import type {} from './client.js'

const browserExpect = playwrightExpect.configure({ timeout: 15000 })

let directory = '',
	origin = '',
	retained = true
let server: ReturnType<typeof createServer> | undefined
beforeAll(async () => {
	await mkdir('.svelte-kit', { recursive: true })
	directory = await mkdtemp(resolve('.svelte-kit/finance-worker-read-'))
	const output = join(directory, 'build')
	await build({
		...workerRuntimeBuildConfig(),
		configFile: false,
		logLevel: 'silent',
		plugins: [
			svelte({ configFile: false }),
			svg(),
			{
				name: 'finance-window-boundary',
				generateBundle(_options, bundle) {
					for (const output of Object.values(bundle)) {
						if (output.type !== 'chunk') continue
						for (const [id, module] of Object.entries(output.modules)) {
							if (
								module.renderedLength > 0 &&
								/\/jazz-tools\//.test(id) &&
								!id.includes('jazz-broker-worker.js?')
							)
								this.error('Native SDK module in Finance Window output: ' + id)
						}
					}
				}
			}
		],
		worker: {
			...workerRuntimeBuildConfig().worker,
			plugins: () => [
				{
					name: 'finance-native-read-controls',
					enforce: 'pre',
					resolveId(source, importer) {
						if (
							source === './binding.js' &&
							importer !== undefined &&
							/\/runtime\/worker\/application\.worker\.ts(?:\?|$)/.test(importer)
						)
							return resolve('tests/worker-application/read-binding.ts')
					},
					generateBundle() {
						const modules = [...this.getModuleIds()]
						if (
							modules.some((id) => id.includes('/runtime/worker/application.worker.ts')) &&
							!modules.some((id) => id.includes('/tests/worker-application/read-binding.ts'))
						)
							this.error('Missing fixture-only SDK seed controls')
						const forbidden = modules.filter(
							(id) => /\.svelte(?:\.[jt]s)?$/.test(id) || /\/jazz-tools\/dist\/svelte\//.test(id)
						)
						if (forbidden.length) this.error('UI module in Finance Worker graph')
					}
				}
			]
		},
		define: { 'process.env.NODE_ENV': JSON.stringify('development') },
		build: {
			outDir: output,
			emptyOutDir: true,
			minify: false,
			rolldownOptions: { input: resolve('tests/worker-application/index.html') }
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
						: extname(file) === '.css'
							? 'text/css'
							: 'application/octet-stream'
		})
	}
	const brokers = [...assets.keys()].filter((p) => /jazz-broker-worker.*\.js$/.test(p))
	if (brokers.length !== 1) throw new Error('Expected one broker asset: ' + brokers.join(', '))
	server = createServer((request, response) => {
		const path = new URL(request.url ?? '/', origin || 'http://test.invalid').pathname
		const asset = assets.get(path === '/' ? '/tests/worker-application/index.html' : path)
		response.writeHead(asset ? 200 : 404, {
			'Content-Type': asset?.type ?? 'text/plain',
			'Cache-Control': 'no-store'
		})
		response.end(asset?.bytes ?? 'No app/auth/Jazz endpoint is available')
	})
	const listener = server
	await new Promise<void>((resolve, reject) => {
		listener.once('error', reject)
		listener.listen(0, '127.0.0.1', resolve)
	})
	const address = listener.address()
	if (!address || typeof address === 'string') throw new Error('Missing fixture address')
	origin = `http://127.0.0.1:${address.port}`
	retained = false
})
afterAll(async () => {
	if (server) {
		const listener = server
		listener.closeAllConnections()
		await new Promise<void>((resolve, reject) => listener.close((e) => (e ? reject(e) : resolve())))
	}
	if (directory && !retained) await rm(directory, { recursive: true, force: true })
	else if (directory) console.error('Finance Worker read artifacts:', directory)
})
async function open(page: Page, scope: string) {
	await page.goto(origin)
	await page.waitForFunction(() => !!window.financeWorkerReadFixture)
	await page.evaluate(
		(scope) =>
			window.financeWorkerReadFixture.open({
				scope,
				serverUrl: location.origin + '/jazz',
				environment: 'worker-read-proof'
			}),
		scope
	)
	await browserExpect
		.poll(() => page.evaluate(() => window.financeWorkerReadFixture.state().status))
		.toBe('ready')
}
async function close(page: Page) {
	await page.evaluate(() => window.financeWorkerReadFixture.close())
	await browserExpect
		.poll(() => page.evaluate(() => window.financeWorkerReadFixture.state().status))
		.toBe('closed')
}
async function createAccountUI(page: Page, name: string) {
	await page.getByRole('button', { name: /add account/i, exact: true }).click()
	const dialog = page.getByRole('dialog', { name: /add account/i })
	await browserExpect(dialog).toBeVisible()
	await dialog.getByLabel(/account name/i).fill(name)
	await dialog.getByLabel(/account type/i).selectOption('cash')
	await dialog.getByRole('button', { name: /add account/i }).click()
	await browserExpect(dialog.getByText(new RegExp(name + '.*saved', 'i'))).toBeVisible()
	await dialog.getByRole('button', { name: 'Close', exact: true }).click()
	await browserExpect(page.getByRole('cell', { name, exact: true })).toBeVisible()
}
for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
	describe(name, () => {
		it('renders only selected accounts and keeps the Worker alive when UI observation detaches', async () => {
			onTestFailed(() => {
				retained = true
			})
			const browser = await engine.launch({ headless: true }),
				page = await browser.newPage()
			try {
				await open(page, crypto.randomUUID())
				const a = crypto.randomUUID(),
					b = crypto.randomUUID(),
					accountA = crypto.randomUUID(),
					accountB = crypto.randomUUID()
				expect(
					await page.evaluate(
						({ a, accountA }) => window.financeWorkerReadFixture.seed(a, accountA, 'Wallet A'),
						{ a, accountA }
					)
				).toEqual({ ok: true })
				expect(
					await page.evaluate(
						({ b, accountB }) => window.financeWorkerReadFixture.seed(b, accountB, 'Wallet B'),
						{ b, accountB }
					)
				).toEqual({ ok: true })
				const select = page.getByLabel('Current Workspace', { exact: true })
				await browserExpect(select.locator('option')).toHaveCount(3)
				await select.selectOption(a)
				await browserExpect(page.getByRole('cell', { name: 'Wallet A', exact: true })).toBeVisible()
				await select.selectOption(b)
				await browserExpect(page.getByRole('cell', { name: 'Wallet B', exact: true })).toBeVisible()
				await browserExpect(page.getByRole('cell', { name: 'Wallet A', exact: true })).toHaveCount(
					0
				)
				await page.evaluate(() => window.financeWorkerReadFixture.detach())
				expect(
					await page.evaluate(
						(accountB) => window.financeWorkerReadFixture.edit(accountB, 'Edited B'),
						accountB
					)
				).toEqual({ ok: true })
				await browserExpect
					.poll(() =>
						page.evaluate(() => window.financeWorkerReadFixture.state().accounts.map((a) => a.name))
					)
					.toEqual(['Edited B'])
				await page.evaluate(() => window.financeWorkerReadFixture.attach())
				await browserExpect(page.getByRole('cell', { name: 'Edited B', exact: true })).toBeVisible()
				await page
					.getByRole('row')
					.filter({ has: page.getByRole('cell', { name: 'Edited B', exact: true }) })
					.getByRole('button', { name: 'Archive', exact: true })
					.click()
				await browserExpect(page.getByRole('cell', { name: 'Edited B', exact: true })).toHaveCount(
					0
				)
				await browserExpect
					.poll(() => page.evaluate(() => window.financeWorkerReadFixture.state().accounts))
					.toEqual([])
				await browserExpect
					.poll(() => page.evaluate(() => window.financeWorkerReadFixture.state().archiveFeedback))
					.toMatchObject({ outcome: 'succeeded', name: 'Edited B' })
				await browserExpect(page.getByText(/Edited B/)).toBeVisible()
				await close(page)
			} finally {
				await browser.close()
			}
		})
		it('creates an account through the existing form with the workspace currency and worker-owned feedback', async () => {
			onTestFailed(() => {
				retained = true
			})
			const browser = await engine.launch({ headless: true }),
				page = await browser.newPage()
			try {
				await open(page, crypto.randomUUID())
				const workspaceId = crypto.randomUUID(),
					accountId = crypto.randomUUID()
				expect(
					await page.evaluate(
						({ workspaceId, accountId }) =>
							window.financeWorkerReadFixture.seed(workspaceId, accountId, 'Seed', 'TZS'),
						{ workspaceId, accountId }
					)
				).toEqual({ ok: true })
				await page.getByLabel('Current Workspace', { exact: true }).selectOption(workspaceId)
				await browserExpect(page.getByRole('cell', { name: 'Seed', exact: true })).toBeVisible()
				await page.getByRole('button', { name: /add account/i, exact: true }).click()
				const dialog = page.getByRole('dialog', { name: /add account/i })
				await browserExpect(dialog.getByLabel('Currency', { exact: true })).toHaveValue('TZS')
				await dialog.getByLabel(/account name/i).fill('Local cash')
				await dialog.getByLabel(/account type/i).selectOption('cash')
				await dialog.getByRole('button', { name: /add account/i }).click()
				await browserExpect(dialog.getByText(/Local cash.*saved/i)).toBeVisible()
				await dialog.getByRole('button', { name: 'Close', exact: true }).click()
				const account = page
					.getByRole('row')
					.filter({ has: page.getByRole('cell', { name: 'Local cash', exact: true }) })
				await browserExpect(account.getByRole('cell', { name: 'TZS', exact: true })).toBeVisible()
				await close(page)
			} finally {
				await browser.close()
			}
		})
		it('drains an archive issued through the real UI before closing its native SDK', async () => {
			onTestFailed(() => {
				retained = true
			})
			const browser = await engine.launch({ headless: true }),
				page = await browser.newPage()
			try {
				await open(page, crypto.randomUUID())
				const workspaceId = crypto.randomUUID(),
					accountId = crypto.randomUUID()
				expect(
					await page.evaluate(
						({ workspaceId, accountId }) =>
							window.financeWorkerReadFixture.seed(workspaceId, accountId, 'Pending archive'),
						{ workspaceId, accountId }
					)
				).toEqual({ ok: true })
				await page.evaluate((id) => window.financeWorkerReadFixture.select(id), workspaceId)
				const row = page
					.getByRole('row')
					.filter({ has: page.getByRole('cell', { name: 'Pending archive', exact: true }) })
				await browserExpect(row).toBeVisible()
				expect(await page.evaluate(() => window.financeWorkerReadFixture.holdArchive())).toEqual({
					ok: true
				})
				await row.getByRole('button', { name: 'Archive', exact: true }).click()
				await browserExpect(row).toHaveCount(0)
				await page.evaluate(() => window.financeWorkerReadFixture.close())
				await browserExpect
					.poll(() => page.evaluate(() => window.financeWorkerReadFixture.state().status))
					.toBe('closing')
				expect(await page.evaluate(() => window.financeWorkerReadFixture.releaseArchive())).toEqual(
					{ ok: true }
				)
				await browserExpect
					.poll(() => page.evaluate(() => window.financeWorkerReadFixture.state().status))
					.toBe('closed')
			} finally {
				await browser.close()
			}
		})
		it('keeps data failed after a malformed view and still waits for clean native close', async () => {
			onTestFailed(() => {
				retained = true
			})
			const browser = await engine.launch({ headless: true }),
				page = await browser.newPage()
			try {
				await open(page, crypto.randomUUID())
				expect(await page.evaluate(() => window.financeWorkerReadFixture.badView())).toEqual({
					ok: true
				})
				await browserExpect
					.poll(() => page.evaluate(() => window.financeWorkerReadFixture.state().status))
					.toBe('failed')
				const workspaceId = crypto.randomUUID(),
					accountId = crypto.randomUUID()
				expect(
					await page.evaluate(
						({ workspaceId, accountId }) =>
							window.financeWorkerReadFixture.seed(workspaceId, accountId, 'After fault'),
						{ workspaceId, accountId }
					)
				).toEqual({ ok: true })
				await page.evaluate((id) => window.financeWorkerReadFixture.select(id), workspaceId)
				expect(await page.evaluate(() => window.financeWorkerReadFixture.state().status)).toBe(
					'failed'
				)
				await expect(
					page.getByRole('cell', { name: 'After fault', exact: true }).count()
				).resolves.toBe(0)
				await close(page)
			} finally {
				await browser.close()
			}
		})
		it('retains selected rows after a full process restart with app/auth/Jazz endpoints unreachable', async () => {
			onTestFailed(() => {
				retained = true
			})
			const profile = await mkdtemp(join(directory, 'profile-'))
			const scope = crypto.randomUUID(),
				workspaceId = crypto.randomUUID(),
				accountId = crypto.randomUUID()
			let context = await engine.launchPersistentContext(profile, { headless: true })
			try {
				let page = await context.newPage()
				await open(page, scope)
				const identity = await page.evaluate(
					() => window.financeWorkerReadFixture.state().identityId
				)
				expect(
					await page.evaluate(
						({ workspaceId, accountId }) =>
							window.financeWorkerReadFixture.seed(workspaceId, accountId, 'Retained wallet'),
						{ workspaceId, accountId }
					)
				).toEqual({ ok: true })
				await page.evaluate((id) => window.financeWorkerReadFixture.select(id), workspaceId)
				await browserExpect(
					page.getByRole('cell', { name: 'Retained wallet', exact: true })
				).toBeVisible()
				await createAccountUI(page, 'Offline created wallet')
				await close(page)
				await context.close()
				context = await engine.launchPersistentContext(profile, { headless: true })
				page = await context.newPage()
				await open(page, scope)
				expect(await page.evaluate(() => window.financeWorkerReadFixture.state().identityId)).toBe(
					identity
				)
				await page.evaluate((id) => window.financeWorkerReadFixture.select(id), workspaceId)
				await browserExpect(
					page.getByRole('cell', { name: 'Retained wallet', exact: true })
				).toBeVisible()
				expect(
					await page.evaluate(
						(id) => window.financeWorkerReadFixture.edit(id, 'Retained edit'),
						accountId
					)
				).toEqual({ ok: true })
				await browserExpect(
					page.getByRole('cell', { name: 'Retained edit', exact: true })
				).toBeVisible()
				await close(page)
				await context.close()
				context = await engine.launchPersistentContext(profile, { headless: true })
				page = await context.newPage()
				await open(page, scope)
				await page.evaluate((id) => window.financeWorkerReadFixture.select(id), workspaceId)
				await browserExpect(
					page.getByRole('cell', { name: 'Retained edit', exact: true })
				).toBeVisible()
				await browserExpect(
					page.getByRole('cell', { name: 'Offline created wallet', exact: true })
				).toBeVisible()
				await close(page)
			} finally {
				await context.close()
			}
		})
	})
}
