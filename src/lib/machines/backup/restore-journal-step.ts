import { types, setup } from 'xstate'
import { createFinalTransitions } from '../finalize.js'

import type { EventPayload } from '../../contracts/machine-events.js'
import {
	prepareBrowserRestoreJournal,
	type BrowserJournalConfiguration,
	type BrowserJournalRequest,
	type BrowserJournalResult
} from '../../backup/restore-journal-browser.js'
import type { RestoreJournalRecord } from '../../backup/restore-journal.js'
import { requireRestoreValue } from '../../backup/restore.js'
import { createBrowserRestoreJournalMachine } from './restore-journal.js'
type Input = BrowserJournalConfiguration
type Context = {
	configuration: Input
	request: BrowserJournalRequest | undefined
	result: Result
}
type Result = {
	outcome: BrowserJournalResult['outcome']
	record: RestoreJournalRecord | undefined
}
/** Finite journal invocation. Copy validated metadata before revoking the borrowed output. */
export function createRestoreJournalStepMachine() {
	const actors = {
		journal: createBrowserRestoreJournalMachine()
	}
	const completionModel = setup({
		schemas: {
			context: types<Context>(),
			events: {
				PREPARED: types<
					EventPayload<
						| {
								type: 'PREPARED'
								request: BrowserJournalRequest
						  }
						| {
								type: 'PREPARATION_FAILED'
						  },
						'PREPARED'
					>
				>(),
				PREPARATION_FAILED: types<
					EventPayload<
						| {
								type: 'PREPARED'
								request: BrowserJournalRequest
						  }
						| {
								type: 'PREPARATION_FAILED'
						  },
						'PREPARATION_FAILED'
					>
				>()
			},
			input: types<Input>(),
			output: types<Result>()
		},
		actors
	})
	type CompletionEntry = Extract<
		NonNullable<Parameters<typeof completionModel.createStateConfig>[0]['entry']>,
		(...args: never[]) => unknown
	>
	type CompletionArgs = Pick<Parameters<CompletionEntry>[0], 'context' | 'actions'>
	type CompletionQueue = Parameters<CompletionEntry>[1]
	const finalizers = {
		complete: (args, enq) => {
			enq(({ context }: CompletionArgs) => context.request?.release(), args)
		}
	} satisfies Record<
		string,
		(args: CompletionArgs, enq: CompletionQueue) => void | { context?: Partial<Context> }
	>
	const complete = createFinalTransitions<
		Context,
		CompletionArgs,
		CompletionQueue,
		keyof typeof finalizers
	>(finalizers)

	return completionModel.createMachine({
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
				entry: ({ context, self }) => {
					try {
						self.send({
							type: 'PREPARED',
							request: prepareBrowserRestoreJournal(context.configuration)
						})
					} catch {
						self.send({ type: 'PREPARATION_FAILED' })
					}
				},
				on: {
					PREPARED: (args) => {
						return {
							target: 'running',
							context: { request: args.event.request } satisfies Partial<Context>
						}
					},
					PREPARATION_FAILED: (args, enq) => {
						return complete('complete', args, enq, { target: 'complete' })
					}
				}
			},
			running: {
				invoke: {
					src: actors.journal,
					input: ({ context }) => ({ request: requireRestoreValue(context.request) }),
					onDone: (args, enq) => {
						const { event } = args
						{
							return complete('complete', args, enq, {
								target: 'complete',
								context: {
									result: {
										outcome: event.output.outcome,
										record: event.output.record?.readRecord()
									}
								} satisfies Partial<Context>
							})
						}
					},
					onError: (args, enq) => {
						return complete('complete', args, enq, { target: 'complete' })
					}
				}
			},
			complete: {
				type: 'final'
			}
		}
	})
}
