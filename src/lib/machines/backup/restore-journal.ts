import { assign, fromCallback, fromPromise, sendTo, setup } from 'xstate'
import { sameBackupBinding, type BackupBinding } from '../../backup/export.js'
import {
	browserJournalFailure,
	browserJournalOperation,
	type BrowserJournalDecision,
	type BrowserJournalErrorCode,
	type BrowserJournalInterruption,
	type BrowserJournalNativeCommand,
	type BrowserJournalNativeEvent,
	type BrowserJournalRequest,
	type BrowserJournalResult
} from '../../backup/restore-journal-browser.js'

export type BrowserJournalInput = { request: BrowserJournalRequest }
export type BrowserJournalControl =
	| { type: 'CANCEL' | 'SHUTDOWN' }
	| { type: 'INVALIDATE'; binding: BackupBinding }
type Event = BrowserJournalControl | BrowserJournalNativeEvent
type Context = BrowserJournalInput & {
	binding: BackupBinding
	claimed: boolean
	interruption: BrowserJournalInterruption | undefined
	failure: BrowserJournalErrorCode | undefined
	decision: BrowserJournalDecision | undefined
	outcome: 'unavailable' | undefined
}
/** One finite native journal operation; invoke this actor instead of hiding a transaction in a promise. */
export function createBrowserRestoreJournalMachine() {
	function leaf<T>(run: (operation: ReturnType<typeof browserJournalOperation>) => T | Promise<T>) {
		return fromPromise<T, BrowserJournalInput>(({ input }) =>
			Promise.resolve(run(browserJournalOperation(input.request)))
		)
	}
	const actors = {
		claim: leaf((operation) => operation.claim()),
		open: leaf((operation) => operation.openDatabase()),
		acquire: leaf((operation) => operation.acquireTransaction()),
		native: fromCallback<BrowserJournalNativeCommand, BrowserJournalInput>(
			({ input, receive, sendBack }) => {
				const operation = browserJournalOperation(input.request)
				const unsubscribe = operation.subscribe(sendBack)
				receive((command) => operation.command(command))
				return unsubscribe
			}
		),
		drain: leaf((operation) => {
			operation.abort()
			return operation.drain()
		}),
		close: leaf((operation) => operation.closeDatabase())
	}
	const model = setup<
		Context,
		Event,
		typeof actors,
		{},
		{ fail: undefined; interrupt: undefined; abort: undefined; decide: undefined },
		{
			interrupted: undefined
			currentBinding: undefined
			transactionAllowed: undefined
		},
		never,
		string,
		BrowserJournalInput,
		BrowserJournalResult
	>({
		actors,
		guards: {
			interrupted: ({ context }) => context.interruption !== undefined,
			currentBinding: ({ context, event }) =>
				event.type === 'INVALIDATE' && sameBackupBinding(context.binding, event.binding),
			transactionAllowed: ({ context }) =>
				browserJournalOperation(context.request).transactionAllowed()
		},
		actions: {
			fail: assign({
				failure: ({ event }) => browserJournalFailure('error' in event ? event.error : undefined)
			}),
			interrupt: assign({
				interruption: ({ context, event }) =>
					context.interruption ??
					(event.type === 'SHUTDOWN'
						? 'closed'
						: event.type === 'INVALIDATE'
							? 'invalidated'
							: 'cancelled')
			}),
			abort: ({ context }) => {
				if (context.claimed) browserJournalOperation(context.request).abort()
			},
			decide: assign({
				decision: ({ context }) => browserJournalOperation(context.request).decide()
			})
		}
	})
	const input = ({ context }: { context: Context }) => ({ request: context.request })
	const failed = { target: 'draining', actions: 'fail' } satisfies {
		target: string
		actions: 'fail'
	}
	return model.createMachine({
		id: 'browser-restore-journal',
		initial: 'claiming',
		context: ({ input }) => ({
			request: input.request,
			binding: browserJournalOperation(input.request).binding,
			claimed: false,
			interruption: undefined,
			failure: undefined,
			decision: undefined,
			outcome: undefined
		}),
		output: ({ context }): BrowserJournalResult => {
			if (!context.claimed)
				return {
					outcome: 'failed',
					code: context.failure ?? 'journalInUse',
					binding: context.binding,
					journal: { settlement: 'notStarted', durability: null }
				}
			return browserJournalOperation(context.request).complete(
				context.interruption,
				context.failure,
				context.outcome
			)
		},
		on: {
			CANCEL: { actions: ['interrupt', 'abort'] },
			SHUTDOWN: { actions: ['interrupt', 'abort'] },
			INVALIDATE: { guard: 'currentBinding', actions: ['interrupt', 'abort'] }
		},
		states: {
			claiming: {
				invoke: {
					src: 'claim',
					input,
					onDone: [
						{ guard: 'interrupted', target: 'draining', actions: assign({ claimed: true }) },
						{ target: 'opening', actions: assign({ claimed: true }) }
					],
					onError: { target: 'complete', actions: 'fail' }
				}
			},
			opening: {
				tags: 'acquiring',
				invoke: {
					src: 'open',
					input,
					onDone: [
						{ guard: 'interrupted', target: 'draining' },
						{ guard: ({ event }) => event.output === 'opened', target: 'acquiringTransaction' },
						{ target: 'draining', actions: assign({ outcome: 'unavailable' }) }
					],
					onError: failed
				}
			},
			acquiringTransaction: {
				invoke: { src: 'acquire', input, onDone: 'using', onError: failed }
			},
			using: {
				tags: 'transaction',
				invoke: { id: 'native', src: 'native', input, onError: failed },
				on: {
					CANCEL: { target: '.aborting', actions: ['interrupt', 'abort'] },
					SHUTDOWN: { target: '.aborting', actions: ['interrupt', 'abort'] },
					INVALIDATE: {
						guard: 'currentBinding',
						target: '.aborting',
						actions: ['interrupt', 'abort']
					},
					TX_COMPLETE: 'draining',
					TX_ABORTED: 'draining',
					TX_FAILED: { target: '.aborting', actions: 'fail' }
				},
				initial: 'checking',
				states: {
					checking: {
						always: [
							{ guard: 'interrupted', target: 'aborting' },
							{
								guard: ({ context }) =>
									browserJournalOperation(context.request).transactionAllowed() &&
									browserJournalOperation(context.request).mode === 'initialize',
								target: 'committing'
							},
							{ guard: 'transactionAllowed', target: 'reading' },
							{ target: 'aborting' }
						]
					},
					reading: { entry: sendTo('native', { type: 'READ' }), on: { READ_READY: 'deciding' } },
					deciding: {
						entry: 'decide',
						always: [
							{ guard: 'interrupted', target: 'aborting' },
							{ guard: ({ context }) => context.decision === 'write', target: 'staging' },
							{ guard: ({ context }) => context.decision === 'observe', target: 'committing' },
							{ target: 'aborting' }
						]
					},
					staging: { entry: sendTo('native', { type: 'WRITE' }), on: { STAGED: 'committing' } },
					committing: { entry: sendTo('native', { type: 'COMMIT' }) },
					aborting: { entry: sendTo('native', { type: 'ABORT' }) }
				}
			},
			draining: {
				tags: 'cleaning',
				invoke: {
					src: 'drain',
					input,
					onDone: 'closingDatabase',
					onError: {
						target: 'complete',
						actions: [
							assign({ failure: 'journalCleanupFailed' }),
							({ context }) => browserJournalOperation(context.request).release()
						]
					}
				}
			},
			closingDatabase: {
				tags: 'cleaning',
				invoke: {
					src: 'close',
					input,
					onDone: 'complete',
					onError: { target: 'complete', actions: assign({ failure: 'journalCleanupFailed' }) }
				}
			},
			complete: { type: 'final' }
		}
	})
}
