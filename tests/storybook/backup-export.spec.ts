import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { ActorRefFrom } from 'xstate'
import type { ArchivePayload } from '../../src/lib/backup/archive.js'
import type { ArchiveProtection } from '../../src/lib/backup/envelope-api.js'
import type { ArchiveProfileValidator } from '../../src/lib/backup/inspection-api.js'
import type {
	ArchiveCaptureSource,
	ArchiveExportRequest,
	ArchiveFileHandoff,
	BackupBinding
} from '../../src/lib/backup/export-api.js'

declare global {
	interface Window {
		// Root checks precede dist. These types describe the fixture's public-package-backed IIFE.
		DLFNotebook: Pick<typeof import('xstate'), 'createActor' | 'toPromise'> &
			Pick<typeof import('../../src/lib/backup/envelope-api.js'), 'prepareArchiveOpen'> &
			Pick<
				typeof import('../../src/lib/machines/backup/envelope.js'),
				'createArchiveEnvelopeMachine'
			> &
			Pick<typeof import('../../src/lib/backup/inspection-api.js'), 'prepareArchiveInspection'> &
			Pick<
				typeof import('../../src/lib/machines/backup/inspection.js'),
				'createArchiveInspectionMachine'
			> & {
				notebookProfile: ArchiveProfileValidator
				createNotebookDataset(source: ArchivePayload['source']): ArchivePayload
				createNotebookExport(options: {
					binding: BackupBinding
					protection: ArchiveProtection
					handoff: ArchiveFileHandoff
				}): {
					actor: ActorRefFrom<
						ReturnType<
							typeof import('../../src/lib/machines/backup/export.js').createArchiveExportMachine
						>
					>
					request: ArchiveExportRequest
					source: ArchiveCaptureSource & {
						replace(payload: unknown): void
						observeBinding(binding: BackupBinding): void
					}
				}
			}
	}
}

test.beforeEach(async ({ page }) => {
	await page.goto('/')
	await page.addScriptTag({ path: resolve('.svelte-kit/notebook-browser/notebook.js') })
})

