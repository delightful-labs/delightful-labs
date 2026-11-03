import { expect, test } from '@playwright/test'
import { resolve } from 'node:path'

declare global {
	interface Window {
		DLFBackup: typeof import('../../fixtures/package-consumer/envelope-browser.js')
	}
}

test('public archive package encrypts and verifies in Chromium without an app session', async ({
	page
}) => {
	await page.goto('/')
	await page.addScriptTag({ path: resolve('.svelte-kit/envelope-browser/envelope.js') })
	const result = await page.evaluate(async () => {
		const {
			prepareArchiveSeal,
			prepareArchiveOpen,
			createArchiveEnvelopeMachine,
			createActor,
			toPromise
		} = window.DLFBackup
		const payload = {
			archiveId: '12345678-1234-4234-8234-123456789abc',
			profile: { id: 'browser', version: 1 },
			source: { applicationId: 'browser', workspaceId: 'workspace' },
			capturedAt: '2026-11-03T00:00:00.000Z',
			coverage: {
				mode: 'complete-supported-graph',
				recordTypes: ['note'],
				history: 'current-data',
				deletedRecords: 'excluded',
				consistency: 'quiescent-single-user'
			},
			records: [],
			attachments: [
				{
					id: 'empty',
					mediaType: 'text/plain',
					fileName: 'private-name',
					sizeBytes: 0,
					data: '',
					sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
				}
			],
			references: []
		}
		const actor = createActor(createArchiveEnvelopeMachine(), {
			input: {
				request: prepareArchiveSeal(payload, { kind: 'password', password: 'browser-secret' })
			}
		})
		const snapshots: string[] = []
		actor.subscribe(() => snapshots.push(JSON.stringify(actor.getPersistedSnapshot())))
		actor.start()
		const sealed = await toPromise(actor)
		if (sealed.outcome !== 'sealed') return { outcome: sealed.outcome }
		const bytes = sealed.archive.copyBytes()
		sealed.archive.release()
		const opening = createActor(createArchiveEnvelopeMachine(), {
			input: { request: prepareArchiveOpen(bytes, 'browser-secret') }
		})
		opening.start()
		const checked = await toPromise(opening)
		if (checked.outcome !== 'integrityChecked') return { outcome: checked.outcome }
		const contents = checked.archive.readPayload()
		checked.archive.release()
		const wrongPassword = createActor(createArchiveEnvelopeMachine(), {
			input: { request: prepareArchiveOpen(bytes, 'wrong-secret') }
		})
		wrongPassword.start()
		const wrong = await toPromise(wrongPassword)
		return {
			outcome: checked.outcome,
			workspace: contents.source.workspaceId,
			attachments: contents.attachments.length,
			wrong,
			secretsInSnapshot: snapshots.some(
				(snapshot) => snapshot.includes('browser-secret') || snapshot.includes('private-name')
			)
		}
	})
	expect(result).toEqual({
		outcome: 'integrityChecked',
		workspace: 'workspace',
		attachments: 1,
		wrong: { outcome: 'failed', code: 'authenticationFailed' },
		secretsInSnapshot: false
	})
})
