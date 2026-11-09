import { types, setup } from 'xstate'

import type { EventPayload } from '../../contracts/machine-events.js'
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
	encodeRestoreJournalRecord,
	type RestoreJournalRecord
} from '../../backup/restore-journal.js'
import { isValidatedRestoreJournalSuccessor } from '../../backup/restore-journal-successor.js'
export type BrowserJournalInput = {
	request: BrowserJournalRequest
}
export type BrowserJournalControl =
	| {
			type: 'CANCEL' | 'SHUTDOWN'
	  }
	| {
			type: 'INVALIDATE'
			binding: BackupBinding
	  }
type Event =
	| BrowserJournalControl
	| BrowserJournalNativeEvent
	| {
			type: 'REQUEST_CLAIMED'
	  }
	| {
			type: 'CLAIM_FAILED'
			code: BrowserJournalErrorCode
	  }
	| {
			type: 'DECODED'
			record: RestoreJournalRecord | undefined
			failure: BrowserJournalErrorCode | undefined
	  }
	| { type: 'ENCODED'; failure: BrowserJournalErrorCode | undefined }
type Context = BrowserJournalInput & {
	binding: BackupBinding
	claimed: boolean
	observed: RestoreJournalRecord | undefined
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
		context.observed?.revision === command.expectedRevision &&
		isValidatedRestoreJournalSuccessor(context.observed, command.record)
	)
}
function selectedRecord(context: Context): RestoreJournalRecord | undefined {
	const data = browserJournalData(context.request),
		command = data.configuration?.command
	return context.terminal === 'complete' && data.configuration
		? committed(context) && command && (command.mode === 'create' || command.mode === 'update')
			? command.record
			: context.observed
		: undefined
}
function facts(context: Context): Pick<BrowserJournalResult, 'binding' | 'journal' | 'record'> {
	const data = browserJournalData(context.request)
	const record = selectedRecord(context)
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
	const patches = {
		interrupt: ({ context, event }: { context: Context; event: Event }): Partial<Context> => ({
			interruption:
				context.interruption ??
				(event.type === 'SHUTDOWN' || event.type === 'RELEASE'
					? 'closed'
					: event.type === 'INVALIDATE'
						? 'invalidated'
						: 'cancelled')
		}),
		failNative: ({ context, event }: { context: Context; event: Event }): Partial<Context> => ({
			failure:
				event.type === 'NATIVE_FAILED'
					? event.code === 'journalCleanupFailed'
						? event.code
						: (context.failure ?? event.code)
					: context.failure
		})
	}
	function decode(context: Context) {
		const data = browserJournalData(context.request)
		try {
			if (!(data.raw instanceof Uint8Array)) throw createRestoreJournalError('invalidJournal')
			return { record: decodeRestoreJournalRecord(data.raw), failure: context.failure }
		} catch (error) {
			return { record: undefined, failure: context.failure ?? browserJournalFailure(error) }
		} finally {
			clearBrowserJournalBuffers(context.request)
		}
	}
	function encode(context: Context): BrowserJournalErrorCode | undefined {
		const data = browserJournalData(context.request)
		const command = data.configuration?.command
		try {
			if (!command || (command.mode !== 'create' && command.mode !== 'update'))
				return 'invalidJournalRequest'
			data.encoded = encodeRestoreJournalRecord(command.record)
			return context.failure
		} catch (error) {
			return context.failure ?? browserJournalFailure(error)
		}
	}

	const model = setup({
		schemas: {
			context: types<Context>(),
			events: {
				CANCEL: types<EventPayload<Event, 'CANCEL'>>(),
				SHUTDOWN: types<EventPayload<Event, 'SHUTDOWN'>>(),
				INVALIDATE: types<EventPayload<Event, 'INVALIDATE'>>(),
				UPGRADE_REQUESTED: types<EventPayload<Event, 'UPGRADE_REQUESTED'>>(),
				UPGRADE_APPLIED: types<EventPayload<Event, 'UPGRADE_APPLIED'>>(),
				OPENED: types<EventPayload<Event, 'OPENED'>>(),
				OPEN_FAILED: types<EventPayload<Event, 'OPEN_FAILED'>>(),
				BEGIN_FAILED: types<EventPayload<Event, 'BEGIN_FAILED'>>(),
				TX_STARTED: types<EventPayload<Event, 'TX_STARTED'>>(),
				READ_READY: types<EventPayload<Event, 'READ_READY'>>(),
				RELEASE: types<EventPayload<Event, 'RELEASE'>>(),
				WRITE_QUEUED: types<EventPayload<Event, 'WRITE_QUEUED'>>(),
				STAGED: types<EventPayload<Event, 'STAGED'>>(),
				TX_COMPLETE: types<EventPayload<Event, 'TX_COMPLETE'>>(),
				TX_ABORTED: types<EventPayload<Event, 'TX_ABORTED'>>(),
				CLOSED: types<EventPayload<Event, 'CLOSED'>>(),
				NATIVE_FAILED: types<EventPayload<Event, 'NATIVE_FAILED'>>(),
				REQUEST_CLAIMED: types<EventPayload<Event, 'REQUEST_CLAIMED'>>(),
				CLAIM_FAILED: types<EventPayload<Event, 'CLAIM_FAILED'>>(),
				DECODED: types<EventPayload<Event, 'DECODED'>>(),
				ENCODED: types<EventPayload<Event, 'ENCODED'>>()
			},
			input: types<BrowserJournalInput>(),
			output: types<BrowserJournalResult>()
		},
		actors,
		guards: {
			interrupted: ({ context }: { context: Context }) => context.interruption !== undefined,
			currentBinding: ({ context, event }: { context: Context; event: Event }) =>
				event.type === 'INVALIDATE' && sameBackupBinding(context.binding, event.binding),
			hasFailure: ({ context }: { context: Context }) => context.failure !== undefined,
			creating: ({ context }: { context: Context }) =>
				configuration(context)?.command.mode === 'create',
			loading: ({ context }: { context: Context }) =>
				configuration(context)?.command.mode === 'load' ||
				configuration(context)?.command.mode === 'discover',
			missing: ({ context }: { context: Context }) => !context.exists,
			matchingIntent: ({ context }: { context: Context }) => {
				const data = browserJournalData(context.request),
					command = data.configuration?.command
				if (!context.observed || !command || command.mode === 'initialize') return false
				if (command.mode === 'discover')
					return matchesJournalBinding(context.observed, context.binding)
				const expected = command.mode === 'load' ? command.intent : command.record.intent
				return (
					matchesJournalBinding(context.observed, context.binding) &&
					JSON.stringify(context.observed.intent) === JSON.stringify(expected)
				)
			},
			alreadyStored: ({ context }: { context: Context }) => {
				const data = browserJournalData(context.request),
					command = data.configuration?.command
				return (
					command?.mode === 'update' &&
					context.observed !== undefined &&
					JSON.stringify(context.observed) === JSON.stringify(command.record)
				)
			},
			candidateAdmitted: ({ context }: { context: Context }) => candidateAdmitted(context),
			successNeedsCommit: ({ context }: { context: Context }) =>
				(context.outcome === 'created' || context.outcome === 'updated') && !committed(context),
			successNeedsTerminal: ({ context }: { context: Context }) =>
				(context.outcome === 'initialized' ||
					context.outcome === 'loaded' ||
					context.outcome === 'existing') &&
				context.terminal !== 'complete'
		},
		actions: {
			publishResult: ({ context }: { context: Context }) => {
				if (context.claimed) browserJournalData(context.request).result = selectedRecord(context)
			}
		}
	})
	const input = ({ context }: { context: Context }) => ({ request: context.request })
	type CompletionEntry = Extract<
		NonNullable<Parameters<typeof model.createStateConfig>[0]['entry']>,
		(...args: never[]) => unknown
	>
	type CompletionArgs = Pick<Parameters<CompletionEntry>[0], 'context' | 'actions'>
	type CompletionQueue = Parameters<CompletionEntry>[1]
	const finalizers = {
		failed: (args, enq) => {
			enq(args.actions.publishResult, args)
			const { context } = args
			return {
				context: {
					observed: undefined,
					result: {
						...(context.claimed
							? facts(context)
							: {
									binding: context.binding,
									journal: { settlement: 'notStarted', durability: null }
								}),
						outcome: 'failed',
						code: context.failure ?? 'journalStoreFailed'
					}
				} satisfies Partial<Context>
			}
		},
		interrupted: (args, enq) => {
			enq(args.actions.publishResult, args)
			const { context } = args
			return {
				context: {
					observed: undefined,
					result: {
						...facts(context),
						outcome: context.interruption ?? 'cancelled'
					}
				} satisfies Partial<Context>
			}
		},
		succeeded: (args, enq) => {
			enq(args.actions.publishResult, args)
			const { context } = args
			return {
				context: {
					observed: undefined,
					result: {
						...facts(context),
						outcome: context.outcome
					}
				} satisfies Partial<Context>
			}
		}
	} satisfies Record<
		string,
		(args: CompletionArgs, enq: CompletionQueue) => void | { context?: Partial<Context> }
	>

	return model.createMachine({
		id: 'browser-restore-journal',
		initial: 'claiming',
		context: ({ input }) => ({
			request: input.request,
			binding: browserJournalBinding(input.request),
			claimed: false,
			observed: undefined,
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
			CANCEL: (args) => {
				return { context: patches.interrupt(args) satisfies Partial<Context> }
			},
			SHUTDOWN: (args) => {
				return { context: patches.interrupt(args) satisfies Partial<Context> }
			},
			INVALIDATE: (args) => {
				if (!args.guards.currentBinding(args)) return
				return { context: patches.interrupt(args) satisfies Partial<Context> }
			},
			RELEASE: (args) => {
				return { context: patches.interrupt(args) satisfies Partial<Context> }
			}
		},
		states: {
			claiming: {
				entry: ({ context, self }, enq) => {
					enq(() => {
						try {
							claimBrowserJournalRequest(context.request)
							self.send({ type: 'REQUEST_CLAIMED' })
						} catch (error) {
							self.send({ type: 'CLAIM_FAILED', code: browserJournalFailure(error) })
						}
					})
				},
				on: {
					REQUEST_CLAIMED: (args) => {
						const { context } = args
						if (!configuration(context)) {
							return {
								target: 'finishing',
								context: { claimed: true, interruption: 'closed' } satisfies Partial<Context>
							}
						}
						if (args.guards.interrupted(args)) {
							return {
								target: 'finishing',
								context: { claimed: true } satisfies Partial<Context>
							}
						}
						return {
							target: 'active',
							context: { claimed: true } satisfies Partial<Context>
						}
					},
					CLAIM_FAILED: (args) => {
						return {
							target: 'finishing',
							context: { failure: args.event.code } satisfies Partial<Context>
						}
					}
				}
			},
			active: {
				invoke: {
					id: 'native',
					src: actors.native,
					input,
					onError: (args) => {
						return {
							target: 'finishing',
							context: {
								failure: browserJournalFailure(args.event.error)
							} satisfies Partial<Context>
						}
					}
				},
				initial: 'opening',
				on: {
					NATIVE_FAILED: (args) => {
						return { context: patches.failNative(args) satisfies Partial<Context> }
					}
				},
				states: {
					opening: {
						initial: 'awaitingOpen',
						entry: (args, enq) => {
							enq.sendTo('native', { type: 'OPEN' })
						},
						states: {
							awaitingOpen: {
								on: {
									UPGRADE_REQUESTED: (args) => {
										const { context, event } = args
										if (args.guards.interrupted(args)) {
											return { target: 'rejectingSchema' }
										}
										if (args.guards.hasFailure(args)) {
											return { target: 'rejectingSchema' }
										}
										if (
											configuration(context)?.command.mode === 'initialize' &&
											event.oldVersion === 0 &&
											event.newVersion === 1
										) {
											return { target: 'creatingSchema' }
										}
										return { target: 'rejectingSchema' }
									}
								}
							},
							creatingSchema: {
								entry: (args, enq) => {
									enq.sendTo('native', { type: 'CREATE_SCHEMA' })
								},
								on: {
									UPGRADE_APPLIED: { target: 'awaitingOpen' },
									NATIVE_FAILED: (args) => {
										return {
											target: 'rejectingSchema',
											context: patches.failNative(args) satisfies Partial<Context>
										}
									}
								}
							},
							rejectingSchema: {
								entry: (args, enq) => {
									enq.sendTo('native', { type: 'REJECT_UPGRADE' })
								}
							}
						},
						on: {
							OPENED: (args) => {
								if (args.guards.interrupted(args)) {
									return { target: 'closing' }
								}
								if (args.guards.hasFailure(args)) {
									return { target: 'closing' }
								}
								if (!args.event.supported) {
									return { target: 'closing' }
								}
								return { target: 'transaction' }
							},
							OPEN_FAILED: (args) => {
								return {
									target: 'closing',
									context: {
										failure: args.context.failure ?? args.event.code
									} satisfies Partial<Context>
								}
							}
						}
					},
					transaction: {
						tags: ['transaction'],
						initial: 'starting',
						on: {
							CANCEL: (args) => {
								return {
									target: '.aborting',
									context: patches.interrupt(args) satisfies Partial<Context>
								}
							},
							SHUTDOWN: (args) => {
								return {
									target: '.aborting',
									context: patches.interrupt(args) satisfies Partial<Context>
								}
							},
							RELEASE: (args) => {
								return {
									target: '.aborting',
									context: patches.interrupt(args) satisfies Partial<Context>
								}
							},
							INVALIDATE: (args) => {
								if (!args.guards.currentBinding(args)) return
								return {
									target: '.aborting',
									context: patches.interrupt(args) satisfies Partial<Context>
								}
							},
							NATIVE_FAILED: (args) => {
								return {
									target: '.aborting',
									context: patches.failNative(args) satisfies Partial<Context>
								}
							},
							BEGIN_FAILED: (args) => {
								return {
									target: 'closing',
									context: {
										failure: args.context.failure ?? args.event.code
									} satisfies Partial<Context>
								}
							},
							WRITE_QUEUED: (_args) => {
								return { context: { writeQueued: true } satisfies Partial<Context> }
							},
							TX_COMPLETE: (_args) => {
								return {
									target: 'closing',
									context: { terminal: 'complete' } satisfies Partial<Context>
								}
							},
							TX_ABORTED: (_args) => {
								return {
									target: 'closing',
									context: { terminal: 'abort' } satisfies Partial<Context>
								}
							}
						},
						states: {
							starting: {
								entry: (args, enq) => {
									enq.sendTo('native', { type: 'BEGIN' })
								},
								on: {
									TX_STARTED: (args) => {
										const { event } = args
										return {
											target: 'checking',
											context: {
												strict: event.strict,
												supported: event.supported
											} satisfies Partial<Context>
										}
									}
								}
							},
							checking: {
								always: (args) => {
									const { context } = args
									if (args.guards.interrupted(args)) {
										return { target: 'aborting' }
									}
									if (!context.strict || !context.supported) {
										return { target: 'aborting' }
									}
									if (configuration(context)?.command.mode === 'initialize') {
										return {
											target: 'committing',
											context: { outcome: 'initialized' } satisfies Partial<Context>
										}
									}
									return { target: 'reading' }
								}
							},
							reading: {
								entry: (args, enq) => {
									enq.sendTo('native', { type: 'READ' })
								},
								on: {
									READ_READY: (args) => {
										return {
											target: 'checkingRow',
											context: { exists: args.event.exists } satisfies Partial<Context>
										}
									}
								}
							},
							checkingRow: {
								always: (args) => {
									const { context } = args
									if (!context.exists && configuration(context)?.command.mode === 'create') {
										return {
											target: 'admittingWrite',
											context: { outcome: 'created' } satisfies Partial<Context>
										}
									}
									if (args.guards.missing(args)) {
										return {
											target: 'aborting',
											context: { outcome: 'missing' } satisfies Partial<Context>
										}
									}
									return { target: 'validating' }
								}
							},
							validating: {
								entry: ({ context, self }, enq) => {
									enq(() => self.send({ type: 'DECODED', ...decode(context) }))
								},
								on: {
									DECODED: ({ context, event }) => ({
										target: 'checkingDecoded',
										context: { observed: event.record, failure: context.failure ?? event.failure }
									})
								}
							},
							checkingDecoded: {
								always: (args) => {
									if (args.guards.hasFailure(args)) {
										return { target: 'aborting' }
									}
									if (!args.guards.matchingIntent(args)) {
										return {
											target: 'aborting',
											context: { outcome: 'conflict' } satisfies Partial<Context>
										}
									}
									if (args.guards.loading(args)) {
										return {
											target: 'committing',
											context: { outcome: 'loaded' } satisfies Partial<Context>
										}
									}
									if (args.guards.creating(args)) {
										return {
											target: 'committing',
											context: { outcome: 'existing' } satisfies Partial<Context>
										}
									}
									if (args.guards.alreadyStored(args)) {
										return {
											target: 'committing',
											context: { outcome: 'existing' } satisfies Partial<Context>
										}
									}
									if (args.guards.candidateAdmitted(args)) {
										return {
											target: 'admittingWrite',
											context: { outcome: 'updated' } satisfies Partial<Context>
										}
									}
									return {
										target: 'aborting',
										context: { outcome: 'conflict' } satisfies Partial<Context>
									}
								}
							},
							admittingWrite: {
								always: (args) => {
									if (args.guards.candidateAdmitted(args)) {
										return { target: 'encoding' }
									}
									return {
										target: 'aborting',
										context: { outcome: 'conflict' } satisfies Partial<Context>
									}
								}
							},
							encoding: {
								entry: ({ context, self }, enq) => {
									enq(() => self.send({ type: 'ENCODED', failure: encode(context) }))
								},
								on: {
									ENCODED: ({ context, event }) => ({
										target: 'checkingEncoded',
										context: { failure: context.failure ?? event.failure }
									})
								}
							},
							checkingEncoded: {
								type: 'choice',
								choice: (args) => {
									if (args.guards.hasFailure(args)) {
										return { target: 'aborting' }
									}
									return { target: 'staging' }
								}
							},
							staging: {
								entry: (args, enq) => {
									enq.sendTo('native', { type: 'WRITE' })
								},
								on: {
									STAGED: (_args) => {
										return {
											target: 'committing',
											context: { writeStaged: true } satisfies Partial<Context>
										}
									}
								}
							},
							committing: {
								entry: (args, enq) => {
									enq.sendTo('native', { type: 'COMMIT' })
								}
							},
							aborting: {
								tags: ['draining'],
								entry: (args, enq) => {
									enq.sendTo('native', { type: 'ABORT' })
								}
							}
						}
					},
					closing: {
						tags: ['cleaning'],
						entry: (args, enq) => {
							enq.sendTo('native', { type: 'CLOSE' })
						},
						on: {
							CLOSED: (args, enq) => {
								enq(() => clearBrowserJournalBuffers(args.context.request))
								return { target: '#browser-restore-journal.finishing' }
							},
							NATIVE_FAILED: (_args) => {
								return {
									target: '#browser-restore-journal.finishing',
									context: { failure: 'journalCleanupFailed' } satisfies Partial<Context>
								}
							}
						}
					}
				}
			},
			finishing: {
				always: (args) => {
					const { context } = args
					if (!context.claimed || context.failure === 'journalCleanupFailed') {
						return { target: 'failed' }
					}
					if (args.guards.interrupted(args)) {
						return { target: 'interrupted' }
					}
					if (args.guards.hasFailure(args)) {
						return { target: 'failed' }
					}
					if (args.guards.successNeedsCommit(args)) {
						return {
							target: 'failed',
							context: { failure: 'journalStoreFailed' } satisfies Partial<Context>
						}
					}
					if (args.guards.successNeedsTerminal(args)) {
						return {
							target: 'failed',
							context: { failure: 'journalStoreFailed' } satisfies Partial<Context>
						}
					}

					return { target: 'succeeded' }
				}
			},
			failed: {
				type: 'final',
				entry: finalizers.failed
			},
			interrupted: {
				type: 'final',
				entry: finalizers.interrupted
			},
			succeeded: {
				type: 'final',
				entry: finalizers.succeeded
			}
		}
	})
}
