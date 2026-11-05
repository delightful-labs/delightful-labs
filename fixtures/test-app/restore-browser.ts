import { createTestAppSource } from './source.js'
import { testAppProfile } from './profile.js'
import { prepareArchiveExport } from 'delightful-local-first/backup/export'
import { createArchiveExportMachine } from 'delightful-local-first/backup/export/workflow'
import { createTestAppRestorePlanningMachine } from './restore-planning.js'
import { createTestAppExport } from './export.js'
import { createTestAppRestore, createTestAppRestoreWorkflow } from './restore-workflow.js'
import { compareTestAppDestination, testAppDestinationGraphQuery } from './restore-comparison.js'
import { createJazzSession, PersistedWriteRejectedError } from 'jazz-tools'
import {
	fromCallback,
	fromPromise,
	createActor,
	toPromise,
	waitFor,
	type ActorRefFrom
} from 'xstate'
import { prepareArchiveOpen, prepareArchiveSeal } from 'delightful-local-first/backup/envelope'
import { createArchiveEnvelopeMachine } from 'delightful-local-first/backup/envelope/workflow'
import { prepareBrowserRestoreJournal } from 'delightful-local-first/backup/restore/journal/browser'
import { createBrowserRestoreJournalMachine } from 'delightful-local-first/backup/restore/journal/workflow'
import { createRestoreMachine } from 'delightful-local-first/backup/restore/workflow'
import { parseRestoreJournalRecord } from 'delightful-local-first/backup/restore/journal'
import { restoreTransactionAccess } from 'delightful-local-first/backup/restore'
import { testAppRestoreRoot, testAppRestoreNotes } from './restore-request.js'
import { createTestAppDataset } from './dataset.js'
import { createTestAppRestorePreparationMachine, prepareTestAppRestore } from './restore.js'
import { testAppRestoreApp, activeTestAppDestinations } from './restore-schema.js'
import {
	createTestAppPreparationWriter,
	createTestAppPreparationWriteMachine,
	createTestAppDestinationWriteMachine,
	createTestAppTransactionWriter
} from './restore-writer.js'
import { createTestAppRestoreAttachmentMachine } from './restore-attachment.js'
import {
	createTestAppAttachmentWriter,
	createTestAppAttachmentRestore
} from './restore-attachment-writer.js'

import { createTestAppRootRestore, createTestAppRootWriter } from './restore-root-writer.js'
import { createTestAppRestoreRootMachine, prepareTestAppRootRestore } from './restore-root.js'

import { createTestAppNoteRestore, createTestAppNoteWriter } from './restore-note-writer.js'
import { createTestAppRestoreNoteMachine, prepareTestAppNoteRestore } from './restore-note.js'

type Writer = ReturnType<typeof createTestAppTransactionWriter>
const config = new URLSearchParams(location.search)
const appId = config.get('appId'),
	serverUrl = config.get('serverUrl')
if (!appId || !serverUrl) throw new Error('Missing qualification configuration')
const session = await createJazzSession({ appId, serverUrl, initial: 'local-first' })
const client = session.getSnapshot().client
if (!client) throw new Error('Qualification session not ready')
const db = client.db
const ownerId = client.session?.user.account
if (!ownerId) throw new Error('Missing qualification owner')
const detached: Parameters<Writer['retainDetached']>[0][] = []
const native = createTestAppTransactionWriter(db, (receipt) => {
	detached.push(receipt)
})
let issued = 0
const begin = db.beginTransaction.bind(db)
db.beginTransaction = () => {
	const transaction = begin()
	const commit = transaction.commit.bind(transaction)
	transaction.commit = () => {
		issued++
		return commit()
	}
	return transaction
}
const writer: Writer = native
const preparationWrite = createTestAppPreparationWriteMachine(db)
const preparationDestination = createTestAppPreparationWriter(db, preparationWrite)
const machine = createTestAppRestorePreparationMachine(writer, preparationDestination)
const pending: {
	actor: ActorRefFrom<typeof machine> | undefined
	cleanup: (() => void) | undefined
	releaseAuthority?: () => void
} = { actor: undefined, cleanup: undefined }
const attachmentPending: {
	actor?: ActorRefFrom<ReturnType<typeof createTestAppRestoreAttachmentMachine>>
	cleanup?: () => void
} = {}
const rootPending: {
	actor?: ActorRefFrom<ReturnType<typeof createTestAppRestoreRootMachine>>
	cleanup?: () => void
	releaseStage?: () => void
	releaseRequest?: () => void
	hasExpected?: () => boolean
	reportIdentity?: (failed: boolean) => void
	staged?: boolean
} = {}
const notePending: {
	actor?: ActorRefFrom<ReturnType<typeof createTestAppRestoreNoteMachine>>
	cleanup?: () => void
	releaseStage?: () => void
	releaseRequest?: () => void
	hasExpected?: () => boolean
	reportIdentity?: (failed: boolean) => void
	staged?: boolean
} = {}
const api = {
	createRestoreMachine,
	createTestAppSource,
	testAppProfile,
	prepareArchiveExport,
	createArchiveExportMachine,
	createTestAppRestorePlanningMachine,
	createTestAppExport,
	createTestAppRestore,
	createTestAppRestoreWorkflow,
	compareTestAppDestination,
	testAppDestinationGraphQuery,
	notePending,
	createTestAppNoteRestore,
	createTestAppNoteWriter,
	createTestAppRestoreNoteMachine,
	prepareTestAppNoteRestore,
	rootPending,
	restoreTransactionAccess,
	testAppRestoreRoot,
	testAppRestoreNotes,
	createTestAppDestinationWriteMachine,
	createTestAppRootRestore,
	createTestAppRootWriter,
	createTestAppRestoreRootMachine,
	prepareTestAppRootRestore,
	attachmentPending,
	createTestAppTransactionWriter,
	createTestAppAttachmentWriter,
	createTestAppRestoreAttachmentMachine,
	createTestAppAttachmentRestore,
	PersistedWriteRejectedError,
	createActor,
	toPromise,
	waitFor,
	prepareArchiveOpen,
	prepareArchiveSeal,
	createArchiveEnvelopeMachine,
	prepareBrowserRestoreJournal,
	createBrowserRestoreJournalMachine,
	parseRestoreJournalRecord,
	createTestAppDataset,
	createTestAppRestorePreparationMachine,
	prepareTestAppRestore,
	testAppRestoreApp,
	activeTestAppDestinations,
	db,
	fromPromise,
	preparationDestination,
	preparationWrite,
	fromCallback,
	writer,
	ownerId,
	pending,
	machine,
	issued: () => issued,
	detached: () => detached.length
}
declare global {
	interface Window {
		DLFRestoreQualification: typeof api
	}
}
window.DLFRestoreQualification = api
