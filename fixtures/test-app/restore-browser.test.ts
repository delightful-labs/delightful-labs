import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createTestAppDataset } from './dataset.js'
import { prepareArchiveSeal } from 'delightful-local-first/backup/envelope'
import { createArchiveEnvelopeMachine } from 'delightful-local-first/backup/envelope/workflow'
import { createActor, toPromise } from 'xstate'
import type { ArchiveRecord } from 'delightful-local-first/backup/archive'
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest'
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { createServer, type ViteDevServer } from 'vite'
import { jazzPlugin } from 'jazz-tools/dev/vite'
import { deploy, startLocalJazzServer, type LocalJazzServerHandle } from 'jazz-tools/testing'
import { resolve } from 'node:path'
import { testAppRestoreApp, testAppRestorePermissions } from './restore-schema.js'
import type {} from './restore-browser.js'

let authority: LocalJazzServerHandle, web: ViteDevServer, browser: Browser
let url: string
const contexts: BrowserContext[] = []
beforeAll(async () => {
	authority = await startLocalJazzServer({
		schema: testAppRestoreApp,
		permissions: testAppRestorePermissions
	})
	web = await createServer({
		configFile: false,
		cacheDir: resolve('node_modules/.vite/test-app-restore'),
		root: resolve('fixtures/test-app'),
		plugins: [jazzPlugin({ server: false, appId: authority.appId, inspector: false })],
		server: { host: '0.0.0.0', port: 6199, strictPort: true, fs: { allow: [process.cwd()] } }
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
async function open(profile?: string) {
	const context = profile
		? await chromium.launchPersistentContext(profile, { headless: true, channel: 'chromium' })
		: await browser.newContext()
	contexts.push(context)
	const page = await context.newPage()
	await page.goto(url)
	await page.waitForFunction(() => Boolean(window.DLFRestoreQualification))
	return page
}
async function sample(page: Page, size?: number, title?: string, fanout = false) {
	return page.evaluate(
		async ({ size, title, fanout }) => {
			const api = window.DLFRestoreQualification
			const binding = {
				applicationId: 'test-app-qualification',
				environment: 'disposable',
				identityId: api.ownerId,
				workspaceId: crypto.randomUUID(),
				operationId: crypto.randomUUID(),
				generation: 1
			}
			const seed = api.createTestAppDataset({
				applicationId: 'test-app-source',
				workspaceId: 'original'
			})
			const root = seed.records.find((record) => record.type === 'notebook')
			const seedFile = seed.attachments[0]
			if (!root || !seedFile) throw new Error('Missing fixture source')
			const raw: typeof seed = fanout
				? {
						...seed,
						records: [
							root,
							...Array.from({ length: 65 }, (_, index): ArchiveRecord => ({
								type: 'note',
								id: `note-${index}`,
								fields: {
									notebook: { kind: 'reference', type: 'notebook', id: root.id },
									body: { kind: 'text', value: `café ☕\n${index}` },
									archived: { kind: 'boolean', value: index % 2 === 0 },
									attachment:
										index % 4 === 3
											? { kind: 'null' }
											: { kind: 'attachment', id: `file-${index % 4}` }
								}
							}))
						],
						attachments: Array.from({ length: 3 }, (_, index) => ({
							...seedFile,
							id: `file-${index}`,
							fileName: `file-${index}.bin`
						}))
					}
				: seed
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
			return { binding, file, databaseName: 'test-app-restore-' + crypto.randomUUID() }
		},
		{ size, title, fanout }
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
			const request = api.prepareTestAppRestore({
				mode,
				binding: sample.binding,
				databaseName: sample.databaseName,
				archive: checked.archive
			})
			const trace: string[] = []
			const actor = api.createActor(
				api.createTestAppRestorePreparationMachine(api.writer, api.preparationDestination),
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
				api.testAppRestoreApp.restoreDestinations.where({ id: binding.workspaceId }),
				{ tier: 'remote' }
			),
			ordinary: await api.db.all(api.activeTestAppDestinations(api.ownerId), { tier: 'remote' })
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
for (const recovery of ['same session', 'page reload', 'browser restart']) {
	it(`resumes a server-rejected preparation after permission repair: ${recovery}`, async () => {
		const profile =
			recovery === 'browser restart'
				? await mkdtemp(join(tmpdir(), 'dlf-retry-browser-'))
				: undefined
		let page = await open(profile)
		const value = await sample(page)
		try {
			await initialize(page, value)
			await deploy({
				appId: authority.appId,
				serverUrl: authority.url,
				adminSecret: authority.adminSecret,
				schema: testAppRestoreApp,
				permissions: {
					...testAppRestorePermissions,
					restoreDestinations: {
						...testAppRestorePermissions.restoreDestinations,
						insert: { with_check: { type: 'False' } }
					}
				}
			})
			const rejected = await run(page, value, 'new')
			expect(rejected.outcome).toBe('incomplete')
			expect(rejected.issued).toBe(1)
			const checkpoint = rejected.record?.checkpoint
			if (checkpoint?.kind !== 'writing' || checkpoint.current.status !== 'issued')
				throw new Error('Expected retained issued preparation')
			expect(checkpoint.current.settlement.remote).toBe('rejected')
			expect(checkpoint.current.transactionId).toEqual(expect.any(String))
			await deploy({
				appId: authority.appId,
				serverUrl: authority.url,
				adminSecret: authority.adminSecret,
				schema: testAppRestoreApp,
				permissions: testAppRestorePermissions
			})
			if (recovery === 'browser restart') {
				await page.context().close()
				page = await open(profile)
			} else if (recovery === 'page reload') {
				await page.reload()
				await page.waitForFunction(() => Boolean(window.DLFRestoreQualification))
			}
			const resumed = await run(
				page,
				{
					...value,
					binding: { ...value.binding, generation: 2 }
				},
				'resume'
			)
			expect(resumed.outcome).toBe('prepared')
			expect(resumed.issued).toBe(recovery === 'same session' ? 2 : 1)
			expect(resumed.record?.intent).toEqual(rejected.record?.intent)
			expect(resumed.record?.checkpoint).toMatchObject({
				completed: [
					{
						issuance: 2,
						settlement: { local: 'persisted', remote: 'accepted' },
						lastRejectedAttempt: {
							issuance: 1,
							transactionId: checkpoint.current.transactionId,
							settlement: checkpoint.current.settlement
						}
					}
				]
			})
			const repeated = await run(page, value, 'resume')
			expect(repeated.record).toEqual(resumed.record)
			expect(repeated.issued).toBe(resumed.issued)
			const rows = await page.evaluate(async (id) => {
				const api = window.DLFRestoreQualification
				return api.db.all(api.testAppRestoreApp.restoreDestinations.where({ id }), {
					tier: 'remote'
				})
			}, value.binding.workspaceId)
			expect(rows).toHaveLength(1)
			expect(rows[0]).toMatchObject({
				id: value.binding.workspaceId,
				operationId: value.binding.operationId,
				ownerId: value.binding.identityId,
				status: 'incomplete'
			})
			const complete = await fullRestore(page, value, 'resume')
			expect(complete.output.outcome).toBe('complete')
			expect(complete.output.record?.intent).toEqual(rejected.record?.intent)
			const finished = complete.output.record?.checkpoint
			if (finished?.kind !== 'complete') throw new Error('Expected complete restore')
			expect(finished.completed[0]).toMatchObject({
				lastRejectedAttempt: { transactionId: checkpoint.current.transactionId }
			})
			expect(complete.rows?.status).toBe('active')
			expect(complete.rows?.notes).toHaveLength(3)
		} finally {
			await deploy({
				appId: authority.appId,
				serverUrl: authority.url,
				adminSecret: authority.adminSecret,
				schema: testAppRestoreApp,
				permissions: testAppRestorePermissions
			})
			await deleteJournal(page, value)
			await page.context().close()
			if (profile) await rm(profile, { recursive: true, force: true })
		}
	})
}

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
		const request = api.prepareTestAppRestore({ ...sample, mode: 'new', archive: checked.archive })
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
					await api.db.one(api.testAppRestoreApp.restoreDestinations.where({ id }), {
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

it('enforces owner-only recovery and rejects activation with changed ownership at the real storage boundary', async () => {
	const page = await open(),
		value = await sample(page)
	await initialize(page, value)
	const original = await run(page, value, 'new')
	expect(original.outcome).toBe('prepared')
	const foreign = await open()
	const hidden = await foreign.evaluate(async (id) => {
		const api = window.DLFRestoreQualification
		return api.db.one(api.testAppRestoreApp.restoreDestinations.where({ id }), { tier: 'remote' })
	}, value.binding.workspaceId)
	expect(hidden).toBeNull()
	if (!original.record) throw new Error('Expected prepared journal')
	const forgedOwnerInsert = await foreign.evaluate(async (record) => {
		const api = window.DLFRestoreQualification
		try {
			await api.db
				.insert(
					api.testAppRestoreApp.restoreDestinations,
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
				.update(api.testAppRestoreApp.restoreDestinations, id, {
					status: 'active',
					ownerId: crypto.randomUUID()
				})
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
			await api.db.one(api.testAppRestoreApp.restoreDestinations.where({ id }), { tier: 'remote' })
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
		api.machine = api.createTestAppRestorePreparationMachine(
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
		const request = api.prepareTestAppRestore({ ...sample, mode: 'new', archive: checked.archive })
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
			const restore = api.createTestAppAttachmentRestore({
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
				api.testAppRestoreApp.restoreAttachments.where({
					destinationId: value.binding.workspaceId
				}),
				{ tier: 'remote' }
			)
			const destination = await api.db.one(
				api.testAppRestoreApp.restoreDestinations.where({ id: value.binding.workspaceId }),
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
					api.testAppRestoreApp.restoreAttachments.where({ destinationId: id }),
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
				api.testAppRestoreApp.restoreAttachments,
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
		const request = api.prepareTestAppRestore({
			mode: 'resume',
			...value,
			archive: checked.archive
		})
		const destination = api.createTestAppAttachmentWriter(api.db, request)
		const writer = api.createTestAppTransactionWriter(api.db, () => {})
		const machine = api.createTestAppRestoreAttachmentMachine(
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
					await api.db.all(api.testAppRestoreApp.restoreAttachments.where({ destinationId: id }), {
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
		const request = api.prepareTestAppRestore({ ...value, mode: 'new', archive: checked.archive })
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
		const machine = api.createTestAppRestorePreparationMachine(api.writer, destinationLogic)
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
			api.testAppRestoreApp.restoreDestinations.where({ id: value.binding.workspaceId }),
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
				api.testAppRestoreApp.restoreDestinations.where({ id: value.binding.workspaceId }),
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
			const destination = api.createTestAppAttachmentWriter(api.db, {
				release() {},
				toJSON: () => ({ kind: 'testAppRestoreRequest' })
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

async function notebook(page: Page, value: Sample) {
	return page.evaluate(async (value) => {
		const api = window.DLFRestoreQualification
		const request = api.prepareArchiveOpen(new Uint8Array(value.file))
		const envelope = api
			.createActor(api.createArchiveEnvelopeMachine(), { input: { request } })
			.start()
		const checked = await api.toPromise(envelope)
		if (checked.outcome !== 'integrityChecked') throw new Error('Invalid fixture')
		const restore = api.createTestAppRootRestore({
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
			api.testAppRestoreApp.restoreNotebooks.where({ destinationId: value.binding.workspaceId }),
			{ tier: 'remote' }
		)
		const destination = await api.db.one(
			api.testAppRestoreApp.restoreDestinations.where({ id: value.binding.workspaceId }),
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
for (const title of ['Test app fixture', '', 'Cafe\u0301 ☕\nSecond line\r\n\u0000']) {
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
	if (!mapping) throw new Error('Missing test app mapping')
	await page.evaluate(
		async ({ value, id }) => {
			const api = window.DLFRestoreQualification
			await api.db
				.insert(
					api.testAppRestoreApp.restoreNotebooks,
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
		const request = api.prepareTestAppRootRestore({ ...value, archive: checked.archive })
		const destination = api.createTestAppRootWriter(api.db, request)
		const machine = api.createTestAppRestoreRootMachine(
			{
				...api.writer,
				acceptRemote: () => new Promise(() => {})
			},
			destination
		)
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
					await api.db.all(api.testAppRestoreApp.restoreNotebooks.where({ destinationId: id }), {
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
	expect(result.rows[0]?.title).toBe('Test app fixture')
	await deleteJournal(page, value)
})

for (const interruption of [
	'CANCEL',
	'INVALIDATE',
	'RELEASE',
	'IDENTITY_LOST',
	'IDENTITY_FAILED'
]) {
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
			const request = api.prepareTestAppRootRestore({ ...value, archive: checked.archive })
			const destination = api.createTestAppRootWriter(api.db, request)
			const gate = new Promise<void>((resolve) => {
				api.rootPending.releaseStage = resolve
			})
			api.rootPending.releaseRequest = () => request.release()
			api.rootPending.hasExpected = () => api.testAppRestoreRoot(request) !== undefined
			const delayed = destination.provide({
				actors: {
					write: api
						.createTestAppDestinationWriteMachine(api.db, () => {})
						.provide({
							actors: {
								observeIdentity: api.fromCallback(({ input, sendBack }) => {
									const same = () =>
										sendBack({
											type: 'IDENTITY_OBSERVED',
											binding: input.binding,
											identityId: input.intent.operation.identityId
										})
									api.rootPending.reportIdentity = (failed) => {
										if (failed) sendBack({ type: 'IDENTITY_FAILED', binding: input.binding })
										else
											sendBack({
												type: 'IDENTITY_OBSERVED',
												binding: input.binding,
												identityId: undefined
											})
										same()
									}
									same()
								}),
								insert: api.fromPromise(({ input }) =>
									api
										.restoreTransactionAccess(input)
										.call(async (transaction): Promise<'inserted'> => {
											const observed = await transaction.one(
												api.testAppRestoreApp.restoreDestinations.where({
													id: input.intent.operation.destinationWorkspaceId
												})
											)
											if (!observed) throw new Error('Missing fixture control')
											const mapping = input.intent.plan.mappings.find(
												(row) => row.kind === 'record' && row.type === 'notebook'
											)
											if (!mapping) throw new Error('Missing fixture mapping')
											transaction.insert(
												api.testAppRestoreApp.restoreNotebooks,
												{
													destinationId: observed.id,
													ownerId: observed.ownerId,
													operationId: observed.operationId,
													title: 'Test app fixture'
												},
												{ id: mapping.destinationId }
											)
											api.rootPending.staged = true
											await gate
											return 'inserted'
										})
								)
							}
						})
				}
			})
			const machine = api.createTestAppRestoreRootMachine(api.writer, delayed)
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
				if (interruption === 'RELEASE') api.rootPending.releaseRequest?.()
				else if (interruption === 'IDENTITY_LOST' || interruption === 'IDENTITY_FAILED')
					api.rootPending.reportIdentity?.(interruption === 'IDENTITY_FAILED')
				else
					actor.send(
						interruption === 'CANCEL'
							? { type: 'CANCEL' }
							: { type: 'INVALIDATE', binding: value.binding }
					)
				const beforeDrain = actor.getSnapshot().status
				const expectedBeforeDrain = api.rootPending.hasExpected?.()
				api.rootPending.releaseStage?.()
				const output = await api.toPromise(actor)
				api.rootPending.cleanup?.()
				actor.stop()
				const rows = await api.db.all(
					api.testAppRestoreApp.restoreNotebooks.where({
						destinationId: value.binding.workspaceId
					}),
					{ tier: 'remote' }
				)
				return {
					output,
					beforeDrain,
					rows,
					issued: api.issued(),
					expectedBeforeDrain,
					expectedAfterDrain: api.rootPending.hasExpected?.()
				}
			},
			{ value, interruption }
		)
		expect(result.beforeDrain).toBe('active')
		expect(result.expectedBeforeDrain).toBe(true)
		expect(result.expectedAfterDrain).toBe(false)
		expect(result.output.outcome).toBe(
			interruption === 'CANCEL' || interruption === 'RELEASE'
				? 'cancelled'
				: interruption === 'INVALIDATE'
					? 'invalidated'
					: 'incomplete'
		)
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
					.update(api.testAppRestoreApp.restoreNotebooks, row.id, { title: 'Changed' })
					.wait({ tier: 'global' })
			)
			const deletion = await denial(() =>
				api.db.delete(api.testAppRestoreApp.restoreNotebooks, row.id).wait({ tier: 'global' })
			)
			const wrongOperation = await denial(() =>
				api.db
					.insert(
						api.testAppRestoreApp.restoreNotebooks,
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
						api.testAppRestoreApp.restoreNotebooks,
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
			const fresh = await api.db.one(api.testAppRestoreApp.restoreNotebooks.where({ id: row.id }), {
				tier: 'remote'
			})
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
			api.testAppRestoreApp.restoreNotebooks.where({ id: row.id }),
			{ tier: 'remote' }
		)
		try {
			await api.db
				.insert(
					api.testAppRestoreApp.restoreNotebooks,
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

it('constructs dormant notebook continuations without claiming the request or reading the archive', async () => {
	const page = await open(),
		value = await sample(page)
	await preparedNotebook(page, value)
	const result = await page.evaluate(async (value) => {
		const api = window.DLFRestoreQualification
		const open = api.prepareArchiveOpen(new Uint8Array(value.file))
		const envelope = api
			.createActor(api.createArchiveEnvelopeMachine(), { input: { request: open } })
			.start()
		const checked = await api.toPromise(envelope)
		if (checked.outcome !== 'integrityChecked') throw new Error('Invalid fixture')
		let reads = 0
		const archive: typeof checked.archive = {
			...checked.archive,
			readPayload() {
				reads++
				return checked.archive.readPayload()
			}
		}
		const request = api.prepareTestAppRootRestore({ ...value, archive })
		const destination = api.createTestAppRootWriter(api.db, request)
		const machine = api.createTestAppRestoreRootMachine(api.writer, destination)
		const dormant = api.createActor(machine, { input: { request } })
		const beforeStart = reads
		const active = api.createActor(machine, { input: { request } }).start()
		const output = await api.toPromise(active)
		dormant.start()
		const rejected = await api.toPromise(dormant)
		active.stop()
		dormant.stop()
		request.release()
		open.release()
		envelope.stop()
		return { beforeStart, outcome: output.outcome, rejected: rejected.outcome }
	}, value)
	expect(result).toEqual({ beforeStart: 0, outcome: 'batchWritten', rejected: 'unavailable' })
	await deleteJournal(page, value)
})

it('finishes a released notebook request unavailable before planning or issuing a transaction', async () => {
	const page = await open(),
		value = await sample(page)
	const result = await page.evaluate(async (value) => {
		const api = window.DLFRestoreQualification
		const open = api.prepareArchiveOpen(new Uint8Array(value.file))
		const envelope = api
			.createActor(api.createArchiveEnvelopeMachine(), { input: { request: open } })
			.start()
		const checked = await api.toPromise(envelope)
		if (checked.outcome !== 'integrityChecked') throw new Error('Invalid fixture')
		const request = api.prepareTestAppRootRestore({ ...value, archive: checked.archive })
		request.release()
		const actor = api
			.createActor(
				api.createTestAppRestoreRootMachine(
					api.writer,
					api.createTestAppRootWriter(api.db, request)
				),
				{ input: { request } }
			)
			.start()
		const output = await api.toPromise(actor)
		actor.stop()
		open.release()
		envelope.stop()
		return { outcome: output.outcome, issued: api.issued() }
	}, value)
	expect(result).toEqual({ outcome: 'unavailable', issued: 0 })
})

it('returns unavailable for a notebook destination with no owned expected content', async () => {
	const page = await open(),
		value = await sample(page)
	await initialize(page, value)
	const prepared = await run(page, value, 'new')
	if (!prepared.record) throw new Error('Missing fixture intent')
	const outcome = await page.evaluate(
		async ({ value, record }) => {
			const api = window.DLFRestoreQualification
			const destination = api.createTestAppRootWriter(api.db, {
				release() {},
				toJSON: () => ({ kind: 'testAppRestoreRequest' })
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
			const output = await api.toPromise(actor)
			actor.stop()
			return output
		},
		{ value, record: prepared.record }
	)
	expect(outcome).toBe('unavailable')
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
		const restore = api.createTestAppNoteRestore({
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
			api.testAppRestoreApp.restoreNotes.where({ destinationId: value.binding.workspaceId }),
			{ tier: 'remote' }
		)
		const destination = await api.db.one(
			api.testAppRestoreApp.restoreDestinations.where({ id: value.binding.workspaceId }),
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
it('writes a complete note group atomically with exact bodies, archived flags, shared/null relationships and retained receipts through comparing', async () => {
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
	const result = await note(page, value)
	expect(result.output.outcome).toBe('batchWritten')
	expect(result.issued).toBe(4)
	expect(result.rows).toHaveLength(3)
	for (const source of [
		{
			id: 'archived',
			body: 'Preserve archived content\u0000exactly.',
			archived: true,
			attachmentId
		},
		{ id: 'empty', body: '', archived: false, attachmentId: null },
		{ id: 'first', body: 'First line\nSecond line\r\nCafe\u0301 ☕', archived: false, attachmentId }
	]) {
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
	}
	const after = result.output.record?.checkpoint,
		prior = initial.checkpoint
	if (!after || after.kind !== 'comparing' || prior.kind === 'conflict')
		throw new Error('Expected progress through comparison')
	expect(after.completed.slice(0, prior.completed.length)).toEqual(prior.completed)
	expect(after.completed).toHaveLength(prior.completed.length + 1)
	expect(result.output.record?.intent).toEqual(initial.intent)
	expect(result.destination?.status).toBe('incomplete')
	await page.reload()
	await page.waitForFunction(() => Boolean(window.DLFRestoreQualification))
	const resumed = await note(page, value)
	expect(resumed.output.outcome).toBe('noNoteStep')
	expect(resumed.issued).toBe(0)
	expect(resumed.rows).toHaveLength(3)
	expect(resumed.output.record).toEqual(result.output.record)
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
			async ({ value, mappings, notebookId, attachmentId, mismatch }) => {
				const api = window.DLFRestoreQualification
				for (const source of [
					{
						id: 'archived',
						body: 'Preserve archived content\u0000exactly.',
						archived: true,
						attachmentId
					},
					{ id: 'empty', body: '', archived: false, attachmentId: null },
					{
						id: 'first',
						body: 'First line\nSecond line\r\nCafe\u0301 ☕',
						archived: false,
						attachmentId
					}
				]) {
					const mapping = mappings.find(
						(entry) =>
							entry.kind === 'record' && entry.type === 'note' && entry.sourceId === source.id
					)
					if (!mapping) throw new Error('Missing note mapping')
					await api.db
						.insert(
							api.testAppRestoreApp.restoreNotes,
							{
								destinationId: value.binding.workspaceId,
								ownerId: api.ownerId,
								operationId: value.binding.operationId,
								notebookId,
								attachmentId:
									source.id === 'archived' && mismatch === 'attachment'
										? null
										: source.attachmentId,
								body:
									source.id === 'archived' && mismatch === 'body'
										? 'Conflicting body'
										: source.body,
								archived: source.archived
							},
							{ id: mapping.destinationId }
						)
						.wait({ tier: 'global' })
				}
			},
			{ value, mappings, notebookId, attachmentId, mismatch }
		)
		const result = await note(page, value)
		expect(result.output.outcome).toBe('conflict')
		expect(result.issued).toBe(3)
		expect(result.output.record).toEqual(before)
		expect(result.rows).toHaveLength(3)
		expect(result.rows.find((row) => row.id === id)?.body).toBe(
			mismatch === 'body' ? 'Conflicting body' : 'Preserve archived content\u0000exactly.'
		)
		await deleteJournal(page, value)
	})
}
it('reconciles an uncertain note group after reload using actual fields and relationship IDs while preserving its attempt', async () => {
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
		const request = api.prepareTestAppNoteRestore({ ...value, archive: checked.archive })
		const destination = api.createTestAppNoteWriter(api.db, request)
		api.notePending.actor = api
			.createActor(
				api.createTestAppRestoreNoteMachine(
					{
						...api.writer,
						acceptRemote: () => new Promise(() => {})
					},
					destination
				),
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
					await api.db.all(api.testAppRestoreApp.restoreNotes.where({ destinationId: id }), {
						tier: 'remote'
					})
				).length
			}, value.binding.workspaceId)
		)
		.toBe(3)
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
	if (!after || after.kind !== 'comparing' || !before || before.checkpoint.kind !== 'writing')
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
	expect(result.rows).toHaveLength(3)
	const archivedId = before.intent.plan.mappings.find(
		(entry) => entry.kind === 'record' && entry.sourceId === 'archived'
	)?.destinationId
	expect(result.rows.find((row) => row.id === archivedId)?.body).toBe(
		'Preserve archived content\u0000exactly.'
	)
	await deleteJournal(page, value)
})

for (const interruption of [
	'CANCEL',
	'INVALIDATE',
	'RELEASE',
	'IDENTITY_LOST',
	'IDENTITY_FAILED'
]) {
	it(`drains staged note insertion on ${interruption} and rolls back before committing`, async () => {
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
			const request = api.prepareTestAppNoteRestore({ ...value, archive: checked.archive })
			const destination = api.createTestAppNoteWriter(api.db, request)
			const gate = new Promise<void>((resolve) => {
				api.notePending.releaseStage = resolve
			})
			api.notePending.releaseRequest = () => request.release()
			api.notePending.hasExpected = () => api.testAppRestoreNotes(request) !== undefined
			const delayed = destination.provide({
				actors: {
					write: api
						.createTestAppDestinationWriteMachine(api.db, () => {})
						.provide({
							actors: {
								observeIdentity: api.fromCallback(({ input, sendBack }) => {
									const same = () =>
										sendBack({
											type: 'IDENTITY_OBSERVED',
											binding: input.binding,
											identityId: input.intent.operation.identityId
										})
									api.notePending.reportIdentity = (failed) => {
										if (failed) sendBack({ type: 'IDENTITY_FAILED', binding: input.binding })
										else
											sendBack({
												type: 'IDENTITY_OBSERVED',
												binding: input.binding,
												identityId: undefined
											})
										same()
									}
									same()
								}),
								insert: api.fromPromise(({ input }) =>
									api
										.restoreTransactionAccess(input)
										.call(async (transaction): Promise<'inserted'> => {
											const notes = api.testAppRestoreNotes(request)
											if (!notes) throw new Error('Missing fixture notes')
											for (const expected of notes)
												transaction.insert(
													api.testAppRestoreApp.restoreNotes,
													{
														destinationId: expected.destinationId,
														ownerId: expected.ownerId,
														operationId: expected.operationId,
														notebookId: expected.notebookId,
														attachmentId: expected.attachmentId,
														body: expected.body,
														archived: expected.archived
													},
													{ id: expected.id }
												)
											api.notePending.staged = true
											await gate
											return 'inserted'
										})
								)
							}
						})
				}
			})
			const machine = api.createTestAppRestoreNoteMachine(api.writer, delayed)
			api.notePending.actor = api.createActor(machine, { input: { request } }).start()
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
					throw new Error('Stale binding terminated actor')
				if (interruption === 'RELEASE') api.notePending.releaseRequest?.()
				else if (interruption === 'IDENTITY_LOST' || interruption === 'IDENTITY_FAILED')
					api.notePending.reportIdentity?.(interruption === 'IDENTITY_FAILED')
				else
					actor.send(
						interruption === 'CANCEL'
							? { type: 'CANCEL' }
							: { type: 'INVALIDATE', binding: value.binding }
					)
				const beforeDrain = actor.getSnapshot().status
				const expectedBeforeDrain = api.notePending.hasExpected?.()
				api.notePending.releaseStage?.()
				const output = await api.toPromise(actor)
				api.notePending.cleanup?.()
				actor.stop()
				const rows = await api.db.all(
					api.testAppRestoreApp.restoreNotes.where({
						destinationId: value.binding.workspaceId
					}),
					{ tier: 'remote' }
				)
				return {
					output,
					beforeDrain,
					rows,
					issued: api.issued(),
					expectedBeforeDrain,
					expectedAfterDrain: api.notePending.hasExpected?.()
				}
			},
			{ value, interruption }
		)
		expect(result.beforeDrain).toBe('active')
		expect(result.expectedBeforeDrain).toBe(true)
		expect(result.expectedAfterDrain).toBe(false)
		expect(result.output.outcome).toBe(
			interruption === 'CANCEL' || interruption === 'RELEASE'
				? 'cancelled'
				: interruption === 'INVALIDATE'
					? 'invalidated'
					: 'incomplete'
		)
		expect(result.issued).toBe(3)
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
							.insert(api.testAppRestoreApp.restoreNotes, fields, { id: crypto.randomUUID() })
							.wait({ tier: 'global' })
					)
				)
			outcomes.push(
				await denial(() =>
					api.db
						.update(api.testAppRestoreApp.restoreNotes, row.id, { body: 'Changed' })
						.wait({ tier: 'global' })
				)
			)
			outcomes.push(
				await denial(() =>
					api.db.delete(api.testAppRestoreApp.restoreNotes, row.id).wait({ tier: 'global' })
				)
			)
			const fresh = await api.db.one(api.testAppRestoreApp.restoreNotes.where({ id: row.id }), {
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
		const observed = await api.db.one(api.testAppRestoreApp.restoreNotes.where({ id: row.id }), {
			tier: 'remote'
		})
		try {
			await api.db
				.insert(
					api.testAppRestoreApp.restoreNotes,
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

it('constructs dormant note continuations without claiming the request or reading the archive', async () => {
	const page = await open(),
		value = await sample(page)
	await preparedNotes(page, value)
	const result = await page.evaluate(async (value) => {
		const api = window.DLFRestoreQualification
		const open = api.prepareArchiveOpen(new Uint8Array(value.file))
		const envelope = api
			.createActor(api.createArchiveEnvelopeMachine(), { input: { request: open } })
			.start()
		const checked = await api.toPromise(envelope)
		if (checked.outcome !== 'integrityChecked') throw new Error('Invalid fixture')
		let reads = 0
		const archive: typeof checked.archive = {
			...checked.archive,
			readPayload() {
				reads++
				return checked.archive.readPayload()
			}
		}
		const request = api.prepareTestAppNoteRestore({ ...value, archive })
		const destination = api.createTestAppNoteWriter(api.db, request)
		const machine = api.createTestAppRestoreNoteMachine(api.writer, destination)
		const dormant = api.createActor(machine, { input: { request } })
		const beforeStart = reads
		const active = api.createActor(machine, { input: { request } }).start()
		const output = await api.toPromise(active)
		dormant.start()
		const rejected = await api.toPromise(dormant)
		active.stop()
		dormant.stop()
		request.release()
		open.release()
		envelope.stop()
		return { beforeStart, outcome: output.outcome, rejected: rejected.outcome }
	}, value)
	expect(result).toEqual({ beforeStart: 0, outcome: 'batchWritten', rejected: 'unavailable' })
	await deleteJournal(page, value)
})

it('finishes a released note request unavailable before planning or issuing a transaction', async () => {
	const page = await open(),
		value = await sample(page)
	const result = await page.evaluate(async (value) => {
		const api = window.DLFRestoreQualification
		const open = api.prepareArchiveOpen(new Uint8Array(value.file))
		const envelope = api
			.createActor(api.createArchiveEnvelopeMachine(), { input: { request: open } })
			.start()
		const checked = await api.toPromise(envelope)
		if (checked.outcome !== 'integrityChecked') throw new Error('Invalid fixture')
		const request = api.prepareTestAppNoteRestore({ ...value, archive: checked.archive })
		request.release()
		const actor = api
			.createActor(
				api.createTestAppRestoreNoteMachine(
					api.writer,
					api.createTestAppNoteWriter(api.db, request)
				),
				{ input: { request } }
			)
			.start()
		const output = await api.toPromise(actor)
		actor.stop()
		open.release()
		envelope.stop()
		return { outcome: output.outcome, issued: api.issued() }
	}, value)
	expect(result).toEqual({ outcome: 'unavailable', issued: 0 })
})

it('returns unavailable for a note destination with no owned expected content', async () => {
	const page = await open(),
		value = await sample(page)
	await initialize(page, value)
	const prepared = await run(page, value, 'new')
	if (!prepared.record) throw new Error('Missing fixture intent')
	const outcome = await page.evaluate(
		async ({ value, record }) => {
			const api = window.DLFRestoreQualification
			const destination = api.createTestAppNoteWriter(api.db, {
				release() {},
				toJSON: () => ({ kind: 'testAppRestoreRequest' })
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
			const output = await api.toPromise(actor)
			actor.stop()
			return output
		},
		{ value, record: prepared.record }
	)
	expect(outcome).toBe('unavailable')
	await deleteJournal(page, value)
})

async function fullRestore(page: Page, value: Sample, mode: 'new' | 'resume', pause = false) {
	return page.evaluate(
		async ({ value, mode, pause }) => {
			const api = window.DLFRestoreQualification
			const open = api.prepareArchiveOpen(new Uint8Array(value.file))
			const envelope = api
				.createActor(api.createArchiveEnvelopeMachine(), { input: { request: open } })
				.start()
			const checked = await api.toPromise(envelope)
			if (checked.outcome !== 'integrityChecked') throw new Error('Invalid test file')
			const request = api.prepareTestAppRestore({
				...value,
				mode,
				archive: checked.archive
			})
			const actor = api.createActor(api.createTestAppRestoreWorkflow(api.db, api.writer, request), {
				input: { request }
			})
			const states: string[] = []
			let interrupted = false
			actor.subscribe((snapshot) => {
				states.push(JSON.stringify(snapshot.value))
				if (pause && !interrupted && snapshot.matches({ working: 'comparing' })) {
					interrupted = true
					actor.send({ type: 'CANCEL' })
				}
			})
			actor.start()
			const output = await api.toPromise(actor)
			const rows = await api.db.one(api.testAppDestinationGraphQuery(value.binding.workspaceId), {
				tier: 'remote'
			})
			const active = await api.db.all(api.activeTestAppDestinations(value.binding.identityId), {
				tier: 'remote'
			})
			request.release()
			actor.stop()
			open.release()
			envelope.stop()
			return { output, rows, active, states, issued: api.issued() }
		},
		{ value, mode, pause }
	)
}

it('completes the full test app restore with exact graph verification and activation', async () => {
	const page = await open(),
		value = await sample(page)
	const restored = await fullRestore(page, value, 'new')
	expect(restored.output.outcome, JSON.stringify(restored)).toBe('complete')
	expect(restored.states.at(-1)).toBe(JSON.stringify('succeeded'))
	expect(restored.output.record?.checkpoint.kind).toBe('complete')
	expect(restored.rows?.status).toBe('active')
	expect(restored.rows?.notes).toHaveLength(3)
	expect(restored.active.map((row) => row.id)).toContain(value.binding.workspaceId)
	expect(restored.issued).toBe(5)
	const resumed = await fullRestore(page, value, 'resume')
	expect(resumed.output.outcome).toBe('complete')
	expect(resumed.issued).toBe(restored.issued)
	expect(resumed.output.record).toEqual(restored.output.record)
	await deleteJournal(page, value)
})

it('compares exact fields, relationships, attachment bytes and complete object sets', async () => {
	const page = await open(),
		value = await sample(page)
	await fullRestore(page, value, 'new')
	const result = await page.evaluate(async (value) => {
		const api = window.DLFRestoreQualification
		const open = api.prepareArchiveOpen(new Uint8Array(value.file))
		const envelope = api
			.createActor(api.createArchiveEnvelopeMachine(), { input: { request: open } })
			.start()
		const checked = await api.toPromise(envelope)
		if (checked.outcome !== 'integrityChecked') throw new Error('Invalid file')
		const request = api.prepareTestAppRestore({
			...value,
			mode: 'resume',
			archive: checked.archive
		})
		const planner = api
			.createActor(api.createTestAppRestorePlanningMachine(), { input: { request } })
			.start()
		if ((await api.toPromise(planner)).outcome !== 'planned') throw new Error('Missing plan')
		const row = await api.db.one(api.testAppDestinationGraphQuery(value.binding.workspaceId), {
			tier: 'remote'
		})
		if (!row) throw new Error('Missing restored graph')
		const note = row.notes[0],
			file = row.attachments[0]
		if (!note || !file) throw new Error('Missing content')
		const cases = [
			{ ...row, notebooks: row.notebooks.map((book) => ({ ...book, title: book.title + 'x' })) },
			{ ...row, notes: row.notes.map((note) => ({ ...note, body: note.body + 'x' })) },
			{ ...row, notes: row.notes.map((note) => ({ ...note, archived: !note.archived })) },
			{ ...row, notes: row.notes.map((note) => ({ ...note, notebookId: crypto.randomUUID() })) },
			{ ...row, notes: row.notes.map((note) => ({ ...note, attachmentId: null })) },
			{ ...row, notes: row.notes.slice(1) },
			{ ...row, notes: [...row.notes, { ...note, id: crypto.randomUUID() }] },
			{ ...row, attachments: [{ ...file, contents: Uint8Array.of(0, 255, 128, 11) }] },
			{ ...row, attachments: [{ ...file, fileName: 'different.bin' }] },
			{ ...row, attachments: [] },
			{ ...row, attachments: [...row.attachments, { ...file, id: crypto.randomUUID() }] },
			{ ...row, notes: row.notes.map((note) => ({ ...note, operationId: 'foreign' })) }
		]
		const result = {
			exact: api.compareTestAppDestination(row, request),
			changed: cases.map((candidate) => api.compareTestAppDestination(candidate, request))
		}
		request.release()
		planner.stop()
		open.release()
		envelope.stop()
		return result
	}, value)
	expect(result.exact).toBe('activeMatch')
	expect(result.changed).toEqual(Array.from({ length: 12 }, () => 'conflict'))
	await deleteJournal(page, value)
})

it('resumes after comparison cancellation and rejects an actual extra row before activation', async () => {
	const page = await open(),
		value = await sample(page)
	const paused = await fullRestore(page, value, 'new', true)
	expect(paused.output.outcome).toBe('cancelled')
	expect(paused.output.record?.checkpoint.kind).toBe('comparing')
	expect(paused.rows?.status).toBe('incomplete')
	expect(paused.active).toEqual([])
	const notebookId = paused.rows?.notebooks[0]?.id
	if (!notebookId) throw new Error('Missing notebook')
	await page.evaluate(
		async ({ value, notebookId }) => {
			const api = window.DLFRestoreQualification
			await api.db
				.insert(
					api.testAppRestoreApp.restoreNotes,
					{
						destinationId: value.binding.workspaceId,
						ownerId: value.binding.identityId,
						operationId: value.binding.operationId,
						notebookId,
						attachmentId: null,
						body: 'unexpected',
						archived: false
					},
					{ id: crypto.randomUUID() }
				)
				.wait({ tier: 'global' })
		},
		{ value, notebookId }
	)
	const resumed = await fullRestore(page, value, 'resume')
	expect(resumed.output.outcome).toBe('conflict')
	expect(resumed.output.record?.checkpoint.kind).toBe('comparing')
	expect(resumed.rows?.status).toBe('incomplete')
	expect(resumed.active).toEqual([])
	expect(resumed.issued).toBe(paused.issued)
	expect(resumed.rows?.notes).toHaveLength(4)
	await deleteJournal(page, value)
})

it('resumes the same mapped graph after a page reload and freezes content after activation', async () => {
	const page = await open(),
		value = await sample(page)
	const paused = await fullRestore(page, value, 'new', true)
	const provenance = await page.evaluate(async (value) => {
		const api = window.DLFRestoreQualification
		const outcomes: string[] = []
		for (const changes of [
			{ operationId: 'changed' },
			{ payloadSha256: '0'.repeat(64) },
			{ graphSha256: '0'.repeat(64) },
			{ ownerId: crypto.randomUUID() }
		]) {
			try {
				await api.db
					.update(api.testAppRestoreApp.restoreDestinations, value.binding.workspaceId, {
						...changes,
						status: 'active'
					})
					.wait({ tier: 'global' })
				outcomes.push('accepted')
			} catch (error) {
				if (error instanceof api.PersistedWriteRejectedError && error.code === 'permission_denied')
					outcomes.push('denied')
				else throw error
			}
		}
		return outcomes
	}, value)
	expect(provenance).toEqual(['denied', 'denied', 'denied', 'denied'])
	await page.reload()
	await page.waitForFunction(() => Boolean(window.DLFRestoreQualification))
	const resumed = await fullRestore(page, value, 'resume')
	expect(resumed.output.outcome).toBe('complete')
	expect(resumed.output.record?.intent).toEqual(paused.output.record?.intent)
	expect(resumed.issued).toBe(1)
	expect(resumed.rows?.notes).toEqual(paused.rows?.notes)
	const attempts = await page.evaluate(async (value) => {
		const api = window.DLFRestoreQualification
		const row = await api.db.one(api.testAppDestinationGraphQuery(value.binding.workspaceId), {
			tier: 'remote'
		})
		const book = row?.notebooks[0],
			note = row?.notes[0]
		if (!book || !note) throw new Error('Missing active graph')
		const outcomes: string[] = []
		const writes = [
			() =>
				api.db.update(api.testAppRestoreApp.restoreDestinations, value.binding.workspaceId, {
					status: 'incomplete'
				}),
			() =>
				api.db.update(api.testAppRestoreApp.restoreDestinations, value.binding.workspaceId, {
					operationId: 'changed'
				}),
			() =>
				api.db.insert(
					api.testAppRestoreApp.restoreNotes,
					{
						destinationId: note.destinationId,
						ownerId: note.ownerId,
						operationId: note.operationId,
						notebookId: book.id,
						attachmentId: null,
						body: 'late',
						archived: false
					},
					{ id: crypto.randomUUID() }
				),
			() => api.db.update(api.testAppRestoreApp.restoreNotes, note.id, { body: 'changed' })
		]
		for (const write of writes) {
			try {
				await write().wait({ tier: 'global' })
				outcomes.push('accepted')
			} catch (error) {
				if (error instanceof api.PersistedWriteRejectedError && error.code === 'permission_denied')
					outcomes.push('denied')
				else throw error
			}
		}
		return outcomes
	}, value)
	expect(attempts).toEqual(['denied', 'denied', 'denied', 'denied'])
	await deleteJournal(page, value)
})

it('restores a retained archive fixture after independent inspection and preserves its input', async () => {
	const page = await open(),
		ownerId = await page.evaluate(() => window.DLFRestoreQualification.ownerId)
	const directory = await mkdtemp(join(tmpdir(), 'dlf-roundtrip-')),
		path = join(directory, 'test-app.dlfbackup')
	const binding = {
		applicationId: 'test-app-roundtrip',
		environment: 'disposable',
		identityId: ownerId,
		workspaceId: crypto.randomUUID(),
		operationId: crypto.randomUUID(),
		generation: 1
	}
	const original = createTestAppDataset({
		applicationId: binding.applicationId,
		workspaceId: binding.workspaceId
	})
	const originalJson = JSON.stringify(original)
	const request = prepareArchiveSeal(original, { kind: 'none' })
	const sealing = createActor(createArchiveEnvelopeMachine(), { input: { request } }).start()
	try {
		const sealed = await toPromise(sealing)
		if (sealed.outcome !== 'sealed') throw new Error('Fixture sealing failed')
		const copy = sealed.archive.copyBytes()
		try {
			await writeFile(path, copy)
		} finally {
			copy.fill(0)
			sealed.archive.release()
		}
		const retained = await readFile(path)
		const inspection = spawnSync(
			process.execPath,
			[
				'--import',
				resolve('fixtures/backup-reader/no-network.mjs'),
				'--input-type=module',
				'--eval',
				`
			import { createActor, toPromise } from 'xstate'
			import { prepareArchiveInspection } from 'delightful-local-first/backup/inspection'
			import { createArchiveInspectionMachine } from 'delightful-local-first/backup/inspection/workflow'
			import { fileSource } from './fixtures/backup-reader/io.mjs'
			import { testAppProfile } from './.svelte-kit/test-app/profile.js'
			const request = prepareArchiveInspection({ source: fileSource(process.argv[1]), profiles: [testAppProfile] })
			const actor = createActor(createArchiveInspectionMachine(), { input: { request } }).start()
			const output = await toPromise(actor)
			console.log(output.outcome)
			if ('report' in output) output.report.release()
			request.release(); actor.stop()
		`,
				path
			],
			{ encoding: 'utf8', env: { PATH: process.env.PATH ?? '' }, timeout: 15000 }
		)
		expect(inspection.status, inspection.stderr).toBe(0)
		expect(inspection.stdout.trim()).toBe('profileValid')
		const value = {
			binding: { ...binding, workspaceId: crypto.randomUUID(), operationId: crypto.randomUUID() },
			file: Array.from(retained),
			databaseName: 'roundtrip-' + crypto.randomUUID()
		}
		const restored = await fullRestore(page, value, 'new')
		expect(restored.output.outcome).toBe('complete')
		expect(restored.rows?.notebooks[0]?.title).toBe('Test app fixture')
		expect(restored.rows?.notes.map((note) => [note.body, note.archived]).sort()).toEqual(
			original.records
				.filter((record) => record.type === 'note')
				.map((record) => [
					record.fields.body?.kind === 'text' ? record.fields.body.value : '',
					record.fields.archived?.kind === 'boolean' ? record.fields.archived.value : false
				])
				.sort()
		)
		await page.reload()
		await page.waitForFunction(() => Boolean(window.DLFRestoreQualification))
		const fresh = await fullRestore(page, value, 'resume')
		expect(fresh.output.outcome).toBe('complete')
		expect(fresh.rows).toEqual(restored.rows)
		expect(fresh.issued).toBe(0)
		expect(JSON.stringify(original)).toBe(originalJson)
		expect(await readFile(path)).toEqual(retained)
		await deleteJournal(page, value)
	} finally {
		request.release()
		sealing.stop()
		await rm(directory, { recursive: true, force: true })
	}
})

it('reconciles a remotely accepted activation after cancellation without issuing it again', async () => {
	const page = await open(),
		value = await sample(page)
	const result = await page.evaluate(async (value) => {
		const api = window.DLFRestoreQualification
		const open = api.prepareArchiveOpen(new Uint8Array(value.file))
		const envelope = api
			.createActor(api.createArchiveEnvelopeMachine(), { input: { request: open } })
			.start()
		const checked = await api.toPromise(envelope)
		if (checked.outcome !== 'integrityChecked') throw new Error('Invalid file')
		const request = api.prepareTestAppRestore({ ...value, mode: 'new', archive: checked.archive })
		let signal = () => {},
			release = () => {}
		const pending = new Promise<void>((yes) => {
			signal = yes
		})
		const gate = new Promise<void>((yes) => {
			release = yes
		})
		let acceptance: Promise<void> = Promise.resolve()
		const writer: typeof api.writer = {
			...api.writer,
			acceptRemote: (write) => {
				const accepted = api.writer.acceptRemote(write)
				if (api.issued() !== 5) return accepted
				acceptance = accepted
				signal()
				return gate
			}
		}
		const actor = api
			.createActor(api.createTestAppRestoreWorkflow(api.db, writer, request), {
				input: { request }
			})
			.start()
		await pending
		actor.send({ type: 'CANCEL' })
		const output = await api.toPromise(actor)
		await acceptance
		release()
		request.release()
		actor.stop()
		open.release()
		envelope.stop()
		return { output, issued: api.issued() }
	}, value)
	expect(result.output.outcome).toBe('cancelled')
	expect(result.output.record?.checkpoint).toMatchObject({
		kind: 'activating',
		current: { status: 'issued', settlement: { local: 'persisted', remote: 'unobserved' } }
	})
	const resumed = await fullRestore(page, value, 'resume')
	expect(resumed.output.outcome).toBe('complete')
	expect(resumed.issued).toBe(result.issued)
	if (resumed.output.record?.checkpoint.kind !== 'complete')
		throw new Error('Missing activation completion')
	expect(resumed.output.record.checkpoint.activation).toMatchObject({
		basis: 'remoteContentMatch',
		localPersistence: 'persisted'
	})
	await deleteJournal(page, value)
})

it('bounded note restore uses the default complete-restore policy and survives reload', async () => {
	const page = await open(),
		value = await sample(page)
	const first = await page.evaluate(async (value) => {
		const api = window.DLFRestoreQualification
		const opening = api.prepareArchiveOpen(new Uint8Array(value.file))
		const envelope = api
			.createActor(api.createArchiveEnvelopeMachine(), { input: { request: opening } })
			.start()
		const checked = await api.toPromise(envelope)
		if (checked.outcome !== 'integrityChecked') throw new Error('Invalid test archive')
		const root = api.createTestAppRestore({
			...value,
			mode: 'new',
			db: api.db,
			archive: checked.archive,
			retainDetached: () => {}
		})
		root.actor.start()
		const output = await api.toPromise(root.actor)
		const rows = await api.db.one(api.testAppDestinationGraphQuery(value.binding.workspaceId), {
			tier: 'remote'
		})
		root.request.release()
		root.actor.stop()
		opening.release()
		envelope.stop()
		return { output, rows, issued: api.issued() }
	}, value)
	expect(first.output.outcome).toBe('complete')
	expect(first.output.record?.intent.plan.version).toBe(2)
	expect(
		first.output.record?.intent.plan.batches.map((batch) => batch.mappingIndexes.length)
	).toEqual([1, 1, 3])
	expect(first.issued).toBe(5)
	await page.reload()
	await page.waitForFunction(() => Boolean(window.DLFRestoreQualification))
	const resumed = await fullRestore(page, value, 'resume')
	expect(resumed.output.outcome).toBe('complete')
	expect(resumed.output.record?.intent.plan.version).toBe(2)
	expect(resumed.issued).toBe(0)
	expect(resumed.rows).toEqual(first.rows)
	await deleteJournal(page, value)
})

it('bounded note restore preserves references across multiple groups and distinct attachments', async () => {
	const page = await open(),
		value = await sample(page, undefined, undefined, true)
	const restored = await fullRestore(page, value, 'new')
	expect(restored.output.outcome).toBe('complete')
	expect(restored.issued).toBe(9)
	expect(
		restored.output.record?.intent.plan.batches.map((batch) => batch.mappingIndexes.length)
	).toEqual([1, 1, 1, 1, 32, 32, 1])
	expect(restored.rows?.notes).toHaveLength(65)
	expect(restored.rows?.attachments).toHaveLength(3)
	expect(restored.rows?.notes.filter((note) => note.attachmentId === null)).toHaveLength(16)
	expect(new Set(restored.rows?.notes.map((note) => note.notebookId)).size).toBe(1)
	await page.reload()
	await page.waitForFunction(() => Boolean(window.DLFRestoreQualification))
	const resumed = await fullRestore(page, value, 'resume')
	expect(resumed.output.outcome).toBe('complete')
	expect(resumed.issued).toBe(0)
	expect(resumed.rows).toEqual(restored.rows)
	await deleteJournal(page, value)
})

it.each([1, 3])(
	'rejects unsupported saved notebook plan version %i without writing',
	async (version) => {
		const page = await open(),
			value = await sample(page)
		const prepared = await fullRestore(page, value, 'new', true)
		const record = prepared.output.record
		if (!record) throw new Error('Missing saved plan')
		const incompatible = {
			...record,
			intent: { ...record.intent, plan: { ...record.intent.plan, version } }
		}
		await page.evaluate(
			async ({ value, record }) => {
				const db = await new Promise<IDBDatabase>((resolve, reject) => {
					const request = indexedDB.open(value.databaseName, 1)
					request.onsuccess = () => resolve(request.result)
					request.onerror = () => reject(request.error)
				})
				try {
					await new Promise<void>((resolve, reject) => {
						const tx = db.transaction('restoreOperations', 'readwrite')
						const { binding } = value
						tx.objectStore('restoreOperations').put(
							new TextEncoder().encode(JSON.stringify(record)),
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
				} finally {
					db.close()
				}
			},
			{ value, record: incompatible }
		)
		await page.reload()
		await page.waitForFunction(() => Boolean(window.DLFRestoreQualification))
		const resumed = await fullRestore(page, value, 'resume')
		expect(resumed.output.outcome).toBe('unavailable')
		expect(resumed.issued).toBe(0)
		expect(resumed.rows).toEqual(prepared.rows)
		expect((await discover(page, value)).record).toEqual(incompatible)
		await deleteJournal(page, value)
	}
)

it('bounded note restore resumes a completed batch after cancellation before comparison', async () => {
	const page = await open(),
		value = await sample(page)
	const paused = await fullRestore(page, value, 'new', true)
	expect(paused.output.outcome).toBe('cancelled')
	expect(paused.output.record?.checkpoint.kind).toBe('comparing')
	expect(paused.issued).toBe(4)
	await page.reload()
	await page.waitForFunction(() => Boolean(window.DLFRestoreQualification))
	const resumed = await fullRestore(page, value, 'resume')
	expect(resumed.output.outcome).toBe('complete')
	expect(resumed.issued).toBe(1)
	expect(resumed.rows?.notes).toHaveLength(3)
	await deleteJournal(page, value)
})

it('bounded note restore reconciles a remotely accepted uncertain batch without replay', async () => {
	const page = await open(),
		value = await sample(page)
	const paused = await page.evaluate(async (value) => {
		const api = window.DLFRestoreQualification
		const opening = api.prepareArchiveOpen(new Uint8Array(value.file))
		const envelope = api
			.createActor(api.createArchiveEnvelopeMachine(), { input: { request: opening } })
			.start()
		const checked = await api.toPromise(envelope)
		if (checked.outcome !== 'integrityChecked') throw new Error('Invalid test archive')
		const request = api.prepareTestAppRestore({
			...value,
			mode: 'new',
			archive: checked.archive
		})
		let signal = () => {},
			release = () => {}
		const pending = new Promise<void>((yes) => {
				signal = yes
			}),
			gate = new Promise<void>((yes) => {
				release = yes
			})
		const writer: typeof api.writer = {
			...api.writer,
			acceptRemote: async (write) => {
				await api.writer.acceptRemote(write)
				if (api.issued() === 4) {
					signal()
					await gate
				}
			}
		}
		const actor = api
			.createActor(api.createTestAppRestoreWorkflow(api.db, writer, request), {
				input: { request }
			})
			.start()
		await pending
		actor.send({ type: 'CANCEL' })
		const output = await api.toPromise(actor)
		release()
		request.release()
		actor.stop()
		opening.release()
		envelope.stop()
		return { output, issued: api.issued() }
	}, value)
	expect(paused.output.outcome).toBe('cancelled')
	expect(paused.issued).toBe(4)
	await page.reload()
	await page.waitForFunction(() => Boolean(window.DLFRestoreQualification))
	const resumed = await fullRestore(page, value, 'resume')
	expect(resumed.output.outcome).toBe('complete')
	expect(resumed.issued).toBe(1)
	const checkpoint = resumed.output.record?.checkpoint
	if (checkpoint?.kind !== 'complete') throw new Error('Missing completed checkpoint')
	expect(checkpoint.completed.at(-1)).toMatchObject({
		basis: 'remoteContentMatch',
		localPersistence: 'persisted'
	})
	await deleteJournal(page, value)
})

for (const fault of ['stageFailure', 'cancelStaging', 'partialPresence']) {
	it(`bounded note restore preserves recovery and all rows on ${fault}`, async () => {
		const page = await open(),
			value = await sample(page)
		const result = await page.evaluate(
			async ({ value, fault }) => {
				const api = window.DLFRestoreQualification
				const opening = api.prepareArchiveOpen(new Uint8Array(value.file))
				const envelope = api
					.createActor(api.createArchiveEnvelopeMachine(), { input: { request: opening } })
					.start()
				const checked = await api.toPromise(envelope)
				if (checked.outcome !== 'integrityChecked') throw new Error('Invalid test archive')
				const request = api.prepareTestAppRestore({
					...value,
					mode: 'new',
					archive: checked.archive
				})
				let signal = () => {},
					release = () => {},
					rolledBack = 0
				const pending = new Promise<void>((yes) => {
						signal = yes
					}),
					gate = new Promise<void>((yes) => {
						release = yes
					})
				const writer: typeof api.writer = {
					...api.writer,
					rollback: (tx) => {
						rolledBack++
						return api.writer.rollback(tx)
					}
				}
				const destination = api.createTestAppNoteWriter(api.db, request)
				const delayed =
					fault === 'partialPresence'
						? destination.provide({
								actors: {
									remote: api.fromPromise(async () => {
										signal()
										await gate
									})
								}
							})
						: destination.provide({
								actors: {
									write: api
										.createTestAppDestinationWriteMachine(api.db, () => {})
										.provide({
											actors: {
												insert: api.fromPromise(({ input }) =>
													api
														.restoreTransactionAccess(input)
														.call(async (tx): Promise<'inserted'> => {
															const notes = api.testAppRestoreNotes(request)
															if (!notes) throw new Error('Expected note batch')
															for (const note of notes) {
																tx.insert(
																	api.testAppRestoreApp.restoreNotes,
																	{
																		destinationId: note.destinationId,
																		ownerId: note.ownerId,
																		operationId: note.operationId,
																		notebookId: note.notebookId,
																		attachmentId: note.attachmentId,
																		body: note.body,
																		archived: note.archived
																	},
																	{ id: note.id }
																)
																if (fault === 'stageFailure')
																	throw new Error('Injected batch stage failure')
															}
															signal()
															await gate
															return 'inserted'
														})
												)
											}
										})
								}
							})
				const machine = api
					.createTestAppRestoreWorkflow(api.db, writer, request)
					.provide({ actors: { note: api.createRestoreMachine(writer, delayed) } })
				const actor = api.createActor(machine, { input: { request } }).start()
				let settled = false
				const outputPromise = api.toPromise(actor).then((output) => {
					settled = true
					return output
				})
				let heldBeforeRelease = false,
					settledBeforeRelease = false
				if (fault !== 'stageFailure') {
					await pending
					actor.send({ type: 'CANCEL' })
					await Promise.resolve()
					heldBeforeRelease = api.testAppRestoreNotes(request) !== undefined
					settledBeforeRelease = settled
					release()
				}
				const output = await outputPromise
				const heldAfter = api.testAppRestoreNotes(request) !== undefined
				request.release()
				actor.stop()
				opening.release()
				envelope.stop()
				if (fault === 'partialPresence') {
					const record = output.record
					if (!record || record.checkpoint.kind !== 'writing')
						throw new Error('Expected unissued batch')
					const writeId = record.checkpoint.current.writeId
					const batch = record.intent.plan.batches.find((b) => b.writeId === writeId)
					const mapping =
						batch?.mappingIndexes[0] === undefined
							? undefined
							: record.intent.plan.mappings[batch.mappingIndexes[0]]
					if (mapping?.kind !== 'record') throw new Error('Expected note mapping')
					const source = api
						.createTestAppDataset({ applicationId: 'test', workspaceId: 'original' })
						.records.find((r) => r.type === 'note' && r.id === mapping.sourceId)
					const fields = source?.fields
					if (
						fields?.body?.kind !== 'text' ||
						fields.archived?.kind !== 'boolean' ||
						fields.notebook?.kind !== 'reference' ||
						(fields.attachment?.kind !== 'attachment' && fields.attachment?.kind !== 'null')
					)
						throw new Error('Missing source fields')
					const book = record.intent.plan.mappings.find(
						(m) => m.kind === 'record' && m.type === 'notebook'
					)
					const attachment = fields.attachment
					const file =
						attachment.kind === 'attachment'
							? record.intent.plan.mappings.find(
									(m) => m.kind === 'attachment' && m.sourceId === attachment.id
								)
							: undefined
					if (!book) throw new Error('Missing parent')
					const tx = api.db.beginTransaction()
					tx.insert(
						api.testAppRestoreApp.restoreNotes,
						{
							destinationId: value.binding.workspaceId,
							ownerId: value.binding.identityId,
							operationId: value.binding.operationId,
							notebookId: book.destinationId,
							attachmentId: file?.destinationId ?? null,
							body: fields.body.value,
							archived: fields.archived.value
						},
						{ id: mapping.destinationId }
					)
					const write = tx.commit()
					await write.wait({ tier: 'local' })
					await write.wait({ tier: 'global' })
				}
				const rows = await api.db.one(api.testAppDestinationGraphQuery(value.binding.workspaceId), {
					tier: 'remote'
				})
				return {
					output,
					rolledBack,
					heldBeforeRelease,
					settledBeforeRelease,
					heldAfter,
					rows,
					issued: api.issued()
				}
			},
			{ value, fault }
		)
		expect(result.output.outcome).toBe(fault === 'stageFailure' ? 'incomplete' : 'cancelled')
		expect(result.rows?.status).toBe('incomplete')
		expect(result.rows?.notes).toHaveLength(fault === 'partialPresence' ? 1 : 0)
		expect(result.heldAfter).toBe(false)
		if (fault === 'cancelStaging') {
			expect(result.heldBeforeRelease).toBe(true)
			expect(result.settledBeforeRelease).toBe(false)
		}
		if (fault !== 'partialPresence') {
			expect(result.rolledBack).toBe(1)
			expect(result.issued).toBe(3)
		} else {
			const resumed = await fullRestore(page, value, 'resume')
			expect(resumed.output.outcome).toBe('conflict')
			expect(resumed.issued).toBe(result.issued)
			expect(resumed.rows?.notes).toEqual(result.rows?.notes)
		}
		await deleteJournal(page, value)
	})
}

// Diagnostic drivers exercise the already-qualified actors; they introduce no application workflow.
// T007's comparison bytes are a synthetic workload target, not an implemented Finance archive.
const reviewLabel = process.env.DLF_BACKUP_REVIEW_LABEL
if (reviewLabel !== undefined && !/^[a-z0-9-]+$/.test(reviewLabel))
	throw new Error('Invalid review label')
const reviewTrace = process.env.DLF_BACKUP_REVIEW_TRACE === '1'
const reviewRecords = Number(process.env.DLF_BACKUP_REVIEW_RECORDS ?? 633)
if (!Number.isSafeInteger(reviewRecords) || reviewRecords < 16 || reviewRecords > 633)
	throw new Error('Review record count must be 16 to 633')
const reviewPayloadBytes = Math.round((672633 * reviewRecords) / 633)
type Measurement =
	| { kind: 'attachment'; mebibytes: number }
	| { kind: 'records'; records: number; payloadBytes: number; cpuRate: number; run: number }
const measurements: Measurement[] = [
	{ kind: 'attachment', mebibytes: 1 },
	{ kind: 'attachment', mebibytes: 4 },
	{ kind: 'attachment', mebibytes: 8 },
	{ kind: 'records', records: reviewRecords, payloadBytes: reviewPayloadBytes, cpuRate: 1, run: 1 },
	{ kind: 'records', records: reviewRecords, payloadBytes: reviewPayloadBytes, cpuRate: 1, run: 2 },
	{ kind: 'records', records: reviewRecords, payloadBytes: reviewPayloadBytes, cpuRate: 1, run: 3 },
	{ kind: 'records', records: reviewRecords, payloadBytes: reviewPayloadBytes, cpuRate: 4, run: 1 }
]
// A short override exercises diagnostic teardown; it never relaxes a production operation bound.
const recordMeasurementDeadline = Number(process.env.DLF_BACKUP_RECORD_TIMEOUT_MS ?? 600000)
if (
	!Number.isSafeInteger(recordMeasurementDeadline) ||
	recordMeasurementDeadline < 1000 ||
	recordMeasurementDeadline > 600000
)
	throw new Error('Record measurement deadline must be between 1000 and 600000 milliseconds')
// Opt-in measurements have no timing pass/fail threshold. CI runs the functional suite separately.
for (const workload of measurements) {
	const enabled =
		workload.kind === 'attachment'
			? process.env.DLF_BACKUP_MEASURE
			: process.env.DLF_BACKUP_RECORD_MEASURE
	const label =
		workload.kind === 'attachment'
			? `encrypted seal/open/restore at ${workload.mebibytes} MiB`
			: `record workload ${workload.records}, CPU ${workload.cpuRate}x, run ${workload.run}`
	const deadlineMs = workload.kind === 'attachment' ? 120000 : recordMeasurementDeadline
	it.skipIf(!enabled)(
		`measures ${label}`,
		async () => {
			const startedAt = Date.now()
			const fileLabel =
				workload.kind === 'attachment'
					? workload.mebibytes
					: `records-${workload.records}-cpu${workload.cpuRate}-run${workload.run}`
			const metricsPath = resolve(
				`.svelte-kit/test-app-performance-${reviewLabel ? `review-${reviewLabel}-` : ''}${fileLabel}.json`
			)
			let latestProgress: { phase: string; writesIssued: number } | undefined
			const page = await open()
			const dedicatedWorkersAtSamplingStart = page.workers().length
			const cdp = await page.context().newCDPSession(page)
			await cdp.send('Performance.enable')
			if (workload.kind === 'records')
				await cdp.send('Emulation.setCPUThrottlingRate', { rate: workload.cpuRate })
			page.on('console', (message) => {
				const match = message.text().match(/^\[Test app measurement\] (\w+), writes issued: (\d+)$/)
				if (match) {
					latestProgress = { phase: match[1] ?? '', writesIssued: Number(match[2]) }
					process.stdout.write(message.text() + '\n')
				}
			})
			const heaps: number[] = [],
				resident: number[] = []
			const system = await browser.newBrowserCDPSession()
			const processes = await system.send('SystemInfo.getProcessInfo')
			const renderers = processes.processInfo
				.filter((entry) => entry.type === 'renderer')
				.map((entry) => entry.id)
			await system.detach()
			const sampleResident = () => {
				const result = spawnSync('ps', ['-o', 'rss=', '-p', renderers.join(',')], {
					encoding: 'utf8'
				})
				if (result.status === 0)
					resident.push(
						result.stdout
							.trim()
							.split(/\s+/)
							.reduce((total, value) => total + Number(value) * 1024, 0)
					)
			}
			sampleResident()
			const heapFailures: unknown[] = []
			const heapReads = new Set<Promise<void>>()
			const sampleHeap = async () => {
				try {
					const result = await cdp.send('Performance.getMetrics')
					const used = result.metrics.find((metric) => metric.name === 'JSHeapUsedSize')?.value
					if (used !== undefined) heaps.push(used)
				} catch (error) {
					// Runner deadlines close the context. Other sampling failures invalidate the run.
					if (!page.isClosed() && heapFailures.length === 0) heapFailures.push(error)
				}
			}
			await sampleHeap()
			const rssSampler = setInterval(sampleResident, 100)
			const sampler = setInterval(() => {
				const read = sampleHeap()
				heapReads.add(read)
				void read.then(() => heapReads.delete(read))
			}, 25)
			try {
				const result = await page.evaluate(
					async ({ workload, reviewTrace }) => {
						const api = window.DLFRestoreQualification
						const raw = api.createTestAppDataset({
							applicationId: 'test-app-measurement',
							workspaceId: 'original'
						})
						let payload = raw
						if (workload.kind === 'attachment') {
							const bytes = Uint8Array.from(
								{ length: workload.mebibytes * 1024 * 1024 },
								(_, i) => i % 251
							)
							const sha256 = Array.from(
								new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
								(byte) => byte.toString(16).padStart(2, '0')
							).join('')
							const pieces: string[] = []
							for (let index = 0; index < bytes.length; index += 16384)
								pieces.push(String.fromCharCode(...bytes.subarray(index, index + 16384)))
							payload = {
								...raw,
								attachments: [
									{
										id: 'binary',
										mediaType: 'application/octet-stream',
										fileName: 'large.bin',
										sizeBytes: bytes.length,
										sha256,
										data: btoa(pieces.join(''))
									}
								]
							}
						} else {
							const root = raw.records.find((record) => record.type === 'notebook')
							if (!root) throw new Error('Measurement notebook missing')
							const notes = Array.from(
								{ length: workload.records - 1 },
								(_, index): ArchiveRecord => ({
									type: 'note',
									id: 'note-' + index,
									fields: {
										notebook: { kind: 'reference', type: 'notebook', id: root.id },
										body: { kind: 'text', value: 'Synthetic café ☕\n' },
										archived: { kind: 'boolean', value: false },
										attachment: { kind: 'null' }
									}
								})
							)
							payload = { ...raw, records: [root, ...notes], attachments: [] }
							const padding =
								workload.payloadBytes - new TextEncoder().encode(JSON.stringify(payload)).length
							if (padding < 0 || notes.length === 0)
								throw new Error('Measurement byte target is too small')
							payload = {
								...payload,
								records: [
									root,
									...notes.map((note, index): ArchiveRecord => {
										const body = note.fields.body
										if (body?.kind !== 'text') throw new Error('Measurement body missing')
										return {
											...note,
											fields: {
												...note.fields,
												body: {
													kind: 'text',
													value:
														body.value +
														'x'.repeat(
															Math.floor(padding / notes.length) +
																(index < padding % notes.length ? 1 : 0)
														)
												}
											}
										}
									})
								]
							}
						}
						const payloadJsonBytes = new TextEncoder().encode(JSON.stringify(payload)).length
						if (workload.kind === 'records' && payloadJsonBytes !== workload.payloadBytes)
							throw new Error('Measurement payload size differs from its target')
						const binding = {
							applicationId: 'test-app-measurement',
							environment: 'disposable',
							identityId: api.ownerId,
							workspaceId: crypto.randomUUID(),
							operationId: crypto.randomUUID(),
							generation: 1
						}
						let file: Uint8Array | undefined
						let largestDelayMs = 0,
							last = performance.now()
						let phase: 'seal' | 'open' | 'restore' = 'seal'
						const phaseDelays = { seal: 0, open: 0, restore: 0 }
						const restoreTimer = { samples: 0, over50Ms: 0, over100Ms: 0, totalExcessMs: 0 }
						const timer = setInterval(() => {
							const now = performance.now()
							largestDelayMs = Math.max(largestDelayMs, now - last - 16)
							phaseDelays[phase] = Math.max(phaseDelays[phase], now - last - 16)
							if (phase === 'restore') {
								const delay = Math.max(0, now - last - 16)
								restoreTimer.samples++
								restoreTimer.totalExcessMs += delay
								if (delay > 50) restoreTimer.over50Ms++
								if (delay > 100) restoreTimer.over100Ms++
							}
							last = now
						}, 16)
						const progress = setInterval(() => {
							console.log('[Test app measurement] ' + phase + ', writes issued: ' + api.issued())
						}, 15000)
						const password = 'disposable measurement password'
						const start = performance.now()
						const sealingRequest = api.prepareArchiveSeal(payload, { kind: 'password', password })
						const sealingActor = api
							.createActor(api.createArchiveEnvelopeMachine(), {
								input: { request: sealingRequest }
							})
							.start()
						const sealed = await api.toPromise(sealingActor)
						if (sealed.outcome !== 'sealed') throw new Error('Fixture sealing failed')
						file = sealed.archive.copyBytes()
						sealed.archive.release()
						const sealedAt = performance.now()
						await new Promise<void>((yes) => setTimeout(yes, 20))
						phase = 'open'
						const openStartedAt = performance.now()
						const opening = api.prepareArchiveOpen(file, password)
						const envelope = api
							.createActor(api.createArchiveEnvelopeMachine(), { input: { request: opening } })
							.start()
						const checked = await api.toPromise(envelope)
						if (checked.outcome !== 'integrityChecked') throw new Error('Open failed')
						const openedAt = performance.now()
						await new Promise<void>((yes) => setTimeout(yes, 20))
						phase = 'restore'
						const restoreStartedAt = performance.now()
						const databaseName = 'measure-' + crypto.randomUUID()
						const restoreOptions = {
							db: api.db,
							binding,
							databaseName,
							mode: 'new',
							archive: checked.archive,
							retainDetached: () => {}
						} satisfies Parameters<typeof api.createTestAppRestore>[0]
						const actorStarts = new Map<string, { id: string; started: number }>()
						const actorTimings = new Map<
							string,
							{ count: number; totalMs: number; maxMs: number }
						>()
						const diagnosticRequest = reviewTrace
							? api.prepareTestAppRestore(restoreOptions)
							: undefined
						const restoring = diagnosticRequest
							? {
									request: diagnosticRequest,
									actor: api.createActor(
										api.createTestAppRestoreWorkflow(api.db, api.writer, diagnosticRequest),
										{
											input: { request: diagnosticRequest },
											inspect(event) {
												const ref = event.actorRef
												if (event.type === '@xstate.actor')
													actorStarts.set(ref.sessionId, {
														id: 'id' in ref && typeof ref.id === 'string' ? ref.id : 'unnamed',
														started: performance.now()
													})
												if (event.type !== '@xstate.snapshot' || event.snapshot.status !== 'done')
													return
												const started = actorStarts.get(ref.sessionId)
												if (!started) return
												actorStarts.delete(ref.sessionId)
												const elapsed = performance.now() - started.started
												const stat = actorTimings.get(started.id) ?? {
													count: 0,
													totalMs: 0,
													maxMs: 0
												}
												stat.count++
												stat.totalMs += elapsed
												stat.maxMs = Math.max(stat.maxMs, elapsed)
												actorTimings.set(started.id, stat)
											}
										}
									)
								}
							: api.createTestAppRestore(restoreOptions)
						restoring.actor.start()
						const output = await api.toPromise(restoring.actor)
						const restoredAt = performance.now()
						await new Promise<void>((yes) => setTimeout(yes, 20))
						clearInterval(timer)
						clearInterval(progress)
						const metrics = {
							...workload,
							recordCount: payload.records.length,
							payloadJsonBytes,
							attachmentCount: payload.attachments.length,
							fileBytes: file.length,
							sealMs: sealedAt - start,
							openMs: openedAt - openStartedAt,
							restoreMs: restoredAt - restoreStartedAt,
							largestDelayMs,
							phaseDelays,
							actorTimings: reviewTrace ? Object.fromEntries(actorTimings) : undefined,
							restoreTimer,
							journalRoundTrips: null,
							writesIssued: api.issued(),
							journalBytes: new TextEncoder().encode(JSON.stringify(output.record)).length,
							outcome: output.outcome,
							planVersion: output.record?.intent.plan.version,
							restoreBatches: output.record?.intent.plan.batches.length
						}
						restoring.request.release()
						restoring.actor.stop()
						opening.release()
						envelope.stop()
						sealingRequest.release()
						sealingActor.stop()
						file.fill(0)
						await new Promise<void>((yes, no) => {
							const removal = indexedDB.deleteDatabase(databaseName)
							removal.onsuccess = () => yes()
							removal.onerror = () => no(removal.error)
						})
						return metrics
					},
					{ workload, reviewTrace }
				)
				await sampleHeap()
				if (heapFailures.length > 0) throw heapFailures[0]
				const metrics = {
					...result,
					journalExecution: 'main',
					dedicatedWorkersAtSamplingStart,
					heapScope: 'page-only',
					browser: browser.version(),
					platform: process.platform,
					architecture: process.arch,
					heapBaselineBytes: heaps[0],
					sampledPeakJsHeapBytes: Math.max(...heaps),
					heapSamples: heaps.length,
					rendererRssBaselineBytes: resident[0],
					sampledPeakRendererRssBytes: Math.max(...resident),
					rssSamples: resident.length,
					rendererProcesses: renderers.length
				}
				await writeFile(metricsPath, JSON.stringify(metrics, null, 2) + '\n', {
					flag: reviewLabel ? 'wx' : 'w'
				})
				expect(metrics.outcome).toBe('complete')
				console.log('Test app measurement:', JSON.stringify(metrics))
			} catch (error) {
				await writeFile(
					metricsPath.replace(/\.json$/, `-interrupted-${deadlineMs}.json`),
					JSON.stringify(
						{
							...workload,
							outcome: 'measurementInterrupted',
							deadlineMs,
							elapsedMs: Date.now() - startedAt,
							latestProgress,
							heapSamples: heaps.length,
							rssSamples: resident.length,
							pageClosed: page.isClosed()
						},
						null,
						2
					) + '\n'
				)
				throw error
			} finally {
				clearInterval(sampler)
				clearInterval(rssSampler)
				await Promise.all(heapReads)
				await cdp.detach().catch((error: unknown) => {
					if (!page.isClosed()) throw error
				})
			}
		},
		deadlineMs
	)
}

for (const interruption of ['release', 'identity']) {
	it(`drains a pending complete-graph read before clearing the request (${interruption})`, async () => {
		const page = await open(),
			value = await sample(page)
		const result = await page.evaluate(
			async ({ value, interruption }) => {
				const api = window.DLFRestoreQualification
				const opening = api.prepareArchiveOpen(new Uint8Array(value.file))
				const envelope = api
					.createActor(api.createArchiveEnvelopeMachine(), { input: { request: opening } })
					.start()
				const checked = await api.toPromise(envelope)
				if (checked.outcome !== 'integrityChecked') throw new Error('Invalid test file')
				const request = api.prepareTestAppRestore({
					...value,
					mode: 'new',
					archive: checked.archive
				})
				let ready = () => {},
					release = () => {},
					report = (_identityId: string | undefined) => {}
				const pending = new Promise<void>((yes) => {
						ready = yes
					}),
					gate = new Promise<void>((yes) => {
						release = yes
					})
				const machine = api.createTestAppRestoreWorkflow(api.db, api.writer, request).provide({
					actors: {
						identity: api.fromCallback(({ input, sendBack }) => {
							report = (identityId) => sendBack({ type: 'IDENTITY', binding: input, identityId })
							report(input.identityId)
						}),
						compare: api.fromPromise(async ({ input }) => {
							const row = await api.db.one(
								api.testAppDestinationGraphQuery(value.binding.workspaceId),
								{ tier: 'remote' }
							)
							const result = api.compareTestAppDestination(row, input.request)
							ready()
							await gate
							return result
						})
					}
				})
				const actor = api.createActor(machine, { input: { request } }).start()
				await pending
				actor.send({ type: 'INVALIDATE', binding: { ...value.binding, generation: 2 } })
				if (interruption === 'release') request.release()
				else {
					report(undefined)
					report(value.binding.identityId)
				}
				const draining = actor.getSnapshot().status
				const retained = checked.archive.readPayload().records.length
				const snapshot = JSON.stringify(actor.getSnapshot())
				release()
				const output = await api.toPromise(actor)
				let cleared = false
				try {
					checked.archive.readPayload()
				} catch {
					cleared = true
				}
				actor.stop()
				opening.release()
				envelope.stop()
				return { output, draining, retained, cleared, snapshot }
			},
			{ value, interruption }
		)
		expect(result.draining).toBe('active')
		expect(result.retained).toBe(4)
		expect(result.cleared).toBe(true)
		expect(result.snapshot).not.toContain('First line')
		expect(result.snapshot).not.toContain('AP+ACg==')
		expect(result.output.outcome).toBe(interruption === 'release' ? 'cancelled' : 'invalidated')
		expect(result.output.record?.checkpoint.kind).toBe('comparing')
		const resumed = await fullRestore(page, value, 'resume')
		expect(resumed.output.outcome).toBe('complete')
		expect(resumed.issued).toBe(5)
		await deleteJournal(page, value)
	})
}

it('finishes a failed graph read incomplete and resumes without replaying domain writes', async () => {
	const page = await open(),
		value = await sample(page)
	const result = await page.evaluate(async (value) => {
		const api = window.DLFRestoreQualification
		const open = api.prepareArchiveOpen(new Uint8Array(value.file))
		const envelope = api
			.createActor(api.createArchiveEnvelopeMachine(), { input: { request: open } })
			.start()
		const checked = await api.toPromise(envelope)
		if (checked.outcome !== 'integrityChecked') throw new Error('Invalid test file')
		const request = api.prepareTestAppRestore({ ...value, mode: 'new', archive: checked.archive })
		const machine = api.createTestAppRestoreWorkflow(api.db, api.writer, request).provide({
			actors: { compare: api.fromPromise(() => Promise.reject(new Error('Read failed'))) }
		})
		const actor = api.createActor(machine, { input: { request } }).start()
		const result = await api.toPromise(actor)
		request.release()
		actor.stop()
		open.release()
		envelope.stop()
		return { ...result, finalState: actor.getSnapshot().value }
	}, value)
	expect(result.outcome).toBe('incomplete')
	expect(result.finalState).toBe('incomplete')
	expect(result.record?.checkpoint.kind).toBe('comparing')
	const resumed = await fullRestore(page, value, 'resume')
	expect(resumed.output.outcome).toBe('complete')
	expect(resumed.issued).toBe(5)
	await deleteJournal(page, value)
})
