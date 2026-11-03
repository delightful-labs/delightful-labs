import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest'
import { chromium } from '@playwright/test'
import type { BrowserContext, Page } from '@playwright/test'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import type { WorkspaceCreationIdentity } from '../../src/lib/contracts/workspace-creation-journal.js'
import type {} from './journal-browser.js'

let web: ViteDevServer, profile: string, context: BrowserContext, page: Page
let errors: string[] = []
const url = 'http://127.0.0.1:6199/journal.html'
beforeAll(async () => {
	profile = await mkdtemp(join(tmpdir(), 'dlf-journal-'))
	web = await createServer({
		configFile: false,
		cacheDir: resolve('node_modules/.vite/dlf-creation-journal'),
		root: resolve('fixtures/private-creation'),
		server: { host: '127.0.0.1', port: 6199, strictPort: true, fs: { allow: [process.cwd()] } }
	})
	await web.listen()
	context = await launch()
})
afterAll(async () => {
	await context?.close()
	await web?.close()
	if (profile) await rm(profile, { recursive: true, force: true })
})
async function launch() {
	const browser = await chromium.launchPersistentContext(profile, {
		headless: true,
		channel: 'chromium'
	})
	browser.setDefaultTimeout(15000)
	return browser
}
async function openPage() {
	const current = await context.newPage()
	current.on('pageerror', (error) => errors.push(error.message))
	await current.goto(url)
	await current.waitForFunction(() => Boolean(window.journalFixture))
	return current
}
beforeEach(async () => {
	errors = []
	page = await openPage()
})
afterEach(async () => {
	await Promise.all(context.pages().map((current) => current.close()))
	await context.setOffline(false)
	expect(errors).toEqual([])
})
function input() {
	const identity: WorkspaceCreationIdentity = {
		hostId: 'fixture-host',
		accountId: crypto.randomUUID(),
		operationId: crypto.randomUUID(),
		workspaceId: crypto.randomUUID(),
		requestFingerprint: 'normalized-request'
	}
	return { name: `journal-${crypto.randomUUID()}`, identity }
}
const invalid = { kind: 'unavailable', reason: 'invalidRecord' }
const storageFailed = { kind: 'unavailable', reason: 'storageFailed' }

it('serializes competing inserts and compare-and-set advances across independent pages', async () => {
	const data = input(),
		peer = await openPage()
	const insertions = await Promise.all(
		[page, peer].map((current) =>
			current.evaluate(
				(data) => window.journalFixture.create(data.name).insertIntent(data.identity),
				data
			)
		)
	)
	expect(insertions.map((result) => result.kind).sort()).toEqual(['conflict', 'persisted'])
	const updates = await Promise.all(
		[page, peer].map((current) =>
			current.evaluate(
				(data) =>
					window.journalFixture
						.create(data.name)
						.advance(data.identity, 1, { kind: 'commitPossible' }),
				data
			)
		)
	)
	expect(updates.map((result) => result.kind).sort()).toEqual(['conflict', 'persisted'])
	for (const current of [page, peer])
		expect(
			await current.evaluate(
				(data) => window.journalFixture.create(data.name).read(data.identity),
				data
			)
		).toEqual({
			kind: 'found',
			record: {
				version: 1,
				identity: data.identity,
				revision: 2,
				evidence: { kind: 'commitPossible' }
			}
		})
})

it('isolates host, account and operation keys and rejects substitution of immutable request identity', async () => {
	const data = input()
	const results = await page.evaluate(async (data) => {
		const journal = window.journalFixture.create(data.name)
		const created = await journal.insertIntent(data.identity)
		const repeats = await journal.insertIntent(data.identity)
		const workspace = await journal.advance(
			{ ...data.identity, workspaceId: crypto.randomUUID() },
			1,
			{ kind: 'commitPossible' }
		)
		const fingerprint = await journal.advance(
			{ ...data.identity, requestFingerprint: 'different' },
			1,
			{ kind: 'commitPossible' }
		)
		const isolated = await Promise.all(
			[
				{ ...data.identity, hostId: 'other' },
				{ ...data.identity, accountId: crypto.randomUUID() },
				{ ...data.identity, operationId: crypto.randomUUID() }
			].map((identity) => journal.read(identity))
		)
		return {
			created,
			repeats,
			workspace,
			fingerprint,
			isolated,
			retained: await journal.read(data.identity)
		}
	}, data)
	expect(results.created.kind).toBe('persisted')
	for (const result of [results.repeats, results.workspace, results.fingerprint])
		expect(result).toEqual({ kind: 'conflict' })
	expect(results.isolated).toEqual([{ kind: 'missing' }, { kind: 'missing' }, { kind: 'missing' }])
	expect(results.retained).toEqual({
		kind: 'found',
		record: { version: 1, identity: data.identity, revision: 1, evidence: { kind: 'intent' } }
	})
})

