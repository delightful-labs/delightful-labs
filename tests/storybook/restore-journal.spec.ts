import { expect, test } from '@playwright/test'
import { resolve } from 'node:path'
import wire from '../fixtures/restore-journal-v1.json' with { type: 'json' }

test('public journal codec preserves unknown-write facts and rejects malformed wire data in Chromium', async ({
	page
}) => {
	await page.goto('/')
	await page.addScriptTag({ path: resolve('.svelte-kit/notebook-browser/notebook.js') })
	const result = await page.evaluate((wire) => {
		const api = window.DLFNotebook,
			utf8 = new TextEncoder()
		const record = api.decodeRestoreJournalRecord(utf8.encode(JSON.stringify(wire)))
		const pending = api.parseRestoreJournalRecord({
			...record,
			revision: 1,
			checkpoint: {
				kind: 'writing',
				completed: [],
				current: {
					status: 'issued',
					writeId: 'prepare',
					issuance: 1,
					settlement: { local: 'persisted', remote: 'unobserved' },
					transactionId: null
				}
			}
		})
		const reopened = api.decodeRestoreJournalRecord(api.encodeRestoreJournalRecord(pending))
		const errors: string[] = []
		for (const text of [
			JSON.stringify(wire).replace('"revision":0', '"revision":0,"revisi\\u006fn":1'),
			JSON.stringify(wire).replace('"version":1', '"version":1.00000000000000001'),
			JSON.stringify({ ...wire, version: 2 })
		]) {
			try {
				api.decodeRestoreJournalRecord(utf8.encode(text))
			} catch (error) {
				errors.push(error instanceof Error ? error.message : 'unexpected')
			}
		}
		if (reopened.checkpoint.kind !== 'writing') throw new Error('Unexpected checkpoint upgrade')
		return {
			initial: record,
			current: reopened.checkpoint.current,
			frozen:
				Object.isFrozen(reopened) &&
				Object.isFrozen(reopened.intent.plan.mappings) &&
				Object.isFrozen(reopened.checkpoint.current),
			errors
		}
	}, wire)
	expect(result).toEqual({
		initial: wire,
		current: {
			status: 'issued',
			writeId: 'prepare',
			issuance: 1,
			settlement: { local: 'persisted', remote: 'unobserved' },
			transactionId: null
		},
		frozen: true,
		errors: ['invalidJournalEncoding', 'invalidJournalEncoding', 'unsupportedJournalVersion']
	})
})

