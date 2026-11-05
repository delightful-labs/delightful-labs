import { assign, not, sendTo, setup } from 'xstate'
import { sameBackupBinding, type BackupBinding } from '../../backup/binding.js'
import {
	browserJournalBinding,
	browserJournalData,
	browserJournalFailure,
	claimBrowserJournalRequest,
	clearBrowserJournalBuffers,
	matchesJournalBinding,
	type BrowserJournalErrorCode,
	type BrowserJournalInterruption,
	type BrowserJournalOutcome,
	type BrowserJournalRequest,
	type BrowserJournalResult
} from '../../backup/restore-journal-browser.js'
import {
	browserJournalNativeActor,
	type BrowserJournalNativeEvent
} from '../../backup/restore-journal-browser-native.js'
import {
	createRestoreJournalError,
	decodeRestoreJournalRecord,
	encodeRestoreJournalRecord
} from '../../backup/restore-journal.js'
import { isValidatedRestoreJournalSuccessor } from '../../backup/restore-journal-successor.js'

export type BrowserJournalInput = { request: BrowserJournalRequest }
export type BrowserJournalControl =
	| { type: 'CANCEL' | 'SHUTDOWN' }
	| { type: 'INVALIDATE'; binding: BackupBinding }
type Event =
	| BrowserJournalControl
	| BrowserJournalNativeEvent
	| { type: 'REQUEST_CLAIMED' }
	| { type: 'CLAIM_FAILED'; code: BrowserJournalErrorCode }