it('rejects unsafe revisions and illegal evidence without altering a valid record', async () => {
	const data = input()
	const results = await page.evaluate(async (data) => {
		const journal = window.journalFixture.create(data.name)
		await journal.insertIntent(data.identity)
		const unsafe = await Promise.all(
			[0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1].map(
				(revision) => journal.advance(data.identity, revision, { kind: 'commitPossible' })
			)
		)
		const skipped = await journal.advance(data.identity, 1, { kind: 'authorityAccepted' })
		const unchanged = await journal.advance(data.identity, 1, { kind: 'intent' })
		const stale = await journal.advance(data.identity, 2, { kind: 'commitPossible' })
		const missing = await journal.advance(
			{ ...data.identity, operationId: crypto.randomUUID() },
			1,
			{ kind: 'commitPossible' }
		)
		return {
			unsafe,
			skipped,
			unchanged,
			stale,
			missing,
			retained: await journal.read(data.identity)
		}
	}, data)
	for (const result of [...results.unsafe, results.skipped, results.unchanged])
		expect(result).toEqual(invalid)
	expect(results.stale).toEqual({ kind: 'conflict' })
	expect(results.missing).toEqual({ kind: 'conflict' })
	expect(results.retained.kind === 'found' && results.retained.record.revision).toBe(1)
})

it.each(['authorityAccepted', 'denied', 'conflict', 'abortFromIntent', 'abortFromPossible'])(
	'persists and freezes terminal evidence: %s',
	async (kind) => {
		const data = input()
		const results = await page.evaluate(
			async ({ data, kind }) => {
				const journal = window.journalFixture.create(data.name)
				await journal.insertIntent(data.identity)
				let revision = 1
				if (kind !== 'abortFromIntent') {
					await journal.advance(data.identity, 1, { kind: 'commitPossible' })
					revision = 2
				}
				const evidence =
					kind === 'denied' || kind === 'conflict'
						? ({
								kind: 'authorityRejected',
								reason: kind
							} satisfies import('../../src/lib/contracts/workspace-creation-journal.js').WorkspaceCreationEvidence)
						: kind === 'authorityAccepted'
							? ({
									kind: 'authorityAccepted'
								} satisfies import('../../src/lib/contracts/workspace-creation-journal.js').WorkspaceCreationEvidence)
							: ({
									kind: 'abortedBeforeCommit'
								} satisfies import('../../src/lib/contracts/workspace-creation-journal.js').WorkspaceCreationEvidence)
				const result = await journal.advance(data.identity, revision, evidence)
				const overwrite = await journal.advance(data.identity, revision + 1, {
					kind: 'commitPossible'
				})
				return { result, overwrite, retained: await journal.read(data.identity) }
			},
			{ data, kind }
		)
		expect(results.result.kind).toBe('persisted')
		expect(results.overwrite).toEqual(invalid)
		if (results.result.kind !== 'persisted') throw new Error('Expected persisted terminal record')
		expect(results.retained).toEqual({ kind: 'found', record: results.result.record })
	}
)

it('snapshots caller data and stores only the declared identity fields', async () => {
	const data = input()
	const result = await page.evaluate(async (data) => {
		const identity = {
			...data.identity,
			credential: 'must-not-persist',
			payload: 'must-not-persist'
		}
		const journal = window.journalFixture.create(data.name)
		const pending = journal.insertIntent(identity)
		identity.workspaceId = 'changed-after-call'
		identity.requestFingerprint = 'changed-after-call'
		await pending
		const evidence: { kind: 'commitPossible' | 'authorityAccepted' } = { kind: 'commitPossible' }
		const advancing = journal.advance(data.identity, 1, evidence)
		evidence.kind = 'authorityAccepted'
		await advancing
		const key = { ...data.identity }
		const reading = journal.read(key)
		key.accountId = 'changed-after-call'
		return {
			read: await reading,
			raw: await window.journalFixture.rawGet(data.name, [
				data.identity.hostId,
				data.identity.accountId,
				data.identity.operationId
			])
		}
	}, data)
	const record = {
		version: 1,
		identity: data.identity,
		revision: 2,
		evidence: { kind: 'commitPossible' }
	}
	expect(result).toEqual({ read: { kind: 'found', record }, raw: record })
})