// Real native transactions through the built public package; all namespaces are disposable.
test('browser journal resumes after reload and atomically rejects stale revisions', async ({
	page
}) => {
	await page.goto('/')
	await page.addScriptTag({ path: resolve('.svelte-kit/notebook-browser/notebook.js') })
	const databaseName = `dlf-journal-review-${crypto.randomUUID()}`
	const result = await page.evaluate(
		async ({ wire, databaseName }) => {
			const api = window.DLFNotebook
			const initial = api.parseRestoreJournalRecord(wire)
			const binding = {
				applicationId: initial.intent.operation.applicationId,
				identityId: initial.intent.operation.identityId,
				environment: initial.intent.operation.environment,
				operationId: initial.intent.operation.operationId,
				workspaceId: initial.intent.operation.destinationWorkspaceId,
				generation: 1
			}
			async function run(
				command: import('../../src/lib/backup/restore-journal-browser.js').BrowserJournalCommand
			) {
				const request = api.prepareBrowserRestoreJournal({ databaseName, binding, command })
				const actor = api.createActor(api.createBrowserRestoreJournalMachine(), {
					input: { request }
				})
				actor.start()
				const output = await api.toPromise(actor)
				const record = output.record?.readRecord()
				const snapshot = JSON.stringify(actor.getSnapshot())
				request.release()
				actor.stop()
				return { outcome: output.outcome, journal: output.journal, record, snapshot }
			}
			const initialized = await run({ mode: 'initialize' })
			const created = await run({ mode: 'create', record: initial })
			const candidate = api.parseRestoreJournalRecord({
				...initial,
				revision: 1,
				checkpoint: {
					kind: 'writing',
					completed: [],
					current: {
						status: 'issued',
						writeId: 'prepare',
						issuance: 1,
						settlement: { local: 'unobserved', remote: 'unobserved' },
						transactionId: null
					}
				}
			})
			const updated = await run({ mode: 'update', expectedRevision: 0, record: candidate })
			const replay = await run({ mode: 'update', expectedRevision: 0, record: candidate })
			const stale = await run({
				mode: 'update',
				expectedRevision: 0,
				record: { ...candidate, checkpoint: initial.checkpoint }
			})
			return {
				initialized: initialized.outcome,
				created: created.outcome,
				updated: updated.outcome,
				settlement: updated.journal,
				replay: replay.outcome,
				stale: stale.outcome,
				privateSnapshot: !updated.snapshot.includes('destination-note')
			}
		},
		{ wire, databaseName }
	)
	expect(result).toEqual({
		initialized: 'initialized',
		created: 'created',
		updated: 'updated',
		settlement: { settlement: 'committed', durability: 'strict' },
		replay: 'existing',
		stale: 'conflict',
		privateSnapshot: true
	})
	await page.reload()
	await page.addScriptTag({ path: resolve('.svelte-kit/notebook-browser/notebook.js') })
	const resumed = await page.evaluate(
		async ({ wire, databaseName }) => {
			const api = window.DLFNotebook,
				initial = api.parseRestoreJournalRecord(wire)
			const request = api.prepareBrowserRestoreJournal({
				databaseName,
				binding: {
					applicationId: initial.intent.operation.applicationId,
					identityId: initial.intent.operation.identityId,
					environment: initial.intent.operation.environment,
					operationId: initial.intent.operation.operationId,
					workspaceId: initial.intent.operation.destinationWorkspaceId,
					generation: 2
				},
				command: { mode: 'load', intent: initial.intent }
			})
			const actor = api.createActor(api.createBrowserRestoreJournalMachine(), {
				input: { request }
			})
			actor.start()
			const result = await api.toPromise(actor)
			const record = result.record?.readRecord()
			request.release()
			actor.stop()
			await new Promise<void>((resolve, reject) => {
				const request = indexedDB.deleteDatabase(databaseName)
				request.onsuccess = () => resolve()
				request.onerror = () => reject(request.error)
				request.onblocked = () => reject(new Error('Leaked database connection'))
			})
			return {
				outcome: result.outcome,
				revision: record?.revision,
				current: record?.checkpoint.kind === 'writing' ? record.checkpoint.current : null
			}
		},
		{ wire, databaseName }
	)
	expect(resumed).toEqual({
		outcome: 'loaded',
		revision: 1,
		current: {
			status: 'issued',
			writeId: 'prepare',
			issuance: 1,
			settlement: { local: 'unobserved', remote: 'unobserved' },
			transactionId: null
		}
	})
})

