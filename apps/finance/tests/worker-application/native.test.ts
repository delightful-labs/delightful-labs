import type { Socket } from 'node:net'
import {
	createAtprotoAuthServer,
	createJazzAuthHandlers
} from 'delightful-local-first/backend/jazz/auth'
import {
	createAuthRequestHandler,
	createCompletionProtocol
} from 'delightful-local-first/auth/atproto/server'
import { makeSignature } from 'better-auth/crypto'
import { z } from 'zod'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createJazz, memory, acceptDeviceAccounts } from 'jazz-tools/backend'
import { app } from '../../src/lib/queries.js'
import permissions from '../../src/lib/jazz.permissions.json' with { type: 'json' }
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
const fixtureSockets = new Set<Socket>()
let fixtureJazz: ReturnType<typeof createJazz> | undefined
let fixtureAuth: ((request: Request) => Promise<Response>) | undefined
async function relayAuth(
	request: IncomingMessage,
	response: ServerResponse,
	handler: (request: Request) => Promise<Response>
) {
	try {
		const chunks: Uint8Array[] = []
		for await (const chunk of request) {
			if (!Buffer.isBuffer(chunk)) throw new Error('Unexpected fixture request body')
			chunks.push(chunk)
		}
		const headers = new Headers()
		for (const [key, value] of Object.entries(request.headers)) {
			if (Array.isArray(value)) for (const part of value) headers.append(key, part)
			else if (value !== undefined) headers.set(key, value)
		}
		const reply = await handler(
			new Request(new URL(request.url ?? '/', origin), {
				method: request.method ?? 'GET',
				headers,
				...(chunks.length ? { body: Buffer.concat(chunks).toString('utf8') } : {})
			})
		)
		response.writeHead(reply.status, {
			...Object.fromEntries(reply.headers),
			'set-cookie': reply.headers.getSetCookie()
		})
		response.end(Buffer.from(await reply.arrayBuffer()))
	} catch {
		response.writeHead(500)
		response.end('Fixture auth request failed')
	}
}

