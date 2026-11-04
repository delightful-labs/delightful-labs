import { afterAll, afterEach, beforeAll, expect, it } from 'vitest'
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { createServer, type ViteDevServer } from 'vite'
import { jazzPlugin } from 'jazz-tools/dev/vite'
import { startLocalJazzServer, type LocalJazzServerHandle } from 'jazz-tools/testing'
import { resolve } from 'node:path'
import { notebookRestoreApp, notebookRestorePermissions } from './restore-schema.js'
import type {} from './restore-browser.js'

let authority: LocalJazzServerHandle, web: ViteDevServer, browser: Browser
let url: string
const contexts: BrowserContext[] = []
beforeAll(async () => {
	authority = await startLocalJazzServer({
		schema: notebookRestoreApp,
		permissions: notebookRestorePermissions
	})
	web = await createServer({
		configFile: false,
		cacheDir: resolve('node_modules/.vite/notebook-restore'),
		root: resolve('fixtures/backup-notebook'),
		plugins: [jazzPlugin({ server: false, appId: authority.appId, inspector: false })],
		server: { host: '127.0.0.1', port: 6199, strictPort: true, fs: { allow: [process.cwd()] } }
	})
	await web.listen()
	url = `http://127.0.0.1:6199/restore.html?appId=${authority.appId}&serverUrl=${encodeURIComponent(authority.url)}`
	browser = await chromium.launch({ headless: true, channel: 'chromium' })
})
afterAll(async () => {
	await Promise.all(contexts.map((context) => context.close()))
	await browser?.close()
	await web?.close()
	await authority?.stop()
})
afterEach(async () => {
	await Promise.all(contexts.splice(0).map((context) => context.close()))
})
async function open() {
	const context = await browser.newContext()
	contexts.push(context)
	const page = await context.newPage()
	await page.goto(url)
	await page.waitForFunction(() => Boolean(window.DLFRestoreQualification))
	return page
}
async function sample(page: Page, size?: number, title?: string) {
	return page.evaluate(
		async ({ size, title }) => {
			const api = window.DLFRestoreQualification
			const binding = {
				applicationId: 'notebook-qualification',
				environment: 'disposable',
				identityId: api.ownerId,
				workspaceId: crypto.randomUUID(),
				operationId: crypto.randomUUID(),
				generation: 1
			}
			const raw = api.createNotebookDataset({
				applicationId: 'notebook-source',
				workspaceId: 'original'
			})
			const payload: typeof raw = {
				...raw,
				records: raw.records.map((record) =>
					record.type !== 'notebook' || title === undefined
						? record
						: { ...record, fields: { ...record.fields, title: { kind: 'text', value: title } } }
				)
			}
			const bytes =
				size === undefined ? undefined : Uint8Array.from({ length: size }, (_, i) => i % 251)
			const digest =
				bytes === undefined
					? undefined
					: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) =>
							byte.toString(16).padStart(2, '0')
						).join('')
			const customized =
				bytes === undefined
					? payload
					: {
							...payload,
							attachments: [
								{
									id: 'binary',
									mediaType: 'application/octet-stream',
									fileName: 'Cafe\u0301 ☕.bin',
									sizeBytes: bytes.length,
									sha256: digest ?? '',
									data: btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''))
								}
							]
						}
			const request = api.prepareArchiveSeal(customized, { kind: 'none' })
			const actor = api
				.createActor(api.createArchiveEnvelopeMachine(), { input: { request } })
				.start()
			const output = await api.toPromise(actor)
			if (output.outcome !== 'sealed') throw new Error('Could not seal fixture')
			const file = Array.from(output.archive.copyBytes())
			output.archive.release()
			request.release()
			actor.stop()
			return { binding, file, databaseName: 'notebook-restore-' + crypto.randomUUID() }
		},
		{ size, title }
	)
}
type Sample = Awaited<ReturnType<typeof sample>>
async function initialize(page: Page, sample: Sample) {
	return page.evaluate(async ({ binding, databaseName }) => {
		const api = window.DLFRestoreQualification
		const request = api.prepareBrowserRestoreJournal({
			binding,
			databaseName,
			command: { mode: 'initialize' }
		})
		const actor = api
			.createActor(api.createBrowserRestoreJournalMachine(), { input: { request } })
			.start()
		const output = await api.toPromise(actor)
		request.release()
		actor.stop()
		return output.outcome
	}, sample)
}
async function run(page: Page, sample: Sample, mode: 'new' | 'resume') {
	return page.evaluate(
		async ({ sample, mode }) => {
			const api = window.DLFRestoreQualification
			const open = api.prepareArchiveOpen(new Uint8Array(sample.file))
			const envelope = api
				.createActor(api.createArchiveEnvelopeMachine(), { input: { request: open } })
				.start()
			const checked = await api.toPromise(envelope)
			if (checked.outcome !== 'integrityChecked') throw new Error('Could not open fixture')
			const request = api.prepareNotebookRestore({
				mode,
				binding: sample.binding,
				databaseName: sample.databaseName,
				archive: checked.archive
			})
			const trace: string[] = []
			const actor = api.createActor(api.createNotebookRestorePreparationMachine(api.writer), {
				input: { request },
				inspect(event) {
					if (event.type === '@xstate.event' && event.event.type.startsWith('xstate.error'))
						trace.push(String(event.event.error))
				}
			})
			actor.subscribe((snapshot) => trace.push(JSON.stringify(snapshot.value)))
			actor.start()
			const output = await api.toPromise(actor)
			request.release()
			actor.stop()
			open.release()
			envelope.stop()
			return { ...output, issued: api.issued(), trace }
		},
		{ sample, mode }
	)
}
async function discover(page: Page, sample: Sample) {
	return page.evaluate(async ({ binding, databaseName }) => {
		const api = window.DLFRestoreQualification
		const request = api.prepareBrowserRestoreJournal({
			binding,
			databaseName,
			command: { mode: 'discover' }
		})
		const actor = api
			.createActor(api.createBrowserRestoreJournalMachine(), { input: { request } })
			.start()
		const output = await api.toPromise(actor)
		const record = output.record?.readRecord()
		request.release()
		actor.stop()
		return { outcome: output.outcome, record }
	}, sample)
}
async function deleteJournal(page: Page, sample: Sample) {
	await page.evaluate(
		(name) =>
			new Promise<void>((resolve, reject) => {
				const deletion = indexedDB.deleteDatabase(name)
				deletion.onsuccess = () => resolve()
				deletion.onerror = () => reject(deletion.error)
				deletion.onblocked = () => reject(new Error('Restore journal connection leaked'))
			}),
		sample.databaseName
	)
}
it('prepares an isolated real Jazz destination, retains exact mappings across reload, and never replays preparation', async () => {
	const page = await open(),
		value = await sample(page)
	expect(await initialize(page, value)).toBe('initialized')
	const result = await run(page, value, 'new')
	expect(result.outcome, result.trace.join(' | ')).toBe('prepared')
	expect(result.issued).toBe(1)
	expect(result.record?.checkpoint).toMatchObject({
		kind: 'writing',
		completed: [{ writeId: 'prepare', settlement: { local: 'persisted', remote: 'accepted' } }]
	})
	const actual = await page.evaluate(async (binding) => {
		const api = window.DLFRestoreQualification
		return {
			row: await api.db.one(
				api.notebookRestoreApp.restoreDestinations.where({ id: binding.workspaceId }),
				{ tier: 'remote' }
			),
			ordinary: await api.db.all(api.activeNotebookDestinations(api.ownerId), { tier: 'remote' })
		}
	}, value.binding)
	expect(actual.row).toMatchObject({
		ownerId: value.binding.identityId,
		operationId: value.binding.operationId,
		status: 'incomplete',
		payloadSha256: result.record?.intent.archive.payloadSha256,
		graphSha256: result.record?.intent.plan.expectedGraphSha256
	})
	expect(actual.ordinary).toEqual([])
	await page.reload()
	await page.waitForFunction(() => Boolean(window.DLFRestoreQualification))
	const resumed = await run(
		page,
		{ ...value, binding: { ...value.binding, generation: 2 } },
		'resume'
	)
	expect(resumed.outcome).toBe('prepared')
	expect(resumed.issued).toBe(0)
	expect(resumed.record).toEqual(result.record)
	await deleteJournal(page, value)
	await page.context().close()
})
it('refuses resume without a journal or with a different checked file, and preserves the original operation', async () => {
	const page = await open(),
		value = await sample(page)
	expect((await run(page, value, 'resume')).issued).toBe(0)
	expect(await initialize(page, value)).toBe('initialized')
	const original = await run(page, value, 'new')
	expect(original.outcome).toBe('prepared')
	const other = await sample(page)
	const mismatched = await run(page, { ...value, file: other.file }, 'resume')
	expect(mismatched.outcome).toBe('conflict')
	expect(mismatched.issued).toBe(1)
	expect((await discover(page, value)).record).toEqual(original.record)
	await deleteJournal(page, value)
	await page.context().close()
})
it('reconciles actual Jazz contents after local checkpoint/reload without fabricating an acceptance receipt', async () => {
	const page = await open(),
		value = await sample(page)
	await initialize(page, value)
	// Hold only the observation, after the real commit/local wait; the native SDK still accepts.
	await page.evaluate(() => {
		window.DLFRestoreQualification.writer.acceptRemote = () => new Promise(() => {})
	})
	await page.evaluate(async (sample) => {
		const api = window.DLFRestoreQualification
		const open = api.prepareArchiveOpen(new Uint8Array(sample.file))
		const envelope = api
			.createActor(api.createArchiveEnvelopeMachine(), { input: { request: open } })
			.start()
		const checked = await api.toPromise(envelope)
		if (checked.outcome !== 'integrityChecked') throw new Error('Could not open fixture')
		const request = api.prepareNotebookRestore({ ...sample, mode: 'new', archive: checked.archive })
		api.pending.actor = api.createActor(api.machine, { input: { request } }).start()
		api.pending.cleanup = () => {
			request.release()
			open.release()
			envelope.stop()
		}
	}, value)
	await expect
		.poll(async () => (await discover(page, value)).record?.checkpoint)
		.toMatchObject({ current: { settlement: { local: 'persisted', remote: 'unobserved' } } })
	await expect
		.poll(() =>
			page.evaluate(async (id) => {
				const api = window.DLFRestoreQualification
				return (
					await api.db.one(api.notebookRestoreApp.restoreDestinations.where({ id }), {
						tier: 'remote'
					})
				)?.status
			}, value.binding.workspaceId)
		)
		.toBe('incomplete')
	const interrupted = await page.evaluate(async () => {
		const api = window.DLFRestoreQualification,
			actor = api.pending.actor
		if (!actor) throw new Error('Missing pending preparation')
		actor.send({ type: 'CANCEL' })
		api.pending.releaseAuthority?.()
		const output = await api.toPromise(actor)
		api.pending.cleanup?.()
		actor.stop()
		return output
	})
	expect(interrupted.outcome).toBe('cancelled')
	expect(interrupted.record?.checkpoint).toMatchObject({
		completed: [],
		current: {
			transactionId: expect.any(String),
			settlement: { local: 'persisted', remote: 'unobserved' }
		}
	})
	await page.reload()
	await page.waitForFunction(() => Boolean(window.DLFRestoreQualification))
	const resumed = await run(
		page,
		{ ...value, binding: { ...value.binding, generation: 2 } },
		'resume'
	)
	expect(resumed.outcome).toBe('prepared')
	expect(resumed.issued).toBe(0)
	expect(resumed.record?.checkpoint).toMatchObject({
		completed: [
			{
				basis: 'remoteContentMatch',
				localPersistence: 'persisted',
				attempt: { settlement: { local: 'persisted', remote: 'unobserved' } }
			}
		]
	})
	await deleteJournal(page, value)
	await page.context().close()
})