for (const stage of ['staging', 'committing']) {
	test(`cancellation during ${stage} retains native commit facts`, async ({ page }) => {
		await page.goto('/')
		await page.addScriptTag({ path: resolve('.svelte-kit/notebook-browser/notebook.js') })
		const result = await page.evaluate(
			async ({ wire, stage }) => {
				const api = window.DLFNotebook,
					initial = api.parseRestoreJournalRecord(wire)
				const databaseName = `dlf-journal-cancel-${crypto.randomUUID()}`
				const binding = {
					applicationId: initial.intent.operation.applicationId,
					identityId: initial.intent.operation.identityId,
					environment: initial.intent.operation.environment,
					operationId: initial.intent.operation.operationId,
					workspaceId: initial.intent.operation.destinationWorkspaceId,
					generation: 1
				}
				async function run(
					command: import('../../src/lib/backup/restore-journal-browser.js').BrowserJournalCommand,
					cancel = false
				) {
					const request = api.prepareBrowserRestoreJournal({ databaseName, binding, command })
					const actor = api.createActor(api.createBrowserRestoreJournalMachine(), {
						input: { request }
					})
					let cancelled = false
					actor.subscribe((snapshot) => {
						if (
							cancel &&
							!cancelled &&
							snapshot.matches({
								active: { transaction: stage === 'staging' ? 'staging' : 'committing' }
							})
						) {
							cancelled = true
							actor.send({ type: 'CANCEL' })
						}
					})
					actor.start()
					const result = await api.toPromise(actor)
					const record = result.record?.readRecord()
					request.release()
					actor.stop()
					return {
						outcome: result.outcome,
						settlement: result.journal.settlement,
						revision: record?.revision
					}
				}
				await run({ mode: 'initialize' })
				await run({ mode: 'create', record: initial })
				const candidate = api.parseRestoreJournalRecord({ ...initial, revision: 1 })
				const cancelled = await run(
					{ mode: 'update', expectedRevision: 0, record: candidate },
					true
				)
				const loaded = await run({ mode: 'load', intent: initial.intent })
				await new Promise<void>((resolve, reject) => {
					const request = indexedDB.deleteDatabase(databaseName)
					request.onsuccess = () => resolve()
					request.onerror = () => reject(request.error)
					request.onblocked = () => reject(new Error('Leaked database connection'))
				})
				return { cancelled, loaded }
			},
			{ wire, stage }
		)
		expect(result.cancelled.outcome).toBe('cancelled')
		expect(result.cancelled.settlement).toBe(stage === 'staging' ? 'aborted' : 'committed')
		expect(result.loaded.revision).toBe(stage === 'staging' ? 0 : 1)
	})
}

test('missing storage is not recreated and malformed rows are preserved', async ({ page }) => {
	await page.goto('/')
	await page.addScriptTag({ path: resolve('.svelte-kit/notebook-browser/notebook.js') })
	const result = await page.evaluate(async (wire) => {
		const api = window.DLFNotebook,
			initial = api.parseRestoreJournalRecord(wire)
		const databaseName = `dlf-journal-invalid-${crypto.randomUUID()}`
		const binding = {
			applicationId: initial.intent.operation.applicationId,
			identityId: initial.intent.operation.identityId,
			environment: initial.intent.operation.environment,
			operationId: initial.intent.operation.operationId,
			workspaceId: initial.intent.operation.destinationWorkspaceId,
			generation: 1
		}
		async function run(
			command: import('../../src/lib/backup/restore-journal-browser.js').BrowserJournalCommand
		) {
			const request = api.prepareBrowserRestoreJournal({ databaseName, binding, command })
			const actor = api.createActor(api.createBrowserRestoreJournalMachine(), {
				input: { request }
			})
			actor.start()
			const result = await api.toPromise(actor)
			request.release()
			actor.stop()
			return result.outcome === 'failed' ? result.code : result.outcome
		}
		const unavailable = await run({ mode: 'load', intent: initial.intent })
		const exists = (await indexedDB.databases()).some((db) => db.name === databaseName)
		await run({ mode: 'initialize' })
		const missing = await run({ mode: 'load', intent: initial.intent })
		const key = JSON.stringify([
			binding.applicationId,
			binding.environment,
			binding.identityId,
			binding.operationId
		])
		const raw = new Uint8Array([1, 2, 3])
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = indexedDB.open(databaseName, 1)
			request.onsuccess = () => resolve(request.result)
			request.onerror = () => reject(request.error)
		})
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction('restoreOperations', 'readwrite')
			tx.objectStore('restoreOperations').put(raw, key)
			tx.oncomplete = () => resolve()
			tx.onabort = () => reject(tx.error)
		})
		const malformed = await run({ mode: 'create', record: initial })
		const retained = await new Promise<unknown>((resolve, reject) => {
			const tx = db.transaction('restoreOperations')
			const request = tx.objectStore('restoreOperations').get(key)
			// A successful request can precede transaction completion and keep close() pending.
			tx.oncomplete = () => resolve(request.result)
			tx.onabort = () => reject(tx.error)
			request.onerror = () => reject(request.error)
		})
		db.close()
		await new Promise<void>((resolve, reject) => {
			const request = indexedDB.deleteDatabase(databaseName)
			request.onsuccess = () => resolve()
			request.onerror = () => reject(request.error)
			request.onblocked = () => reject(new Error('Leaked database connection'))
		})
		return {
			unavailable,
			exists,
			missing,
			malformed,
			preserved:
				retained instanceof Uint8Array && retained.every((byte, index) => byte === raw[index])
		}
	}, wire)
	expect(result).toEqual({
		unavailable: 'unavailable',
		exists: false,
		missing: 'missing',
		malformed: 'invalidJournalEncoding',
		preserved: true
	})
})

