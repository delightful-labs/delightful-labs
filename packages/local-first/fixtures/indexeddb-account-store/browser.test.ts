import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { copyFile, glob, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, firefox, webkit } from '@playwright/test'
import type { Browser, BrowserContext, Page } from '@playwright/test'
import { build, type Plugin } from 'vite'
import { z } from 'zod'
import type { Payload } from './worker.js'

const origin = 'https://indexeddb-account-store.test/'
const reply = z.discriminatedUnion('type', [
	z.object({ type: z.literal('checkpoint'), id: z.number(), phase: z.string() }),
	z.object({ type: z.literal('result'), id: z.number(), value: z.unknown() }),
	z.object({
		type: z.literal('error'),
		id: z.number(),
		error: z.object({ reason: z.string(), writeOutcome: z.string() })
	})
])
type Reply = z.infer<typeof reply>
type Harness = {
	create: (name: string) => void
	call: (name: string, payload: Payload) => Promise<unknown>
	terminate: (name: string) => void
	checkpoints: { name: string; phase: string }[]
}
declare global {
	interface Window {
		accountStoreTest: Harness
	}
}
let directory = '',
	workerSource = ''

beforeAll(async () => {
	await mkdir('.svelte-kit', { recursive: true })
	directory = await mkdtemp(resolve('.svelte-kit/account-store-consumer-'))
	const destination = join(directory, 'node_modules/delightful-local-first')
	await mkdir(destination, { recursive: true })
	const archive = join(directory, 'library.tgz')
	execFileSync('pnpm', ['pack', '--out', archive], { stdio: 'pipe' })
	execFileSync('tar', ['-xzf', archive, '--strip-components', '1', '-C', destination])
	await writeFile(
		join(directory, 'package.json'),
		JSON.stringify({ private: true, type: 'module' })
	)
	const entry = createRequire(join(directory, 'package.json')).resolve(
		'delightful-local-first/backend/jazz/account-store/indexeddb'
	)
	expect(entry.startsWith(destination)).toBe(true)
	await writeFile(
		join(directory, 'consumer.ts'),
		`
import { createIndexedDbAccountStore } from 'delightful-local-first/backend/jazz/account-store/indexeddb'
import type { AccountStore } from 'jazz-tools'
export function configure() {
 const store = createIndexedDbAccountStore({ databaseName: 'type-consumer', key: 'profile' })
 const sdk: AccountStore = store
 return { sdk, close: store.close }
}
`
	)
	await writeFile(
		join(directory, 'tsconfig.json'),
		JSON.stringify({
			extends: resolve('tsconfig.json'),
			compilerOptions: { paths: {}, module: 'NodeNext', moduleResolution: 'NodeNext', types: [] },
			include: ['./consumer.ts'],
			exclude: []
		})
	)
	execFileSync(
		process.execPath,
		[resolve('node_modules/typescript/bin/tsc'), '--project', join(directory, 'tsconfig.json')],
		{ stdio: 'pipe' }
	)
	await copyFile('fixtures/indexeddb-account-store/worker.ts', join(directory, 'worker.ts'))
	await writeFile(
		join(directory, 'driver.ts'),
		`export function open() { return new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }) }`
	)
	const check: Plugin = {
		name: 'packed-account-store-import',
		generateBundle(_options, bundle) {
			if (
				![...this.getModuleIds()].some(
					(id) =>
						id.startsWith(destination) && id.endsWith('/backend/jazz/indexeddb-account-store.js')
				)
			)
				this.error('Worker did not use the packed public AccountStore')
			for (const output of Object.values(bundle))
				if (output.type === 'chunk' && (output.imports.length || output.dynamicImports.length))
					this.error('Native fixture worker must be a self-contained emitted module')
		}
	}
	await build({
		configFile: false,
		root: directory,
		logLevel: 'silent',
		worker: { format: 'es', plugins: () => [check] },
		build: {
			outDir: join(directory, 'build'),
			rolldownOptions: { input: join(directory, 'driver.ts'), preserveEntrySignatures: 'strict' }
		}
	})
	const artifacts: string[] = []
	for await (const file of glob(join(directory, 'build/assets/worker-*.js'))) artifacts.push(file)
	expect(artifacts).toHaveLength(1)
	const artifact = artifacts[0]
	if (!artifact) throw new Error('Missing emitted worker')
	workerSource = await readFile(artifact, 'utf8')
}, 30_000)
afterAll(async () => {
	if (directory) await rm(directory, { recursive: true, force: true })
})

