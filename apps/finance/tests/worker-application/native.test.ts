import { createJazz, memory, acceptLocalFirstAuth } from 'jazz-tools/backend'
import { app } from '../../src/lib/schema.js'
import permissions from '../../src/lib/permissions.js'
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
								/\/(?:domain\/(?:account-balances|transaction-groups)|filters\/transaction-list-filters)\.[jt]s$/.test(
									id
								)
							)
								this.error('Finance projection in Window output: ' + id)
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
					transform(code, id) {
						if (!/\/runtime\/worker\/application\.worker\.ts$/.test(id)) return
						return code
							.replace(
								'import { createFinanceWorkerBinding }',
								'import { createFinanceWorkerBinding, inspectWorkerFailure, traceSessionInput }'
							)
							.replace('input: native', 'input: traceSessionInput(native)')
							.replace(
								'application = createActor(machine, {',
								'application = createActor(machine, { inspect: inspectWorkerFailure,'
							)
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
async function open(page: Page, scope: string, serverUrl = origin + '/jazz') {
	await page.goto(origin)
	await page.waitForFunction(() => !!window.financeWorkerReadFixture)
	await page.evaluate(
		({ scope, serverUrl }) =>
			window.financeWorkerReadFixture.open({
				scope,
				serverUrl,
				environment: 'worker-read-proof'
			}),
		{ scope, serverUrl }
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
async function enterExpenseUI(page: Page, accountId: string, description: string) {
	await page.getByLabel('Account', { exact: true }).selectOption(accountId)
	await page.getByLabel('Category', { exact: true }).selectOption({ label: 'Worker expense' })
	await page.getByLabel('Amount', { exact: true }).fill('12.34')
	await page.getByLabel('Date', { exact: true }).fill('2026-11-18')
	await page.getByLabel('Description', { exact: true }).fill(description)
	await page.getByRole('button', { name: /save transaction/i }).click()
	await browserExpect(
		page.getByRole('status').filter({ hasText: /transaction saved/i })
	).toBeVisible()
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
				await browserExpect(page.getByRole('status').filter({ hasText: 'Edited B' })).toBeVisible()
				await close(page)
			} finally {
				await browser.close()
			}
		})
		it('routes late workspaces, native selection and legacy details, hides denied scope, and drains navigation on close', async () => {
			onTestFailed(() => {
				retained = true
			})
			const browser = await engine.launch({ headless: true }),
				page = await browser.newPage()
			try {
				await open(page, crypto.randomUUID())
				await page.evaluate(() => {
					window.financeWorkerReadFixture.route('/accounts?query=rent&page=2#row')
					window.financeWorkerReadFixture.followRoutes()
				})
				await browserExpect.poll(() => new URL(page.url()).pathname).toBe('/settings/workspace')
				await browserExpect
					.poll(() =>
						page.evaluate(() => window.financeWorkerReadFixture.state().workspaceNavigation?.status)
					)
					.toBe('directory')
				const a = crypto.randomUUID(),
					b = crypto.randomUUID(),
					accountA = crypto.randomUUID(),
					accountB = crypto.randomUUID()
				expect(
					await page.evaluate(
						({ a, accountA }) => window.financeWorkerReadFixture.seed(a, accountA, 'Route A'),
						{ a, accountA }
					)
				).toEqual({ ok: true })
				await browserExpect
					.poll(() => page.url().slice(origin.length))
					.toBe('/accounts?query=rent&page=2&workspace=' + a + '#row')
				await browserExpect(page.getByRole('cell', { name: 'Route A', exact: true })).toBeVisible()
				await enterExpenseUI(page, accountA, 'Route expense')
				const transaction = (
					await page.evaluate((id) => window.financeWorkerReadFixture.transactions(id), a)
				).transactions?.[0]
				if (!transaction) throw new Error('Missing routed transaction')
				expect(
					await page.evaluate(
						({ b, accountB }) => window.financeWorkerReadFixture.seed(b, accountB, 'Route B'),
						{ b, accountB }
					)
				).toEqual({ ok: true })
				const select = page.getByLabel('Current Workspace', { exact: true })
				await browserExpect(select.locator('option')).toHaveCount(3)
				await select.selectOption(b)
				await browserExpect
					.poll(() => page.url().slice(origin.length))
					.toBe('/accounts?query=rent&workspace=' + b + '#row')
				await browserExpect(page.getByRole('cell', { name: 'Route B', exact: true })).toBeVisible()
				await browserExpect(page.getByRole('cell', { name: 'Route A', exact: true })).toHaveCount(0)
				await page.evaluate(
					(id) => window.financeWorkerReadFixture.route('/expenses?workspace=' + id),
					crypto.randomUUID()
				)
				await browserExpect
					.poll(() =>
						page.evaluate(() => window.financeWorkerReadFixture.state().workspaceNavigation)
					)
					.toMatchObject({ status: 'unavailable', showContent: false })
				await browserExpect(page.getByRole('cell', { name: 'Route B', exact: true })).toHaveCount(0)
				await page.evaluate(
					(id) => window.financeWorkerReadFixture.route('/expenses/' + id + '?page=2#detail'),
					transaction.id
				)
				await browserExpect
					.poll(() => page.url().slice(origin.length))
					.toBe('/expenses/' + transaction.id + '?page=2&workspace=' + a + '#detail')
				await browserExpect(page.getByRole('cell', { name: 'Route A', exact: true })).toBeVisible()
				const before = await page.evaluate(() => window.financeWorkerReadFixture.navigationCalls())
				await page.evaluate(() => window.financeWorkerReadFixture.holdNavigation())
				await select.selectOption(b)
				await browserExpect
					.poll(() => page.evaluate(() => window.financeWorkerReadFixture.navigationCalls()))
					.toBe(before + 1)
				await page.evaluate(() => window.financeWorkerReadFixture.close())
				await browserExpect
					.poll(() => page.evaluate(() => window.financeWorkerReadFixture.state().status))
					.toBe('closing')
				await page.evaluate(() => window.financeWorkerReadFixture.releaseNavigation())
				await browserExpect
					.poll(() => page.evaluate(() => window.financeWorkerReadFixture.state().status))
					.toBe('closed')
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
		it('reveals a recovery phrase only on request and clears the shared dialog on hide, detach and close', async () => {
			onTestFailed(() => {
				retained = true
			})
			const browser = await engine.launch({ headless: true }),
				page = await browser.newPage()
			try {
				await open(page, crypto.randomUUID())
				expect(await page.evaluate(() => window.financeWorkerReadFixture.recoveryReads())).toEqual({
					ok: true,
					recoveryReads: 0
				})
				const show = page.getByRole('button', { name: /show recovery phrase/i })
				await show.click()
				const phrase = page.getByRole('textbox', { name: /recovery phrase/i })
				await browserExpect(phrase).toBeVisible()
				const revealed = await phrase.inputValue()
				expect(revealed.trim().split(/\s+/).length).toBeGreaterThan(10)
				expect(await page.evaluate(() => window.financeWorkerReadFixture.recoveryReads())).toEqual({
					ok: true,
					recoveryReads: 1
				})
				expect(
					await page.evaluate(() =>
						JSON.stringify(window.financeWorkerReadFixture.state(), (_key, value: unknown) =>
							typeof value === 'bigint' ? String(value) : value
						)
					)
				).not.toContain(revealed)
				await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
				await browserExpect(phrase).toHaveCount(0)
				await show.click()
				await browserExpect(phrase).toHaveValue(revealed)
				await page.evaluate(() => window.financeWorkerReadFixture.detach())
				await page.evaluate(() => window.financeWorkerReadFixture.attach())
				await browserExpect(phrase).toHaveCount(0)
				expect(await page.evaluate(() => window.financeWorkerReadFixture.recoveryReads())).toEqual({
					ok: true,
					recoveryReads: 2
				})
				await show.click()
				await close(page)
				await browserExpect(phrase).toHaveCount(0)
			} finally {
				await browser.close()
			}
		})
		it('resumes finance after native offline restoration refusal following a held archive and UI remount', async () => {
			onTestFailed(() => {
				retained = true
			})
			const browser = await engine.launch({ headless: true }),
				page = await browser.newPage()
			const failures: string[] = []
			page.on('console', (message) => {
				if (message.type() === 'error' && message.text().startsWith('Native session change error'))
					failures.push(message.text())
			})
			try {
				await open(page, crypto.randomUUID())
				const workspaceId = crypto.randomUUID(),
					accountId = crypto.randomUUID()
				expect(
					await page.evaluate(
						({ workspaceId, accountId }) =>
							window.financeWorkerReadFixture.seed(workspaceId, accountId, 'Before restore'),
						{ workspaceId, accountId }
					)
				).toEqual({ ok: true })
				await page.getByLabel('Current Workspace', { exact: true }).selectOption(workspaceId)
				await browserExpect(
					page.getByRole('cell', { name: 'Before restore', exact: true })
				).toBeVisible()
				const identity = await page.evaluate(
					() => window.financeWorkerReadFixture.state().identityId
				)
				await page.getByRole('button', { name: /show recovery phrase/i }).click()
				const phrase = await page
					.getByRole('dialog')
					.getByRole('textbox', { name: /recovery phrase/i })
					.inputValue()
				await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
				expect(await page.evaluate(() => window.financeWorkerReadFixture.holdArchive())).toEqual({
					ok: true
				})
				await page.getByRole('button', { name: 'Archive', exact: true }).click()
				await page.locator('summary').filter({ hasText: 'Login' }).click()
				await page.getByRole('textbox', { name: /recovery phrase/i }).fill(phrase)
				await page.getByRole('button', { name: 'Login', exact: true }).click()
				await browserExpect
					.poll(() =>
						page.evaluate(() => window.financeWorkerReadFixture.state().identityRestore.busy)
					)
					.toBe(true)
				await browserExpect
					.poll(() => page.evaluate(() => window.financeWorkerReadFixture.state().status))
					.toBe('loading')
				await page.evaluate(() => window.financeWorkerReadFixture.detach())
				await page.evaluate(() => window.financeWorkerReadFixture.attach())
				await page.locator('summary').filter({ hasText: 'Login' }).click()
				await browserExpect(page.getByRole('textbox', { name: /recovery phrase/i })).toHaveValue('')
				await browserExpect(page.getByRole('textbox', { name: /recovery phrase/i })).toBeDisabled()
				expect(await page.evaluate(() => window.financeWorkerReadFixture.releaseArchive())).toEqual(
					{ ok: true }
				)
				await browserExpect
					.poll(() => page.evaluate(() => window.financeWorkerReadFixture.state().identityRestore))
					.toMatchObject({ busy: false, error: true })
				expect(await page.evaluate(() => window.financeWorkerReadFixture.state().identityId)).toBe(
					identity
				)
				await page.getByLabel('Current Workspace', { exact: true }).selectOption(workspaceId)
				await browserExpect
					.poll(() => page.evaluate(() => window.financeWorkerReadFixture.state().status))
					.toBe('ready')
				expect(await page.evaluate(() => window.financeWorkerReadFixture.state().accounts)).toEqual(
					[]
				)
				expect(
					await page.evaluate(() => window.financeWorkerReadFixture.state().archiveFeedback)
				).toBeNull()
				expect(failures).toHaveLength(1)
				expect(failures[0]).toContain('GracefulShutdownSyncError')
				await close(page)
			} finally {
				await browser.close()
			}
		})
		it('restores existing finance from another browser profile and retains its transactions offline', async () => {
			onTestFailed(() => {
				retained = true
			})
			const authority = createJazz({
				app,
				permissions,
				store: memory(),
				authenticate: acceptLocalFirstAuth,
				allowedOrigins: [origin]
			})
			const endpoint = createServer((request, response) => authority.nodeHandler(request, response))
			await authority.attach(endpoint)
			await authority.ready()
			await new Promise<void>((resolve) => endpoint.listen(0, '127.0.0.1', resolve))
			const address = endpoint.address()
			if (!address || typeof address === 'string') throw new Error('Missing restoration authority')
			const serverUrl = `http://127.0.0.1:${address.port}/jazz`,
				scope = serverUrl
			const sourceProfile = await mkdtemp(join(directory, 'restore-source-')),
				restoredProfile = await mkdtemp(join(directory, 'restored-'))
			let context = await engine.launchPersistentContext(sourceProfile, { headless: true })
			try {
				let page = await context.newPage()
				await open(page, scope, serverUrl)
				await browserExpect
					.poll(() => page.evaluate(() => window.financeWorkerReadFixture.state().workspaceStartup))
					.toBe('ready')
				const original = await page.evaluate(() => window.financeWorkerReadFixture.state())
				const workspace = original.workspaces?.[0]
				if (!workspace) throw new Error('Missing source workspace')
				await page.getByLabel('Current Workspace', { exact: true }).selectOption(workspace.id)
				await createAccountUI(page, 'Recovered wallet')
				await page
					.getByLabel('Account', { exact: true })
					.selectOption({ label: 'Recovered wallet · USD' })
				await page.getByLabel('Category', { exact: true }).selectOption({ index: 1 })
				await page.getByLabel('Amount', { exact: true }).fill('12.34')
				await page.getByLabel('Date', { exact: true }).fill('2026-11-18')
				await page.getByLabel('Description', { exact: true }).fill('Existing recovered expense')
				await page.getByRole('button', { name: /save transaction/i }).click()
				await browserExpect(
					page.getByRole('status').filter({ hasText: /transaction saved/i })
				).toBeVisible()
				await browserExpect
					.poll(async () => {
						const result = await page.evaluate(
							(id) => window.financeWorkerReadFixture.transactions(id, true),
							workspace.id
						)
						return result.transactions?.map((row) => row.description)
					})
					.toEqual(['Existing recovered expense'])
				await page.getByRole('button', { name: /show recovery phrase/i }).click()
				const phrase = await page
					.getByRole('dialog')
					.getByRole('textbox', { name: /recovery phrase/i })
					.inputValue()
				await close(page)
				await context.close()
				context = await engine.launchPersistentContext(restoredProfile, { headless: true })
				page = await context.newPage()
				await open(page, scope, serverUrl)
				await browserExpect
					.poll(() => page.evaluate(() => window.financeWorkerReadFixture.state().workspaceStartup))
					.toBe('ready')
				const temporary = await page.evaluate(
					() => window.financeWorkerReadFixture.state().identityId
				)
				expect(temporary).not.toBe(original.identityId)
				await page.locator('summary').filter({ hasText: 'Login' }).click()
				const input = page.getByRole('textbox', { name: /recovery phrase/i })
				await input.fill('not a recovery phrase')
				await page.getByRole('button', { name: 'Login', exact: true }).click()
				await browserExpect(
					page.getByRole('alert').filter({ hasText: /check the recovery phrase/i })
				).toBeVisible()
				expect(await page.evaluate(() => window.financeWorkerReadFixture.state().identityId)).toBe(
					temporary
				)
				await browserExpect(input).toHaveValue('')
				await page.evaluate(() => {
					window.financeWorkerReadFixture.route('/login')
					window.financeWorkerReadFixture.failNextNavigation()
				})
				await input.fill(phrase)
				await page.getByRole('button', { name: 'Login', exact: true }).click()
				await browserExpect
					.poll(() => page.evaluate(() => window.financeWorkerReadFixture.state().identityId))
					.toBe(original.identityId)
				await browserExpect
					.poll(() => page.evaluate(() => window.financeWorkerReadFixture.state().identityRestore))
					.toMatchObject({ busy: false, error: false })
				await browserExpect(input).toHaveValue('')
				await browserExpect(
					page
						.getByRole('alert')
						.filter({ hasText: /account was restored.*destination could not be opened/i })
				).toBeVisible()
				expect(await page.evaluate(() => window.financeWorkerReadFixture.navigationCalls())).toBe(1)
				await page.evaluate(() => window.financeWorkerReadFixture.holdNavigation())
				await page.getByRole('button', { name: 'Try again', exact: true }).click()
				await browserExpect
					.poll(() => page.evaluate(() => window.financeWorkerReadFixture.navigationCalls()))
					.toBe(2)
				await browserExpect
					.poll(() => page.evaluate(() => window.financeWorkerReadFixture.state().identityRestore))
					.toMatchObject({ busy: true, navigationOnly: true })
				await page.evaluate(() => {
					window.financeWorkerReadFixture.route('/account')
					window.financeWorkerReadFixture.releaseNavigation()
				})
				await browserExpect
					.poll(() => page.evaluate(() => window.financeWorkerReadFixture.state().identityRestore))
					.toMatchObject({ busy: false, navigationError: false })
				expect(new URL(page.url()).pathname).toBe('/account')
				await browserExpect
					.poll(() =>
						page.evaluate(() =>
							window.financeWorkerReadFixture.state().workspaces?.map((w) => w.id)
						)
					)
					.toEqual([workspace.id])
				await page.getByLabel('Current Workspace', { exact: true }).selectOption(workspace.id)
				await browserExpect(
					page.getByRole('cell', { name: 'Recovered wallet', exact: true })
				).toBeVisible()
				await browserExpect(
					page.getByRole('link', { name: /transaction details.*Existing recovered expense/i })
				).toBeVisible()
				await page.evaluate(() => {
					window.financeWorkerReadFixture.route('/login')
					window.financeWorkerReadFixture.holdNavigation()
				})
				await input.fill(phrase)
				await page.getByRole('button', { name: 'Login', exact: true }).click()
				await browserExpect
					.poll(() => page.evaluate(() => window.financeWorkerReadFixture.navigationCalls()))
					.toBe(3)
				await page.evaluate(() => window.financeWorkerReadFixture.close())
				await browserExpect
					.poll(() => page.evaluate(() => window.financeWorkerReadFixture.state().status))
					.toBe('closing')
				await page.evaluate(() => window.financeWorkerReadFixture.releaseNavigation())
				await browserExpect
					.poll(() => page.evaluate(() => window.financeWorkerReadFixture.state().status))
					.toBe('closed')
				expect(new URL(page.url()).pathname).toBe('/')
				await context.close()
				await authority.close()
				endpoint.closeAllConnections()
				await new Promise<void>((resolve) => endpoint.close(() => resolve()))
				context = await engine.launchPersistentContext(restoredProfile, { headless: true })
				page = await context.newPage()
				await open(page, scope, serverUrl)
				expect(await page.evaluate(() => window.financeWorkerReadFixture.state().identityId)).toBe(
					original.identityId
				)
				await page.getByLabel('Current Workspace', { exact: true }).selectOption(workspace.id)
				await browserExpect(
					page.getByRole('link', { name: /transaction details.*Existing recovered expense/i })
				).toBeVisible()
				await close(page)
			} finally {
				await context.close()
				await authority.close()
				if (endpoint.listening) {
					endpoint.closeAllConnections()
					await new Promise<void>((resolve) => endpoint.close(() => resolve()))
				}
			}
		})
		it('initializes a real workspace without fixture writes and reuses its marker offline', async () => {
			onTestFailed(() => {
				retained = true
			})
			const authority = createJazz({
				app,
				permissions,
				store: memory(),
				authenticate: acceptLocalFirstAuth,
				allowedOrigins: [origin]
			})
			const endpoint = createServer((request, response) => authority.nodeHandler(request, response))
			await authority.attach(endpoint)
			await authority.ready()
			await new Promise<void>((resolve) => endpoint.listen(0, '127.0.0.1', resolve))
			const address = endpoint.address()
			if (!address || typeof address === 'string')
				throw new Error('Missing native initialization authority')
			const serverUrl = `http://127.0.0.1:${address.port}/jazz`,
				scope = serverUrl
			const profile = await mkdtemp(join(directory, 'initialization-'))
			let context = await engine.launchPersistentContext(profile, { headless: true })
			try {
				let page = await context.newPage()
				await open(page, scope, serverUrl)
				await browserExpect
					.poll(() => page.evaluate(() => window.financeWorkerReadFixture.state().workspaceStartup))
					.toBe('ready')
				const workspaces = await page.evaluate(
					() => window.financeWorkerReadFixture.state().workspaces
				)
				expect(workspaces).toHaveLength(1)
				const workspace = workspaces?.[0]
				if (!workspace) throw new Error('Native initialization did not create a workspace')
				await page.getByLabel('Current Workspace', { exact: true }).selectOption(workspace.id)
				await createAccountUI(page, 'Initialized wallet')
				await browserExpect(
					page.getByRole('cell', { name: 'Initialized wallet', exact: true })
				).toBeVisible()
				await close(page)
				await context.close()
				await authority.close()
				endpoint.closeAllConnections()
				await new Promise<void>((resolve, reject) =>
					endpoint.close((error) => (error ? reject(error) : resolve()))
				)
				context = await engine.launchPersistentContext(profile, { headless: true })
				page = await context.newPage()
				await open(page, scope, serverUrl)
				await browserExpect
					.poll(() => page.evaluate(() => window.financeWorkerReadFixture.state().workspaceStartup))
					.toBe('ready')
				expect(
					await page.evaluate(() => window.financeWorkerReadFixture.state().workspaces)
				).toEqual(workspaces)
				await page.getByLabel('Current Workspace', { exact: true }).selectOption(workspace.id)
				await browserExpect(
					page.getByRole('cell', { name: 'Initialized wallet', exact: true })
				).toBeVisible()
				await close(page)
			} finally {
				await context.close()
				await authority.close()
				if (endpoint.listening) {
					endpoint.closeAllConnections()
					await new Promise<void>((resolve) => endpoint.close(() => resolve()))
				}
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
		it('saves expense and income through the real transaction form in the application Worker', async () => {
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
							window.financeWorkerReadFixture.seed(workspaceId, accountId, 'Ledger'),
						{ workspaceId, accountId }
					)
				).toEqual({ ok: true })
				await page.getByLabel('Current Workspace', { exact: true }).selectOption(workspaceId)
				await browserExpect(page.getByRole('cell', { name: 'Ledger', exact: true })).toBeVisible()
				await browserExpect(page.getByLabel('Account', { exact: true })).toHaveValue(accountId)

				await enterExpenseUI(page, accountId, 'Worker expense record')
				expect(
					await page.evaluate((id) => window.financeWorkerReadFixture.transactions(id), workspaceId)
				).toMatchObject({
					ok: true,
					transactions: [
						{
							amountMinor: 1234,
							currency: 'USD',
							kind: 'expense',
							description: 'Worker expense record',
							paymentMethod: null,
							checkId: null
						}
					]
				})
				await page.evaluate(() => window.financeWorkerReadFixture.selectKind('income'))
				await browserExpect(
					page
						.getByLabel('Category', { exact: true })
						.locator('option', { hasText: 'Worker income' })
				).toHaveCount(1)
				await page.getByLabel('Category', { exact: true }).selectOption({ label: 'Worker income' })
				await page.getByLabel('Amount', { exact: true }).fill('50.00')
				await page.getByLabel('Date', { exact: true }).fill('2026-11-19')
				await page.getByLabel('Payment method', { exact: true }).selectOption('cash')
				await page.getByRole('button', { name: /save transaction/i }).click()
				await browserExpect(
					page.getByRole('status').filter({ hasText: /transaction saved/i })
				).toBeVisible()
				expect(
					await page.evaluate((id) => window.financeWorkerReadFixture.transactions(id), workspaceId)
				).toMatchObject({
					ok: true,
					transactions: [
						{ amountMinor: 1234, kind: 'expense' },
						{ amountMinor: 5000, kind: 'income', paymentMethod: 'cash' }
					]
				})
				await close(page)
			} finally {
				await browser.close()
			}
		})
		it('edits income check details and moves its check and ledger account together', async () => {
			onTestFailed(() => {
				retained = true
			})
			const browser = await engine.launch({ headless: true }),
				page = await browser.newPage()
			page.on('console', (message) => {
				if (message.type() === 'error' && message.text().startsWith('Native worker actor error'))
					console.error(message.text())
			})
			try {
				await open(page, crypto.randomUUID())
				const workspaceId = crypto.randomUUID(),
					accountId = crypto.randomUUID()
				expect(
					await page.evaluate(
						({ workspaceId, accountId }) =>
							window.financeWorkerReadFixture.seed(workspaceId, accountId, 'Check origin'),
						{ workspaceId, accountId }
					)
				).toEqual({ ok: true })
				await page.getByLabel('Current Workspace', { exact: true }).selectOption(workspaceId)
				await createAccountUI(page, 'Check destination')
				await page.evaluate(() => window.financeWorkerReadFixture.selectKind('income'))
				await browserExpect(
					page
						.getByLabel('Category', { exact: true })
						.locator('option', { hasText: 'Worker income' })
				).toHaveCount(1)
				await page.getByLabel('Account', { exact: true }).selectOption(accountId)
				await page.getByLabel('Category', { exact: true }).selectOption({ label: 'Worker income' })
				await page.getByLabel('Amount', { exact: true }).fill('50.00')
				await page.getByLabel('Date', { exact: true }).fill('2026-11-19')
				await page.getByLabel('Payment method', { exact: true }).selectOption('check')
				await page.locator('[name="checkNumber"]').fill('100')
				await page.locator('[name="checkDate"]').fill('2026-11-19')
				const save = page.getByRole('button', { name: /save transaction/i })
				await save.click()
				await browserExpect(
					page.getByRole('status').filter({ hasText: /transaction saved/i })
				).toBeVisible()
				await page.getByRole('link', { name: /transaction details/i }).click()
				await browserExpect(page.locator('[name="checkNumber"]')).toHaveValue('100')
				await page.locator('[name="checkNumber"]').fill('101')
				await page
					.getByLabel('Account', { exact: true })
					.selectOption({ label: 'Check destination · USD' })
				await save.click()
				await browserExpect(save).toBeDisabled()
				await browserExpect
					.poll(
						async () =>
							(
								await page.evaluate(
									(id) => window.financeWorkerReadFixture.transactions(id),
									workspaceId
								)
							).transactions?.[0]
					)
					.toMatchObject({
						checkNumber: '101',
						accountId: await page.getByLabel('Account', { exact: true }).inputValue(),
						checkAccountId: await page.getByLabel('Account', { exact: true }).inputValue()
					})
				await close(page)
			} finally {
				await browser.close()
			}
		})
		it('edits an existing expense through the worker form and discards a replaced editor draft', async () => {
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
							window.financeWorkerReadFixture.seed(workspaceId, accountId, 'Edit wallet'),
						{ workspaceId, accountId }
					)
				).toEqual({ ok: true })
				await page.getByLabel('Current Workspace', { exact: true }).selectOption(workspaceId)
				await enterExpenseUI(page, accountId, 'Worker editable expense')
				await page
					.getByRole('link', { name: /transaction details.*Worker editable expense/i })
					.click()
				const amount = page.getByLabel('Amount', { exact: true }),
					save = page.getByRole('button', { name: /save transaction/i })
				await browserExpect(amount).toHaveValue('12.34')
				await browserExpect(save).toBeDisabled()
				await amount.fill('25.00')
				await browserExpect(save).toBeEnabled()
				await amount.fill('12.34')
				await browserExpect(save).toBeDisabled()
				await amount.fill('25.00')
				await save.click()
				await browserExpect
					.poll(
						async () =>
							(
								await page.evaluate(
									(id) => window.financeWorkerReadFixture.transactions(id),
									workspaceId
								)
							).transactions?.[0]?.amountMinor
					)
					.toBe(2500)
				await browserExpect(save).toBeDisabled()
				await page
					.getByLabel('Memo (additional notes)', { exact: true })
					.fill('Repeated worker edit')
				await save.click()
				await browserExpect(save).toBeDisabled()
				const id = await page.evaluate(() => window.financeWorkerReadFixture.state().transactionId)
				expect(id).not.toBeNull()
				await amount.fill('99.00')
				await page.evaluate(() => window.financeWorkerReadFixture.selectTransaction(null))
				await page.evaluate((id) => window.financeWorkerReadFixture.selectTransaction(id), id)
				await browserExpect(amount).toHaveValue('25.00')
				await browserExpect(
					page.getByLabel('Memo (additional notes)', { exact: true })
				).toHaveValue('Repeated worker edit')
				await browserExpect(save).toBeDisabled()
				await close(page)
			} finally {
				await browser.close()
			}
		})
		it('renders bounded ledger pages, exact live balances and worker-owned text filtering', async () => {
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
							window.financeWorkerReadFixture.seed(workspaceId, accountId, 'Pagination wallet'),
						{ workspaceId, accountId }
					)
				).toEqual({ ok: true })
				await page.getByLabel('Current Workspace', { exact: true }).selectOption(workspaceId)
				expect(
					await page.evaluate(
						({ workspaceId, accountId }) =>
							window.financeWorkerReadFixture.seedLedger(workspaceId, accountId),
						{ workspaceId, accountId }
					)
				).toEqual({ ok: true })
				await browserExpect
					.poll(() =>
						page.evaluate(() => window.financeWorkerReadFixture.state().accounts[0]?.balanceMinor)
					)
					.toBe(-4000n)
				await browserExpect(page.getByText(/^Ledger record \d+$/)).toHaveCount(25)
				await browserExpect(page.getByText('$40.00', { exact: true })).toBeVisible()
				const originalUrl = page.url()
				await page.getByRole('link', { name: /next page/i }).click()
				await browserExpect(page.getByText(/^Ledger record \d+$/)).toHaveCount(15)
				await browserExpect(page.getByText('$40.00', { exact: true })).toBeVisible()
				expect(page.url()).toBe(originalUrl)
				await page
					.getByRole('link', { name: /transaction details/i })
					.first()
					.click()
				await browserExpect(page.getByLabel('Amount', { exact: true })).toHaveValue('1.00')
				expect(
					await page.evaluate(() => window.financeWorkerReadFixture.state().ledger?.page)
				).toBe(2)
				await page.getByRole('button', { name: 'Back to List', exact: true }).click()
				await browserExpect(page.getByText(/^Ledger record \d+$/)).toHaveCount(15)
				expect(
					await page.evaluate(
						() =>
							window.financeWorkerReadFixture.state().ledger?.groups.flatMap((g) => g.transactions)
								.length
					)
				).toBe(15)
				await page.getByRole('button', { name: /search transactions/i }).click()
				await page
					.getByRole('searchbox', { name: /search transactions/i })
					.fill('ledger memo needle')
				await browserExpect(page.getByText(/^Ledger record \d+$/)).toHaveCount(1)
				await browserExpect(page.getByText('Ledger record 39', { exact: true })).toBeVisible()
				expect(
					await page.evaluate(() => window.financeWorkerReadFixture.state().ledger?.page)
				).toBe(1)
				expect(
					await page.evaluate(
						() => window.financeWorkerReadFixture.state().accounts[0]?.balanceMinor
					)
				).toBe(-4000n)
				expect(
					await page.evaluate(() =>
						Object.keys(
							window.financeWorkerReadFixture.state().ledger?.groups[0]?.transactions[0] ?? {}
						)
					)
				).not.toContain('memo')
				await close(page)
			} finally {
				await browser.close()
			}
		})
		it('preserves direct filtered pages and input focus through native replacement and back/forward', async () => {
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
							window.financeWorkerReadFixture.seed(workspaceId, accountId, 'URL wallet'),
						{ workspaceId, accountId }
					)
				).toEqual({ ok: true })
				expect(
					await page.evaluate(
						({ workspaceId, accountId }) =>
							window.financeWorkerReadFixture.seedLedger(workspaceId, accountId),
						{ workspaceId, accountId }
					)
				).toEqual({ ok: true })
				await page.evaluate((id) => {
					window.financeWorkerReadFixture.route(
						'/expenses?workspace=' + id + '&page=2&q=ledger&keep=yes#row'
					)
					window.financeWorkerReadFixture.followRoutes()
				}, workspaceId)
				await browserExpect(page.getByText(/^Ledger record \d+$/)).toHaveCount(15)
				await page.getByRole('link', { name: /previous page/i }).click()
				await browserExpect.poll(() => new URL(page.url()).searchParams.has('page')).toBe(false)
				await browserExpect(page.getByText(/^Ledger record \d+$/)).toHaveCount(25)
				await page.getByRole('button', { name: /search transactions/i }).click()
				const input = page.getByRole('searchbox', { name: /search transactions/i })
				await input.fill('')
				await browserExpect.poll(() => new URL(page.url()).searchParams.has('q')).toBe(false)
				await input.pressSequentially('ledger memo needle', { delay: 25 })
				await browserExpect(input).toHaveValue('ledger memo needle')
				await browserExpect(input).toBeFocused()
				await browserExpect(page.getByText('Ledger record 39', { exact: true })).toBeVisible()
				await browserExpect
					.poll(() => new URL(page.url()).searchParams.get('q'))
					.toBe('ledger memo needle')
				expect(new URL(page.url()).searchParams.get('keep')).toBe('yes')
				expect(new URL(page.url()).hash).toBe('#row')
				await page.evaluate(
					(id) =>
						window.financeWorkerReadFixture.route(
							'/expenses?workspace=' + id + '&page=2&q=ledger#other'
						),
					workspaceId
				)
				await browserExpect(page.getByText(/^Ledger record \d+$/)).toHaveCount(15)
				await page.goBack()
				await browserExpect(page.getByText('Ledger record 39', { exact: true })).toBeVisible()
				await browserExpect
					.poll(() =>
						page.evaluate(() => window.financeWorkerReadFixture.state().ledger?.filters.query)
					)
					.toBe('ledger memo needle')
				await page.goForward()
				await browserExpect(page.getByText(/^Ledger record \d+$/)).toHaveCount(15)
				await browserExpect
					.poll(() => page.evaluate(() => window.financeWorkerReadFixture.state().ledger?.page))
					.toBe(2)
				await close(page)
			} finally {
				await browser.close()
			}
		})
		it('filters with shared account checkboxes, retains full balances and resets selection across workspaces', async () => {
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
							window.financeWorkerReadFixture.seed(workspaceId, accountId, 'Mask A'),
						{ workspaceId, accountId }
					)
				).toEqual({ ok: true })
				await page.getByLabel('Current Workspace', { exact: true }).selectOption(workspaceId)
				await createAccountUI(page, 'Mask B')
				const accountB = await page.evaluate(
					() =>
						window.financeWorkerReadFixture
							.state()
							.accounts.find((account) => account.name === 'Mask B')?.id
				)
				if (!accountB) throw new Error('Missing second native account')
				expect(
					await page.evaluate(
						({ workspaceId, accountId }) =>
							window.financeWorkerReadFixture.seedLedger(workspaceId, accountId),
						{ workspaceId, accountId }
					)
				).toEqual({ ok: true })
				await enterExpenseUI(page, accountB, 'Only selected B')
				await page.evaluate((id) => {
					window.financeWorkerReadFixture.route('/expenses?workspace=' + id + '&page=2#accounts')
					window.financeWorkerReadFixture.followRoutes()
				}, workspaceId)
				await browserExpect
					.poll(() => page.evaluate(() => window.financeWorkerReadFixture.state().ledger?.page))
					.toBe(2)
				await page.getByRole('checkbox', { name: 'Mask A', exact: true }).uncheck()
				await browserExpect.poll(() => new URL(page.url()).searchParams.has('page')).toBe(false)
				await browserExpect(page.getByText('Only selected B', { exact: true })).toBeVisible()
				await browserExpect(page.getByText(/^Ledger record \d+$/)).toHaveCount(0)
				await browserExpect
					.poll(() =>
						page.evaluate(() =>
							window.financeWorkerReadFixture
								.state()
								.accounts.map((account) => [account.name, account.balanceMinor])
						)
					)
					.toEqual([
						['Mask A', -4000n],
						['Mask B', -1234n]
					])
				await browserExpect(
					page.getByRole('checkbox', { name: 'Mask B', exact: true })
				).toBeChecked()
				await page.getByRole('checkbox', { name: 'Mask B', exact: true }).uncheck()
				await browserExpect(
					page.getByText('Turn on an account to see its transactions.', { exact: true })
				).toBeVisible()
				await page.getByRole('checkbox', { name: 'All Accounts', exact: true }).check()
				await browserExpect(page.getByRole('link', { name: /transaction details/i })).toHaveCount(
					25
				)
				await createAccountUI(page, 'Later account')
				await browserExpect(
					page.getByRole('checkbox', { name: 'Later account', exact: true })
				).toBeChecked()
				await page.getByRole('checkbox', { name: 'All Accounts', exact: true }).uncheck()
				const other = crypto.randomUUID(),
					otherAccount = crypto.randomUUID()
				expect(
					await page.evaluate(
						({ other, otherAccount }) =>
							window.financeWorkerReadFixture.seed(other, otherAccount, 'Other workspace'),
						{ other, otherAccount }
					)
				).toEqual({ ok: true })
				await page.getByLabel('Current Workspace', { exact: true }).selectOption(other)
				await browserExpect(
					page.getByRole('cell', { name: 'Other workspace', exact: true })
				).toBeVisible()
				await browserExpect(
					page.getByRole('checkbox', { name: 'All Accounts', exact: true })
				).toBeChecked()
				await browserExpect
					.poll(() =>
						page.evaluate(() => window.financeWorkerReadFixture.state().selectedAccountIds)
					)
					.toBeNull()
				await close(page)
			} finally {
				await browser.close()
			}
		})
		it('opens routed details and returns to the filtered list through native history without losing the requested page', async () => {
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
							window.financeWorkerReadFixture.seed(workspaceId, accountId, 'Detail wallet'),
						{ workspaceId, accountId }
					)
				).toEqual({ ok: true })
				expect(
					await page.evaluate(
						({ workspaceId, accountId }) =>
							window.financeWorkerReadFixture.seedLedger(workspaceId, accountId),
						{ workspaceId, accountId }
					)
				).toEqual({ ok: true })
				await page.evaluate((id) => {
					window.financeWorkerReadFixture.route('/expenses?workspace=' + id + '&q=ledger&page=99')
					window.financeWorkerReadFixture.followRoutes()
				}, workspaceId)
				await browserExpect(page.getByRole('link', { name: /transaction details/i })).toHaveCount(
					15
				)
				await browserExpect
					.poll(() => page.evaluate(() => window.financeWorkerReadFixture.state().ledger))
					.toMatchObject({ page: 2, requestedPage: 99, filters: { query: 'ledger' } })
				const link = page.getByRole('link', { name: /transaction details/i }).first(),
					href = await link.getAttribute('href')
				if (!href) throw new Error('Missing native detail link')
				const destination = new URL(href, page.url())
				expect(destination.searchParams.get('workspace')).toBe(workspaceId)
				expect(destination.searchParams.get('q')).toBe('ledger')
				expect(destination.searchParams.get('page')).toBe('99')
				await link.click()
				await browserExpect.poll(() => page.url()).toBe(destination.href)
				await browserExpect(page.getByLabel('Amount', { exact: true })).toHaveValue('1.00')
				await browserExpect(
					page.getByRole('button', { name: 'Back to List', exact: true })
				).toBeVisible()
				await page.goBack()
				await browserExpect.poll(() => new URL(page.url()).pathname).toBe('/expenses')
				await browserExpect
					.poll(() => page.evaluate(() => window.financeWorkerReadFixture.state().transactionId))
					.toBeNull()
				await browserExpect(page.getByRole('link', { name: /transaction details/i })).toHaveCount(
					15
				)
				await page.goForward()
				await browserExpect.poll(() => page.url()).toBe(destination.href)
				await browserExpect(page.getByLabel('Amount', { exact: true })).toHaveValue('1.00')
				await page.getByRole('button', { name: 'Back to List', exact: true }).click()
				await browserExpect.poll(() => new URL(page.url()).pathname).toBe('/expenses')
				await browserExpect
					.poll(() => page.evaluate(() => window.financeWorkerReadFixture.state().transactionId))
					.toBeNull()
				expect(new URL(page.url()).searchParams.get('q')).toBe('ledger')
				expect(new URL(page.url()).searchParams.get('page')).toBe('99')
				await browserExpect(page.getByRole('link', { name: /transaction details/i })).toHaveCount(
					15
				)
				await close(page)
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
				expect(
					await page.evaluate(() => window.financeWorkerReadFixture.state().identityRestore)
				).toMatchObject({ canSubmit: false, canRetryNavigation: false, busy: false })
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
				await enterExpenseUI(page, accountId, 'Retained expense')
				await page.getByRole('link', { name: /transaction details.*Retained expense/i }).click()
				await browserExpect(page.getByLabel('Amount', { exact: true })).toHaveValue('12.34')
				await page.getByLabel('Amount', { exact: true }).fill('45.67')
				await page.getByRole('button', { name: /save transaction/i }).click()
				await browserExpect
					.poll(
						async () =>
							(
								await page.evaluate(
									(id) => window.financeWorkerReadFixture.transactions(id),
									workspaceId
								)
							).transactions?.[0]?.amountMinor
					)
					.toBe(4567)
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
				expect(
					await page.evaluate((id) => window.financeWorkerReadFixture.transactions(id), workspaceId)
				).toMatchObject({
					ok: true,
					transactions: [
						{ amountMinor: 4567, currency: 'USD', kind: 'expense', description: 'Retained expense' }
					]
				})
				await close(page)
			} finally {
				await context.close()
			}
		})
	})
}
