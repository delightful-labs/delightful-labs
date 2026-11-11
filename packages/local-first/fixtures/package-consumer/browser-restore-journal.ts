import { createActor } from 'xstate'
import {
	prepareBrowserRestoreJournal,
	type BrowserJournalCommand,
	type BrowserJournalRecordView
} from 'delightful-local-first/backup/restore/journal/browser'
import { createBrowserRestoreJournalMachine } from 'delightful-local-first/backup/restore/journal/workflow'
import type { BackupBinding } from 'delightful-local-first/backup/binding'

// Static consumer declaration checks only. Native effects are exercised separately in the Chromium fixture.
export function browserJournalActor(
	databaseName: string,
	binding: BackupBinding,
	command: BrowserJournalCommand
) {
	const request = prepareBrowserRestoreJournal({ databaseName, binding, command })
	return {
		request,
		actor: createActor(createBrowserRestoreJournalMachine(), { input: { request } })
	}
}
export function readJournalView(view: BrowserJournalRecordView) {
	return view.readRecord()
}