it('enforces owner-only recovery and denies premature activation at the real storage boundary', async () => {
	const page = await open(),
		value = await sample(page)
	await initialize(page, value)
	const original = await run(page, value, 'new')
	expect(original.outcome).toBe('prepared')
	const foreign = await open()
	const hidden = await foreign.evaluate(async (id) => {
		const api = window.DLFRestoreQualification
		return api.db.one(api.notebookRestoreApp.restoreDestinations.where({ id }), { tier: 'remote' })
	}, value.binding.workspaceId)
	expect(hidden).toBeNull()
	if (!original.record) throw new Error('Expected prepared journal')
	const forgedOwnerInsert = await foreign.evaluate(async (record) => {
		const api = window.DLFRestoreQualification
		try {
			await api.db
				.insert(
					api.notebookRestoreApp.restoreDestinations,
					{
						ownerId: record.intent.operation.identityId,
						operationId: crypto.randomUUID(),
						payloadSha256: record.intent.archive.payloadSha256,
						graphSha256: record.intent.plan.expectedGraphSha256,
						status: 'incomplete'
					},
					{ id: crypto.randomUUID() }
				)
				.wait({ tier: 'global' })
			return 'accepted'
		} catch (error) {
			if (error instanceof api.PersistedWriteRejectedError && error.code === 'permission_denied')
				return 'rejected'
			throw error
		}
	}, original.record)
	expect(forgedOwnerInsert).toBe('rejected')
	const activation = await page.evaluate(async (id) => {
		const api = window.DLFRestoreQualification
		try {
			await api.db
				.update(api.notebookRestoreApp.restoreDestinations, id, { status: 'active' })
				.wait({ tier: 'global' })
			return 'accepted'
		} catch (error) {
			if (error instanceof api.PersistedWriteRejectedError && error.code === 'permission_denied')
				return 'rejected'
			throw error
		}
	}, value.binding.workspaceId)
	expect(activation).toBe('rejected')
	const stillIncomplete = await page.evaluate(async (id) => {
		const api = window.DLFRestoreQualification
		return (
			await api.db.one(api.notebookRestoreApp.restoreDestinations.where({ id }), { tier: 'remote' })
		)?.status
	}, value.binding.workspaceId)
	expect(stillIncomplete).toBe('incomplete')
	await foreign.context().close()
	await deleteJournal(page, value)
	await page.context().close()
})
it('rejects malformed discovered metadata without replacing storage or writing a destination', async () => {
	const page = await open(),
		value = await sample(page)
	await initialize(page, value)
	await page.evaluate(async ({ binding, databaseName }) => {
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = indexedDB.open(databaseName, 1)
			request.onsuccess = () => resolve(request.result)
			request.onerror = () => reject(request.error)
		})
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction('restoreOperations', 'readwrite')
			tx.objectStore('restoreOperations').put(
				new Uint8Array([1, 2, 3]),
				JSON.stringify([
					binding.applicationId,
					binding.environment,
					binding.identityId,
					binding.operationId
				])
			)
			tx.oncomplete = () => resolve()
			tx.onabort = () => reject(tx.error)
		})
		db.close()
	}, value)
	expect(await discover(page, value)).toEqual({ outcome: 'failed', record: undefined })
	expect((await run(page, value, 'resume')).issued).toBe(0)
	const bytes = await page.evaluate(async ({ binding, databaseName }) => {
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = indexedDB.open(databaseName, 1)
			request.onsuccess = () => resolve(request.result)
			request.onerror = () => reject(request.error)
		})
		const retained = await new Promise<unknown>((resolve, reject) => {
			const tx = db.transaction('restoreOperations')
			const request = tx
				.objectStore('restoreOperations')
				.get(
					JSON.stringify([
						binding.applicationId,
						binding.environment,
						binding.identityId,
						binding.operationId
					])
				)
			tx.oncomplete = () => resolve(request.result)
			tx.onabort = () => reject(tx.error)
		})
		db.close()
		return retained instanceof Uint8Array ? Array.from(retained) : null
	}, value)
	expect(bytes).toEqual([1, 2, 3])
	await deleteJournal(page, value)
	await page.context().close()
})