test('native journal CAS retains a rejected retry and content-match completion after reload', async ({
	page
}) => {
	await page.goto('/')
	await page.addScriptTag({ path: resolve('.svelte-kit/notebook-browser/notebook.js') })
	const databaseName = `dlf-journal-attempt-${crypto.randomUUID()}`
	const result = await page.evaluate(
		async ({ wire, databaseName }) => {
			const api = window.DLFNotebook,
				initial = api.parseRestoreJournalRecord(wire),
				scope = initial.intent.operation
			const binding = {
				applicationId: scope.applicationId,
				environment: scope.environment,
				identityId: scope.identityId,
				operationId: scope.operationId,
				workspaceId: scope.destinationWorkspaceId,
				generation: 1
			}
			async function run(
				command: import('../../src/lib/backup/restore-journal-browser.js').BrowserJournalCommand
			) {
				const request = api.prepareBrowserRestoreJournal({ databaseName, binding, command })
				const actor = api.createActor(api.createBrowserRestoreJournalMachine(), {
					input: { request }
				})
				try {
					actor.start()
					const output = await api.toPromise(actor)
					return {
						outcome: output.outcome,
						settlement: output.journal.settlement,
						record: output.record?.readRecord()
					}
				} finally {
					request.release()
					actor.stop()
				}
			}
			const initialized = await run({ mode: 'initialize' })
			const created = await run({ mode: 'create', record: initial })
			const issued = api.parseRestoreJournalRecord({
				...initial,
				revision: 1,
				checkpoint: {
					kind: 'writing',
					completed: [],
					current: {
						status: 'issued',
						writeId: 'prepare',
						issuance: 1,
						settlement: { local: 'unobserved', remote: 'unobserved' },
						transactionId: null
					}
				}
			})
			const issuance = await run({ mode: 'update', expectedRevision: 0, record: issued })
			const rejectedAttempt = {
				issuance: 1,
				transactionId: 'rejected-transaction',
				settlement: { local: 'persisted', remote: 'rejected' }
			}
			const retry = {
				writeId: 'prepare',
				issuance: 2,
				transactionId: null,
				settlement: { local: 'unobserved', remote: 'unobserved' },
				lastRejectedAttempt: rejectedAttempt
			}
			const unconfirmedRetry = api.parseRestoreJournalRecord({
				...initial,
				revision: 2,
				checkpoint: { kind: 'writing', completed: [], current: { status: 'issued', ...retry } }
			})
			const blocked = await run({ mode: 'update', expectedRevision: 1, record: unconfirmedRetry })
			const rejected = api.parseRestoreJournalRecord({
				...initial,
				revision: 2,
				checkpoint: {
					kind: 'writing',
					completed: [],
					current: { status: 'issued', writeId: 'prepare', ...rejectedAttempt }
				}
			})
			const rejection = await run({ mode: 'update', expectedRevision: 1, record: rejected })
			const retried = api.parseRestoreJournalRecord({
				...initial,
				revision: 3,
				checkpoint: { kind: 'writing', completed: [], current: { status: 'issued', ...retry } }
			})
			const restarted = await run({ mode: 'update', expectedRevision: 2, record: retried })
			const completion = {
				basis: 'remoteContentMatch',
				writeId: 'prepare',
				contentSha256: initial.intent.plan.preparation.expectedContentSha256,
				localPersistence: 'persisted',
				attempt: retry
			}
			const candidate = api.parseRestoreJournalRecord({
				...initial,
				revision: 4,
				checkpoint: {
					kind: 'writing',
					completed: [completion],
					current: { status: 'notIssued', writeId: 'batch-notes', issuance: 0 }
				}
			})
			const completed = await run({ mode: 'update', expectedRevision: 3, record: candidate })
			return {
				outcomes: [
					initialized.outcome,
					created.outcome,
					issuance.outcome,
					blocked.outcome,
					rejection.outcome,
					restarted.outcome,
					completed.outcome
				],
				settlement: completed.settlement,
				record: completed.record
			}
		},
		{ wire, databaseName }
	)
	expect(result.outcomes).toEqual([
		'initialized',
		'created',
		'updated',
		'conflict',
		'updated',
		'updated',
		'updated'
	])
	expect(result.settlement).toBe('committed')
	await page.reload()
	await page.addScriptTag({ path: resolve('.svelte-kit/notebook-browser/notebook.js') })
	const resumed = await page.evaluate(
		async ({ wire, databaseName }) => {
			const api = window.DLFNotebook,
				initial = api.parseRestoreJournalRecord(wire),
				scope = initial.intent.operation
			const request = api.prepareBrowserRestoreJournal({
				databaseName,
				binding: {
					applicationId: scope.applicationId,
					environment: scope.environment,
					identityId: scope.identityId,
					operationId: scope.operationId,
					workspaceId: scope.destinationWorkspaceId,
					generation: 2
				},
				command: { mode: 'load', intent: initial.intent }
			})
			const actor = api.createActor(api.createBrowserRestoreJournalMachine(), {
				input: { request }
			})
			actor.start()
			const result = await api.toPromise(actor)
			const record = result.record?.readRecord()
			request.release()
			actor.stop()
			await new Promise<void>((resolve, reject) => {
				const request = indexedDB.deleteDatabase(databaseName)
				request.onsuccess = () => resolve()
				request.onerror = () => reject(request.error)
				request.onblocked = () => reject(new Error('Leaked database connection'))
			})
			return { outcome: result.outcome, record }
		},
		{ wire, databaseName }
	)
	expect(resumed.outcome).toBe('loaded')
	expect(resumed.record).toEqual(result.record)
	const entry =
		resumed.record?.checkpoint.kind === 'writing'
			? resumed.record.checkpoint.completed[0]
			: undefined
	expect(entry).toMatchObject({
		basis: 'remoteContentMatch',
		attempt: {
			issuance: 2,
			transactionId: null,
			settlement: { local: 'unobserved', remote: 'unobserved' },
			lastRejectedAttempt: {
				issuance: 1,
				transactionId: 'rejected-transaction',
				settlement: { local: 'persisted', remote: 'rejected' }
			}
		}
	})
})

