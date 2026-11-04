import { afterAll, beforeAll, expect, it } from 'vitest'
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
async function open() {
	const context = await browser.newContext()
	contexts.push(context)
	const page = await context.newPage()
	await page.goto(url)
	await page.waitForFunction(() => Boolean(window.DLFRestoreQualification))
	return page
}
async function sample(page: Page) {
	return page.evaluate(async () => {
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
		const request = api.prepareArchiveSeal(payload, { kind: 'none' })
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
	})
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
		api.writer.checkAuthority = () => new Promise(() => {})
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
