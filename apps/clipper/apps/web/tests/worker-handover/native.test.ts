import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { cp, glob, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import { build, type InlineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { expect as browserExpect, chromium, firefox, webkit, type Page } from '@playwright/test'
import {
	jazzWorkerOptions,
	resolveJazzWorkerAssets
} from 'delightful-local-first/backend/jazz/worker-build'
import type {} from './client.js'

const observe = browserExpect.configure({ timeout: 15000 })
let directory = '',
	origin = ''
let preserve = false
let documentBuild: 'old' | 'new' = 'old'
let server: ReturnType<typeof createServer> | undefined

beforeAll(async () => {
	await mkdir('.svelte-kit', { recursive: true })
	directory = await mkdtemp(resolve('.svelte-kit/clipper-handover-'))
	const sdkAssets = resolveJazzWorkerAssets(import.meta.url)
	let futureBindings: string | undefined
	let usedFutureBindings = false
	const config = {
		configFile: false,
		logLevel: 'silent',
		plugins: [svelte({ configFile: false })],
		resolve: {
			alias: [
				{ find: /^#jazz-broker-worker/, replacement: sdkAssets.brokerEntry },
				{ find: /^jazz-wasm$/, replacement: sdkAssets.wasmEntry },
				{ find: /^#jazz-wasm-binary/, replacement: sdkAssets.wasmBinary }
			]
		},
		worker: {
			...jazzWorkerOptions(),
			plugins: () => [
				{
					name: 'clipper-descendant-schema',
					enforce: 'pre',
					load(id) {
						if (futureBindings && id === resolve('src/lib/backend/jazz/jazz.generated.ts')) {
							usedFutureBindings = true
							return futureBindings
						}
					}
				}
			]
		},
		build: {
			outDir: join(directory, 'old'),
			emptyOutDir: true,
			rolldownOptions: { input: resolve('tests/worker-handover/index.html') }
		}
	} satisfies InlineConfig
	await build(config)
	const source = join(directory, 'future-source')
	await cp('src', join(source, 'src'), { recursive: true })
	const schemaDir = join(source, 'src/lib/backend/jazz')
	const schemaFile = join(schemaDir, 'schema.ts')
	const schema = await readFile(schemaFile, 'utf8')
	const anchor = 'export const schema = s.defineSchema({'
	if (!schema.includes(anchor)) throw new Error('Missing native schema fixture anchor')
	await writeFile(
		schemaFile,
		schema.replace(
			anchor,
			anchor + '\n upgradeFixture: s.table({ marker: s.string().optional() }),'
		)
	)
	const permissionsFile = join(schemaDir, 'permissions.ts')
	const permissions = await readFile(permissionsFile, 'utf8')
	const permissionAnchor = 'export const permissions = definePermissions({'
	if (!permissions.includes(permissionAnchor))
		throw new Error('Missing native permission fixture anchor')
	await writeFile(
		permissionsFile,
		permissions.replace(permissionAnchor, permissionAnchor + '\n upgradeFixture: {},')
	)
	const require = createRequire(import.meta.url)
	const cli = join(require.resolve('jazz-tools/package.json'), '../bin/jazz-tools.js')
	for (const args of [
		['migrations', 'create', '--name', 'worker-handover-fixture'],
		['generate'],
		['generate', '--check']
	])
		execFileSync(process.execPath, [cli, ...args, '--schema-dir', schemaDir], { stdio: 'pipe' })
	futureBindings = await readFile(join(schemaDir, 'jazz.generated.ts'), 'utf8')
	await build({ ...config, build: { ...config.build, outDir: join(directory, 'new') } })
	if (!usedFutureBindings) throw new Error('Descendant schema was not built into the worker')
	const assets = new Map<string, { bytes: Buffer; type: string }>()
	for (const version of ['old', 'new']) {
		const output = join(directory, version)
		for await (const file of glob('**/*', { cwd: output })) {
			const path = join(output, file)
			if (!(await stat(path)).isFile()) continue
			const key = file === 'tests/worker-handover/index.html' ? '/' + version + '.html' : '/' + file
			const bytes = await readFile(path)
			const existing = assets.get(key)
			if (existing && !existing.bytes.equals(bytes))
				throw new Error('Native fixture asset collision')
			assets.set(key, {
				bytes,
				type:
					extname(file) === '.html'
						? 'text/html'
						: extname(file) === '.js'
							? 'application/javascript'
							: 'application/octet-stream'
			})
		}
	}
	expect([...assets.keys()].filter((key) => /jazz-broker-worker.*\.js$/.test(key))).toHaveLength(1)
	const listener = createServer((request, response) => {
		const path = new URL(request.url ?? '/', 'http://fixture.invalid').pathname
		const asset = assets.get(path === '/' ? '/' + documentBuild + '.html' : path)
		response.writeHead(asset ? 200 : 404, {
			'Content-Type': asset?.type ?? 'text/plain',
			'Cache-Control': 'no-store'
		})
		response.end(asset?.bytes ?? 'No backend is available')
	})
	server = listener
	await new Promise<void>((resolve, reject) => {
		listener.once('error', reject)
		listener.listen(0, '127.0.0.1', resolve)
	})
	const address = listener.address()
	if (!address || typeof address === 'string') throw new Error('Native listener address missing')
	origin = `http://127.0.0.1:${address.port}`
})
afterAll(async () => {
	const listener = server
	if (listener) {
		listener.closeAllConnections()
		await new Promise<void>((resolve, reject) =>
			listener.close((error) => (error ? reject(error) : resolve()))
		)
	}
	if (directory && !preserve) await rm(directory, { recursive: true, force: true })
	else if (directory) console.error('Native Clipper handover artifacts:', directory)
})
async function configure(page: Page, appId: string) {
	await page.waitForFunction(() => Boolean(window.clipperHandoverFixture))
	await page.evaluate((id) => window.clipperHandoverFixture.open(id), appId)
}
async function ready(page: Page) {
	// Library binding precedes the collection's asynchronous ROWS observation.
	await observe
		.poll(() => page.evaluate(() => Boolean(window.clipperHandoverFixture.state().view?.library)))
		.toBe(true)
	expect(
		await page.evaluate(() => window.clipperHandoverFixture.state().view?.worker.windowPresent)
	).toBe(false)
}
for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
	describe(name, () => {
		it.each(['new', 'old'] satisfies ('new' | 'old')[])(
			'hands native schema ownership to a %s document without losing saved data or looping',
			async (version) => {
				onTestFailed(() => {
					preserve = true
				})
				const browser = await engine.launch({ headless: true })
				const context = await browser.newContext()
				const old = await context.newPage()
				let reloads = 0
				try {
					const appId = crypto.randomUUID(),
						url = 'https://example.com/native-worker-handover'
					documentBuild = 'old'
					await old.goto(origin)
					await configure(old, appId)
					await ready(old)
					await old.evaluate((url) => window.clipperHandoverFixture.add(url), url)
					await observe
						.poll(() =>
							old.evaluate(
								(url) =>
									window.clipperHandoverFixture
										.state()
										.view?.library?.rows.find((row) => row.url === url)?.id,
								url
							)
						)
						.toBeTruthy()
					const id = await old.evaluate(
						(url) =>
							window.clipperHandoverFixture
								.state()
								.view?.library?.rows.find((row) => row.url === url)?.id,
						url
					)
					old.on('framenavigated', (frame) => {
						if (frame === old.mainFrame()) reloads++
					})
					documentBuild = version
					const reloaded = old.waitForEvent('domcontentloaded')
					const future = await context.newPage()
					await future.goto(origin + '/new.html')
					await configure(future, appId)
					await ready(future)
					await reloaded
					expect(reloads).toBe(1)
					await configure(old, appId)
					if (version === 'new') {
						await ready(old)
						await observe
							.poll(() =>
								old.evaluate(
									(id) =>
										window.clipperHandoverFixture
											.state()
											.view?.library?.rows.some((row) => row.id === id),
									id
								)
							)
							.toBe(true)
						await old.evaluate(() => window.clipperHandoverFixture.close())
						await observe
							.poll(() => old.evaluate(() => window.clipperHandoverFixture.state().released))
							.toBe(true)
					} else
						await observe
							.poll(() => old.evaluate(() => window.clipperHandoverFixture.state().failed))
							.toBe(true)
					expect(reloads).toBe(1)
					await observe
						.poll(() =>
							future.evaluate(
								(id) =>
									window.clipperHandoverFixture
										.state()
										.view?.library?.rows.some((row) => row.id === id),
								id
							)
						)
						.toBe(true)
					await future.evaluate(() => window.clipperHandoverFixture.close())
					await observe
						.poll(() => future.evaluate(() => window.clipperHandoverFixture.state().released))
						.toBe(true)
				} finally {
					documentBuild = 'old'
					await browser.close()
				}
			}
		)
	})
}