beforeAll(async () => {
	await mkdir('.svelte-kit', { recursive: true })
	directory = await mkdtemp(resolve('.svelte-kit/finance-worker-read-'))
	const output = join(directory, 'build')
	await build({
		...workerRuntimeBuildConfig(),
		configFile: false,
		resolve: {
			...workerRuntimeBuildConfig().resolve,
			alias: [
				{
					find: '$app/state',
					replacement: resolve('tests/worker-application/route-state.svelte.ts')
				},
				...workerRuntimeBuildConfig().resolve.alias
			]
		},
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
								/\/(?:domain\/(?:account-balances|transaction-groups|classification-counts)|filters\/transaction-list-filters)\.[jt]s$/.test(
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
	// Compile the real Finance service worker with this standalone host's asset manifest.
	await build({
		configFile: false,
		logLevel: 'silent',
		plugins: [
			{
				name: 'finance-auth-shell-manifest',
				resolveId(id) {
					if (['$app/service-worker', '$app/env', '$app/manifest'].includes(id)) return '\0' + id
				},
				load(id) {
					if (id === '\0$app/service-worker') return 'export const self = globalThis'
					if (id === '\0$app/env') return 'export const version = "finance-auth-fixture"'
					if (id === '\0$app/manifest')
						return (
							'export const assets = []; export const immutable = ' +
							JSON.stringify([...assets.keys(), '/'].map((path) => ({ path }))) +
							'; export const prerendered = []'
						)
				},
				generateBundle(_options, bundle) {
					for (const output of Object.values(bundle))
						if (output.type === 'chunk')
							assets.set('/auth-fixture-worker.js', {
								bytes: Buffer.from(output.code),
								type: 'application/javascript'
							})
				}
			}
		],
		build: {
			write: false,
			minify: false,
			lib: { entry: resolve('src/service-worker/index.ts'), formats: ['es'] }
		}
	})
	const brokers = [...assets.keys()].filter((p) => /jazz-broker-worker.*\.js$/.test(p))
	if (brokers.length !== 1) throw new Error('Expected one broker asset: ' + brokers.join(', '))
	server = createServer((request, response) => {
		const path = new URL(request.url ?? '/', origin || 'http://test.invalid').pathname
		if (fixtureJazz && path.startsWith(fixtureJazz.basePath)) {
			fixtureJazz.nodeHandler(request, response)
			return
		}
		if (fixtureAuth && (path.startsWith('/api/auth/') || path === '/test-oauth-return')) {
			void relayAuth(request, response, fixtureAuth)
			return
		}
		const asset = assets.get(path === '/' ? '/tests/worker-application/index.html' : path)
		response.writeHead(asset ? 200 : 404, {
			'Content-Type': asset?.type ?? 'text/plain',
			'Cache-Control': 'no-store'
		})
		response.end(asset?.bytes ?? 'No app/auth/Jazz endpoint is available')
	})
	server.on('upgrade', (request, socket) => {
		// The native backend handles its own path. Other fixture paths have no sync server.
		if (
			!fixtureJazz ||
			!new URL(request.url ?? '/', origin).pathname.startsWith(fixtureJazz.basePath)
		)
			socket.destroy()
	})
	server.on('connection', (socket) => {
		fixtureSockets.add(socket)
		socket.once('close', () => fixtureSockets.delete(socket))
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
		for (const socket of fixtureSockets) socket.destroy()
		fixtureSockets.clear()
		listener.closeAllConnections()
		await new Promise<void>((resolve, reject) => listener.close((e) => (e ? reject(e) : resolve())))
	}
	if (directory && !retained) await rm(directory, { recursive: true, force: true })
	else if (directory) console.error('Finance Worker read artifacts:', directory)
})
async function openDrawerSection(page: Page, name: string) {
	const toggle = page.getByRole('button', { name: 'Toggle Main navigation', exact: true })
	if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click()
	const section = page
		.locator('aside details')
		.filter({ has: page.locator('summary', { hasText: name }) })
	if ((await section.getAttribute('open')) === null) await section.locator('summary').click()
	return section
}
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
	await openDrawerSection(page, 'Settings')
	await openDrawerSection(page, 'Accounts')
}
async function close(page: Page) {
	await page.evaluate(() => window.financeWorkerReadFixture.close())
	await browserExpect
		.poll(() => page.evaluate(() => window.financeWorkerReadFixture.state().status))
		.toBe('closed')
}
async function route(page: Page, path: string) {
	await page.evaluate((path) => window.financeWorkerReadFixture.route(path + location.search), path)
}
async function selectWorkspaceUI(page: Page, id: string) {
	const select = page.getByLabel('Current Workspace', { exact: true })
	await browserExpect(select.locator('option[value="' + id + '"]')).toHaveCount(1)
	if ((await select.inputValue()) !== id) await select.selectOption(id)
}
async function archiveAccountUI(page: Page, name: string) {
	await route(page, '/accounts')
	await page.getByRole('button', { name: 'Manage ' + name, exact: true }).click()
	await page
		.getByRole('dialog', { name, exact: true })
		.getByRole('button', { name: 'Archive', exact: true })
		.click()
}
async function createAccountUI(page: Page, name: string) {
	await route(page, '/accounts')
	await openDrawerSection(page, 'Accounts')
	await page
		.locator('aside')
		.getByRole('button', { name: /add account/i, exact: true })
		.click()
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
	await route(page, '/expenses/new')
	await page.getByLabel('Account', { exact: true }).selectOption(accountId)
	await page.getByLabel('Category', { exact: true }).selectOption({ label: 'Worker expense' })
	await page.getByLabel('Amount', { exact: true }).fill('12.34')
	await page.getByLabel('Date', { exact: true }).fill('2026-11-18')
	await page.getByLabel('Description', { exact: true }).fill(description)
	await page.getByRole('button', { name: /save transaction/i }).click()
	await browserExpect.poll(() => new URL(page.url()).pathname).toMatch(/^\/(income|expenses)$/)
}
for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
	describe(name, () => {
		it('switches to an existing provider account, signs out, recovers local work and reopens offline', async () => {
			onTestFailed(() => {
				retained = true
			})
			const secret = 'synthetic-finance-provider-secret-at-least-thirty-two'
			let auth: ReturnType<typeof createAtprotoAuthServer>
			const authority = createJazz({
				app,
				permissions,
				store: memory(),
				basePath: '/provider-' + name + '-jazz',
				allowedOrigins: [origin],
				...createJazzAuthHandlers(() => auth)
			})
			auth = createAtprotoAuthServer(
				{ db: () => authority.db, schema: app },
				{ origin, secret },
				{ clientName: 'Delightful Finance', cookiePrefix: 'finance.auth' }
			)
			if (!server) throw new Error('Missing fixture server')
			fixtureJazz = authority
			await authority.attach(server)
			await authority.ready()
			const serverUrl = origin + authority.basePath,
				scope = serverUrl
			const native = await auth.$context
			const user = await native.internalAdapter.createUser(
				{ name: 'Synthetic provider user', email: 'provider@example.invalid', emailVerified: true },
				{
					method: 'oauth',
					oauth: { providerId: 'atproto', profile: { did: 'did:plc:syntheticfinance' } }
				}
			)
			const cookie = async () => {
				const session = await native.internalAdapter.createSession(user.id)
				return encodeURIComponent(
					session.token + '.' + (await makeSignature(session.token, secret))
				)
			}
			const completion = createCompletionProtocol({
				cookieName: 'finance.oauth-completion',
				callbackRoute: '/'
			})
			const handler = createAuthRequestHandler({
				cookieName: 'finance.oauth-completion',
				callbackRoute: '/'
			})
			let callbackURL = '/',
				authorizations = 0
			fixtureAuth = async (request) => {
				const url = new URL(request.url)
				if (url.pathname === '/api/auth/sign-in/atproto') {
					const body = z
						.object({ scope: z.literal('atproto'), callbackURL: z.string() })
						.parse(await request.json())
					callbackURL = body.callbackURL
					authorizations += 1
					return Response.json({ url: 'https://provider.invalid/authorize' })
				}
				if (url.pathname === '/test-oauth-return') {
					const attempt = z
						.uuid()
						.parse(new URL(callbackURL, origin).searchParams.get('atproto_attempt'))
					const headers = new Headers({ location: callbackURL })
					headers.append(
						'Set-Cookie',
						native.authCookies.sessionToken.name +
							'=' +
							(await cookie()) +
							'; HttpOnly; SameSite=Lax; Path=/; Max-Age=3600'
					)
					headers.append('Set-Cookie', completion.completionCookie(attempt, user.id, secret, false))
					return new Response(null, { status: 302, headers })
				}
				return handler(auth, request, { origin, secret })
			}
			const knownProfile = await mkdtemp(join(directory, 'provider-known-'))
			const localProfile = await mkdtemp(join(directory, 'provider-local-'))
			let context = await engine.launchPersistentContext(knownProfile, { headless: true })
			const attach = async (page: Page) => {
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
					.poll(() => page.evaluate(() => window.financeWorkerReadFixture.state().auth?.canSignOut))
					.toBe(true)
				await browserExpect
					.poll(() => new URL(page.url()).searchParams.has('atproto_attempt'))
					.toBe(false)
				await browserExpect
					.poll(() => page.evaluate(() => window.financeWorkerReadFixture.state().workspaceStartup))
					.toBe('ready')
				await openDrawerSection(page, 'Settings')
				await openDrawerSection(page, 'Accounts')
			}
			try {
				await context.addCookies([
					{
						name: native.authCookies.sessionToken.name,
						value: await cookie(),
						url: origin,
						httpOnly: true,
						sameSite: 'Lax'
					}
				])
				let page = await context.newPage()
				await open(page, scope, serverUrl)
				await browserExpect
					.poll(() => page.evaluate(() => window.financeWorkerReadFixture.state().auth?.canSignOut))
					.toBe(true)
				await browserExpect
					.poll(() => page.evaluate(() => window.financeWorkerReadFixture.state().workspaceStartup))
					.toBe('ready')
				const returningIdentity = await page.evaluate(
					() => window.financeWorkerReadFixture.state().identityId
				)
				const providerWorkspace = await page.evaluate(
					() => window.financeWorkerReadFixture.state().workspaces?.[0]
				)
				if (!providerWorkspace) throw new Error('Missing provider workspace')
				await selectWorkspaceUI(page, providerWorkspace.id)
				await createAccountUI(page, 'Provider-only wallet')
				await close(page)
				await context.close()
				context = await engine.launchPersistentContext(localProfile, { headless: true })
				await context.route('https://provider.invalid/authorize', (route) =>
					route.fulfill({
						status: 200,
						contentType: 'text/html',
						body:
							'<script>location.replace(' +
							JSON.stringify(origin + '/test-oauth-return') +
							')</script>'
					})
				)
				page = await context.newPage()
				await open(page, scope, serverUrl)
				await browserExpect
					.poll(() => page.evaluate(() => window.financeWorkerReadFixture.state().workspaceStartup))
					.toBe('ready')
				const original = await page.evaluate(() => window.financeWorkerReadFixture.state())
				const workspace = original.workspaces?.[0]
				if (!workspace) throw new Error('Missing local workspace')
				expect(original.identityId).not.toBe(returningIdentity)
				await selectWorkspaceUI(page, workspace.id)
				await createAccountUI(page, 'Before provider login')
				await route(page, '/account')
				await page.getByRole('button', { name: /show recovery phrase/i }).click()
				const recovery = page.getByRole('dialog')
				const phrase = await recovery
					.getByRole('textbox', { name: /recovery phrase/i })
					.inputValue()
				await recovery.getByRole('button', { name: 'Close', exact: true }).click()
				await route(page, '/login')
				await page
					.getByRole('textbox', { name: 'AT Protocol handle', exact: true })
					.fill('person.example')
				await page.getByRole('button', { name: 'Sign in with AT Protocol', exact: true }).click()
				await page
					.getByRole('dialog', { name: 'Sign in with AT Protocol', exact: true })
					.getByRole('button', { name: 'Continue to sign in', exact: true })
					.click()
				await page.waitForURL(
					(url) => url.origin === origin && url.searchParams.has('atproto_attempt')
				)
				await attach(page)
				expect(await page.evaluate(() => window.financeWorkerReadFixture.state().identityId)).toBe(
					returningIdentity
				)
				await browserExpect(
					page.getByRole('cell', { name: 'Before provider login', exact: true })
				).toHaveCount(0)
				await selectWorkspaceUI(page, providerWorkspace.id)
				await browserExpect(
					page.getByRole('cell', { name: 'Provider-only wallet', exact: true })
				).toBeVisible()
				await page.evaluate(async () => {
					await navigator.serviceWorker.register('/auth-fixture-worker.js')
					await navigator.serviceWorker.ready
				})
				await context.setOffline(true)
				await context.clearCookies({ name: native.authCookies.sessionToken.name })
				await close(page)
				await context.close()
				context = await engine.launchPersistentContext(localProfile, { headless: true })
				await context.setOffline(true)
				page = await context.newPage()
				await open(page, scope, serverUrl)
				expect(await page.evaluate(() => window.financeWorkerReadFixture.state().identityId)).toBe(
					returningIdentity
				)
				await selectWorkspaceUI(page, providerWorkspace.id)
				await browserExpect(
					page.getByRole('cell', { name: 'Provider-only wallet', exact: true })
				).toBeVisible()
				expect(
					(await context.cookies()).filter(
						(cookie) => cookie.name === native.authCookies.sessionToken.name
					)
				).toHaveLength(0)
				await context.addCookies([
					{
						name: native.authCookies.sessionToken.name,
						value: await cookie(),
						url: origin,
						httpOnly: true,
						sameSite: 'Lax'
					}
				])
				await context.setOffline(false)
				await context.route('https://provider.invalid/authorize', (route) =>
					route.fulfill({
						status: 200,
						contentType: 'text/html',
						body:
							'<script>location.replace(' +
							JSON.stringify(origin + '/test-oauth-return') +
							')</script>'
					})
				)
				await route(page, '/account')
				await page.getByRole('button', { name: 'Sign out', exact: true }).click()
				await browserExpect
					.poll(() => page.evaluate(() => window.financeWorkerReadFixture.state().status))
					.toBe('signed-out')
				await route(page, '/login')
				await page
					.getByRole('textbox', { name: 'AT Protocol handle', exact: true })
					.fill('person.example')
				await page.getByRole('button', { name: 'Sign in with AT Protocol', exact: true }).click()
				await page.waitForURL(
					(url) => url.origin === origin && url.searchParams.has('atproto_attempt')
				)
				await attach(page)
				expect(authorizations).toBe(2)
				await route(page, '/login')
				await page.getByRole('textbox', { name: 'Recovery phrase', exact: true }).fill(phrase)
				await page.getByRole('button', { name: 'Login', exact: true }).click()
				await browserExpect
					.poll(() => page.evaluate(() => window.financeWorkerReadFixture.state().identityId))
					.toBe(original.identityId)
				expect(
					(await context.cookies()).filter(
						(cookie) => cookie.name === native.authCookies.sessionToken.name
					)
				).toHaveLength(0)
				await selectWorkspaceUI(page, workspace.id)
				await route(page, '/accounts')
				await browserExpect(
					page.getByRole('cell', { name: 'Before provider login', exact: true })
				).toBeVisible()
				await page.evaluate(async () => {
					await navigator.serviceWorker.register('/auth-fixture-worker.js')
					await navigator.serviceWorker.ready
				})
				await close(page)
				await context.close()
				for (let restart = 0; restart < 2; restart++) {
					context = await engine.launchPersistentContext(localProfile, { headless: true })
					await context.setOffline(true)
					page = await context.newPage()
					await open(page, scope, serverUrl)
					expect(
						await page.evaluate(() => window.financeWorkerReadFixture.state().identityId)
					).toBe(original.identityId)
					await selectWorkspaceUI(page, workspace.id)
					await browserExpect(
						page.getByRole('cell', { name: 'Before provider login', exact: true })
					).toBeVisible()
					if (restart === 0) await createAccountUI(page, 'Created offline after login')
					else
						await browserExpect(
							page.getByRole('cell', { name: 'Created offline after login', exact: true })
						).toBeVisible()
					await close(page)
					await context.close()
				}
				context = await engine.launchPersistentContext(localProfile, { headless: true })
				page = await context.newPage()
				await open(page, scope, serverUrl)
				await browserExpect
					.poll(async () =>
						(await authority.db.all(app.accounts.where({ organizationId: workspace.id }))).map(
							(account) => account.name
						)
					)
					.toContain('Created offline after login')
				await close(page)
			} finally {
				fixtureAuth = undefined
				fixtureJazz = undefined
				await context.close()
				await authority.close()
			}
		}, 120_000)

		it('confirms provider login accessibly and preserves local finance when authorization fails', async () => {
			const browser = await engine.launch({ headless: true })
			const context = await browser.newContext()
			let requests = 0
			await context.route('**/api/auth/sign-in/atproto', async (request) => {
				requests += 1
				expect(request.request().postDataJSON()).toMatchObject({
					scope: 'atproto',
					handle: 'person.example'
				})
				await request.fulfill({ status: 503, contentType: 'application/json', body: '{}' })
			})
			try {
				const page = await context.newPage()
				await open(page, crypto.randomUUID())
				const identity = await page.evaluate(
					() => window.financeWorkerReadFixture.state().identityId
				)
				await route(page, '/login')
				const handle = page.getByRole('textbox', { name: 'AT Protocol handle', exact: true })
				const begin = page.getByRole('button', { name: 'Sign in with AT Protocol', exact: true })
				await handle.fill('person.example')
				// Establish keyboard focus explicitly: WebKit pointer clicks do not focus buttons.
				await begin.focus()
				await begin.press('Enter')
				const dialog = page.getByRole('dialog', { name: 'Sign in with AT Protocol', exact: true })
				await browserExpect(dialog).toBeVisible()
				await browserExpect(
					dialog.getByRole('button', { name: 'Continue to sign in', exact: true })
				).toBeFocused()
				expect(requests).toBe(0)
				if (name === 'chromium')
					await page.screenshot({
						path: '.svelte-kit/finance-atproto-confirmation.png',
						fullPage: true
					})
				await page.keyboard.press('Escape')
				await browserExpect(dialog).not.toBeVisible()
				await browserExpect(begin).toBeEnabled()
				await browserExpect(begin).toBeFocused()
				expect(requests).toBe(0)
				await begin.click()
				await dialog.getByRole('button', { name: 'Continue to sign in', exact: true }).click()
				await browserExpect(
					page
						.getByRole('alert')
						.filter({ hasText: 'Sign-in could not be completed. Please try again.' })
				).toBeVisible()
				expect(requests).toBe(1)
				expect(await page.evaluate(() => window.financeWorkerReadFixture.state().identityId)).toBe(
					identity
				)
				await route(page, '/account')
				await browserExpect(
					page.getByRole('button', { name: 'Sign out', exact: true })
				).toHaveCount(0)
				await close(page)
			} finally {
				await context.close()
				await browser.close()
			}
		})

		it('creates and archives classifications through the shared UI and retains complete history offline', async () => {
			onTestFailed(() => {
				retained = true
			})
			const profile = await mkdtemp(join(directory, 'classification-profile-')),
				scope = crypto.randomUUID(),
				workspaceId = crypto.randomUUID(),
				accountId = crypto.randomUUID()
			let context = await engine.launchPersistentContext(profile, { headless: true })
			try {
				let page = await context.newPage()
				await open(page, scope)
				expect(
					await page.evaluate(
						({ workspaceId, accountId }) =>
							window.financeWorkerReadFixture.seed(workspaceId, accountId, 'Classification wallet'),
						{ workspaceId, accountId }
					)
				).toEqual({ ok: true })
				await page.evaluate((id) => {
					window.financeWorkerReadFixture.route('/settings/categories?workspace=' + id)
				}, workspaceId)
				await page.getByRole('button', { name: 'Add Category', exact: true }).click()
				let dialog = page.getByRole('dialog', { name: 'Add Category', exact: true })
				await dialog.getByLabel('Category name', { exact: true }).fill('Native travel')
				await dialog.getByLabel('Transaction type', { exact: true }).selectOption('expense')
				await dialog.getByRole('button', { name: 'Add Category', exact: true }).click()
				await browserExpect(dialog.getByText(/Native travel.*saved/i)).toBeVisible()
				await dialog.getByRole('button', { name: 'Close', exact: true }).click()
				const categoryId = await page.evaluate(
					() =>
						window.financeWorkerReadFixture
							.state()
							.classification?.categories.find((c) => c.name === 'Native travel')?.id
				)
				if (!categoryId) throw new Error('Missing native category')
				await browserExpect(
					page.getByRole('button', { name: 'Archive Worker expense', exact: true })
				).toHaveCount(0)
				const aside = page.locator('aside')
				await aside.getByRole('link', { name: 'Expenses', exact: true }).click()
				await route(page, '/expenses/new')
				// This standalone host has no SvelteKit route boundary. Wait for the
				// worker's new route view before editing its replacement form.
				await browserExpect
					.poll(() =>
						page.evaluate(
							() => window.financeWorkerReadFixture.state().workspaceNavigation?.showContent
						)
					)
					.toBe(true)
				await page.getByLabel('Category', { exact: true }).selectOption(categoryId)
				await page.getByLabel('Amount', { exact: true }).fill('10.00')
				await page.getByLabel('Date', { exact: true }).fill('2026-11-18')
				await page.getByLabel('Description', { exact: true }).fill('Classification history')
				await browserExpect(page.getByLabel('Category', { exact: true })).toHaveValue(categoryId)
				await page.getByRole('button', { name: /save transaction/i }).click()
				await browserExpect
					.poll(() => new URL(page.url()).pathname)
					.toMatch(/^\/(income|expenses)$/)
				await aside.getByRole('link', { name: 'Tags', exact: true }).click()
				await page.getByRole('button', { name: 'Add Tag', exact: true }).click()
				dialog = page.getByRole('dialog', { name: 'Add Tag', exact: true })
				await dialog.getByLabel('Tag name', { exact: true }).fill('Native trip')
				await dialog.getByLabel('Transaction type', { exact: true }).selectOption('expense')
				await dialog.getByLabel('Category', { exact: true }).selectOption(categoryId)
				await dialog.getByRole('button', { name: 'Add Tag', exact: true }).click()
				await browserExpect(dialog.getByText(/Native trip.*saved/i)).toBeVisible()
				await dialog.getByRole('button', { name: 'Close', exact: true }).click()
				await page.getByRole('button', { name: 'Archive Native trip', exact: true }).click()
				await browserExpect(page.getByRole('row', { name: /Native trip/ })).toHaveCount(0)
				await aside.getByRole('link', { name: 'Categories', exact: true }).click()
				await page.getByRole('checkbox', { name: 'All Accounts', exact: true }).uncheck()
				let row = page.getByRole('row', { name: /Native travel/ })
				await browserExpect(row.getByRole('cell').nth(1)).toHaveText('1')
				await browserExpect(row.getByRole('cell').nth(2)).toHaveText('1')
				await page.getByRole('button', { name: 'Archive Native travel', exact: true }).click()
				await browserExpect(row).toHaveCount(0)
				await page.getByRole('radio', { name: 'All', exact: true }).check()
				await browserExpect(row.getByRole('cell').nth(1)).toHaveText('1')
				await browserExpect(row.getByRole('cell').nth(2)).toHaveText('1')
				await close(page)
				await context.close()
				context = await engine.launchPersistentContext(profile, { headless: true })
				page = await context.newPage()
				await open(page, scope)
				await page.evaluate((id) => {
					window.financeWorkerReadFixture.route('/settings/tags?workspace=' + id)
				}, workspaceId)
				await page.getByRole('radio', { name: 'All', exact: true }).check()
				await browserExpect(
					page
						.getByRole('row', { name: /Native trip/ })
						.getByRole('cell', { name: 'Native travel', exact: true })
				).toBeVisible()
				await page.getByRole('button', { name: 'Add Tag', exact: true }).click()
				dialog = page.getByRole('dialog', { name: 'Add Tag', exact: true })
				await browserExpect(
					dialog
						.getByLabel('Category', { exact: true })
						.locator('option')
						.filter({ hasText: 'Native travel' })
				).toHaveCount(0)
				await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
				await close(page)
			} finally {
				await context.close()
			}
		})
		it('binds the shared drawer to worker navigation, scoped links and retained native history', async () => {
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
							window.financeWorkerReadFixture.seed(workspaceId, accountId, 'Shell wallet'),
						{ workspaceId, accountId }
					)
				).toEqual({ ok: true })
				await page.evaluate((id) => {
					window.financeWorkerReadFixture.route('/expenses?workspace=' + id)
				}, workspaceId)
				const aside = page.locator('aside'),
					income = aside.getByRole('link', { name: 'Income', exact: true }),
					expenses = aside.getByRole('link', { name: 'Expenses', exact: true })
				await browserExpect(expenses).toHaveAttribute('aria-current', 'page')
				await browserExpect(income).toHaveAttribute('href', '/income?workspace=' + workspaceId)
				await income.click()
				await browserExpect
					.poll(() => page.evaluate(() => window.financeWorkerReadFixture.state().transactionKind))
					.toBe('income')
				await browserExpect(income).toHaveAttribute('aria-current', 'page')
				await browserExpect(expenses).not.toHaveAttribute('aria-current', 'page')
				await browserExpect(
					aside.getByRole('link', { name: 'Manage Accounts', exact: true })
				).toHaveAttribute('href', '/accounts?workspace=' + workspaceId)
				await page.goBack()
				await browserExpect
					.poll(() => page.evaluate(() => window.financeWorkerReadFixture.state().transactionKind))
					.toBe('expense')
				await browserExpect(expenses).toHaveAttribute('aria-current', 'page')
				await page.goForward()
				await browserExpect(income).toHaveAttribute('aria-current', 'page')
				await browserExpect
					.poll(() => page.evaluate(() => window.financeWorkerReadFixture.state().transactionKind))
					.toBe('income')
				const identity = await page.evaluate(
					() => window.financeWorkerReadFixture.state().identityId
				)
				await page.evaluate(() => window.financeWorkerReadFixture.detach())
				await page.evaluate(() => window.financeWorkerReadFixture.attach())
				await openDrawerSection(page, 'Settings')
				await browserExpect(page.getByLabel('Current Workspace', { exact: true })).toHaveValue(
					workspaceId
				)
				await browserExpect(
					aside.getByRole('link', { name: 'Income', exact: true })
				).toHaveAttribute('aria-current', 'page')
				expect(await page.evaluate(() => window.financeWorkerReadFixture.state().identityId)).toBe(
					identity
				)
				await close(page)
			} finally {
				await browser.close()
			}
		})
		it('retains the worker draft through mobile drawer dismissal, focus return and resizing', async () => {
			onTestFailed(() => {
				retained = true
			})
			const browser = await engine.launch({ headless: true }),
				page = await browser.newPage({ viewport: { width: 390, height: 900 } })
			try {
				await page.emulateMedia({ reducedMotion: 'reduce' })
				await open(page, crypto.randomUUID())
				const workspaceId = crypto.randomUUID(),
					accountId = crypto.randomUUID()
				expect(
					await page.evaluate(
						({ workspaceId, accountId }) =>
							window.financeWorkerReadFixture.seed(workspaceId, accountId, 'Mobile wallet'),
						{ workspaceId, accountId }
					)
				).toEqual({ ok: true })
				await selectWorkspaceUI(page, workspaceId)
				const toggle = page.getByRole('button', { name: 'Toggle Main navigation', exact: true }),
					dismiss = page.getByRole('button', { name: 'Close Main navigation', exact: true })
				await browserExpect(toggle).toHaveAttribute('aria-expanded', 'true')
				await dismiss.click()
				await browserExpect(toggle).toBeFocused()
				await browserExpect(toggle).toHaveAttribute('aria-expanded', 'false')
				await route(page, '/expenses/new')
				const description = page.getByLabel('Description', { exact: true })
				await description.fill('Keep mobile draft')
				await toggle.click()
				await browserExpect(dismiss).toBeVisible()
				expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
					390
				)
				await dismiss.click()
				await browserExpect(toggle).toBeFocused()
				await browserExpect(description).toHaveValue('Keep mobile draft')
				await toggle.click()
				await page.setViewportSize({ width: 1280, height: 900 })
				await browserExpect(dismiss).toBeHidden()
				await browserExpect(description).toHaveValue('Keep mobile draft')
				await browserExpect(
					page.getByRole('checkbox', { name: 'Mobile wallet', exact: true })
				).toBeChecked()
				await close(page)
			} finally {
				await browser.close()
			}
		})
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
				await archiveAccountUI(page, 'Edited B')
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
				await page.evaluate(
					(id) =>
						window.financeWorkerReadFixture.route(
							'/accounts?query=rent&page=2&workspace=' + id + '#row'
						),
					a
				)
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
				await browserExpect(
					page.getByRole('checkbox', { name: 'Route A', exact: true })
				).toBeVisible()
				await browserExpect(page.getByLabel('Amount', { exact: true })).toHaveValue('12.34')
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
				await selectWorkspaceUI(page, workspaceId)
				await browserExpect(page.getByRole('cell', { name: 'Seed', exact: true })).toBeVisible()
				await page
					.locator('aside')
					.getByRole('button', { name: /add account/i, exact: true })
					.click()
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
				await route(page, '/account')
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
				await selectWorkspaceUI(page, workspaceId)
				await browserExpect(
					page.getByRole('cell', { name: 'Before restore', exact: true })
				).toBeVisible()
				const identity = await page.evaluate(
					() => window.financeWorkerReadFixture.state().identityId
				)
				await route(page, '/account')
				await page.getByRole('button', { name: /show recovery phrase/i }).click()
				const phrase = await page
					.getByRole('dialog')
					.getByRole('textbox', { name: /recovery phrase/i })
					.inputValue()
				await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
				expect(await page.evaluate(() => window.financeWorkerReadFixture.holdArchive())).toEqual({
					ok: true
				})
				await archiveAccountUI(page, 'Before restore')
				await route(page, '/login')
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
				await route(page, '/login')
				await browserExpect(page.getByRole('textbox', { name: /recovery phrase/i })).toHaveValue('')
				await browserExpect(page.getByRole('textbox', { name: /recovery phrase/i })).toBeDisabled()
				expect(await page.evaluate(() => window.financeWorkerReadFixture.releaseArchive())).toEqual(
					{ ok: true }
				)
				await browserExpect
					.poll(() => page.evaluate(() => window.financeWorkerReadFixture.state().identityRestore))
					.toMatchObject({ busy: false, feedback: 'sessionFailed' })
				expect(await page.evaluate(() => window.financeWorkerReadFixture.state().identityId)).toBe(
					identity
				)
				await openDrawerSection(page, 'Settings')
				await selectWorkspaceUI(page, workspaceId)
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
				authenticate: acceptDeviceAccounts,
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
				await selectWorkspaceUI(page, workspace.id)
				await createAccountUI(page, 'Recovered wallet')
				await route(page, '/expenses/new')
				await page
					.getByLabel('Account', { exact: true })
					.selectOption({ label: 'Recovered wallet · USD' })
				await page.getByLabel('Category', { exact: true }).selectOption({ index: 1 })
				await page.getByLabel('Amount', { exact: true }).fill('12.34')
				await page.getByLabel('Date', { exact: true }).fill('2026-11-18')
				await page.getByLabel('Description', { exact: true }).fill('Existing recovered expense')
				await page.getByRole('button', { name: /save transaction/i }).click()
				await browserExpect
					.poll(() => new URL(page.url()).pathname)
					.toMatch(/^\/(income|expenses)$/)
				await browserExpect
					.poll(async () => {
						const result = await page.evaluate(
							(id) => window.financeWorkerReadFixture.transactions(id, true),
							workspace.id
						)
						return result.transactions?.map((row) => row.description)
					})
					.toEqual(['Existing recovered expense'])
				await route(page, '/account')
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
				await route(page, '/login')
				const input = page.getByRole('textbox', { name: /recovery phrase/i })
				await input.fill('not a recovery phrase')
				await page.getByRole('button', { name: 'Login', exact: true }).click()
				await browserExpect(
					page.getByRole('alert').filter({ hasText: /check the recovery phrase/i })
				).toBeVisible()
				expect(await page.evaluate(() => window.financeWorkerReadFixture.state().identityId)).toBe(
					temporary
				)
				await browserExpect(input).toHaveValue('not a recovery phrase')
				const beforeRestoreNavigation = await page.evaluate(() =>
					window.financeWorkerReadFixture.navigationCalls()
				)
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
					.toMatchObject({ busy: false, feedback: 'none' })
				await browserExpect(input).toHaveValue('')
				await browserExpect(
					page
						.getByRole('alert')
						.filter({ hasText: /account was restored.*destination could not be opened/i })
				).toBeVisible()
				expect(await page.evaluate(() => window.financeWorkerReadFixture.navigationCalls())).toBe(
					beforeRestoreNavigation + 1
				)
				await page.evaluate(() => window.financeWorkerReadFixture.holdNavigation())
				await page.getByRole('button', { name: 'Try again', exact: true }).click()
				await browserExpect
					.poll(() => page.evaluate(() => window.financeWorkerReadFixture.navigationCalls()))
					.toBe(beforeRestoreNavigation + 2)
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
				await selectWorkspaceUI(page, workspace.id)
				await route(page, '/accounts')
				await browserExpect(
					page.getByRole('cell', { name: 'Recovered wallet', exact: true })
				).toBeVisible()
				await route(page, '/expenses')
				await browserExpect(
					page.getByRole('link', { name: /transaction details.*Existing recovered expense/i })
				).toBeVisible()
				const beforeHeldRestoreNavigation = await page.evaluate(() =>
					window.financeWorkerReadFixture.navigationCalls()
				)
				await page.evaluate(() => {
					window.financeWorkerReadFixture.route('/login')
					window.financeWorkerReadFixture.holdNavigation()
				})
				await input.fill(phrase)
				await page.getByRole('button', { name: 'Login', exact: true }).click()
				await browserExpect
					.poll(() => page.evaluate(() => window.financeWorkerReadFixture.navigationCalls()))
					.toBe(beforeHeldRestoreNavigation + 1)
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
				await selectWorkspaceUI(page, workspace.id)
				await route(page, '/expenses')
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
				authenticate: acceptDeviceAccounts,
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
				await selectWorkspaceUI(page, workspace.id)
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
				await selectWorkspaceUI(page, workspace.id)
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
				await page.evaluate(
					(id) => window.financeWorkerReadFixture.route('/accounts?workspace=' + id),
					workspaceId
				)
				const row = page
					.getByRole('row')
					.filter({ has: page.getByRole('cell', { name: 'Pending archive', exact: true }) })
				await browserExpect(row).toBeVisible()
				expect(await page.evaluate(() => window.financeWorkerReadFixture.holdArchive())).toEqual({
					ok: true
				})
				await archiveAccountUI(page, 'Pending archive')
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
				await selectWorkspaceUI(page, workspaceId)
				await browserExpect(page.getByRole('cell', { name: 'Ledger', exact: true })).toBeVisible()
				await route(page, '/expenses/new')
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
				await page.evaluate(() =>
					window.financeWorkerReadFixture.route('/income/new' + location.search)
				)
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
				await browserExpect
					.poll(() => new URL(page.url()).pathname)
					.toMatch(/^\/(income|expenses)$/)
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
				await selectWorkspaceUI(page, workspaceId)
				await createAccountUI(page, 'Check destination')
				await page.evaluate(() =>
					window.financeWorkerReadFixture.route('/income/new' + location.search)
				)
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
				await browserExpect
					.poll(() => new URL(page.url()).pathname)
					.toMatch(/^\/(income|expenses)$/)
				await page.getByRole('link', { name: /transaction details/i }).click()
				await browserExpect(page.locator('[name="checkNumber"]')).toHaveValue('100')
				await page.locator('[name="checkNumber"]').fill('101')
				const destination = await page.evaluate(
					() =>
						window.financeWorkerReadFixture
							.state()
							.accounts.find((account) => account.name === 'Check destination')?.id
				)
				if (!destination) throw new Error('Missing destination account')
				await page.getByLabel('Account', { exact: true }).selectOption(destination)
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
						accountId: destination,
						checkAccountId: destination
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
				await selectWorkspaceUI(page, workspaceId)
				await enterExpenseUI(page, accountId, 'Worker editable expense')
				await page
					.getByRole('link', { name: /transaction details.*Worker editable expense/i })
					.click()
				const amount = page.getByLabel('Amount', { exact: true }),
					save = page.getByRole('button', { name: /save transaction/i })
				await browserExpect(amount).toHaveValue('12.34')
				const originalInput = await amount.elementHandle()
				if (!originalInput) throw new Error('Missing edit input')
				await browserExpect(save).toBeDisabled()
				await amount.fill('25.00')
				await browserExpect(save).toBeEnabled()
				await amount.fill('12.34')
				await browserExpect(save).toBeDisabled()
				await amount.fill('25.00')
				expect(await originalInput.evaluate((element) => element.isConnected)).toBe(true)
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
				await page.evaluate(() =>
					window.financeWorkerReadFixture.route('/expenses' + location.search)
				)
				await page.evaluate(
					(id) => window.financeWorkerReadFixture.route('/expenses/' + id + location.search),
					id
				)
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
				await selectWorkspaceUI(page, workspaceId)
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
				await route(page, '/expenses')
				await browserExpect(page.getByText(/^Ledger record \d+$/)).toHaveCount(25)
				await browserExpect(page.getByText('$40.00', { exact: true })).toBeVisible()
				const originalUrl = new URL(page.url())
				await page.getByRole('link', { name: /next page/i }).click()
				await browserExpect(page.getByText(/^Ledger record \d+$/)).toHaveCount(15)
				await browserExpect(page.getByText('$40.00', { exact: true })).toBeVisible()
				expect(new URL(page.url()).pathname).toBe(originalUrl.pathname)
				expect(new URL(page.url()).searchParams.get('page')).toBe('2')
				await page
					.getByRole('link', { name: /transaction details/i })
					.first()
					.click()
				await browserExpect(page.getByLabel('Amount', { exact: true })).toHaveValue('1.00')
				expect(
					await page.evaluate(() => window.financeWorkerReadFixture.state().ledger?.page)
				).toBe(2)
				await route(page, '/expenses')
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
				await selectWorkspaceUI(page, workspaceId)
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
				await selectWorkspaceUI(page, other)
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
					page.getByRole('heading', { name: /transaction details/i, exact: true })
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
				await route(page, '/expenses')
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
				const beforeWorkspace = crypto.randomUUID(),
					beforeAccount = crypto.randomUUID()
				expect(
					await page.evaluate(
						({ workspaceId, accountId }) =>
							window.financeWorkerReadFixture.seed(workspaceId, accountId, 'Before fault'),
						{ workspaceId: beforeWorkspace, accountId: beforeAccount }
					)
				).toEqual({ ok: true })
				await page.evaluate(
					(id) => window.financeWorkerReadFixture.route('/accounts?workspace=' + id),
					beforeWorkspace
				)
				await browserExpect(
					page.getByRole('cell', { name: 'Before fault', exact: true })
				).toBeVisible()
				const before = await page.evaluate(() => window.financeWorkerReadFixture.state())
				expect(await page.evaluate(() => window.financeWorkerReadFixture.badView())).toEqual({
					ok: true
				})
				await browserExpect
					.poll(() => page.evaluate(() => window.financeWorkerReadFixture.state().status))
					.toBe('failed')
				expect(
					await page.evaluate(() => window.financeWorkerReadFixture.state().identityRestore)
				).toMatchObject({ canSubmit: false, canRetryNavigation: false, busy: false })
				expect(await page.evaluate(() => window.financeWorkerReadFixture.state())).toMatchObject({
					sessionRevision: before.sessionRevision,
					selection: before.selection,
					accounts: [],
					classification: null,
					workspaceNavigation: null,
					ledger: null,
					recoveryAvailable: false
				})
				await browserExpect(
					page.getByRole('cell', { name: 'Before fault', exact: true })
				).toHaveCount(0)
				const workspaceId = crypto.randomUUID(),
					accountId = crypto.randomUUID()
				expect(
					await page.evaluate(
						({ workspaceId, accountId }) =>
							window.financeWorkerReadFixture.seed(workspaceId, accountId, 'After fault'),
						{ workspaceId, accountId }
					)
				).toEqual({ ok: true })
				await page.evaluate(
					(id) => window.financeWorkerReadFixture.route('/accounts?workspace=' + id),
					workspaceId
				)
				expect(await page.evaluate(() => window.financeWorkerReadFixture.state().status)).toBe(
					'failed'
				)
				await expect(
					page.getByRole('cell', { name: 'After fault', exact: true }).count()
				).resolves.toBe(0)
				await close(page)
				expect(await page.evaluate(() => window.financeWorkerReadFixture.state())).toMatchObject({
					identityId: null,
					accounts: [],
					classification: null,
					ledger: null,
					recoveryAvailable: false,
					canRetrySession: false
				})
			} finally {
				await browser.close()
			}
		})
		it('isolates native preference transactions by SDK namespace and workspace key', async () => {
			const browser = await engine.launch({ headless: true }),
				page = await browser.newPage()
			try {
				await open(page, crypto.randomUUID())
				const namespace = crypto.randomUUID(),
					one = crypto.randomUUID(),
					two = crypto.randomUUID()
				expect(
					await page.evaluate(
						({ namespace, one, two }) =>
							window.financeWorkerReadFixture.orderStorage(namespace, 'identity/workspace', [
								two,
								one
							]),
						{ namespace, one, two }
					)
				).toEqual({ ok: true, ids: [two, one] })
				expect(
					await page.evaluate(
						(namespace) =>
							window.financeWorkerReadFixture.orderStorage(namespace, 'identity/other-workspace'),
						namespace
					)
				).toEqual({ ok: true, ids: [] })
				expect(
					await page.evaluate(
						(namespace) =>
							window.financeWorkerReadFixture.orderStorage(
								namespace + '-other-environment',
								'identity/workspace'
							),
						namespace
					)
				).toEqual({ ok: true, ids: [] })
				expect(
					await page.evaluate(
						(namespace) =>
							window.financeWorkerReadFixture.orderStorage(namespace, 'identity/workspace'),
						namespace
					)
				).toEqual({ ok: true, ids: [two, one] })
				await close(page)
			} finally {
				await browser.close()
			}
		})
		it('orders accounts through the worker controls and isolates workspace preferences', async () => {
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
				for (const [workspaceId, accountId, name] of [
					[a, accountA, 'Order A'],
					[b, accountB, 'Other A']
				]) {
					if (!workspaceId || !accountId || !name) throw new Error('Missing ordering fixture')
					expect(
						await page.evaluate(
							({ workspaceId, accountId, name }) =>
								window.financeWorkerReadFixture.seed(workspaceId, accountId, name),
							{ workspaceId, accountId, name }
						)
					).toEqual({ ok: true })
				}
				await selectWorkspaceUI(page, a)
				await createAccountUI(page, 'Order B')
				await browserExpect(
					page.getByRole('button', { name: 'Edit Order', exact: true })
				).toBeEnabled()
				await page.getByRole('button', { name: 'Edit Order', exact: true }).click()
				await browserExpect(
					page.getByRole('button', { name: 'Move Order A up', exact: true })
				).toBeDisabled()
				await browserExpect(
					page.getByRole('button', { name: 'Move Order B down', exact: true })
				).toBeDisabled()
				await page.getByRole('button', { name: 'Move Order B up', exact: true }).click()
				await browserExpect
					.poll(() =>
						page.evaluate(() =>
							window.financeWorkerReadFixture.state().accounts.map((row) => row.name)
						)
					)
					.toEqual(['Order B', 'Order A'])
				const idB = await page.evaluate(
					() => window.financeWorkerReadFixture.state().accounts[0]?.id
				)
				if (!idB) throw new Error('Missing reordered account')
				await browserExpect
					.poll(() =>
						page.evaluate(
							() => window.financeWorkerReadFixture.state().transactionEntry?.defaultAccountId
						)
					)
					.toBe(idB)
				await browserExpect(
					page.getByRole('checkbox', { name: 'Order A', exact: true })
				).toBeChecked()
				await browserExpect(
					page.getByRole('checkbox', { name: 'Order B', exact: true })
				).toBeChecked()
				await page.getByRole('button', { name: 'Done', exact: true }).click()
				await selectWorkspaceUI(page, b)
				await createAccountUI(page, 'Other B')
				await browserExpect
					.poll(() =>
						page.evaluate(() => window.financeWorkerReadFixture.state().accountOrder?.ids)
					)
					.toHaveLength(2)
				await browserExpect
					.poll(() =>
						page.evaluate(() =>
							window.financeWorkerReadFixture.state().accounts.map((row) => row.name)
						)
					)
					.toEqual(['Other A', 'Other B'])
				await selectWorkspaceUI(page, a)
				await browserExpect
					.poll(() =>
						page.evaluate(() =>
							window.financeWorkerReadFixture.state().accounts.map((row) => row.name)
						)
					)
					.toEqual(['Order B', 'Order A'])
				await route(page, '/expenses/new')
				await browserExpect(page.getByLabel('Account', { exact: true })).toHaveValue(idB)
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
				await page.evaluate(
					(id) => window.financeWorkerReadFixture.route('/accounts?workspace=' + id),
					workspaceId
				)
				await browserExpect(
					page.getByRole('cell', { name: 'Retained wallet', exact: true })
				).toBeVisible()
				await createAccountUI(page, 'Offline created wallet')
				await page.getByRole('button', { name: 'Edit Order', exact: true }).click()
				await page.getByRole('button', { name: 'Move Retained wallet up', exact: true }).click()
				await browserExpect
					.poll(() =>
						page.evaluate(() =>
							window.financeWorkerReadFixture.state().accounts.map((row) => row.name)
						)
					)
					.toEqual(['Retained wallet', 'Offline created wallet'])
				await page.getByRole('button', { name: 'Done', exact: true }).click()
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
				await page.evaluate(
					(id) => window.financeWorkerReadFixture.route('/accounts?workspace=' + id),
					workspaceId
				)
				await browserExpect(
					page.getByRole('cell', { name: 'Retained wallet', exact: true })
				).toBeVisible()
				await browserExpect
					.poll(() =>
						page.evaluate(() =>
							window.financeWorkerReadFixture.state().accounts.map((row) => row.name)
						)
					)
					.toEqual(['Retained wallet', 'Offline created wallet'])
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
				await page.evaluate(
					(id) => window.financeWorkerReadFixture.route('/accounts?workspace=' + id),
					workspaceId
				)
				await browserExpect(
					page.getByRole('cell', { name: 'Retained edit', exact: true })
				).toBeVisible()
				await browserExpect(
					page.getByRole('cell', { name: 'Offline created wallet', exact: true })
				).toBeVisible()
				await browserExpect
					.poll(() =>
						page.evaluate(() =>
							window.financeWorkerReadFixture.state().accounts.map((row) => row.name)
						)
					)
					.toEqual(['Retained edit', 'Offline created wallet'])
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
