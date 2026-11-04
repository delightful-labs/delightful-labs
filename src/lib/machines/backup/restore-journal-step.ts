import { assign, fromPromise, setup } from 'xstate'
import {
	prepareBrowserRestoreJournal,
	type BrowserJournalConfiguration,
	type BrowserJournalRequest,
	type BrowserJournalResult
} from '../../backup/restore-journal-browser.js'
import type { RestoreJournalRecord } from '../../backup/restore-journal.js'
import { requirePreparationValue } from '../../backup/restore-preparation.js'
import { createBrowserRestoreJournalMachine } from './restore-journal.js'

type Input = BrowserJournalConfiguration
type Context = { configuration: Input; request: BrowserJournalRequest | undefined; result: Result }
type Result = { outcome: BrowserJournalResult['outcome']; record: RestoreJournalRecord | undefined }

/** Finite journal invocation. Copy validated metadata before revoking the borrowed output. */
export function createRestoreJournalStepMachine() {
	const actors = {
		prepare: fromPromise<BrowserJournalRequest, Input>(({ input }) =>
			Promise.resolve(prepareBrowserRestoreJournal(input))
		),
		journal: createBrowserRestoreJournalMachine()
	}
	return setup<
		Context,
		{ type: 'UNUSED' },
		typeof actors,
		{},
		{},
		{},
		never,
		string,
		Input,
		Result
	>({
		actors
	}).createMachine({
		id: 'restore-journal-step',
		context: ({ input }) => ({
			configuration: input,
			request: undefined,
			result: { outcome: 'failed', record: undefined }
		}),
		initial: 'preparing',
		output: ({ context }) => context.result,
		states: {
			preparing: {
				invoke: {
					src: 'prepare',
					input: ({ context }) => context.configuration,
					onDone: { target: 'running', actions: assign({ request: ({ event }) => event.output }) },
					onError: 'complete'
				}
			},
			running: {
				invoke: {
					src: 'journal',
					input: ({ context }) => ({ request: requirePreparationValue(context.request) }),
					onDone: {
						target: 'complete',
						actions: assign({
							result: ({ event }) => ({
								outcome: event.output.outcome,
								record: event.output.record?.readRecord()
							})
						})
					},
					onError: 'complete'
				}
			},
			complete: {
				type: 'final',
				entry: ({ context }) => context.request?.release()
			}
		}
	})
}