it('holds one operation owner across tabs and releases ownership after cancellation', async () => {
	const page = await open(),
		value = await sample(page)
	await initialize(page, value)
	await page.evaluate(async (sample) => {
		const api = window.DLFRestoreQualification
		api.writer.checkAuthority = () =>
			new Promise<boolean>((resolve) => {
				api.pending.releaseAuthority = () => resolve(true)
			})
		const open = api.prepareArchiveOpen(new Uint8Array(sample.file))
		const envelope = api
			.createActor(api.createArchiveEnvelopeMachine(), { input: { request: open } })
			.start()
		const checked = await api.toPromise(envelope)
		if (checked.outcome !== 'integrityChecked') throw new Error('Could not open fixture')
		const request = api.prepareNotebookRestore({ ...sample, mode: 'new', archive: checked.archive })
		api.pending.actor = api.createActor(api.machine, { input: { request } }).start()
		api.pending.cleanup = () => {
			request.release()
			open.release()
			envelope.stop()
		}
	}, value)
	await expect.poll(async () => (await discover(page, value)).outcome).toBe('loaded')
	const peer = await page.context().newPage()
	await peer.goto(url)
	await peer.waitForFunction(() => Boolean(window.DLFRestoreQualification))
	const blocked = await run(peer, value, 'resume')
	expect(blocked.outcome).toBe('unavailable')
	expect(blocked.issued).toBe(0)
	const serialized = await page.evaluate(() =>
		JSON.stringify(window.DLFRestoreQualification.pending.actor?.getSnapshot())
	)
	expect(serialized).not.toContain('First line')
	expect(serialized).not.toContain('Preserve archived content')
	await page.evaluate(async () => {
		const api = window.DLFRestoreQualification,
			actor = api.pending.actor
		if (!actor) throw new Error('Missing pending preparation')
		actor.send({ type: 'CANCEL' })
		api.pending.releaseAuthority?.()
		await api.toPromise(actor)
		api.pending.cleanup?.()
		actor.stop()
	})
	const continued = await run(peer, value, 'resume')
	expect(continued.outcome).toBe('prepared')
	expect(continued.issued).toBe(1)
	await deleteJournal(page, value)
	await page.context().close()
})

it('binds discovered recovery metadata to identity, operation and destination without resetting the row', async () => {
	const page = await open(),
		value = await sample(page)
	await initialize(page, value)
	const original = await run(page, value, 'new')
	expect(original.record).toBeDefined()
	const wrongDestination = {
		...value,
		binding: { ...value.binding, workspaceId: crypto.randomUUID() }
	}
	expect((await discover(page, wrongDestination)).outcome).toBe('conflict')
	const wrongOperation = {
		...value,
		binding: { ...value.binding, operationId: crypto.randomUUID() }
	}
	expect((await discover(page, wrongOperation)).outcome).toBe('missing')
	const wrongIdentity = { ...value, binding: { ...value.binding, identityId: crypto.randomUUID() } }
	expect((await discover(page, wrongIdentity)).outcome).toBe('missing')
	expect((await discover(page, value)).record).toEqual(original.record)
	await deleteJournal(page, value)
	await page.context().close()
})

it('refuses first-write admission for a different restoring identity before transaction issuance', async () => {
	const page = await open(),
		value = await sample(page)
	const mismatched = { ...value, binding: { ...value.binding, identityId: crypto.randomUUID() } }
	await initialize(page, mismatched)
	const output = await run(page, mismatched, 'new')
	expect(output.outcome).toBe('incomplete')
	expect(output.issued).toBe(0)
	expect(output.record?.checkpoint).toMatchObject({
		completed: [],
		current: { status: 'notIssued', issuance: 0 }
	})
	await deleteJournal(page, mismatched)
	await page.context().close()
})

async function attachment(page: Page, value: Sample, summarize = false) {
	return page.evaluate(
		async ({ value, summarize }) => {
			const api = window.DLFRestoreQualification
			const request = api.prepareArchiveOpen(new Uint8Array(value.file))
			const envelope = api
				.createActor(api.createArchiveEnvelopeMachine(), { input: { request } })
				.start()
			const checked = await api.toPromise(envelope)
			if (checked.outcome !== 'integrityChecked') throw new Error('Invalid fixture')
			const restore = api.createNotebookAttachmentRestore({
				db: api.db,
				retainDetached: () => {},
				binding: value.binding,
				databaseName: value.databaseName,
				archive: checked.archive
			})
			restore.actor.start()
			const output = await api.toPromise(restore.actor)
			restore.request.release()
			restore.actor.stop()
			request.release()
			envelope.stop()
			const rows = await api.db.all(
				api.notebookRestoreApp.restoreAttachments.where({
					destinationId: value.binding.workspaceId
				}),
				{ tier: 'remote' }
			)
			const destination = await api.db.one(
				api.notebookRestoreApp.restoreDestinations.where({ id: value.binding.workspaceId }),
				{ tier: 'remote' }
			)
			return {
				output,
				issued: api.issued(),
				rows: rows.map((row) => ({ ...row, contents: summarize ? [] : Array.from(row.contents) })),
				destination
			}
		},
		{ value, summarize }
	)
}
it('writes actual attachment bytes, preserves preparation evidence, and does not replay after reload', async () => {
	const page = await open(),
		value = await sample(page)
	expect(await initialize(page, value)).toBe('initialized')
	const prepared = await run(page, value, 'new')
	expect(prepared.outcome).toBe('prepared')
	const result = await attachment(page, value)
	expect(result.output.outcome).toBe('batchWritten')
	expect(result.issued).toBe(2)
	expect(result.rows).toHaveLength(1)
	expect(result.rows[0]?.contents).toEqual([0, 255, 128, 10])
	expect(result.destination?.status).toBe('incomplete')
	const before = prepared.record?.checkpoint,
		after = result.output.record?.checkpoint
	if (!before || before.kind !== 'writing' || !after || after.kind !== 'writing')
		throw new Error('Expected journal prefix')
	expect(after.completed).toHaveLength(2)
	expect(after.completed[0]).toEqual(before.completed[0])
	await page.reload()
	await page.waitForFunction(() => Boolean(window.DLFRestoreQualification))
	const resumed = await attachment(page, value)
	expect(resumed.output.outcome).toBe('noAttachmentStep')
	expect(resumed.issued).toBe(0)
	expect(resumed.rows).toEqual(result.rows)
	expect(resumed.output.record).toEqual(result.output.record)
	await deleteJournal(page, value)
})

