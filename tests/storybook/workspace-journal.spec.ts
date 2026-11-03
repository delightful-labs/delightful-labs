import { expect, test } from '@playwright/test'
import { resolve } from 'node:path'
import type { WorkspaceJournalInput } from '../../src/lib/machines/workspaces/journal.js'

type NotebookRecord = { key: string; attempt: { notebookId: string; title: string } }
declare global {
	interface Window {
		DLFJournal: Pick<typeof import('xstate'), 'createActor' | 'toPromise'> & {
			createNotebookJournal: (
				name: string
			) => ReturnType<
				typeof import('../../src/lib/machines/workspaces/journal.js').createWorkspaceJournal<NotebookRecord>
			>
		}
	}
}
test.beforeEach(async ({ page }) => {
	await page.goto('/')
	await page.addScriptTag({ path: resolve('.svelte-kit/journal-browser/journal.js') })
})

test('public journal persists notebook records and clears only the selected attempt', async ({
	page
}) => {
	const result = await page.evaluate(async () => {
		const { createActor, toPromise, createNotebookJournal } = window.DLFJournal
		const name = `dlf-journal-test-${crypto.randomUUID()}`
		const machine = createNotebookJournal(name)
		const record = { key: 'member', attempt: { notebookId: 'stable', title: 'notes' } }
		async function run(input: WorkspaceJournalInput<NotebookRecord>) {
			const actor = createActor(machine, { input }).start()
			try {
				return await toPromise(actor)
			} finally {
				actor.stop()
			}
		}
		try {
			const written = await run({ mode: 'write', key: record.key, record })
			const read = await run({ mode: 'read', key: record.key })
			const wrong = await run({ mode: 'clear', key: record.key, attemptId: 'different' })
			const retained = await run({ mode: 'read', key: record.key })
			const cleared = await run({ mode: 'clear', key: record.key, attemptId: 'stable' })
			const empty = await run({ mode: 'read', key: record.key })
			return { written, read, wrong, retained, cleared, empty }
		} finally {
			await new Promise<void>((done, fail) => {
				const request = indexedDB.deleteDatabase(name)
				request.onsuccess = () => done()
				request.onerror = () => fail(request.error)
			})
		}
	})
	const record = { key: 'member', attempt: { notebookId: 'stable', title: 'notes' } }
	expect(result).toEqual({
		written: { outcome: 'succeeded', record },
		read: { outcome: 'succeeded', record },
		wrong: { outcome: 'conflict' },
		retained: { outcome: 'succeeded', record },
		cleared: { outcome: 'succeeded', record: undefined },
		empty: { outcome: 'succeeded', record: undefined }
	})
})

test('native cancellation aborts staged journal data before reporting cancelled', async ({
	page
}) => {
	const result = await page.evaluate(async () => {
		const { createActor, toPromise, createNotebookJournal } = window.DLFJournal
		const name = `dlf-journal-test-${crypto.randomUUID()}`,
			machine = createNotebookJournal(name)
		const record = { key: 'member', attempt: { notebookId: 'cancelled', title: 'notes' } }
		const actor = createActor(machine, {
			input: { mode: 'write', key: record.key, record }
		})
		let aborted = false,
			interrupted = false
		actor.subscribe((snapshot) => {
			if (!interrupted && snapshot.matches({ running: { work: { using: 'waiting' } } })) {
				interrupted = true
				const transaction = snapshot.context.tx
				if (!transaction) throw new Error('Missing native transaction')
				// Observe the native event before the adapter synchronously reports it to the actor.
				const onAbort = transaction.onabort
				transaction.onabort = (event) => {
					aborted = true
					onAbort?.call(transaction, event)
				}
				actor.send({ type: 'CANCEL' })
			}
		})
		try {
			actor.start()
			const outcome = await toPromise(actor)
			const reader = createActor(machine, { input: { mode: 'read', key: record.key } }).start()
			try {
				return {
					outcome: outcome.outcome,
					aborted,
					interrupted,
					read: await toPromise(reader)
				}
			} finally {
				reader.stop()
			}
		} finally {
			actor.stop()
			await new Promise<void>((done, fail) => {
				const request = indexedDB.deleteDatabase(name)
				request.onsuccess = () => done()
				request.onerror = () => fail(request.error)
			})
		}
	})
	expect(result).toEqual({
		outcome: 'cancelled',
		aborted: true,
		interrupted: true,
		read: { outcome: 'succeeded', record: undefined }
	})
})