test('only explicit initialization creates schema, synchronously within the upgrade callback', async ({
	page
}) => {
	await page.goto('/')
	await page.addScriptTag({ path: resolve('.svelte-kit/notebook-browser/notebook.js') })
	const result = await page.evaluate(async (wire) => {
		const api = window.DLFNotebook,
			record = api.parseRestoreJournalRecord(wire),
			scope = record.intent.operation
		const binding = {
			applicationId: scope.applicationId,
			environment: scope.environment,
			identityId: scope.identityId,
			operationId: scope.operationId,
			workspaceId: scope.destinationWorkspaceId,
			generation: 1
		}
		const nativeOpen = indexedDB.open.bind(indexedDB),
			nativeCreate = IDBDatabase.prototype.createObjectStore
		let inside = false
		const mutations: boolean[] = []
		indexedDB.open = (name, version) => {
			const request = nativeOpen(name, version)
			Object.defineProperty(request, 'onupgradeneeded', {
				set(handler: IDBOpenDBRequest['onupgradeneeded']) {
					request.addEventListener('upgradeneeded', (event) => {
						inside = true
						try {
							handler?.call(request, event)
						} finally {
							inside = false
						}
					})
				}
			})
			return request
		}
		IDBDatabase.prototype.createObjectStore = function (this: IDBDatabase, name, options) {
			mutations.push(inside)
			return nativeCreate.call(this, name, options)
		}
		const outputs = []
		try {
			const commands: import('../../src/lib/backup/restore-journal-browser.js').BrowserJournalCommand[] =
				[
					{ mode: 'initialize' },
					{ mode: 'load', intent: record.intent },
					{ mode: 'create', record },
					{
						mode: 'update',
						expectedRevision: 0,
						record: api.parseRestoreJournalRecord({ ...record, revision: 1 })
					}
				]
			for (const command of commands) {
				const databaseName = `dlf-upgrade-policy-${crypto.randomUUID()}`
				const request = api.prepareBrowserRestoreJournal({ databaseName, binding, command })
				const actor = api
					.createActor(api.createBrowserRestoreJournalMachine(), { input: { request } })
					.start()
				try {
					const output = await api.toPromise(actor)
					outputs.push({
						mode: command.mode,
						outcome: output.outcome,
						exists: (await indexedDB.databases()).some((db) => db.name === databaseName)
					})
				} finally {
					request.release()
					actor.stop()
				}
				await new Promise<void>((resolve, reject) => {
					const deletion = indexedDB.deleteDatabase(databaseName)
					deletion.onsuccess = () => resolve()
					deletion.onerror = () => reject(deletion.error)
					deletion.onblocked = () => reject(new Error('Connection leaked'))
				})
			}
			return { outputs, mutations }
		} finally {
			indexedDB.open = nativeOpen
			IDBDatabase.prototype.createObjectStore = nativeCreate
		}
	}, wire)
	expect(result).toEqual({
		outputs: [
			{ mode: 'initialize', outcome: 'initialized', exists: true },
			{ mode: 'load', outcome: 'unavailable', exists: false },
			{ mode: 'create', outcome: 'unavailable', exists: false },
			{ mode: 'update', outcome: 'unavailable', exists: false }
		],
		mutations: [true]
	})
})