for (const size of [0, 1024 * 1024]) {
	it(
		`restores and freshly reads ${size} attachment bytes through the actual root`,
		async () => {
			const page = await open(),
				value = await sample(page, size)
			expect(await initialize(page, value)).toBe('initialized')
			expect((await run(page, value, 'new')).outcome).toBe('prepared')
			const result = await attachment(page, value, true)
			expect(result.output.outcome).toBe('batchWritten')
			const actual = await page.evaluate(async (id) => {
				const api = window.DLFRestoreQualification
				const row = await api.db.one(
					api.notebookRestoreApp.restoreAttachments.where({ destinationId: id }),
					{ tier: 'remote' }
				)
				if (!row) throw new Error('Missing actual attachment')
				return {
					size: row.contents.byteLength,
					exact: row.contents.every((byte, index) => byte === index % 251)
				}
			}, value.binding.workspaceId)
			expect(actual).toEqual({ size, exact: true })
			expect(result.rows[0]?.fileName).toBe('Cafe\u0301 ☕.bin')
			expect(result.destination?.status).toBe('incomplete')
			await deleteJournal(page, value)
		},
		size === 0 ? 30000 : 90000
	)
}
it('rejects conflicting actual bytes despite a matching declared digest without overwriting or replay', async () => {
	const page = await open(),
		value = await sample(page)
	expect(await initialize(page, value)).toBe('initialized')
	const prepared = await run(page, value, 'new')
	const mapping = prepared.record?.intent.plan.mappings.find(
		(mapping) => mapping.kind === 'attachment'
	)
	if (!mapping) throw new Error('Missing attachment mapping')
	await page.evaluate(
		async ({ value, id }) => {
			const api = window.DLFRestoreQualification
			const tx = api.db.beginTransaction()
			tx.insert(
				api.notebookRestoreApp.restoreAttachments,
				{
					destinationId: value.binding.workspaceId,
					ownerId: api.ownerId,
					operationId: value.binding.operationId,
					mediaType: 'application/octet-stream',
					fileName: 'bytes.bin',
					sizeBytes: 4,
					sha256: '6d6f7836f1e146dc0204afb5133dae52fdc05603d8ac2dc793b481b0e0829fd1',
					contents: new Uint8Array([0, 255, 128, 11])
				},
				{ id }
			)
			const write = tx.commit()
			await write.wait({ tier: 'global' })
		},
		{ value, id: mapping.destinationId }
	)
	const result = await attachment(page, value)
	expect(result.output.outcome).toBe('conflict')
	expect(result.issued).toBe(2)
	expect(result.rows[0]?.contents).toEqual([0, 255, 128, 11])
	expect(result.output.record).toEqual(prepared.record)
	await deleteJournal(page, value)
})

it('reconciles an uncertain attachment after reload using fresh bytes while preserving its original attempt', async () => {
	const page = await open(),
		value = await sample(page)
	await initialize(page, value)
	expect((await run(page, value, 'new')).outcome).toBe('prepared')
	await page.evaluate(async (value) => {
		const api = window.DLFRestoreQualification
		const open = api.prepareArchiveOpen(new Uint8Array(value.file))
		const envelope = api
			.createActor(api.createArchiveEnvelopeMachine(), { input: { request: open } })
			.start()
		const checked = await api.toPromise(envelope)
		if (checked.outcome !== 'integrityChecked') throw new Error('Invalid fixture')
		const request = api.prepareNotebookAttachmentRestore({ ...value, archive: checked.archive })
		const writer = api.createNotebookAttachmentWriter(api.db, request, () => {})
		const machine = api.createNotebookRestoreAttachmentMachine({
			...writer,
			acceptRemote: () => new Promise(() => {})
		})
		api.attachmentPending.actor = api.createActor(machine, { input: { request } }).start()
		api.attachmentPending.cleanup = () => {
			request.release()
			open.release()
			envelope.stop()
		}
	}, value)
	await expect
		.poll(async () => (await discover(page, value)).record?.checkpoint)
		.toMatchObject({
			completed: [{ writeId: 'prepare' }],
			current: { settlement: { local: 'persisted', remote: 'unobserved' } }
		})
	await expect
		.poll(() =>
			page.evaluate(async (id) => {
				const api = window.DLFRestoreQualification
				return (
					await api.db.all(api.notebookRestoreApp.restoreAttachments.where({ destinationId: id }), {
						tier: 'remote'
					})
				).length
			}, value.binding.workspaceId)
		)
		.toBe(1)
	const interrupted = await page.evaluate(async () => {
		const api = window.DLFRestoreQualification,
			actor = api.attachmentPending.actor
		if (!actor) throw new Error('Missing attachment actor')
		actor.send({ type: 'CANCEL' })
		const output = await api.toPromise(actor)
		api.attachmentPending.cleanup?.()
		actor.stop()
		return output
	})
	expect(interrupted.outcome).toBe('cancelled')
	const previous = interrupted.record?.checkpoint
	if (!previous || previous.kind !== 'writing' || previous.current.status !== 'issued')
		throw new Error('Expected uncertain write')
	await page.reload()
	await page.waitForFunction(() => Boolean(window.DLFRestoreQualification))
	const recovered = await attachment(page, value)
	expect(recovered.output.outcome).toBe('batchWritten')
	expect(recovered.issued).toBe(0)
	const checkpoint = recovered.output.record?.checkpoint
	if (!checkpoint || checkpoint.kind !== 'writing') throw new Error('Expected retained progress')
	expect(checkpoint.completed[1]).toMatchObject({
		basis: 'remoteContentMatch',
		attempt: {
			transactionId: previous.current.transactionId,
			issuance: previous.current.issuance,
			settlement: previous.current.settlement
		}
	})
	expect(recovered.rows[0]?.contents).toEqual([0, 255, 128, 10])
	await deleteJournal(page, value)
})

