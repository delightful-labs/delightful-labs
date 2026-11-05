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
async function sample(page: Page, size?: number) {
	return page.evaluate(async (size) => {
		const api = window.DLFRestoreQualification
		const binding = {
			applicationId: 'notebook-qualification',
			environment: 'disposable',
			identityId: api.ownerId,
			workspaceId: crypto.randomUUID(),
			operationId: crypto.randomUUID(),
			generation: 1
		}
		const payload = api.createNotebookDataset({
			applicationId: 'notebook-source',
			workspaceId: 'original'
		})
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
	}, size)
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
			const actor = api.createActor(
				api.createNotebookRestorePreparationMachine(api.writer, api.preparationDestination),
				{
					input: { request },
					inspect(event) {
						if (event.type === '@xstate.event' && event.event.type.startsWith('xstate.error'))
							trace.push(String(event.event.error))
					}
				}
			)
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
		api.machine = api.createNotebookRestorePreparationMachine(
			api.writer,
			api.preparationDestination.provide({
				actors: {
					write: api.preparationWrite.provide({
						actors: {
							observeIdentity: api.fromCallback(({ input, sendBack }) => {
								api.pending.releaseAuthority = () =>
									sendBack({
										type: 'IDENTITY_OBSERVED',
										binding: input.binding,
										identityId: input.intent.operation.identityId
									})
							})
						}
					})
				}
			})
		)
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
		const request = api.prepareNotebookRestore({
			mode: 'resume',
			...value,
			archive: checked.archive
		})
		const destination = api.createNotebookAttachmentWriter(api.db, request)
		const writer = api.createNotebookTransactionWriter(api.db, () => {})
		const machine = api.createNotebookRestoreAttachmentMachine(
			{
				...writer,
				acceptRemote: () => new Promise(() => {})
			},
			destination
		)
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

it('rejects a second claim without clearing the first restore actor’s resources', async () => {
	const page = await open(),
		value = await sample(page)
	expect(await initialize(page, value)).toBe('initialized')
	const result = await page.evaluate(async (value) => {
		const api = window.DLFRestoreQualification
		const open = api.prepareArchiveOpen(new Uint8Array(value.file))
		const envelope = api
			.createActor(api.createArchiveEnvelopeMachine(), { input: { request: open } })
			.start()
		const checked = await api.toPromise(envelope)
		if (checked.outcome !== 'integrityChecked') throw new Error('Invalid fixture')
		const request = api.prepareNotebookRestore({ ...value, mode: 'new', archive: checked.archive })
		let release: () => void = () => {
			throw new Error('Missing authority gate')
		}
		let reportEntered: () => void = () => {
			throw new Error('Missing entry observation')
		}
		const gate = new Promise<void>((resolve) => {
			release = resolve
		})
		const entered = new Promise<void>((resolve) => {
			reportEntered = resolve
		})
		const destinationLogic = api.preparationDestination.provide({
			actors: {
				write: api.preparationWrite.provide({
					actors: {
						observeIdentity: api.fromCallback(({ input, sendBack }) => {
							reportEntered()
							void gate.then(() =>
								sendBack({
									type: 'IDENTITY_OBSERVED',
									binding: input.binding,
									identityId: api.db.getAuthState().session?.user.account ?? undefined
								})
							)
						})
					}
				})
			}
		})
		const machine = api.createNotebookRestorePreparationMachine(api.writer, destinationLogic)
		const first = api.createActor(machine, { input: { request } }).start()
		await entered
		const second = api.createActor(machine, { input: { request } }).start()
		const rejected = await api.toPromise(second)
		const activeBeforeRelease = first.getSnapshot().status
		const writesBeforeRelease = api.issued()
		second.stop()
		release()
		const completed = await api.toPromise(first)
		first.stop()
		request.release()
		open.release()
		envelope.stop()
		const destination = await api.db.one(
			api.notebookRestoreApp.restoreDestinations.where({ id: value.binding.workspaceId }),
			{ tier: 'remote' }
		)
		return {
			rejected,
			completed,
			activeBeforeRelease,
			writesBeforeRelease,
			issued: api.issued(),
			destination
		}
	}, value)
	expect(result.rejected.outcome).toBe('unavailable')
	expect(result.rejected.record).toBeUndefined()
	expect(result.activeBeforeRelease).toBe('active')
	expect(result.writesBeforeRelease).toBe(0)
	expect(result.completed.outcome).toBe('prepared')
	expect(result.issued).toBe(1)
	expect(result.destination).toMatchObject({
		id: value.binding.workspaceId,
		operationId: value.binding.operationId,
		status: 'incomplete'
	})
	await deleteJournal(page, value)
})

for (const authority of ['denied', 'failed']) {
	it(`keeps preparation unissued when destination identity admission is ${authority}`, async () => {
		const page = await open(),
			value = await sample(page)
		expect(await initialize(page, value)).toBe('initialized')
		await page.evaluate((authority) => {
			const api = window.DLFRestoreQualification
			api.preparationDestination = api.preparationDestination.provide({
				actors: {
					write: api.preparationWrite.provide({
						actors: {
							observeIdentity: api.fromCallback(({ input, sendBack }) => {
								if (authority === 'failed') {
									sendBack({ type: 'IDENTITY_FAILED', binding: input.binding })
									return
								}
								sendBack({
									type: 'IDENTITY_OBSERVED',
									binding: input.binding,
									identityId: undefined
								})
							})
						}
					})
				}
			})
		}, authority)
		const result = await run(page, value, 'new')
		expect(result.outcome).toBe('incomplete')
		expect(result.issued).toBe(0)
		expect(result.record?.checkpoint).toMatchObject({
			kind: 'writing',
			completed: [],
			current: { status: 'notIssued', issuance: 0 }
		})
		expect((await discover(page, value)).record).toEqual(result.record)
		const row = await page.evaluate((value) => {
			const api = window.DLFRestoreQualification
			return api.db.one(
				api.notebookRestoreApp.restoreDestinations.where({ id: value.binding.workspaceId }),
				{ tier: 'remote' }
			)
		}, value)
		expect(row).toBeNull()
		await deleteJournal(page, value)
	})
}

for (const change of ['lost', 'failed', 'stale', 'cancelBeforeObservation']) {
	it(`keeps write admission finite for ${change} identity reports and disposes observation`, async () => {
		const page = await open(),
			value = await sample(page)
		await initialize(page, value)
		const prepared = await run(page, value, 'new')
		if (!prepared.record) throw new Error('Missing prepared intent')
		const result = await page.evaluate(
			async ({ value, record, change }) => {
				const api = window.DLFRestoreQualification
				let report: (change: string) => void = () => {
					throw new Error('Missing observer')
				}
				let release: () => void = () => {
					throw new Error('Missing insert gate')
				}
				let started: () => void = () => {
					throw new Error('Missing insert observation')
				}
				const gate = new Promise<void>((resolve) => {
					release = resolve
				})
				const entered = new Promise<void>((resolve) => {
					started = resolve
				})
				let disposed = 0
				const logic = api.preparationWrite.provide({
					actors: {
						observeIdentity: api.fromCallback(({ input, sendBack }) => {
							report = (kind) => {
								if (kind === 'failed') {
									sendBack({ type: 'IDENTITY_FAILED', binding: input.binding })
									return
								}
								sendBack({
									type: 'IDENTITY_OBSERVED',
									binding:
										kind === 'stale'
											? { ...input.binding, generation: input.binding.generation + 1 }
											: input.binding,
									identityId: kind === 'same' ? input.intent.operation.identityId : undefined
								})
							}
							if (change !== 'cancelBeforeObservation') report('same')
							return () => {
								disposed++
							}
						}),
						insert: api.fromPromise(() => {
							started()
							return gate.then((): 'inserted' => 'inserted')
						})
					}
				})
				const transaction = api.db.beginTransaction()
				const actor = api
					.createActor(logic, {
						input: {
							binding: value.binding,
							databaseName: value.databaseName,
							intent: record.intent,
							step: record.intent.plan.preparation,
							operation: 'stage',
							transaction: {
								call: (operation) => Promise.resolve(operation(transaction)),
								toJSON: () => ({ kind: 'restoreTransactionAccess' })
							}
						}
					})
					.start()
				if (change === 'cancelBeforeObservation') actor.send({ type: 'CANCEL' })
				else {
					await entered
					report(change)
					report('same')
				}
				const activeBeforeSettlement = actor.getSnapshot().status
				release()
				const outcome = await api.toPromise(actor)
				await transaction.rollback()
				actor.stop()
				return { outcome, activeBeforeSettlement, disposed }
			},
			{ value, record: prepared.record, change }
		)
		expect(result.outcome).toBe(
			change === 'lost'
				? 'denied'
				: change === 'failed'
					? 'unavailable'
					: change === 'stale'
						? 'staged'
						: 'cancelled'
		)
		expect(result.disposed).toBe(1)
		if (change !== 'cancelBeforeObservation') expect(result.activeBeforeSettlement).toBe('active')
		await deleteJournal(page, value)
	})
}

it('denies identity replacement at the actual native insert boundary', async () => {
	const page = await open(),
		value = await sample(page)
	await initialize(page, value)
	const prepared = await run(page, value, 'new')
	if (!prepared.record) throw new Error('Missing prepared intent')
	const outcome = await page.evaluate(
		async ({ value, record }) => {
			const api = window.DLFRestoreQualification
			const transaction = api.db.beginTransaction()
			const read = api.db.getAuthState.bind(api.db)
			const state = read(),
				session = state.session
			if (!session) throw new Error('Missing qualification session')
			api.db.getAuthState = () => ({
				...state,
				session: { ...session, user: { ...session.user, account: crypto.randomUUID() } }
			})
			try {
				const actor = api
					.createActor(api.preparationWrite, {
						input: {
							binding: value.binding,
							databaseName: value.databaseName,
							intent: record.intent,
							step: record.intent.plan.preparation,
							operation: 'stage',
							transaction: {
								call: (operation) => Promise.resolve(operation(transaction)),
								toJSON: () => ({ kind: 'restoreTransactionAccess' })
							}
						}
					})
					.start()
				const result = await api.toPromise(actor)
				actor.stop()
				return result
			} finally {
				api.db.getAuthState = read
				await transaction.rollback()
			}
		},
		{ value, record: prepared.record }
	)
	expect(outcome).toBe('denied')
	await deleteJournal(page, value)
})

it('returns unavailable for an attachment request with no owned expected bytes', async () => {
	const page = await open(),
		value = await sample(page)
	await initialize(page, value)
	const prepared = await run(page, value, 'new')
	if (!prepared.record) throw new Error('Missing prepared intent')
	const outcome = await page.evaluate(
		async ({ value, record }) => {
			const api = window.DLFRestoreQualification
			const destination = api.createNotebookAttachmentWriter(api.db, {
				release() {},
				toJSON: () => ({ kind: 'notebookRestoreRequest' })
			})
			const actor = api
				.createActor(destination, {
					input: {
						binding: value.binding,
						databaseName: value.databaseName,
						intent: record.intent,
						step: record.intent.plan.preparation,
						operation: 'authority'
					}
				})
				.start()
			const result = await api.toPromise(actor)
			actor.stop()
			return result
		},
		{ value, record: prepared.record }
	)
	expect(outcome).toBe('unavailable')
	await deleteJournal(page, value)
})