it('preserves corrupt and unsupported records, including stored undefined, instead of treating them as missing', async () => {
	const data = input()
	const results = await page.evaluate(async (data) => {
		const journal = window.journalFixture.create(data.name),
			key = [data.identity.hostId, data.identity.accountId, data.identity.operationId]
		const base = { version: 1, identity: data.identity, revision: 1, evidence: { kind: 'intent' } }
		const malformed: unknown[] = [
			undefined,
			null,
			{},
			{ ...base, version: 'bad' },
			{ ...base, revision: 1.5 },
			{ ...base, revision: Number.MAX_SAFE_INTEGER },
			{ ...base, identity: { ...data.identity, accountId: 'wrong-key' } },
			{ ...base, evidence: { kind: 'authorityAccepted' } },
			{ ...base, extra: 'unexpected' },
			{ ...base, evidence: { kind: 'intent', secret: 'unexpected' } },
			{ ...base, identity: { ...data.identity, secret: 'unexpected' } }
		]
		const observations = []
		for (const value of [...malformed, { ...base, version: 2 }]) {
			await window.journalFixture.rawPut(data.name, key, value)
			const read = await journal.read(data.identity),
				insert = await journal.insertIntent(data.identity),
				advance = await journal.advance(data.identity, 1, { kind: 'commitPossible' })
			observations.push({
				read,
				insert,
				advance,
				unchanged:
					JSON.stringify(await window.journalFixture.rawGet(data.name, key)) ===
					JSON.stringify(value)
			})
		}
		return observations
	}, data)
	for (const [index, result] of results.entries()) {
		const expected =
			index === results.length - 1 ? { kind: 'unavailable', reason: 'unsupportedVersion' } : invalid
		expect(result).toEqual({ read: expected, insert: expected, advance: expected, unchanged: true })
	}
})

it('refuses a future database version and incompatible store layouts without repairing them', async () => {
	const data = input()
	const results = await page.evaluate(async (data) => {
		const observations = []
		for (const layout of ['future', 'extraStore', 'keyPath']) {
			const name = `${data.name}-${layout}`
			const db = await window.journalFixture.open(
				name,
				layout === 'future' ? 2 : 1,
				layout === 'extraStore' || layout === 'keyPath' ? layout : 'normal'
			)
			const before = { version: db.version, stores: Array.from(db.objectStoreNames) }
			db.close()
			const journal = window.journalFixture.create(name)
			const read = await journal.read(data.identity),
				insert = await journal.insertIntent(data.identity),
				advance = await journal.advance(data.identity, 1, { kind: 'commitPossible' })
			const reopened = await window.journalFixture.open(name, before.version)
			const after = { version: reopened.version, stores: Array.from(reopened.objectStoreNames) }
			reopened.close()
			observations.push({ read, insert, advance, before, after })
		}
		return observations
	}, data)
	for (const [index, result] of results.entries()) {
		const expected =
			index === 0 ? { kind: 'unavailable', reason: 'unsupportedVersion' } : storageFailed
		expect(result.read).toEqual(expected)
		expect(result.insert).toEqual(expected)
		expect(result.advance).toEqual(expected)
		expect(result.after).toEqual(result.before)
	}
})

it('reports a real storage transaction abort after add success, never premature persistence', async () => {
	const data = input()
	const result = await page.evaluate(async (data) => {
		const initial = await window.journalFixture.open(data.name)
		initial.close()
		let addSucceeded = false,
			aborted = false
		const factory = window.journalFixture.factory((name, version) => {
			const request = indexedDB.open(name, version)
			request.addEventListener('success', () => {
				const db = request.result,
					nativeTransaction = db.transaction.bind(db)
				db.transaction = (stores, mode, options) => {
					const tx = nativeTransaction(stores, mode, options)
					tx.addEventListener('abort', () => {
						aborted = true
					})
					const store = tx.objectStore('creationOperations'),
						nativeAdd = store.add.bind(store)
					store.add = (value: unknown, key?: IDBValidKey) => {
						const write = nativeAdd(value, key)
						write.addEventListener('success', () => {
							addSucceeded = true
							tx.abort()
						})
						return write
					}
					return tx
				}
			})
			return request
		})
		const result = await window.journalFixture
			.create(data.name, factory)
			.insertIntent(data.identity)
		return {
			result,
			addSucceeded,
			aborted,
			read: await window.journalFixture.create(data.name).read(data.identity)
		}
	}, data)
	expect(result).toEqual({
		result: storageFailed,
		addSucceeded: true,
		aborted: true,
		read: { kind: 'missing' }
	})
})