for (const interruption of ['CANCEL', 'SHUTDOWN', 'release', 'stop', 'creationFailure']) {
	test(`journal upgrade handles ${interruption} without leaving schema or connections`, async ({
		page
	}) => {
		await page.goto('/')
		await page.addScriptTag({ path: resolve('.svelte-kit/notebook-browser/notebook.js') })
		const result = await page.evaluate(
			async ({ wire, interruption }) => {
				const api = window.DLFNotebook,
					record = api.parseRestoreJournalRecord(wire),
					scope = record.intent.operation
				const databaseName = `dlf-upgrade-interrupt-${crypto.randomUUID()}`
				const binding = {
					applicationId: scope.applicationId,
					environment: scope.environment,
					identityId: scope.identityId,
					operationId: scope.operationId,
					workspaceId: scope.destinationWorkspaceId,
					generation: 1
				}
				const nativeOpen = indexedDB.open.bind(indexedDB),
					nativeCreate = IDBDatabase.prototype.createObjectStore
				let finishOpen = () => {}
				const openSettled = new Promise<void>((resolve) => {
					finishOpen = resolve
				})
				indexedDB.open = (name, version) => {
					const request = nativeOpen(name, version)
					request.addEventListener('error', () => finishOpen())
					request.addEventListener('success', () => finishOpen())
					return request
				}
				let mutations = 0,
					observed = false
				IDBDatabase.prototype.createObjectStore = function (this: IDBDatabase, name, options) {
					mutations++
					if (interruption === 'creationFailure') throw new Error('Synthetic schema failure')
					return nativeCreate.call(this, name, options)
				}
				const request = api.prepareBrowserRestoreJournal({
					databaseName,
					binding,
					command: { mode: 'initialize' }
				})
				const actor = api.createActor(api.createBrowserRestoreJournalMachine(), {
					input: { request },
					inspect(event) {
						if (event.type === '@xstate.event' && event.event.type === 'UPGRADE_REQUESTED') {
							observed = true
							if (interruption === 'CANCEL') actor.send({ type: 'CANCEL' })
							if (interruption === 'SHUTDOWN') actor.send({ type: 'SHUTDOWN' })
							if (interruption === 'release') request.release()
							if (interruption === 'stop') actor.stop()
						}
					}
				})
				try {
					actor.start()
					const output = interruption === 'stop' ? undefined : await api.toPromise(actor)
					await openSettled
					const exists = (await indexedDB.databases()).some((db) => db.name === databaseName)
					await new Promise<void>((resolve, reject) => {
						const deletion = indexedDB.deleteDatabase(databaseName)
						deletion.onsuccess = () => resolve()
						deletion.onerror = () => reject(deletion.error)
						deletion.onblocked = () => reject(new Error('Connection leaked'))
					})
					return {
						observed,
						mutations,
						exists,
						outcome: output?.outcome ?? 'stopped',
						code: output?.outcome === 'failed' ? output.code : undefined
					}
				} finally {
					request.release()
					actor.stop()
					indexedDB.open = nativeOpen
					IDBDatabase.prototype.createObjectStore = nativeCreate
				}
			},
			{ wire, interruption }
		)
		expect(result.observed).toBe(true)
		expect(result.exists).toBe(false)
		expect(result.mutations).toBe(interruption === 'creationFailure' ? 1 : 0)
		expect(result.outcome).toBe(
			{
				CANCEL: 'cancelled',
				SHUTDOWN: 'closed',
				release: 'closed',
				stop: 'stopped',
				creationFailure: 'failed'
			}[interruption]
		)
		if (interruption === 'creationFailure') expect(result.code).toBe('journalStoreFailed')
	})
}

