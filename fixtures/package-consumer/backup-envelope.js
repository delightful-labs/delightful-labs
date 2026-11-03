// Consume the built package exports on Node without source aliases or an application session.
import { createActor, toPromise } from 'xstate'
import { prepareArchiveSeal, prepareArchiveOpen } from 'delightful-local-first/backup/envelope'
import { createArchiveEnvelopeMachine } from 'delightful-local-first/backup/envelope/workflow'
const input = {
	archiveId: '12345678-1234-4234-8234-123456789abc',
	profile: { id: 'consumer', version: 1 },
	source: { applicationId: 'consumer', workspaceId: 'workspace' },
	capturedAt: '2026-11-03T00:00:00.000Z',
	coverage: {
		mode: 'complete-supported-graph',
		recordTypes: ['note'],
		history: 'current-data',
		deletedRecords: 'excluded',
		consistency: 'quiescent-single-user'
	},
	records: [],
	attachments: [],
	references: []
}
const sealing = createActor(createArchiveEnvelopeMachine(), {
	input: { request: prepareArchiveSeal(input, { kind: 'password', password: 'consumer-example' }) }
})
sealing.start()
const sealed = await toPromise(sealing)
if (sealed.outcome !== 'sealed') throw new Error('Public archive sealing failed')
const opening = createActor(createArchiveEnvelopeMachine(), {
	input: { request: prepareArchiveOpen(sealed.archive.copyBytes(), 'consumer-example') }
})
opening.start()
const checked = await toPromise(opening)
sealed.archive.release()
if (checked.outcome !== 'integrityChecked') throw new Error('Public archive opening failed')
if (checked.archive.readPayload().source.workspaceId !== 'workspace')
	throw new Error('Public archive contents changed')
checked.archive.release()