type Context = BrowserJournalInput & {
	binding: BackupBinding
	claimed: boolean
	interruption: BrowserJournalInterruption | undefined
	failure: BrowserJournalErrorCode | undefined
	outcome: BrowserJournalOutcome
	// Native observations retained for reporting after the transaction states have exited.
	strict: boolean
	supported: boolean
	exists: boolean
	writeQueued: boolean
	writeStaged: boolean
	terminal: 'notStarted' | 'complete' | 'abort'
	result: BrowserJournalResult | undefined
}
function configuration(context: Context) {
	return browserJournalData(context.request).configuration
}
function committed(context: Context) {
	return context.writeQueued && context.writeStaged && context.terminal === 'complete'
}
function candidateAdmitted(context: Context): boolean {
	const data = browserJournalData(context.request),
		command = data.configuration?.command
	if (!command || (command.mode !== 'create' && command.mode !== 'update')) return false
	if (!matchesJournalBinding(command.record, context.binding)) return false
	if (command.mode === 'create') return !context.exists && command.record.revision === 0
	return (
		data.observed?.revision === command.expectedRevision &&
		isValidatedRestoreJournalSuccessor(data.observed, command.record)
	)
}
function facts(context: Context): Pick<BrowserJournalResult, 'binding' | 'journal' | 'record'> {
	const data = browserJournalData(context.request),
		command = data.configuration?.command
	const record =
		context.terminal === 'complete' && data.configuration
			? committed(context) && command && (command.mode === 'create' || command.mode === 'update')
				? command.record
				: data.observed
			: undefined
	data.result = record
	return {
		binding: context.binding,
		journal: {
			settlement: committed(context)
				? 'committed'
				: context.writeQueued
					? context.terminal === 'abort'
						? 'aborted'
						: 'unknown'
					: 'notStarted',
			durability: context.strict ? 'strict' : null
		},
		...(record ? { record: data.view } : {})
	}
}
/** The single lifecycle owner. Native callbacks report observations; this chart makes every decision. */
export function createBrowserRestoreJournalMachine() {
	const actors = {
		native: browserJournalNativeActor
	}
	const model = setup<
		Context,
		Event,
		typeof actors,
		{},
		{
			interrupt: undefined
			failNative: undefined
			decode: undefined
			encode: undefined
		},
		{
			interrupted: undefined
			currentBinding: undefined
			hasFailure: undefined
			creating: undefined
			loading: undefined
			missing: undefined
			matchingIntent: undefined
			alreadyStored: undefined
			candidateAdmitted: undefined
			successNeedsCommit: undefined
			successNeedsTerminal: undefined
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
			hasFailure: ({ context }) => context.failure !== undefined,
			creating: ({ context }) => configuration(context)?.command.mode === 'create',
			loading: ({ context }) =>
				configuration(context)?.command.mode === 'load' ||
				configuration(context)?.command.mode === 'discover',
			missing: ({ context }) => !context.exists,
			matchingIntent: ({ context }) => {
				const data = browserJournalData(context.request),
					command = data.configuration?.command
				if (!data.observed || !command || command.mode === 'initialize') return false
				if (command.mode === 'discover')
					return matchesJournalBinding(data.observed, context.binding)
				const expected = command.mode === 'load' ? command.intent : command.record.intent
				return (
					matchesJournalBinding(data.observed, context.binding) &&
					JSON.stringify(data.observed.intent) === JSON.stringify(expected)
				)
			},
			alreadyStored: ({ context }) => {
				const data = browserJournalData(context.request),
					command = data.configuration?.command
				return (
					command?.mode === 'update' &&
					data.observed !== undefined &&
					JSON.stringify(data.observed) === JSON.stringify(command.record)
				)
			},
			candidateAdmitted: ({ context }) => candidateAdmitted(context),
			successNeedsCommit: ({ context }) =>
				(context.outcome === 'created' || context.outcome === 'updated') && !committed(context),
			successNeedsTerminal: ({ context }) =>
				(context.outcome === 'initialized' ||
					context.outcome === 'loaded' ||
					context.outcome === 'existing') &&
				context.terminal !== 'complete'
		},
		actions: {
			interrupt: assign({
				interruption: ({ context, event }) =>
					context.interruption ??
					(event.type === 'SHUTDOWN' || event.type === 'RELEASE'
						? 'closed'
						: event.type === 'INVALIDATE'
							? 'invalidated'
							: 'cancelled')
			}),
			failNative: assign({
				failure: ({ context, event }) =>
					event.type === 'NATIVE_FAILED'
						? event.code === 'journalCleanupFailed'
							? event.code
							: (context.failure ?? event.code)
						: context.failure
			}),
			decode: assign({
				failure: ({ context }) => {
					const data = browserJournalData(context.request)
					try {
						if (!(data.raw instanceof Uint8Array)) throw createRestoreJournalError('invalidJournal')
						data.observed = decodeRestoreJournalRecord(data.raw)
						return context.failure
					} catch (error) {
						return context.failure ?? browserJournalFailure(error)
					} finally {
						clearBrowserJournalBuffers(context.request)
					}
				}
			}),
			encode: assign({
				failure: ({ context }) => {
					const data = browserJournalData(context.request),
						command = data.configuration?.command
					try {
						if (!command || (command.mode !== 'create' && command.mode !== 'update'))
							return 'invalidJournalRequest'
						data.encoded = encodeRestoreJournalRecord(command.record)
						return context.failure
					} catch (error) {
						return context.failure ?? browserJournalFailure(error)
					}
				}
			})
		}
	})
	const input = ({ context }: { context: Context }) => ({ request: context.request })
	return model.createMachine({
		id: 'browser-restore-journal',
		initial: 'claiming',
		context: ({ input }) => ({
			request: input.request,
			binding: browserJournalBinding(input.request),
			claimed: false,
			interruption: undefined,
			failure: undefined,
			outcome: 'unavailable',
			strict: false,
			supported: false,
			exists: false,
			writeQueued: false,
			writeStaged: false,
			terminal: 'notStarted',
			result: undefined
		}),
		output: ({ context }) =>
			context.result ?? {
				binding: context.binding,
				journal: { settlement: 'notStarted', durability: null },
				outcome: 'failed',
				code: 'journalStoreFailed'
			},
		on: {
			CANCEL: { actions: 'interrupt' },
			SHUTDOWN: { actions: 'interrupt' },
			INVALIDATE: { guard: 'currentBinding', actions: 'interrupt' },
			RELEASE: { actions: 'interrupt' }
		},
		states: {
			claiming: {
				entry: ({ context, self }) => {
					try {
						claimBrowserJournalRequest(context.request)
						self.send({ type: 'REQUEST_CLAIMED' })
					} catch (error) {
						self.send({ type: 'CLAIM_FAILED', code: browserJournalFailure(error) })
					}
				},
				on: {
					REQUEST_CLAIMED: [
						{
							guard: ({ context }) => !configuration(context),
							target: 'finishing',
							actions: assign({ claimed: true, interruption: 'closed' })
						},
						{ guard: 'interrupted', target: 'finishing', actions: assign({ claimed: true }) },
						{ target: 'active', actions: assign({ claimed: true }) }
					],
					CLAIM_FAILED: {
						target: 'finishing',
						actions: assign({ failure: ({ event }) => event.code })
					}
				}
			},
			active: {
				invoke: {
					id: 'native',
					src: 'native',
					input,
					onError: {
						target: 'finishing',
						actions: assign({ failure: ({ event }) => browserJournalFailure(event.error) })
					}
				},
				initial: 'opening',
				on: { NATIVE_FAILED: { actions: 'failNative' } },
				states: {
					opening: {
						initial: 'awaitingOpen',
						entry: sendTo('native', { type: 'OPEN' }),
						states: {
							awaitingOpen: {
								on: {
									UPGRADE_REQUESTED: [
										{ guard: 'interrupted', target: 'rejectingSchema' },
										{ guard: 'hasFailure', target: 'rejectingSchema' },
										{
											guard: ({ context, event }) =>
												configuration(context)?.command.mode === 'initialize' &&
												event.oldVersion === 0 &&
												event.newVersion === 1,
											target: 'creatingSchema'
										},
										{ target: 'rejectingSchema' }
									]
								}
							},
							creatingSchema: {
								entry: sendTo('native', { type: 'CREATE_SCHEMA' }),
								on: {
									UPGRADE_APPLIED: 'awaitingOpen',
									NATIVE_FAILED: { target: 'rejectingSchema', actions: 'failNative' }
								}
							},
							rejectingSchema: {
								entry: sendTo('native', { type: 'REJECT_UPGRADE' })
							}
						},
						on: {
							OPENED: [
								{ guard: 'interrupted', target: 'closing' },
								{ guard: 'hasFailure', target: 'closing' },
								{ guard: ({ event }) => !event.supported, target: 'closing' },
								{ target: 'transaction' }
							],
							OPEN_FAILED: {
								target: 'closing',
								actions: assign({ failure: ({ context, event }) => context.failure ?? event.code })
							}
						}
					},
					transaction: {
						tags: 'transaction',
						initial: 'starting',
						on: {
							CANCEL: { target: '.aborting', actions: 'interrupt' },
							SHUTDOWN: { target: '.aborting', actions: 'interrupt' },
							RELEASE: { target: '.aborting', actions: 'interrupt' },
							INVALIDATE: { guard: 'currentBinding', target: '.aborting', actions: 'interrupt' },
							NATIVE_FAILED: { target: '.aborting', actions: 'failNative' },
							BEGIN_FAILED: {
								target: 'closing',
								actions: assign({ failure: ({ context, event }) => context.failure ?? event.code })
							},
							WRITE_QUEUED: { actions: assign({ writeQueued: true }) },
							TX_COMPLETE: { target: 'closing', actions: assign({ terminal: 'complete' }) },
							TX_ABORTED: { target: 'closing', actions: assign({ terminal: 'abort' }) }
						},
						states: {
							starting: {
								entry: sendTo('native', { type: 'BEGIN' }),
								on: {
									TX_STARTED: {
										target: 'checking',
										actions: assign({
											strict: ({ event }) => event.strict,
											supported: ({ event }) => event.supported
										})
									}
								}
							},
							checking: {
								always: [
									{ guard: 'interrupted', target: 'aborting' },
									{
										guard: ({ context }) => !context.strict || !context.supported,
										target: 'aborting'
									},
									{
										guard: ({ context }) => configuration(context)?.command.mode === 'initialize',
										target: 'committing',
										actions: assign({ outcome: 'initialized' })
									},
									{ target: 'reading' }
								]
							},
							reading: {
								entry: sendTo('native', { type: 'READ' }),
								on: {
									READ_READY: {
										target: 'checkingRow',
										actions: assign({ exists: ({ event }) => event.exists })
									}
								}
							},
							checkingRow: {
								always: [
									{
										guard: ({ context }) =>
											!context.exists && configuration(context)?.command.mode === 'create',
										target: 'admittingWrite',
										actions: assign({ outcome: 'created' })
									},
									{ guard: 'missing', target: 'aborting', actions: assign({ outcome: 'missing' }) },
									{ target: 'validating' }
								]
							},
							validating: {
								entry: 'decode',
								always: [
									{ guard: 'hasFailure', target: 'aborting' },
									{
										guard: not('matchingIntent'),
										target: 'aborting',
										actions: assign({ outcome: 'conflict' })
									},
									{
										guard: 'loading',
										target: 'committing',
										actions: assign({ outcome: 'loaded' })
									},
									{
										guard: 'creating',
										target: 'committing',
										actions: assign({ outcome: 'existing' })
									},
									{
										guard: 'alreadyStored',
										target: 'committing',
										actions: assign({ outcome: 'existing' })
									},
									{
										guard: 'candidateAdmitted',
										target: 'admittingWrite',
										actions: assign({ outcome: 'updated' })
									},
									{ target: 'aborting', actions: assign({ outcome: 'conflict' }) }
								]
							},
							admittingWrite: {
								always: [
									{ guard: 'candidateAdmitted', target: 'encoding' },
									{ target: 'aborting', actions: assign({ outcome: 'conflict' }) }
								]
							},
							encoding: {
								entry: 'encode',
								always: [{ guard: 'hasFailure', target: 'aborting' }, { target: 'staging' }]
							},
							staging: {
								entry: sendTo('native', { type: 'WRITE' }),
								on: { STAGED: { target: 'committing', actions: assign({ writeStaged: true }) } }
							},
							committing: { entry: sendTo('native', { type: 'COMMIT' }) },
							aborting: { tags: 'draining', entry: sendTo('native', { type: 'ABORT' }) }
						}
					},
					closing: {
						tags: 'cleaning',
						entry: sendTo('native', { type: 'CLOSE' }),
						on: {
							CLOSED: {
								target: '#browser-restore-journal.finishing',
								actions: ({ context }) => clearBrowserJournalBuffers(context.request)
							},
							NATIVE_FAILED: {
								target: '#browser-restore-journal.finishing',
								actions: assign({ failure: 'journalCleanupFailed' })
							}
						}
					}
				}
			},
			finishing: {
				always: [
					{
						guard: ({ context }) => !context.claimed || context.failure === 'journalCleanupFailed',
						target: 'failed'
					},
					{ guard: 'interrupted', target: 'interrupted' },
					{ guard: 'hasFailure', target: 'failed' },
					{
						guard: 'successNeedsCommit',
						target: 'failed',
						actions: assign({ failure: 'journalStoreFailed' })
					},
					{
						guard: 'successNeedsTerminal',
						target: 'failed',
						actions: assign({ failure: 'journalStoreFailed' })
					},
					{ target: 'succeeded' }
				]
			},
			failed: {
				type: 'final',
				entry: assign({
					result: ({ context }): BrowserJournalResult => ({
						...(context.claimed
							? facts(context)
							: {
									binding: context.binding,
									journal: { settlement: 'notStarted', durability: null }
								}),
						outcome: 'failed',
						code: context.failure ?? 'journalStoreFailed'
					})
				})
			},
			interrupted: {
				type: 'final',
				entry: assign({
					result: ({ context }): BrowserJournalResult => ({
						...facts(context),
						outcome: context.interruption ?? 'cancelled'
					})
				})
			},
			succeeded: {
				type: 'final',
				entry: assign({
					result: ({ context }): BrowserJournalResult => ({
						...facts(context),
						outcome: context.outcome
					})
				})
			}
		}
	})
}
