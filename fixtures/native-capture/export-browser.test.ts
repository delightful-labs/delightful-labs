import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { chromium, type Browser } from '@playwright/test'
import { createServer, type ViteDevServer } from 'vite'
import { jazzPlugin } from 'jazz-tools/dev/vite'
import { createJazzSession, type JazzClient } from 'jazz-tools/backend'
import { startLocalJazzServer, type LocalJazzServerHandle } from 'jazz-tools/testing'
import type { JazzSession } from 'jazz-tools/client'
import type { Db } from 'jazz-tools'
import { createActor, toPromise } from 'xstate'
import { app, permissions, bytes, readGraph } from './schema.js'
import { testExportProfile } from './export-reader.js'
import { prepareArchiveOpen } from '../../src/lib/backup/envelope-api.js'
import { createArchiveEnvelopeMachine } from '../../src/lib/machines/backup/envelope.js'
import type {} from './export-browser.js'

let authority: LocalJazzServerHandle, session: JazzSession<JazzClient>, writer: Db
let web: ViteDevServer, browser: Browser, url: string, directory: string
beforeAll(async () => {
	authority = await startLocalJazzServer({
		schema: app,
		permissions,
		inMemory: true,
		allowLocalFirstAuth: true
	})
	session = await createJazzSession({
		appId: authority.appId,
		app,
		permissions,
		serverUrl: authority.url,
		driver: { type: 'memory' },
		initial: { backendSecret: authority.backendSecret }
	})
	const client = session.getSnapshot().client
	if (!client) throw new Error('Disposable writer missing')
	writer = client.db
	web = await createServer({
		configFile: false,
		root: resolve('fixtures/native-capture'),
		cacheDir: resolve('node_modules/.vite/native-export'),
		plugins: [
			jazzPlugin({ server: false, appId: authority.appId, inspector: false }),
			{
				name: 'native-export-document',
				configureServer(host) {
					host.middlewares.use((request, response, next) => {
						if (!request.url?.startsWith('/?')) return next()
						response.setHeader('Content-Type', 'text/html')
						response.end(
							'<!doctype html><title>Disposable native export</title><script type="module" src="/export-browser.ts"></script>'
						)
					})
				}
			}
		],
		server: { host: '127.0.0.1', port: 0, strictPort: true, fs: { allow: [process.cwd()] } }
	})
	await web.listen()
	const address = web.httpServer?.address()
	if (!address || typeof address === 'string') throw new Error('Disposable listener missing')
	url = `http://127.0.0.1:${address.port}/?appId=${authority.appId}&serverUrl=${encodeURIComponent(authority.url)}`
	process.stdout.write(
		`Disposable native export qualification: http://127.0.0.1:${address.port}/\n`
	)
	browser = await chromium.launch({ headless: true, channel: 'chromium' })
	directory = await mkdtemp(join(tmpdir(), 'native-export-qualification-'))
}, 30000)
afterAll(async () => {
	await browser?.close()
	await web?.close()
	await session?.close()
	await authority?.stop()
	if (directory) await rm(directory, { recursive: true, force: true })
})

it.each(['none', 'password'])(
	'downloads %s protection from persistent Chromium and reopens outside the browser',
	async (kind) => {
		const graph = {
			workspace: crypto.randomUUID(),
			entry: crypto.randomUUID(),
			file: crypto.randomUUID(),
			part: crypto.randomUUID()
		}
		const tx = writer.beginTransaction()
		tx.insert(
			app.workspaces,
			{ revision: 0, allowed: true, visible: true },
			{ id: graph.workspace }
		)
		tx.insert(
			app.entries,
			{ revision: 0, workspaceId: graph.workspace, fileId: graph.file },
			{ id: graph.entry }
		)
		tx.insert(
			app.files,
			{ revision: 0, workspaceId: graph.workspace, sizeBytes: 8 },
			{ id: graph.file }
		)
		tx.insert(
			app.parts,
			{ workspaceId: graph.workspace, fileId: graph.file, partIndex: 0, data: bytes(0) },
			{ id: graph.part }
		)
		await tx.commit().wait({ tier: 'global' })
		const before = await readGraph(writer, graph)
		const context = await browser.newContext(),
			page = await context.newPage()
		try {
			await page.goto(url)
			await page.waitForFunction(() => Boolean(window.NativeArchiveExport))
			const downloading = page.waitForEvent('download')
			const result = await page.evaluate(
				({ graph, kind }) =>
					window.NativeArchiveExport.export(
						graph,
						kind === 'password'
							? { kind: 'password', password: 'synthetic-browser-password' }
							: { kind: 'none' }
					),
				{ graph, kind }
			)
			expect(result).toMatchObject({ outcome: 'exported', handoff: 'dispatched' })
			const downloaded = await downloading,
				path = join(directory, `${kind}.json`)
			await downloaded.saveAs(path)
			const file = Uint8Array.from(await readFile(path))
			const request = prepareArchiveOpen(
				file,
				kind === 'password' ? 'synthetic-browser-password' : undefined
			)
			const inspection = createActor(createArchiveEnvelopeMachine(), { input: { request } }).start()
			const opened = await toPromise(inspection)
			if (opened.outcome !== 'integrityChecked') throw new Error('Independent Node reopen failed')
			const payload = opened.archive.readPayload()
			expect(testExportProfile.validate(payload)).toBe(true)
			expect(payload.attachments[0]?.data).toBe(Buffer.from(bytes(0)).toString('base64'))
			opened.archive.release()
			expect(await readGraph(writer, graph)).toEqual(before)
			await page.evaluate(() => window.NativeArchiveExport.close())
		} finally {
			await context.close()
		}
	},
	30000
)
