import { createJazzClient } from 'jazz-tools/client'
import type { ActorRef, Snapshot } from 'xstate'
import type { RestoreEvent } from 'delightful-local-first/backup/restore'
import type { TestAppContinuationResult } from './restore-continuation.js'
import { testAppProfile } from './profile.js'
import { createTestAppRestorePlanningMachine } from './restore-planning.js'
import { createTestAppRestore, createTestAppRestoreWorkflow } from './restore-workflow.js'
import { compareTestAppDestination, testAppDestinationGraphQuery } from './restore-comparison.js'
import { PersistedWriteRejectedError } from 'jazz-tools'
import {
	createCallbackLogic,
	createAsyncLogic,
	createActor,
	toPromise,
	waitFor,
	type Actor
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
	createTestAppTransactionWriter,
	observeTestAppWrites
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
const session = await createJazzClient({
	scope: appId,
	serverUrl,
	initial: 'local-first',
	client: () => import('jazz-tools/local-first')
})
const client = session.getSnapshot().client
if (!client) throw new Error('Qualification session not ready')
await client.db.upgradeToLocalFirst(() => import('jazz-tools/local-first'))
const db = client.db
if (!db.isLocalFirst()) throw new Error('Restore qualification requires local-first storage')
const ownerId = client.session?.user
if (!ownerId) throw new Error('Missing qualification owner')
const detached: Parameters<Writer['retainDetached']>[0][] = []
let issued = 0
observeTestAppWrites(db, () => {
	issued++
})
const writer = createTestAppTransactionWriter(db, (receipt) => {
	detached.push(receipt)
})
const preparationWrite = createTestAppPreparationWriteMachine(db)
const preparationDestination = createTestAppPreparationWriter(db, preparationWrite)
const machine = createTestAppRestorePreparationMachine(writer, preparationDestination)
const pending: {
	actor: Actor<typeof machine> | undefined
	cleanup: (() => void) | undefined
	releaseAuthority?: () => void
} = { actor: undefined, cleanup: undefined }
const attachmentPending: {
	actor?: ActorRef<Snapshot<TestAppContinuationResult<string>>, RestoreEvent> & { stop(): void }
	cleanup?: () => void
} = {}
const rootPending: {
	actor?: ActorRef<Snapshot<TestAppContinuationResult<string>>, RestoreEvent> & { stop(): void }
	cleanup?: () => void
	releaseStage?: () => void
	releaseRequest?: () => void
	hasExpected?: () => boolean
	reportIdentity?: (failed: boolean) => void
	staged?: boolean
} = {}
const notePending: {
	actor?: ActorRef<Snapshot<TestAppContinuationResult<string>>, RestoreEvent> & { stop(): void }
	cleanup?: () => void
	releaseStage?: () => void
	releaseRequest?: () => void
	hasExpected?: () => boolean
	reportIdentity?: (failed: boolean) => void
	staged?: boolean
} = {}
const api = {
	createRestoreMachine,
	testAppProfile,
	createTestAppRestorePlanningMachine,
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
	createTestAppPreparationWriteMachine,
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
	createAsyncLogic,
	preparationDestination,
	preparationWrite,
	createCallbackLogic,
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