async function notebook(page: Page, value: Sample) {
	return page.evaluate(async (value) => {
		const api = window.DLFRestoreQualification
		const request = api.prepareArchiveOpen(new Uint8Array(value.file))
		const envelope = api
			.createActor(api.createArchiveEnvelopeMachine(), { input: { request } })
			.start()
		const checked = await api.toPromise(envelope)
		if (checked.outcome !== 'integrityChecked') throw new Error('Invalid fixture')
		const restore = api.createNotebookRootRestore({
			db: api.db,
			retainDetached: () => {},
			...value,
			archive: checked.archive
		})
		restore.actor.start()
		const output = await api.toPromise(restore.actor)
		restore.request.release()
		restore.actor.stop()
		request.release()
		envelope.stop()
		const rows = await api.db.all(
			api.notebookRestoreApp.restoreNotebooks.where({ destinationId: value.binding.workspaceId }),
			{ tier: 'remote' }
		)
		const destination = await api.db.one(
			api.notebookRestoreApp.restoreDestinations.where({ id: value.binding.workspaceId }),
			{ tier: 'remote' }
		)
		return { output, rows, destination, issued: api.issued() }
	}, value)
}
async function preparedNotebook(page: Page, value: Sample) {
	expect(await initialize(page, value)).toBe('initialized')
	expect((await run(page, value, 'new')).outcome).toBe('prepared')
	const written = await attachment(page, value)
	expect(written.output.outcome).toBe('batchWritten')
	return written.output.record
}
for (const title of ['Notebook fixture', '', 'Cafe\u0301 ☕\nSecond line\r\n\u0000']) {
	it(`preserves notebook title ${JSON.stringify(title)}, mapped identity and prefix across reload without replay`, async () => {
		const page = await open(),
			value = await sample(page, undefined, title)
		const before = await preparedNotebook(page, value)
		const result = await notebook(page, value)
		expect(result.output.outcome).toBe('batchWritten')
		expect(result.issued).toBe(3)
		expect(result.destination?.status).toBe('incomplete')
		const mapping = before?.intent.plan.mappings.find(
			(entry) => entry.kind === 'record' && entry.type === 'notebook'
		)
		expect(result.rows).toEqual([
			expect.objectContaining({
				id: mapping?.destinationId,
				destinationId: value.binding.workspaceId,
				ownerId: value.binding.identityId,
				operationId: value.binding.operationId,
				title
			})
		])
		const prior = before?.checkpoint,
			after = result.output.record?.checkpoint
		if (!prior || prior.kind !== 'writing' || !after || after.kind !== 'writing')
			throw new Error('Expected writing prefix')
		expect(after.completed).toHaveLength(3)
		expect(after.completed.slice(0, 2)).toEqual(prior.completed)
		expect(result.output.record?.intent).toEqual(before?.intent)
		expect(after.current).toMatchObject({ status: 'notIssued' })
		await page.reload()
		await page.waitForFunction(() => Boolean(window.DLFRestoreQualification))
		const resumed = await notebook(page, value)
		expect(resumed.output.outcome).toBe('noNotebookStep')
		expect(resumed.issued).toBe(0)
		expect(resumed.rows).toEqual(result.rows)
		expect(resumed.output.record).toEqual(result.output.record)
		await deleteJournal(page, value)
	})
}
it('does not skip missing preparation or pending attachments, or replace intent for another checked file', async () => {
	const page = await open(),
		value = await sample(page)
	expect((await notebook(page, value)).issued).toBe(0)
	await initialize(page, value)
	expect((await notebook(page, value)).output.outcome).toBe('unavailable')
	expect((await run(page, value, 'new')).outcome).toBe('prepared')
	const before = await discover(page, value)
	const blocked = await notebook(page, value)
	expect(blocked.output.outcome).toBe('noNotebookStep')
	expect(blocked.issued).toBe(1)
	expect(blocked.rows).toEqual([])
	expect(blocked.output.record).toEqual(before.record)
	const other = await sample(page, undefined, 'Other notebook')
	const wrongFile = await notebook(page, { ...value, file: other.file })
	expect(wrongFile.output.outcome).toBe('conflict')
	expect(wrongFile.issued).toBe(1)
	expect((await discover(page, value)).record).toEqual(before.record)
	await deleteJournal(page, value)
})
it('detects a conflicting actual notebook title without overwriting or advancing the journal', async () => {
	const page = await open(),
		value = await sample(page)
	const before = await preparedNotebook(page, value)
	const mapping = before?.intent.plan.mappings.find(
		(entry) => entry.kind === 'record' && entry.type === 'notebook'
	)
	if (!mapping) throw new Error('Missing notebook mapping')
	await page.evaluate(
		async ({ value, id }) => {
			const api = window.DLFRestoreQualification
			await api.db
				.insert(
					api.notebookRestoreApp.restoreNotebooks,
					{
						destinationId: value.binding.workspaceId,
						ownerId: api.ownerId,
						operationId: value.binding.operationId,
						title: 'Conflicting title'
					},
					{ id }
				)
				.wait({ tier: 'global' })
		},
		{ value, id: mapping.destinationId }
	)
	const result = await notebook(page, value)
	expect(result.output.outcome).toBe('conflict')
	expect(result.issued).toBe(2)
	expect(result.rows[0]?.title).toBe('Conflicting title')
	expect(result.output.record).toEqual(before)
	await deleteJournal(page, value)
})
it('recovers uncertain notebook content after reload without fabricating acceptance or issuing another write', async () => {
	const page = await open(),
		value = await sample(page)
	await preparedNotebook(page, value)
	await page.evaluate(async (value) => {
		const api = window.DLFRestoreQualification
		const open = api.prepareArchiveOpen(new Uint8Array(value.file))
		const envelope = api
			.createActor(api.createArchiveEnvelopeMachine(), { input: { request: open } })
			.start()
		const checked = await api.toPromise(envelope)
		if (checked.outcome !== 'integrityChecked') throw new Error('Invalid fixture')
		const request = api.prepareNotebookRootRestore({ ...value, archive: checked.archive })
		const writer = api.createNotebookRootWriter(api.db, request, () => {})
		const machine = api.createNotebookRestoreRootMachine({
			...writer,
			acceptRemote: () => new Promise(() => {})
		})
		api.rootPending.actor = api.createActor(machine, { input: { request } }).start()
		api.rootPending.cleanup = () => {
			request.release()
			open.release()
			envelope.stop()
		}
	}, value)
	await expect
		.poll(async () => (await discover(page, value)).record?.checkpoint)
		.toMatchObject({ current: { settlement: { local: 'persisted', remote: 'unobserved' } } })
	await expect
		.poll(() =>
			page.evaluate(async (id) => {
				const api = window.DLFRestoreQualification
				return (
					await api.db.all(api.notebookRestoreApp.restoreNotebooks.where({ destinationId: id }), {
						tier: 'remote'
					})
				).length
			}, value.binding.workspaceId)
		)
		.toBe(1)
	const interrupted = await page.evaluate(async () => {
		const api = window.DLFRestoreQualification,
			actor = api.rootPending.actor
		if (!actor) throw new Error('Missing notebook actor')
		actor.send({ type: 'CANCEL' })
		const output = await api.toPromise(actor)
		api.rootPending.cleanup?.()
		actor.stop()
		return output
	})
	expect(interrupted.outcome).toBe('cancelled')
	const prior = interrupted.record?.checkpoint
	if (!prior || prior.kind !== 'writing' || prior.current.status !== 'issued')
		throw new Error('Expected uncertain attempt')
	await page.reload()
	await page.waitForFunction(() => Boolean(window.DLFRestoreQualification))
	const result = await notebook(page, value)
	expect(result.output.outcome).toBe('batchWritten')
	expect(result.issued).toBe(0)
	const after = result.output.record?.checkpoint
	if (!after || after.kind !== 'writing') throw new Error('Expected progress')
	expect(after.completed.slice(0, 2)).toEqual(prior.completed)
	expect(after.completed[2]).toMatchObject({
		basis: 'remoteContentMatch',
		localPersistence: 'persisted',
		attempt: {
			issuance: prior.current.issuance,
			transactionId: prior.current.transactionId,
			settlement: prior.current.settlement
		}
	})
	expect(result.rows[0]?.title).toBe('Notebook fixture')
	await deleteJournal(page, value)
})

