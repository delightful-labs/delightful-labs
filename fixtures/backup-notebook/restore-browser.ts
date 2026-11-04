import { createJazzSession, PersistedWriteRejectedError } from 'jazz-tools'
import { createActor, toPromise, waitFor, type ActorRefFrom } from 'xstate'
import { prepareArchiveOpen, prepareArchiveSeal } from 'delightful-local-first/backup/envelope'
import { createArchiveEnvelopeMachine } from 'delightful-local-first/backup/envelope/workflow'
import { prepareBrowserRestoreJournal } from 'delightful-local-first/backup/restore/journal/browser'
import { createBrowserRestoreJournalMachine } from 'delightful-local-first/backup/restore/journal/workflow'
import { parseRestoreJournalRecord } from 'delightful-local-first/backup/restore/journal'
import { createNotebookDataset } from './dataset.js'
import { createNotebookRestorePreparationMachine, prepareNotebookRestore } from './restore.js'
import { notebookRestoreApp, activeNotebookDestinations } from './restore-schema.js'
import { createNotebookPreparationWriter } from './restore-writer.js'

type Writer = ReturnType<typeof createNotebookPreparationWriter>
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
const native = createNotebookPreparationWriter(db, (receipt) => {
	detached.push(receipt)
})
let issued = 0
const writer: Writer = {
	...native,
	commit: (transaction) => {
		issued++
		return native.commit(transaction)
	}
}
const machine = createNotebookRestorePreparationMachine(writer)
const pending: {
	actor: ActorRefFrom<typeof machine> | undefined
	cleanup: (() => void) | undefined
} = { actor: undefined, cleanup: undefined }
const api = {
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