for (const version of [1, 2]) {
	test(`initialization preserves unsupported existing schema/version ${version}`, async ({
		page
	}) => {
		await page.goto('/')
		await page.addScriptTag({ path: resolve('.svelte-kit/notebook-browser/notebook.js') })
		const result = await page.evaluate(
			async ({ wire, version }) => {
				const api = window.DLFNotebook,
					record = api.parseRestoreJournalRecord(wire),
					scope = record.intent.operation
				const databaseName = `dlf-upgrade-existing-${crypto.randomUUID()}`
				const seed = await new Promise<IDBDatabase>((resolve, reject) => {
					const request = indexedDB.open(databaseName, version)
					request.onupgradeneeded = () => request.result.createObjectStore('unrelated')
					request.onsuccess = () => resolve(request.result)
					request.onerror = () => reject(request.error)
				})
				seed.close()
				const binding = {
					applicationId: scope.applicationId,
					environment: scope.environment,
					identityId: scope.identityId,
					operationId: scope.operationId,
					workspaceId: scope.destinationWorkspaceId,
					generation: 1
				}
				const request = api.prepareBrowserRestoreJournal({
					databaseName,
					binding,
					command: { mode: 'initialize' }
				})
				const actor = api
					.createActor(api.createBrowserRestoreJournalMachine(), { input: { request } })
					.start()
				try {
					const output = await api.toPromise(actor)
					const stored = await new Promise<IDBDatabase>((resolve, reject) => {
						const open = indexedDB.open(databaseName)
						open.onsuccess = () => resolve(open.result)
						open.onerror = () => reject(open.error)
					})
					const observed = { version: stored.version, stores: Array.from(stored.objectStoreNames) }
					stored.close()
					await new Promise<void>((resolve, reject) => {
						const deletion = indexedDB.deleteDatabase(databaseName)
						deletion.onsuccess = () => resolve()
						deletion.onerror = () => reject(deletion.error)
						deletion.onblocked = () => reject(new Error('Connection leaked'))
					})
					return { outcome: output.outcome, ...observed }
				} finally {
					request.release()
					actor.stop()
				}
			},
			{ wire, version }
		)
		expect(result).toEqual({ outcome: 'unavailable', version, stores: ['unrelated'] })
	})
}