for (const kind of ['none', 'password']) {
	test(`public notebook ${kind} export downloads and opens exact browser contents`, async ({
		page
	}, info) => {
		const [download, result] = await Promise.all([
			page.waitForEvent('download'),
			page.evaluate(async (kind) => {
				const api = window.DLFNotebook
				const password = ' browser-export-password-é😀 '
				const binding: BackupBinding = {
					applicationId: 'notebook-browser',
					environment: 'disposable',
					identityId: 'owner',
					workspaceId: 'source',
					generation: 1,
					operationId: 'browser-export'
				}
				let retained = new Uint8Array()
				const fixture = api.createNotebookExport({
					binding,
					protection: kind === 'password' ? { kind: 'password', password } : { kind: 'none' },
					handoff: {
						dispatch: (file, expected, signal) => {
							if (signal.aborted || expected.generation !== binding.generation)
								return Promise.resolve('rejected')
							retained = file.copyBytes()
							const url = URL.createObjectURL(
								new Blob([retained], { type: 'application/octet-stream' })
							)
							try {
								const anchor = document.createElement('a')
								anchor.href = url
								anchor.download = 'notebook.dlfbackup'
								anchor.click()
							} finally {
								URL.revokeObjectURL(url)
							}
							return Promise.resolve('dispatched')
						}
					}
				})
				const snapshots: string[] = []
				fixture.actor.subscribe(() =>
					snapshots.push(JSON.stringify(fixture.actor.getPersistedSnapshot()))
				)
				fixture.actor.start()
				const exported = await api.toPromise(fixture.actor)
				const opening = api.createActor(api.createArchiveEnvelopeMachine(), {
					input: {
						request: api.prepareArchiveOpen(retained, kind === 'password' ? password : undefined)
					}
				})
				opening.start()
				const checked = await api.toPromise(opening)
				if (checked.outcome !== 'integrityChecked')
					throw new Error('Browser archive opening failed')
				const payload = checked.archive.readPayload()
				checked.archive.release()
				fixture.source.replace(payload) // verifies that the capture lease was released
				const inspector = api.createActor(api.createArchiveInspectionMachine(), {
					input: {
						request: api.prepareArchiveInspection({
							source: { read: () => Promise.resolve(retained.slice()) },
							profiles: [api.notebookProfile],
							password: { read: () => Promise.resolve(password) }
						})
					}
				})
				inspector.start()
				const inspected = await api.toPromise(inspector)
				if ('report' in inspected) inspected.report.release()
				const archived = payload.records.find((record) => record.id === 'archived')
				const first = payload.records.find((record) => record.id === 'first')
				const empty = payload.records.find((record) => record.id === 'empty')
				return {
					exported: exported.outcome,
					handoff: exported.handoff,
					inspected: inspected.outcome,
					archived: archived?.fields,
					first: first?.fields,
					empty: empty?.fields,
					bytes: Array.from(retained),
					attachment: payload.attachments[0],
					secrets: snapshots.some(
						(snapshot) =>
							snapshot.includes(password) ||
							snapshot.includes('bytes.bin') ||
							snapshot.includes('Preserve archived content')
					)
				}
			}, kind)
		])
		const path = info.outputPath('notebook.dlfbackup')
		await download.saveAs(path)
		expect(await readFile(path)).toEqual(Buffer.from(result.bytes))
		expect(result).toMatchObject({
			exported: 'exported',
			handoff: 'dispatched',
			inspected: 'profileValid',
			secrets: false
		})
		expect(result.first?.body).toEqual({
			kind: 'text',
			value: 'First line\nSecond line\r\nCafe\u0301 ☕'
		})
		expect(result.archived?.archived).toEqual({ kind: 'boolean', value: true })
		expect(result.archived?.body).toEqual({
			kind: 'text',
			value: 'Preserve archived content\u0000exactly.'
		})
		expect(result.empty?.body).toEqual({ kind: 'text', value: '' })
		expect(result.archived?.attachment).toEqual(result.first?.attachment)
		expect(Buffer.from(result.attachment?.data ?? '', 'base64')).toEqual(
			Buffer.from([0, 255, 128, 10])
		)
	})
}

test('browser invalidation drains a late notebook lease and rejects a stale A → B → A retry', async ({
	page
}) => {
	const result = await page.evaluate(async () => {
		const api = window.DLFNotebook
		const binding: BackupBinding = {
			applicationId: 'notebook-browser',
			environment: 'disposable',
			identityId: 'owner',
			workspaceId: 'source',
			generation: 1,
			operationId: 'interrupted'
		}
		let dispatches = 0
		const fixture = api.createNotebookExport({
			binding,
			protection: { kind: 'none' },
			handoff: {
				dispatch: () => {
					dispatches += 1
					return Promise.resolve('dispatched')
				}
			}
		})
		const acquire = fixture.source.acquire.bind(fixture.source)
		let deliver: (() => void) | undefined
		let notify = () => {}
		const acquired = new Promise<void>((resolve) => {
			notify = resolve
		})
		fixture.source.acquire = (expected, signal) =>
			acquire(expected, signal).then(
				(lease) =>
					new Promise((resolve) => {
						deliver = () => resolve(lease)
						notify()
					})
			)
		fixture.actor.start()
		await acquired
		const payload = api.createNotebookDataset({
			applicationId: binding.applicationId,
			workspaceId: binding.workspaceId
		})
		let excluded = false
		try {
			fixture.source.replace(payload)
		} catch {
			excluded = true
		}
		fixture.actor.send({ type: 'INVALIDATE', binding })
		fixture.source.observeBinding({ ...binding, generation: 3 })
		fixture.actor.send({ type: 'RETRY_HANDOFF', binding: { ...binding, generation: 3 } })
		const draining = fixture.actor.getSnapshot().status === 'active'
		deliver?.()
		const output = await api.toPromise(fixture.actor)
		fixture.source.replace(payload)
		return { excluded, draining, dispatches, outcome: output.outcome, handoff: output.handoff }
	})
	expect(result).toEqual({
		excluded: true,
		draining: true,
		dispatches: 0,
		outcome: 'invalidated',
		handoff: 'notStarted'
	})
})