async function boot(context: BrowserContext) {
	// This synthetic origin has no server. Only the inert fixture document is
	// fulfilled; worker code is the emitted closed bundle supplied as a Blob.
	await context.route(/^https?:\/\//, (route) => {
		const url = route.request().url()
		return url.startsWith(origin)
			? route.fulfill({
					contentType: 'text/html',
					body: '<!doctype html><title>Native account store fixture</title>'
				})
			: route.abort('internetdisconnected')
	})
	// Firefox/WebKit reject document navigation before route fulfillment in
	// offline mode. Bootstrap only this inert local document, then take every
	// AccountStore construction/operation offline. There is no HTTP server to contact.
	await context.setOffline(false)
	const page = await context.newPage()
	await page.goto(origin)
	await context.setOffline(true)
	await page.evaluate((source) => {
		let sequence = 0
		const workers = new Map<string, Worker>()
		const pending = new Map<
			number,
			{
				name: string
				resolve: (value: unknown) => void
				reject: (error: Error) => void
				timer: ReturnType<typeof setTimeout>
			}
		>()
		const checkpoints: { name: string; phase: string }[] = []
		const sourceUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
		window.accountStoreTest = {
			checkpoints,
			create(name) {
				const worker = new Worker(sourceUrl, { type: 'module' })
				workers.set(name, worker)
				worker.onmessage = ({ data }: MessageEvent<Reply>) => {
					if (data.type === 'checkpoint') {
						checkpoints.push({ name, phase: data.phase })
						return
					}
					const call = pending.get(data.id)
					if (!call || call.name !== name) return
					clearTimeout(call.timer)
					pending.delete(data.id)
					call.resolve(data.type === 'result' ? data.value : { error: data.error })
				}
				worker.onerror = (event) => {
					checkpoints.push({ name, phase: `worker-error: ${event.message}` })
					for (const [id, call] of pending)
						if (call.name === name) {
							clearTimeout(call.timer)
							pending.delete(id)
							call.reject(new Error('Native fixture worker failed'))
						}
				}
			},
			call(name, payload) {
				return new Promise<unknown>((resolve, reject) => {
					const worker = workers.get(name)
					if (!worker) {
						reject(new Error('Missing fixture worker'))
						return
					}
					const id = ++sequence
					const timer = setTimeout(() => {
						pending.delete(id)
						reject(
							new Error(
								`Native fixture reply overdue for ${payload.method}: ${checkpoints
									.filter((point) => point.name === name)
									.map((point) => point.phase)
									.join(', ')}`
							)
						)
					}, 10_000)
					pending.set(id, { name, resolve, reject, timer })
					try {
						worker.postMessage({ ...payload, id })
					} catch {
						clearTimeout(timer)
						pending.delete(id)
						reject(new Error('Fixture post failed'))
					}
				})
			},
			terminate(name) {
				workers.get(name)?.terminate()
				workers.delete(name)
				for (const [id, call] of pending)
					if (call.name === name) {
						clearTimeout(call.timer)
						pending.delete(id)
						call.resolve({ terminated: true })
					}
			}
		}
	}, workerSource)
	return page
}
async function create(page: Page, name = 'a') {
	// Deliver only the fixture's local module bytes before going offline. The
	// AccountStore is constructed by the later OPEN command, after this returns.
	await page.context().setOffline(false)
	try {
		await page.evaluate((name) => window.accountStoreTest.create(name), name)
		await page.waitForFunction(
			(name) =>
				window.accountStoreTest.checkpoints.some(
					(point) =>
						point.name === name &&
						(point.phase === 'ready' || point.phase.startsWith('worker-error:'))
				),
			name,
			{ timeout: 5_000 }
		)
		const error = await page.evaluate(
			(name) =>
				window.accountStoreTest.checkpoints.find(
					(point) => point.name === name && point.phase.startsWith('worker-error:')
				)?.phase,
			name
		)
		if (error) throw new Error(error)
	} finally {
		await page.context().setOffline(true)
	}
}
async function call(page: Page, payload: Payload, name = 'a') {
	return page.evaluate(({ name, payload }) => window.accountStoreTest.call(name, payload), {
		name,
		payload
	})
}
function binding() {
	return { databaseName: `qualification-${crypto.randomUUID()}`, key: 'profile' }
}