for (const interruption of ['CANCEL', 'INVALIDATE']) {
	it(`drains staged notebook insertion on ${interruption} and rolls back before committing`, async () => {
		const page = await open(),
			value = await sample(page)
		const before = await preparedNotebook(page, value)
		await page.evaluate(async (value) => {
			const api = window.DLFRestoreQualification
			const open = api.prepareArchiveOpen(new Uint8Array(value.file))
			const envelope = api
				.createActor(api.createArchiveEnvelopeMachine(), { input: { request: open } })
				.start()
			const checked = await api.toPromise(envelope)
			if (checked.outcome !== 'integrityChecked') throw new Error('Invalid fixture')
			const request = api.prepareNotebookRootRestore({ ...value, archive: checked.archive })
			const writer = api.createNotebookRootWriter(api.db, request, () => {})
			const gate = new Promise<void>((resolve) => {
				api.rootPending.releaseStage = resolve
			})
			const machine = api.createNotebookRestoreRootMachine({
				...writer,
				stage: async (...args) => {
					await writer.stage(...args)
					api.rootPending.staged = true
					await gate
				}
			})
			api.rootPending.actor = api.createActor(machine, { input: { request } }).start()
			api.rootPending.cleanup = () => {
				request.release()
				open.release()
				envelope.stop()
			}
		}, value)
		await page.waitForFunction(() => window.DLFRestoreQualification.rootPending.staged)
		const result = await page.evaluate(
			async ({ value, interruption }) => {
				const api = window.DLFRestoreQualification,
					actor = api.rootPending.actor
				if (!actor) throw new Error('Missing notebook actor')
				actor.send({
					type: 'INVALIDATE',
					binding: { ...value.binding, generation: value.binding.generation + 1 }
				})
				if (actor.getSnapshot().status !== 'active')
					throw new Error('Stale binding terminated actor')
				actor.send(
					interruption === 'CANCEL'
						? { type: 'CANCEL' }
						: { type: 'INVALIDATE', binding: value.binding }
				)
				const beforeDrain = actor.getSnapshot().status
				api.rootPending.releaseStage?.()
				const output = await api.toPromise(actor)
				api.rootPending.cleanup?.()
				actor.stop()
				const rows = await api.db.all(
					api.notebookRestoreApp.restoreNotebooks.where({
						destinationId: value.binding.workspaceId
					}),
					{ tier: 'remote' }
				)
				return { output, beforeDrain, rows, issued: api.issued() }
			},
			{ value, interruption }
		)
		expect(result.beforeDrain).toBe('active')
		expect(result.output.outcome).toBe(interruption === 'CANCEL' ? 'cancelled' : 'invalidated')
		expect(result.issued).toBe(2)
		expect(result.rows).toEqual([])
		const checkpoint = result.output.record?.checkpoint,
			prior = before?.checkpoint
		if (!checkpoint || checkpoint.kind !== 'writing' || !prior || prior.kind !== 'writing')
			throw new Error('Expected prefix')
		expect(checkpoint.completed).toEqual(prior.completed)
		expect(checkpoint.current).toMatchObject({
			status: 'issued',
			settlement: { local: 'unobserved', remote: 'unobserved' }
		})
		const resumed = await notebook(page, value)
		expect(resumed.output.outcome).toBe('incomplete')
		expect(resumed.issued).toBe(2)
		expect(resumed.output.record).toEqual(result.output.record)
		await deleteJournal(page, value)
	})
}
it('enforces notebook owner/control scope and immutable rows at the actual server boundary', async () => {
	const page = await open(),
		value = await sample(page)
	await preparedNotebook(page, value)
	const result = await notebook(page, value)
	expect(result.output.outcome).toBe('batchWritten')
	const row = result.rows[0]
	if (!row) throw new Error('Missing notebook row')
	const denied = await page.evaluate(
		async ({ row, value }) => {
			const api = window.DLFRestoreQualification
			async function denial(effect: () => PromiseLike<unknown>) {
				try {
					await effect()
					return 'accepted'
				} catch (error) {
					if (
						error instanceof api.PersistedWriteRejectedError &&
						error.code === 'permission_denied'
					)
						return 'permission_denied'
					throw error
				}
			}
			const update = await denial(() =>
				api.db
					.update(api.notebookRestoreApp.restoreNotebooks, row.id, { title: 'Changed' })
					.wait({ tier: 'global' })
			)
			const deletion = await denial(() =>
				api.db.delete(api.notebookRestoreApp.restoreNotebooks, row.id).wait({ tier: 'global' })
			)
			const wrongOperation = await denial(() =>
				api.db
					.insert(
						api.notebookRestoreApp.restoreNotebooks,
						{
							destinationId: row.destinationId,
							ownerId: api.ownerId,
							operationId: crypto.randomUUID(),
							title: 'Forged operation'
						},
						{ id: crypto.randomUUID() }
					)
					.wait({ tier: 'global' })
			)
			const missingControl = await denial(() =>
				api.db
					.insert(
						api.notebookRestoreApp.restoreNotebooks,
						{
							destinationId: crypto.randomUUID(),
							ownerId: api.ownerId,
							operationId: value.binding.operationId,
							title: 'No control'
						},
						{ id: crypto.randomUUID() }
					)
					.wait({ tier: 'global' })
			)
			const fresh = await api.db.one(
				api.notebookRestoreApp.restoreNotebooks.where({ id: row.id }),
				{ tier: 'remote' }
			)
			return { update, deletion, wrongOperation, missingControl, fresh }
		},
		{ row, value }
	)
	expect(denied).toMatchObject({
		update: 'permission_denied',
		deletion: 'permission_denied',
		wrongOperation: 'permission_denied',
		missingControl: 'permission_denied',
		fresh: row
	})
	const foreign = await open()
	const foreignResult = await foreign.evaluate(async (row) => {
		const api = window.DLFRestoreQualification
		const observed = await api.db.one(
			api.notebookRestoreApp.restoreNotebooks.where({ id: row.id }),
			{ tier: 'remote' }
		)
		try {
			await api.db
				.insert(
					api.notebookRestoreApp.restoreNotebooks,
					{
						destinationId: row.destinationId,
						ownerId: row.ownerId,
						operationId: row.operationId,
						title: 'Forged owner'
					},
					{ id: crypto.randomUUID() }
				)
				.wait({ tier: 'global' })
			return { observed, outcome: 'accepted' }
		} catch (error) {
			if (error instanceof api.PersistedWriteRejectedError && error.code === 'permission_denied')
				return { observed, outcome: 'permission_denied' }
			throw error
		}
	}, row)
	expect(foreignResult).toEqual({ observed: null, outcome: 'permission_denied' })
	await foreign.context().close()
	await deleteJournal(page, value)
})