test('abort during native commit waits for actual completion and preserves the failure', async ({
	page
}) => {
	const result = await page.evaluate(async () => {
		const { createActor, toPromise, createNotebookJournal } = window.DLFJournal
		const name = `dlf-journal-test-${crypto.randomUUID()}`,
			machine = createNotebookJournal(name)
		const record = { key: 'member', attempt: { notebookId: 'committing', title: 'notes' } }
		let aborted = false,
			completed = false,
			interrupted = false,
			fakeAborts = 0
		const actor = createActor(machine, {
			input: { mode: 'write', key: record.key, record },
			inspect: (inspection) => {
				if (inspection.type === '@xstate.event' && inspection.event.type === 'TX_ABORTED')
					fakeAborts++
			}
		})
		actor.subscribe((snapshot) => {
			if (!interrupted && snapshot.matches({ running: { work: { using: 'waiting' } } })) {
				const transaction = snapshot.context.tx
				if (!transaction) throw new Error('Missing native transaction')
				interrupted = true
				// Observe the native event before the adapter synchronously reports it to the actor.
				const onAbort = transaction.onabort,
					onComplete = transaction.oncomplete
				transaction.onabort = (event) => {
					aborted = true
					onAbort?.call(transaction, event)
				}
				transaction.oncomplete = (event) => {
					completed = true
					onComplete?.call(transaction, event)
				}
				transaction.commit()
				actor.send({ type: 'SHUTDOWN' })
			}
		})
		try {
			actor.start()
			const outcome = await toPromise(actor)
			const reader = createActor(machine, { input: { mode: 'read', key: record.key } }).start()
			try {
				return {
					outcome: outcome.outcome,
					errorName:
						outcome.outcome === 'failed' && outcome.error instanceof DOMException
							? outcome.error.name
							: undefined,
					aborted,
					completed,
					interrupted,
					fakeAborts,
					read: await toPromise(reader)
				}
			} finally {
				reader.stop()
			}
		} finally {
			actor.stop()
			await new Promise<void>((done, fail) => {
				const request = indexedDB.deleteDatabase(name)
				request.onsuccess = () => done()
				request.onerror = () => fail(request.error)
			})
		}
	})
	expect(result).toEqual({
		outcome: 'failed',
		errorName: 'InvalidStateError',
		aborted: false,
		completed: true,
		interrupted: true,
		fakeAborts: 0,
		read: {
			outcome: 'succeeded',
			record: { key: 'member', attempt: { notebookId: 'committing', title: 'notes' } }
		}
	})
})

test('a real incompatible IndexedDB version fails without reporting cancellation', async ({
	page
}) => {
	const result = await page.evaluate(async () => {
		const { createActor, toPromise, createNotebookJournal } = window.DLFJournal
		const name = `dlf-journal-test-${crypto.randomUUID()}`
		const db = await new Promise<IDBDatabase>((done, fail) => {
			const request = indexedDB.open(name, 2)
			request.onsuccess = () => done(request.result)
			request.onerror = () => fail(request.error)
		})
		db.close()
		const actor = createActor(createNotebookJournal(name), {
			input: { mode: 'read', key: 'member' }
		}).start()
		try {
			const outcome = await toPromise(actor)
			return {
				outcome: outcome.outcome,
				errorName:
					outcome.outcome === 'failed' && outcome.error instanceof DOMException
						? outcome.error.name
						: undefined
			}
		} finally {
			actor.stop()
			await new Promise<void>((done, fail) => {
				const request = indexedDB.deleteDatabase(name)
				request.onsuccess = () => done()
				request.onerror = () => fail(request.error)
			})
		}
	})
	expect(result).toEqual({ outcome: 'failed', errorName: 'VersionError' })
})

test('a real constraint error still fails and rolls back the journal transaction', async ({
	page
}) => {
	const result = await page.evaluate(async () => {
		const { createActor, toPromise, createNotebookJournal } = window.DLFJournal
		const name = `dlf-journal-test-${crypto.randomUUID()}`,
			machine = createNotebookJournal(name)
		const record = { key: 'member', attempt: { notebookId: 'duplicate', title: 'notes' } }
		const actor = createActor(machine, { input: { mode: 'write', key: record.key, record } })
		let injected = false,
			aborted = false
		actor.subscribe((snapshot) => {
			if (!injected && snapshot.matches({ running: { work: { using: 'reading' } } })) {
				const transaction = snapshot.context.tx
				if (!transaction) throw new Error('Missing native transaction')
				injected = true
				// Observe the native event before the adapter synchronously reports it to the actor.
				const onAbort = transaction.onabort
				transaction.onabort = (event) => {
					aborted = true
					onAbort?.call(transaction, event)
				}
				// The journal's queued read sees absence; this real request then occupies the key
				// before the journal's add, producing a native ConstraintError in the same transaction.
				transaction.objectStore('attempts').add(record)
			}
		})
		try {
			actor.start()
			const outcome = await toPromise(actor)
			const reader = createActor(machine, { input: { mode: 'read', key: record.key } }).start()
			try {
				return {
					outcome: outcome.outcome,
					errorName:
						outcome.outcome === 'failed' && outcome.error instanceof DOMException
							? outcome.error.name
							: undefined,
					injected,
					aborted,
					read: await toPromise(reader)
				}
			} finally {
				reader.stop()
			}
		} finally {
			actor.stop()
			await new Promise<void>((done, fail) => {
				const request = indexedDB.deleteDatabase(name)
				request.onsuccess = () => done()
				request.onerror = () => fail(request.error)
			})
		}
	})
	expect(result).toEqual({
		outcome: 'failed',
		errorName: 'ConstraintError',
		injected: true,
		aborted: true,
		read: { outcome: 'succeeded', record: undefined }
	})
})