for (const engine of [chromium, firefox, webkit])
	describe(engine.name(), () => {
		let browser: Browser
		beforeAll(async () => {
			browser = await engine.launch({ headless: true })
		})
		afterAll(async () => {
			await browser?.close()
		})

		it('uses the packed public export to open empty storage, commit, and reopen in a fresh worker', async () => {
			const context = await browser.newContext()
			try {
				const page = await boot(context),
					scope = binding()
				await create(page)
				expect(await call(page, { ...scope, method: 'open' })).toBeNull()
				expect(await call(page, { ...scope, method: 'update', value: 'retained' })).toBe(true)
				await call(page, { ...scope, method: 'close' })
				await page.evaluate(() => window.accountStoreTest.terminate('a'))
				await create(page, 'b')
				expect(await call(page, { ...scope, method: 'open' }, 'b')).toBe('retained')
			} finally {
				await context.close()
			}
		})

		it('serializes concurrent transforms from real workers in two tabs without lost updates', async () => {
			const context = await browser.newContext()
			try {
				const first = await boot(context),
					second = await boot(context),
					scope = binding()
				await create(first)
				await create(second)
				await Promise.all([
					call(first, { ...scope, method: 'open' }),
					call(second, { ...scope, method: 'open' })
				])
				await Promise.all(
					[first, second].map(async (page, writer) => {
						for (let index = 0; index < 12; index++)
							expect(
								await call(page, { ...scope, method: 'append', value: `${writer}-${index}` })
							).toBe(true)
					})
				)
				const value = z.string().parse(await call(first, { ...scope, method: 'read' }))
				expect(value.split(',').filter(Boolean).sort()).toEqual(
					Array.from({ length: 2 }, (_, writer) =>
						Array.from({ length: 12 }, (_, index) => `${writer}-${index}`)
					)
						.flat()
						.sort()
				)
			} finally {
				await context.close()
			}
		})

		for (const method of ['throw-transform', 'oversize', 'quota', 'abort-after-put'])
			it(`${method} preserves the previous record and reports native abort`, async () => {
				const context = await browser.newContext()
				try {
					const page = await boot(context),
						scope = binding()
					await create(page)
					await call(page, { ...scope, method: 'open' })
					await call(page, { ...scope, method: 'update', value: 'original' })
					const command = z
						.enum(['throw-transform', 'oversize', 'quota', 'abort-after-put'])
						.parse(method)
					const result = await call(page, { ...scope, method: command })
					expect(result).toMatchObject({ ok: false, writeOutcome: 'aborted' })
					expect(JSON.stringify(result)).not.toContain('private')
					expect(await call(page, { ...scope, method: 'read' })).toBe('original')
				} finally {
					await context.close()
				}
			})

		it.each([
			{ name: 'number', value: 42 },
			{ name: 'null', value: null },
			{ name: 'undefined', value: undefined },
			{ name: 'oversize', value: 'x'.repeat(1024 * 1024 + 1) }
		])(
			'rejects a persisted $name record rather than reporting an empty identity',
			async ({ value }) => {
				const context = await browser.newContext()
				try {
					const page = await boot(context),
						scope = binding()
					await create(page)
					await call(page, { ...scope, method: 'seed', value })
					expect(await call(page, { ...scope, method: 'open' })).toEqual({
						error: { reason: 'invalid-value', writeOutcome: 'aborted' }
					})
				} finally {
					await context.close()
				}
			}
		)

		it('drains the current native transaction before close and rejects queued updates', async () => {
			const context = await browser.newContext()
			try {
				const page = await boot(context),
					scope = binding()
				await create(page)
				await call(page, { ...scope, method: 'open' })
				expect(await call(page, { ...scope, method: 'close-during-write' })).toEqual({
					first: { ok: true },
					queued: { ok: false, reason: 'closed', writeOutcome: 'not-issued' },
					trace: ['put-success', 'transaction-complete', 'closed']
				})
			} finally {
				await context.close()
			}
		})

		it('retains a canceled native open and closes its late connection before acknowledging close', async () => {
			const context = await browser.newContext()
			try {
				const page = await boot(context),
					scope = binding()
				await create(page)
				expect(await call(page, { ...scope, method: 'late-open' })).toEqual({
					premature: false,
					reading: { ok: false, reason: 'closed', writeOutcome: 'not-issued' }
				})
			} finally {
				await context.close()
			}
		})

		for (const method of ['actor-stop', 'stop-during-begin'])
			it(`${method} retains native abort evidence and prevents an orphaned write`, async () => {
				const context = await browser.newContext()
				try {
					const page = await boot(context),
						scope = binding()
					await create(page)
					const command = z.enum(['actor-stop', 'stop-during-begin']).parse(method)
					expect(await call(page, { ...scope, method: command })).toEqual({
						aborted: true,
						calls: method === 'actor-stop' ? 1 : 0,
						value: 'original'
					})
				} finally {
					await context.close()
				}
			})

		it('closes its old connection for a real version change and refuses later work', async () => {
			const context = await browser.newContext()
			try {
				const page = await boot(context),
					scope = binding()
				await create(page)
				await call(page, { ...scope, method: 'open' })
				expect(await call(page, { ...scope, method: 'version-change' })).toEqual({
					ok: false,
					reason: 'closed',
					writeOutcome: 'not-issued'
				})
			} finally {
				await context.close()
			}
		})

		it('native close failure cannot acknowledge safe closure or reopen admission', async () => {
			const context = await browser.newContext()
			try {
				const page = await boot(context),
					scope = binding()
				await create(page)
				await call(page, { ...scope, method: 'open' })
				expect(await call(page, { ...scope, method: 'close-failure' })).toMatchObject({
					closing: { ok: false },
					reading: { ok: false, reason: 'closed' }
				})
			} finally {
				await context.close()
			}
		})

		for (const phase of ['before', 'put', 'committed'])
			it(`worker termination at ${phase} leaves an atomic record and permits a replacement writer`, async () => {
				const context = await browser.newContext()
				try {
					const page = await boot(context),
						scope = binding()
					await create(page)
					await call(page, { ...scope, method: 'open' })
					const previous = JSON.stringify({ revision: 1, bytes: 'a'.repeat(8192) })
					const replacement = JSON.stringify({ revision: 2, bytes: 'b'.repeat(8192) })
					await call(page, { ...scope, method: 'update', value: previous })
					const position = z.enum(['before', 'put', 'committed']).parse(phase)
					const pending = call(page, {
						...scope,
						method: 'crash',
						phase: position,
						value: replacement
					})
					void pending.catch(() => {})
					await page.waitForFunction(
						(phase) =>
							window.accountStoreTest.checkpoints.some(
								(point) => point.name === 'a' && point.phase === phase
							),
						phase
					)
					await page.evaluate(() => window.accountStoreTest.terminate('a'))
					expect(await pending).toEqual({ terminated: true })
					await create(page, 'b')
					const value = await call(page, { ...scope, method: 'open' }, 'b')
					expect(
						phase === 'put'
							? [previous, replacement]
							: [phase === 'before' ? previous : replacement]
					).toContain(value)
					expect(
						await call(page, { ...scope, method: 'update', value: 'replacement-can-write' }, 'b')
					).toBe(true)
					expect(await call(page, { ...scope, method: 'read' }, 'b')).toBe('replacement-can-write')
				} finally {
					await context.close()
				}
			})

		it('retains offline edits through two complete browser-process/profile restarts', async () => {
			const profile = await mkdtemp(join(directory, `profile-${engine.name()}-`)),
				scope = binding()
			try {
				for (const [expected, next] of [
					[null, 'saved'],
					['saved', 'offline-edit'],
					['offline-edit', 'final']
				]) {
					const context = await engine.launchPersistentContext(profile, { headless: true })
					try {
						const page = await boot(context)
						await create(page)
						expect(await call(page, { ...scope, method: 'open' })).toBe(expected)
						if (next)
							expect(await call(page, { ...scope, method: 'update', value: next })).toBe(true)
					} finally {
						await context.close()
					}
				}
			} finally {
				await rm(profile, { recursive: true, force: true })
			}
		}, 30_000)
	})