async function note(page: Page, value: Sample) {
	return page.evaluate(async (value) => {
		const api = window.DLFRestoreQualification
		const request = api.prepareArchiveOpen(new Uint8Array(value.file))
		const envelope = api
			.createActor(api.createArchiveEnvelopeMachine(), { input: { request } })
			.start()
		const checked = await api.toPromise(envelope)
		if (checked.outcome !== 'integrityChecked') throw new Error('Invalid fixture')
		const restore = api.createNotebookNoteRestore({
			db: api.db,
			retainDetached: () => {},
			...value,
			archive: checked.archive
		})
		restore.actor.start()
		const output = await api.toPromise(restore.actor)
		restore.request.release()
		restore.actor.stop()
		request.release()
		envelope.stop()
		const rows = await api.db.all(
			api.notebookRestoreApp.restoreNotes.where({ destinationId: value.binding.workspaceId }),
			{ tier: 'remote' }
		)
		const destination = await api.db.one(
			api.notebookRestoreApp.restoreDestinations.where({ id: value.binding.workspaceId }),
			{ tier: 'remote' }
		)
		return { output, rows, destination, issued: api.issued() }
	}, value)
}
async function preparedNotes(page: Page, value: Sample) {
	await preparedNotebook(page, value)
	const root = await notebook(page, value)
	expect(root.output.outcome).toBe('batchWritten')
	return root.output.record
}
it('writes one mapped note at a time with exact bodies, archived flags, shared/null relationships and retained receipts through comparing', async () => {
	const page = await open(),
		value = await sample(page)
	const initial = await preparedNotes(page, value)
	if (!initial) throw new Error('Missing journal')
	const notebookId = initial.intent.plan.mappings.find(
		(entry) => entry.kind === 'record' && entry.type === 'notebook'
	)?.destinationId
	const attachmentId = initial.intent.plan.mappings.find(
		(entry) => entry.kind === 'attachment'
	)?.destinationId
	let previous = initial
	for (const [index, source] of [
		{
			id: 'archived',
			body: 'Preserve archived content\u0000exactly.',
			archived: true,
			attachmentId
		},
		{ id: 'empty', body: '', archived: false, attachmentId: null },
		{ id: 'first', body: 'First line\nSecond line\r\nCafe\u0301 ☕', archived: false, attachmentId }
	].entries()) {
		const result = await note(page, value)
		expect(result.output.outcome).toBe('batchWritten')
		expect(result.issued).toBe(4 + index)
		expect(result.rows).toHaveLength(index + 1)
		const mapping = initial.intent.plan.mappings.find(
			(entry) => entry.kind === 'record' && entry.type === 'note' && entry.sourceId === source.id
		)
		expect(result.rows.find((row) => row.id === mapping?.destinationId)).toMatchObject({
			notebookId,
			attachmentId: source.attachmentId,
			body: source.body,
			archived: source.archived,
			destinationId: value.binding.workspaceId,
			ownerId: value.binding.identityId,
			operationId: value.binding.operationId
		})
		const after = result.output.record?.checkpoint,
			prior = previous.checkpoint
		if (!after || after.kind === 'conflict' || prior.kind === 'conflict' || !result.output.record)
			throw new Error('Expected progress')
		expect(after.completed.slice(0, prior.completed.length)).toEqual(prior.completed)
		expect(after.completed).toHaveLength(prior.completed.length + 1)
		expect(after.kind).toBe(index === 2 ? 'comparing' : 'writing')
		expect(result.output.record.intent).toEqual(initial.intent)
		expect(result.destination?.status).toBe('incomplete')
		previous = result.output.record
	}
	await page.reload()
	await page.waitForFunction(() => Boolean(window.DLFRestoreQualification))
	const resumed = await note(page, value)
	expect(resumed.output.outcome).toBe('noNoteStep')
	expect(resumed.issued).toBe(0)
	expect(resumed.rows).toHaveLength(3)
	expect(resumed.output.record).toEqual(previous)
	expect(resumed.destination?.status).toBe('incomplete')
	await deleteJournal(page, value)
})
it('does not skip pending notebook preparation or accept another archive for a note step', async () => {
	const page = await open(),
		value = await sample(page)
	expect((await note(page, value)).issued).toBe(0)
	await preparedNotebook(page, value)
	const before = await discover(page, value)
	const blocked = await note(page, value)
	expect(blocked.output.outcome).toBe('noNoteStep')
	expect(blocked.issued).toBe(2)
	expect(blocked.output.record).toEqual(before.record)
	expect(blocked.rows).toEqual([])
	expect((await notebook(page, value)).output.outcome).toBe('batchWritten')
	const original = await discover(page, value)
	const other = await sample(page)
	const wrong = await note(page, { ...value, file: other.file })
	expect(wrong.output.outcome).toBe('conflict')
	expect(wrong.issued).toBe(3)
	expect((await discover(page, value)).record).toEqual(original.record)
	await deleteJournal(page, value)
})
for (const mismatch of ['body', 'attachment']) {
	it(`rejects conflicting note ${mismatch} without overwriting or advancing the journal`, async () => {
		const page = await open(),
			value = await sample(page)
		const before = await preparedNotes(page, value)
		if (!before) throw new Error('Missing journal')
		const mappings = before.intent.plan.mappings
		const id = mappings.find(
			(entry) => entry.kind === 'record' && entry.type === 'note' && entry.sourceId === 'archived'
		)?.destinationId
		const notebookId = mappings.find(
			(entry) => entry.kind === 'record' && entry.type === 'notebook'
		)?.destinationId
		const attachmentId = mappings.find((entry) => entry.kind === 'attachment')?.destinationId
		if (!id || !notebookId || !attachmentId) throw new Error('Missing mappings')
		await page.evaluate(
			async ({ value, id, notebookId, attachmentId, mismatch }) => {
				const api = window.DLFRestoreQualification
				await api.db
					.insert(
						api.notebookRestoreApp.restoreNotes,
						{
							destinationId: value.binding.workspaceId,
							ownerId: api.ownerId,
							operationId: value.binding.operationId,
							notebookId,
							attachmentId: mismatch === 'attachment' ? null : attachmentId,
							body:
								mismatch === 'body'
									? 'Conflicting body'
									: 'Preserve archived content\u0000exactly.',
							archived: true
						},
						{ id }
					)
					.wait({ tier: 'global' })
			},
			{ value, id, notebookId, attachmentId, mismatch }
		)
		const result = await note(page, value)
		expect(result.output.outcome).toBe('conflict')
		expect(result.issued).toBe(3)
		expect(result.output.record).toEqual(before)
		expect(result.rows).toHaveLength(1)
		expect(result.rows[0]?.body).toBe(
			mismatch === 'body' ? 'Conflicting body' : 'Preserve archived content\u0000exactly.'
		)
		await deleteJournal(page, value)
	})
}
it('reconciles an uncertain note after reload using actual fields and relationship IDs while preserving its attempt', async () => {
	const page = await open(),
		value = await sample(page)
	const before = await preparedNotes(page, value)
	await page.evaluate(async (value) => {
		const api = window.DLFRestoreQualification
		const open = api.prepareArchiveOpen(new Uint8Array(value.file))
		const envelope = api
			.createActor(api.createArchiveEnvelopeMachine(), { input: { request: open } })
			.start()
		const checked = await api.toPromise(envelope)
		if (checked.outcome !== 'integrityChecked') throw new Error('Invalid fixture')
		const request = api.prepareNotebookNoteRestore({ ...value, archive: checked.archive })
		const writer = api.createNotebookNoteWriter(api.db, request, () => {})
		api.notePending.actor = api
			.createActor(
				api.createNotebookRestoreNoteMachine({
					...writer,
					acceptRemote: () => new Promise(() => {})
				}),
				{ input: { request } }
			)
			.start()
		api.notePending.cleanup = () => {
			request.release()
			open.release()
			envelope.stop()
		}
	}, value)
	await expect
		.poll(async () => (await discover(page, value)).record?.checkpoint)
		.toMatchObject({ current: { settlement: { local: 'persisted', remote: 'unobserved' } } })
	await expect
		.poll(() =>
			page.evaluate(async (id) => {
				const api = window.DLFRestoreQualification
				return (
					await api.db.all(api.notebookRestoreApp.restoreNotes.where({ destinationId: id }), {
						tier: 'remote'
					})
				).length
			}, value.binding.workspaceId)
		)
		.toBe(1)
	const interrupted = await page.evaluate(async () => {
		const api = window.DLFRestoreQualification,
			actor = api.notePending.actor
		if (!actor) throw new Error('Missing note actor')
		actor.send({ type: 'CANCEL' })
		const output = await api.toPromise(actor)
		api.notePending.cleanup?.()
		actor.stop()
		return output
	})
	expect(interrupted.outcome).toBe('cancelled')
	const prior = interrupted.record?.checkpoint
	if (!prior || prior.kind !== 'writing' || prior.current.status !== 'issued')
		throw new Error('Expected uncertain note')
	await page.reload()
	await page.waitForFunction(() => Boolean(window.DLFRestoreQualification))
	const result = await note(page, value)
	expect(result.output.outcome).toBe('batchWritten')
	expect(result.issued).toBe(0)
	const after = result.output.record?.checkpoint
	if (!after || after.kind !== 'writing' || !before || before.checkpoint.kind !== 'writing')
		throw new Error('Expected prefix')
	expect(after.completed.slice(0, 3)).toEqual(before.checkpoint.completed)
	expect(after.completed[3]).toMatchObject({
		basis: 'remoteContentMatch',
		localPersistence: 'persisted',
		attempt: {
			issuance: prior.current.issuance,
			transactionId: prior.current.transactionId,
			settlement: prior.current.settlement
		}
	})
	expect(result.rows[0]?.body).toBe('Preserve archived content\u0000exactly.')
	await deleteJournal(page, value)
})

