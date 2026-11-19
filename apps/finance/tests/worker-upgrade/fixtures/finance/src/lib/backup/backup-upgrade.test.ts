import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { createActor, toPromise } from 'xstate'
import { prepareArchiveOpen } from 'delightful-local-first/backup/envelope'
import { createArchiveEnvelopeMachine } from 'delightful-local-first/backup/envelope/workflow'
import { decodeFinanceBackup, validateFinanceBackup } from './workspace.js'
import retained from '../../../retained-backup.json' with { type: 'json' }

it('independently reopens an actual alpha.60 v1 archive with exact amounts, identities and attachment bytes', async () => {
	const bytes = await readFile(new URL('../../../retained-backup.dlf', import.meta.url))
	const request = prepareArchiveOpen(bytes)
	try {
		const result = await toPromise(
			createActor(createArchiveEnvelopeMachine(), { input: { request } }).start()
		)
		if (result.outcome !== 'integrityChecked')
			throw new Error('Historical archive failed independent reopening')
		try {
			const payload = result.archive.readPayload(),
				decoded = decodeFinanceBackup(payload)
			expect(retained.sdk).toBe('2.0.0-alpha.60')
			expect(payload.profile).toEqual({ id: 'delightful.finance.workspace', version: 1 })
			expect(validateFinanceBackup(payload)).toBe(true)
			expect(decoded.organizations).toMatchObject([
				{ id: retained.ids.organization, ownerId: retained.ids.owner, name: 'Historical household' }
			])
			expect(decoded.transactions).toMatchObject([
				{
					id: retained.ids.transaction,
					accountId: retained.ids.account,
					categoryId: retained.ids.category,
					amountMinor: Number.MAX_SAFE_INTEGER,
					bookedOn: '2026-11-17'
				}
			])
			expect(
				payload.records.find((row) => row.id === retained.ids.transaction)?.fields.amountMinor
			).toEqual({ kind: 'integer', value: String(Number.MAX_SAFE_INTEGER) })
			expect(
				payload.records.find((row) => row.id === retained.ids.organization)?.fields
			).not.toHaveProperty('restoreOperationId')
			expect(payload.coverage.recordTypes).not.toContain('sourceDocuments')
			expect(payload.attachments).toHaveLength(1)
			expect(payload.attachments[0]?.id).toBe(retained.ids.file)
			expect(Buffer.from(payload.attachments[0]?.data ?? '', 'base64')).toEqual(
				Buffer.from([0, 1, 127, 255])
			)
		} finally {
			result.archive.release()
		}
	} finally {
		request.release()
	}
})
