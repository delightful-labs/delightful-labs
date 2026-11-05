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
import { parseRestoreJournalRecord } from 'delightful-local-first/backup/restore/journal'
import { restoreTransactionAccess } from 'delightful-local-first/backup/restore'
import { notebookRestoreRoot, notebookRestoreNote } from './restore-request.js'
import { createNotebookDataset } from './dataset.js'
import { createNotebookRestorePreparationMachine, prepareNotebookRestore } from './restore.js'
import { notebookRestoreApp, activeNotebookDestinations } from './restore-schema.js'
import {
	createNotebookPreparationWriter,
	createNotebookPreparationWriteMachine,
	createNotebookDestinationWriteMachine,
	createNotebookTransactionWriter
} from './restore-writer.js'
import { createNotebookRestoreAttachmentMachine } from './restore-attachment.js'
import {
	createNotebookAttachmentWriter,
	createNotebookAttachmentRestore
} from './restore-attachment-writer.js'

import { createNotebookRootRestore, createNotebookRootWriter } from './restore-notebook-writer.js'
import { createNotebookRestoreRootMachine, prepareNotebookRootRestore } from './restore-notebook.js'

import { createNotebookNoteRestore, createNotebookNoteWriter } from './restore-note-writer.js'
import { createNotebookRestoreNoteMachine, prepareNotebookNoteRestore } from './restore-note.js'

type Writer = ReturnType<typeof createNotebookTransactionWriter>
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
const native = createNotebookTransactionWriter(db, (receipt) => {
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
const preparationWrite = createNotebookPreparationWriteMachine(db)
const preparationDestination = createNotebookPreparationWriter(db, preparationWrite)
const machine = createNotebookRestorePreparationMachine(writer, preparationDestination)
const pending: {
	actor: ActorRefFrom<typeof machine> | undefined
	cleanup: (() => void) | undefined
	releaseAuthority?: () => void
} = { actor: undefined, cleanup: undefined }
const attachmentPending: {
	actor?: ActorRefFrom<ReturnType<typeof createNotebookRestoreAttachmentMachine>>
	cleanup?: () => void
} = {}
const rootPending: {
	actor?: ActorRefFrom<ReturnType<typeof createNotebookRestoreRootMachine>>
	cleanup?: () => void
	releaseStage?: () => void
	releaseRequest?: () => void
	hasExpected?: () => boolean
	reportIdentity?: (failed: boolean) => void
	staged?: boolean
} = {}
const notePending: {
	actor?: ActorRefFrom<ReturnType<typeof createNotebookRestoreNoteMachine>>
	cleanup?: () => void
	releaseStage?: () => void
	releaseRequest?: () => void
	hasExpected?: () => boolean
	reportIdentity?: (failed: boolean) => void
	staged?: boolean
} = {}
const api = {
	notePending,
	createNotebookNoteRestore,
	createNotebookNoteWriter,
	createNotebookRestoreNoteMachine,
	prepareNotebookNoteRestore,
	rootPending,
	restoreTransactionAccess,
	notebookRestoreRoot,
	notebookRestoreNote,
	createNotebookDestinationWriteMachine,
	createNotebookRootRestore,
	createNotebookRootWriter,
	createNotebookRestoreRootMachine,
	prepareNotebookRootRestore,
	attachmentPending,
	createNotebookTransactionWriter,
	createNotebookAttachmentWriter,
	createNotebookRestoreAttachmentMachine,
	createNotebookAttachmentRestore,
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
	createNotebookDataset,
	createNotebookRestorePreparationMachine,
	prepareNotebookRestore,
	notebookRestoreApp,
	activeNotebookDestinations,
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