it.each(['newUpgrade', 'lateSuccess'])(
	'disposes an abandoned blocked-open request: %s',
	async (scenario) => {
		const data = input()
		const result = await page.evaluate(
			async ({ data, scenario }) => {
				if (scenario === 'lateSuccess') {
					const db = await window.journalFixture.open(data.name)
					db.close()
				}
				let late = ''
				let pendingResult:
					| import('../../src/lib/contracts/workspace-creation-journal.js').WorkspaceCreationJournalWrite
					| undefined
				const disposed = new Promise<void>((resolve) => {
					const factory = window.journalFixture.factory((name, version) => {
						const request = indexedDB.open(name, version)
						request.addEventListener('success', () => {
							late = 'success'
							resolve()
						})
						request.addEventListener('error', (event) => {
							event.preventDefault()
							late = request.error?.name ?? 'error'
							resolve()
						})
						queueMicrotask(() => request.dispatchEvent(new Event('blocked')))
						return request
					})
					window.journalFixture
						.create(data.name, factory)
						.insertIntent(data.identity)
						.then((result) => {
							pendingResult = result
						})
				})
				await disposed
				const read = await window.journalFixture.create(data.name).read(data.identity)
				// A successful delete also proves the late-acquired connection was closed.
				let deleteBlocked = false
				await new Promise<void>((resolve, reject) => {
					const deletion = indexedDB.deleteDatabase(data.name)
					deletion.onblocked = () => {
						deleteBlocked = true
						reject(new Error('Late connection leaked'))
					}
					deletion.onerror = () => reject(deletion.error)
					deletion.onsuccess = () => resolve()
				})
				return { result: pendingResult, late, read, deleteBlocked }
			},
			{ data, scenario }
		)
		expect(result).toEqual({
			result: storageFailed,
			late: scenario === 'newUpgrade' ? 'AbortError' : 'success',
			read: { kind: 'missing' },
			deleteBlocked: false
		})
	}
)

it('classifies open failure and rejects malformed input before creating a database', async () => {
	const data = input()
	const result = await page.evaluate(async (data) => {
		let opens = 0
		const factory = window.journalFixture.factory(() => {
			opens += 1
			throw new DOMException('Fixture denial', 'SecurityError')
		})
		const journal = window.journalFixture.create(data.name, factory)
		const bad = await journal.insertIntent({ ...data.identity, operationId: ' ' })
		const badRead = await journal.read({ ...data.identity, accountId: '' })
		const blankName = await window.journalFixture.create(' ', factory).insertIntent(data.identity)
		const before = opens
		const failed = await journal.insertIntent(data.identity)
		return { bad, badRead, blankName, before, failed, opens }
	}, data)
	expect(result).toEqual({
		bad: invalid,
		badRead: invalid,
		blankName: invalid,
		before: 0,
		failed: storageFailed,
		opens: 1
	})
})

it('retains exact journal evidence after SIGKILL and restarts without replay', async () => {
	const intent = input(),
		possible = input(),
		accepted = input()
	const data = [intent, possible, accepted]
	await context.setOffline(true)
	const before = await page.evaluate(async (data) => {
		const records = []
		for (const [index, input] of data.entries()) {
			const journal = window.journalFixture.create(input.name)
			await journal.insertIntent(input.identity)
			if (index >= 1) await journal.advance(input.identity, 1, { kind: 'commitPossible' })
			if (index >= 2) await journal.advance(input.identity, 2, { kind: 'authorityAccepted' })
			records.push(await journal.read(input.identity))
		}
		return records
	}, data)
	for (const record of before) expect(record.kind).toBe('found')
	const browser = context.browser()
	if (!browser) throw new Error('Missing fixture browser')
	const cdp = await browser.newBrowserCDPSession(),
		info = await cdp.send('SystemInfo.getProcessInfo')
	const processInfo = info.processInfo.find((item) => item.type === 'browser')
	if (!processInfo) throw new Error('Missing browser process ID')
	process.kill(processInfo.id, 'SIGKILL')
	await expect.poll(() => browser.isConnected(), { timeout: 15000 }).toBe(false)
	await context.close()
	context = await launch()
	page = await openPage()
	await context.setOffline(true)
	const after = await page.evaluate(
		(data) =>
			Promise.all(
				data.map((input) => window.journalFixture.create(input.name).read(input.identity))
			),
		data
	)
	expect(after).toEqual(before)
	// Reading recovered intent/commitPossible does not advance either record or issue any SDK write.
	expect(
		after.map((record) => (record.kind === 'found' ? record.record.evidence.kind : record.kind))
	).toEqual(['intent', 'commitPossible', 'authorityAccepted'])
}, 60000)