for (const interruption of ['CANCEL', 'INVALIDATE']) {
	it(`drains note staging and rolls back on ${interruption} without automatically replaying`, async () => {
		const page = await open(),
			value = await sample(page)
		const before = await preparedNotes(page, value)
		await page.evaluate(async (value) => {
			const api = window.DLFRestoreQualification
			const open = api.prepareArchiveOpen(new Uint8Array(value.file))
			const envelope = api
				.createActor(api.createArchiveEnvelopeMachine(), { input: { request: open } })
				.start()
			const checked = await api.toPromise(envelope)
			if (checked.outcome !== 'integrityChecked') throw new Error('Invalid fixture')
			const request = api.prepareNotebookNoteRestore({ ...value, archive: checked.archive })
			const writer = api.createNotebookNoteWriter(api.db, request, () => {})
			const gate = new Promise<void>((resolve) => {
				api.notePending.releaseStage = resolve
			})
			api.notePending.actor = api
				.createActor(
					api.createNotebookRestoreNoteMachine({
						...writer,
						stage: async (...args) => {
							await writer.stage(...args)
							api.notePending.staged = true
							await gate
						}
					}),
					{ input: { request } }
				)
				.start()
			api.notePending.cleanup = () => {
				request.release()
				open.release()
				envelope.stop()
			}
		}, value)
		await page.waitForFunction(() => window.DLFRestoreQualification.notePending.staged)
		const result = await page.evaluate(
			async ({ value, interruption }) => {
				const api = window.DLFRestoreQualification,
					actor = api.notePending.actor
				if (!actor) throw new Error('Missing note actor')
				actor.send({
					type: 'INVALIDATE',
					binding: { ...value.binding, generation: value.binding.generation + 1 }
				})
				if (actor.getSnapshot().status !== 'active')
					throw new Error('Mismatched binding terminated note actor')
				actor.send(
					interruption === 'CANCEL'
						? { type: 'CANCEL' }
						: { type: 'INVALIDATE', binding: value.binding }
				)
				const beforeDrain = actor.getSnapshot().status
				api.notePending.releaseStage?.()
				const output = await api.toPromise(actor)
				api.notePending.cleanup?.()
				actor.stop()
				const rows = await api.db.all(
					api.notebookRestoreApp.restoreNotes.where({ destinationId: value.binding.workspaceId }),
					{ tier: 'remote' }
				)
				return { output, beforeDrain, rows, issued: api.issued() }
			},
			{ value, interruption }
		)
		expect(result.beforeDrain).toBe('active')
		expect(result.output.outcome).toBe(interruption === 'CANCEL' ? 'cancelled' : 'invalidated')
		expect(result.issued).toBe(3)
		expect(result.rows).toEqual([])
		const after = result.output.record?.checkpoint
		if (!after || after.kind !== 'writing' || !before || before.checkpoint.kind !== 'writing')
			throw new Error('Expected prefix')
		expect(after.completed).toEqual(before.checkpoint.completed)
		expect(after.current).toMatchObject({
			status: 'issued',
			settlement: { local: 'unobserved', remote: 'unobserved' }
		})
		const resumed = await note(page, value)
		expect(resumed.output.outcome).toBe('incomplete')
		expect(resumed.issued).toBe(3)
		expect(resumed.output.record).toEqual(result.output.record)
		await deleteJournal(page, value)
	})
}
it('enforces note relationship scope, owner-only reads and immutable rows at the actual server boundary', async () => {
	const page = await open(),
		value = await sample(page)
	await preparedNotes(page, value)
	const original = await note(page, value)
	expect(original.output.outcome).toBe('batchWritten')
	const row = original.rows[0]
	if (!row) throw new Error('Missing restored note')
	const other = await sample(page)
	const otherRecord = await preparedNotes(page, other)
	const otherNotebook = otherRecord?.intent.plan.mappings.find(
		(entry) => entry.kind === 'record' && entry.type === 'notebook'
	)?.destinationId
	const otherAttachment = otherRecord?.intent.plan.mappings.find(
		(entry) => entry.kind === 'attachment'
	)?.destinationId
	if (!otherNotebook || !otherAttachment) throw new Error('Missing other destination mappings')
	const denied = await page.evaluate(
		async ({ row, otherNotebook, otherAttachment }) => {
			const api = window.DLFRestoreQualification
			async function denial(effect: () => PromiseLike<unknown>) {
				try {
					await effect()
					return 'accepted'
				} catch (error) {
					if (
						error instanceof api.PersistedWriteRejectedError &&
						error.code === 'permission_denied'
					)
						return 'permission_denied'
					throw error
				}
			}
			const base = {
				destinationId: row.destinationId,
				ownerId: row.ownerId,
				operationId: row.operationId,
				notebookId: row.notebookId,
				attachmentId: row.attachmentId,
				body: 'Policy fixture',
				archived: false
			}
			const outcomes: string[] = []
			for (const fields of [
				{ ...base, notebookId: otherNotebook },
				{ ...base, attachmentId: otherAttachment },
				{ ...base, notebookId: crypto.randomUUID() },
				{ ...base, attachmentId: crypto.randomUUID() },
				{ ...base, operationId: crypto.randomUUID() },
				{ ...base, ownerId: crypto.randomUUID() }
			])
				outcomes.push(
					await denial(() =>
						api.db
							.insert(api.notebookRestoreApp.restoreNotes, fields, { id: crypto.randomUUID() })
							.wait({ tier: 'global' })
					)
				)
			outcomes.push(
				await denial(() =>
					api.db
						.update(api.notebookRestoreApp.restoreNotes, row.id, { body: 'Changed' })
						.wait({ tier: 'global' })
				)
			)
			outcomes.push(
				await denial(() =>
					api.db.delete(api.notebookRestoreApp.restoreNotes, row.id).wait({ tier: 'global' })
				)
			)
			const fresh = await api.db.one(api.notebookRestoreApp.restoreNotes.where({ id: row.id }), {
				tier: 'remote'
			})
			return { outcomes, fresh }
		},
		{ row, otherNotebook, otherAttachment }
	)
	expect(denied.outcomes).toEqual(Array.from({ length: 8 }, () => 'permission_denied'))
	expect(denied.fresh).toEqual(row)
	const foreign = await open()
	const foreignResult = await foreign.evaluate(async (row) => {
		const api = window.DLFRestoreQualification
		const observed = await api.db.one(api.notebookRestoreApp.restoreNotes.where({ id: row.id }), {
			tier: 'remote'
		})
		try {
			await api.db
				.insert(
					api.notebookRestoreApp.restoreNotes,
					{
						destinationId: row.destinationId,
						ownerId: row.ownerId,
						operationId: row.operationId,
						notebookId: row.notebookId,
						attachmentId: row.attachmentId,
						body: 'Forged owner',
						archived: false
					},
					{ id: crypto.randomUUID() }
				)
				.wait({ tier: 'global' })
			return { observed, outcome: 'accepted' }
		} catch (error) {
			if (error instanceof api.PersistedWriteRejectedError && error.code === 'permission_denied')
				return { observed, outcome: 'permission_denied' }
			throw error
		}
	}, row)
	expect(foreignResult).toEqual({ observed: null, outcome: 'permission_denied' })
	await foreign.context().close()
	await deleteJournal(page, value)
	await deleteJournal(page, other)
})
