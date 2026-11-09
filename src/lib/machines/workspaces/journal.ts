import { matchesState, type StateValue, types, createCallbackLogic, setup } from 'xstate'
import { createFinalTransitions } from '../finalize.js'

import type { EventPayload } from '../../contracts/machine-events.js'
import { journalDatabase, type JournalDatabaseEvent } from './journal-native.js'
export type WorkspaceJournalEvent =
	| JournalDatabaseEvent
	| {
			type: 'SHUTDOWN' | 'CANCEL' | 'TX_COMPLETE' | 'TX_ABORTED'
	  }
	| {
			type: 'RECORD'
			value: unknown
	  }
	| {
			type: 'TX_FAILED'
			error: unknown
	  }
export type WorkspaceJournalResult<Record> =
	| {
			outcome: 'succeeded'
			record: Record | undefined
	  }
	| {
			outcome: 'conflict' | 'cancelled'
	  }
	| {
			outcome: 'failed'
			error: unknown
	  }
export type WorkspaceJournalInput<Record> = {
	key: string
} & (
	| {
			mode: 'read'
	  }
	| {
			mode: 'write'
			record: Record
	  }
	| {
			mode: 'clear'
			attemptId: string
	  }
)
export function createWorkspaceJournal<
	Record extends {
		key: string
	}
>(options: {
	databaseName: string
	attemptId: (record: Record) => string
	schema: {
		safeParse: (value: unknown) => {
			success: boolean
		}
		parse: (value: unknown) => Record
	}
}) {
	type WorkspaceJournalRecord = Record
	type Input = WorkspaceJournalInput<Record>
	type JournalResult = WorkspaceJournalResult<Record>
	type Command =
		| {
				type: 'READ'
				key: string
		  }
		| {
				type: 'INSERT'
				record: WorkspaceJournalRecord
		  }
		| {
				type: 'REMOVE'
				key: string
		  }
		| {
				type: 'ABORT'
		  }
	type Event = WorkspaceJournalEvent
	function required<T>(value: T | undefined): T {
		if (value === undefined) throw new Error('Missing journal resource')
		return value
	}
	// Native resource adapter: commands each perform one operation; the chart chooses policy/staging.
	const resource = createCallbackLogic<Command, IDBTransaction>(
		({ input: tx, receive, sendBack }) => {
			let report: ((event: WorkspaceJournalEvent) => void) | undefined = sendBack
			tx.oncomplete = () => report?.({ type: 'TX_COMPLETE' })
			tx.onabort = () => report?.({ type: 'TX_ABORTED' })
			tx.onerror = (event) => {
				const requestError = event.target instanceof IDBRequest ? event.target.error : undefined
				// Explicit abort rejects pending requests with AbortError but leaves tx.error null.
				// Its native abort event supplies settlement; those request errors are not new failures.
				if (requestError?.name === 'AbortError' && tx.error === null) return
				report?.({ type: 'TX_FAILED', error: tx.error ?? requestError })
			}
			receive((command) => {
				try {
					if (command.type === 'READ') {
						const request = tx.objectStore('attempts').get(command.key)
						request.onsuccess = () => report?.({ type: 'RECORD', value: request.result })
						return
					}
					if (command.type === 'INSERT') {
						tx.objectStore('attempts').add(command.record)
						return
					}
					if (command.type === 'REMOVE') {
						tx.objectStore('attempts').delete(command.key)
						return
					}
					tx.abort()
				} catch (error) {
					report?.({ type: 'TX_FAILED', error })
					if (command.type === 'ABORT') return
					try {
						tx.abort()
					} catch (abortError) {
						report?.({ type: 'TX_FAILED', error: abortError })
					}
				}
			})
			return () => {
				report = undefined
				tx.oncomplete = null
				tx.onabort = null
				tx.onerror = null
				try {
					tx.abort()
				} catch {
					/* Native commit/abort may already be terminal. */
				}
			}
		}
	)
	type Context = {
		request: Input
		tx: IDBTransaction | undefined
		raw: unknown
		result: JournalResult | undefined
		observation: {
			record: WorkspaceJournalRecord | undefined
		}
	}
	const completionModel = setup({
		schemas: {
			context: types<Context>(),
			events: {
				OPENED: types<EventPayload<Event, 'OPENED'>>(),
				CLOSED: types<EventPayload<Event, 'CLOSED'>>(),
				ACQUIRED: types<EventPayload<Event, 'ACQUIRED'>>(),
				OPEN_FAILED: types<EventPayload<Event, 'OPEN_FAILED'>>(),
				ACQUIRE_FAILED: types<EventPayload<Event, 'ACQUIRE_FAILED'>>(),
				CLOSE_FAILED: types<EventPayload<Event, 'CLOSE_FAILED'>>(),
				CANCEL: types<EventPayload<Event, 'CANCEL'>>(),
				SHUTDOWN: types<EventPayload<Event, 'SHUTDOWN'>>(),
				TX_COMPLETE: types<EventPayload<Event, 'TX_COMPLETE'>>(),
				TX_ABORTED: types<EventPayload<Event, 'TX_ABORTED'>>(),
				RECORD: types<EventPayload<Event, 'RECORD'>>(),
				TX_FAILED: types<EventPayload<Event, 'TX_FAILED'>>()
			},
			input: types<Input>(),
			output: types<JournalResult>()
		},
		actors: { database: journalDatabase, resource },
		guards: {
			closing: ({ value }: { value: StateValue }) =>
				matchesState({ running: { control: 'closing' } }, value)
		}
	})
	type CompletionEntry = Extract<
		NonNullable<Parameters<typeof completionModel.createStateConfig>[0]['entry']>,
		(...args: never[]) => unknown
	>
	type CompletionArgs = Pick<Parameters<CompletionEntry>[0], 'context' | 'actions'>
	type CompletionQueue = Parameters<CompletionEntry>[1]
	const finalizers = {
		cancelled: (_args, _enq) => {
			return {
				context: { result: { outcome: 'cancelled' } } satisfies Partial<Context>
			}
		},
		failed: (args, _enq) => {
			return {
				context: {
					result: args.context.result ?? {
						outcome: 'failed',
						error: new Error('Journal transaction aborted')
					}
				} satisfies Partial<Context>
			}
		}
	} satisfies {
		[name: string]: (
			args: CompletionArgs,
			enq: CompletionQueue
		) => void | {
			context?: Partial<Context>
		}
	}
	const complete = createFinalTransitions<
		Context,
		CompletionArgs,
		CompletionQueue,
		keyof typeof finalizers
	>(finalizers)
	const machine = completionModel.createMachine({
		id: 'workspace-creation-journal',
		initial: 'running',
		context: ({ input }) => ({
			request: input,
			tx: undefined,
			raw: undefined,
			result: undefined,
			observation: {
				record: undefined
			}
		}),
		output: ({ context }) => required(context.result),
		states: {
			running: {
				type: 'parallel',
				invoke: {
					id: 'database',
					src: journalDatabase,
					input: () => ({ databaseName: options.databaseName }),
					onError: (args, enq) => {
						{
							return complete('failed', args, enq, {
								target: '#workspace-creation-journal.failed',
								context: {
									result: { outcome: 'failed', error: args.event.error }
								} satisfies Partial<Context>
							})
						}
					}
				},
				states: {
					control: {
						initial: 'active',
						states: {
							active: { on: { SHUTDOWN: { target: 'closing' }, CANCEL: { target: 'closing' } } },
							closing: { on: { SHUTDOWN: {}, CANCEL: {} } }
						}
					},
					work: {
						initial: 'opening',
						states: {
							opening: {
								entry: (args, enq) => {
									enq.sendTo('database', { type: 'OPEN' })
								},
								on: {
									OPENED: { target: 'checkingOpen' },
									OPEN_FAILED: (args) => {
										return {
											target: 'finishing',
											context: {
												result: {
													outcome: 'failed',
													error: args.event.error
												}
											} satisfies Partial<Context>
										}
									}
								}
							},
							checkingOpen: {
								always: (args) => {
									if (matchesState({ running: { control: 'closing' } }, args.value)) {
										return { target: 'closingDatabase' }
									}
									return { target: 'acquiring' }
								}
							},
							acquiring: {
								entry: (args, enq) => {
									enq.sendTo('database', { type: 'ACQUIRE' })
								},
								on: {
									ACQUIRED: (args) => {
										return {
											target: 'using',
											context: { tx: args.event.tx } satisfies Partial<Context>
										}
									},
									ACQUIRE_FAILED: (args) => {
										return {
											target: 'closingDatabase',
											context: {
												result: {
													outcome: 'failed',
													error: args.event.error
												}
											} satisfies Partial<Context>
										}
									}
								}
							},
							using: {
								invoke: {
									id: 'resource',
									src: resource,
									input: ({ context }) => required(context.tx),
									onError: (args) => {
										return {
											target: 'closingDatabase',
											context: {
												result: {
													outcome: 'failed',
													error: args.event.error
												}
											} satisfies Partial<Context>
										}
									}
								},
								on: {
									SHUTDOWN: (args, enq) => {
										enq.sendTo('resource', { type: 'ABORT' })
										return { target: '.aborting' }
									},
									CANCEL: (args, enq) => {
										enq.sendTo('resource', { type: 'ABORT' })
										return { target: '.aborting' }
									},
									TX_FAILED: (args) => {
										return {
											context: {
												result: {
													outcome: 'failed',
													error: args.event.error
												}
											} satisfies Partial<Context>
										}
									},
									TX_ABORTED: (args) => {
										const { context } = args
										if (matchesState({ running: { control: 'closing' } }, args.value)) {
											return {
												target: 'closingDatabase',
												context: {
													result:
														context.result?.outcome === 'failed'
															? context.result
															: { outcome: 'cancelled' }
												} satisfies Partial<Context>
											}
										}
										return {
											target: 'closingDatabase',
											context: {
												result:
													context.result?.outcome === 'conflict' ||
													context.result?.outcome === 'failed'
														? context.result
														: {
																outcome: 'failed',
																error: new Error('Journal transaction aborted')
															}
											} satisfies Partial<Context>
										}
									},
									TX_COMPLETE: { target: 'closingDatabase' }
								},
								initial: 'checking',
								states: {
									checking: {
										always: (args, enq) => {
											if (matchesState({ running: { control: 'closing' } }, args.value)) {
												enq.sendTo('resource', { type: 'ABORT' })
												return { target: 'aborting' }
											}
											return { target: 'reading' }
										}
									},
									reading: {
										entry: (args, enq) => {
											enq.sendTo('resource', {
												type: 'READ',
												key: args.context.request.key
											})
										},
										on: {
											RECORD: (args) => {
												return {
													target: 'validating',
													context: { raw: args.event.value } satisfies Partial<Context>
												}
											}
										}
									},
									validating: {
										always: (args) => {
											const { context } = args
											if (context.raw === undefined) {
												return { target: 'choosing' }
											}
											if (options.schema.safeParse(context.raw).success) {
												return {
													target: 'choosing',
													context: {
														observation: {
															...args.context.observation,
															record: options.schema.parse(context.raw)
														}
													} satisfies Partial<Context>
												}
											}
											return { target: 'conflicting' }
										}
									},
									choosing: {
										always: (args) => {
											const { context } = args
											if (
												context.observation.record !== undefined &&
												context.observation.record.key !== context.request.key
											) {
												return { target: 'conflicting' }
											}
											if (context.request.mode === 'read') {
												return {
													target: 'waiting',
													context: {
														result: {
															outcome: 'succeeded',
															record: context.observation.record
														}
													} satisfies Partial<Context>
												}
											}
											if (
												context.request.mode === 'write' &&
												context.observation.record === undefined &&
												context.request.record.key === context.request.key
											) {
												return { target: 'inserting' }
											}
											if (
												context.request.mode === 'write' &&
												JSON.stringify(context.observation.record) ===
													JSON.stringify(context.request.record)
											) {
												return {
													target: 'waiting',
													context: {
														result: {
															outcome: 'succeeded',
															record: context.observation.record
														}
													} satisfies Partial<Context>
												}
											}
											if (
												context.request.mode === 'clear' &&
												context.observation.record === undefined
											) {
												return {
													target: 'waiting',
													context: {
														result: { outcome: 'succeeded', record: undefined }
													} satisfies Partial<Context>
												}
											}
											if (
												context.request.mode === 'clear' &&
												context.observation.record !== undefined &&
												options.attemptId(context.observation.record) === context.request.attemptId
											) {
												return { target: 'removing' }
											}
											return { target: 'conflicting' }
										}
									},
									inserting: {
										entry: (args, enq) => {
											enq.sendTo(
												'resource',
												(({ context }) => {
													if (context.request.mode !== 'write')
														throw new Error('Expected journal write')
													return { type: 'INSERT', record: context.request.record }
												})(args)
											)
											return {
												context: {
													result: (({ context }): JournalResult => {
														if (context.request.mode !== 'write')
															throw new Error('Expected journal write')
														return { outcome: 'succeeded', record: context.request.record }
													})(args)
												} satisfies Partial<Context>
											}
										},
										always: { target: 'waiting' }
									},
									removing: {
										entry: (args, enq) => {
											enq.sendTo('resource', {
												type: 'REMOVE',
												key: args.context.request.key
											})
											return {
												context: {
													result: { outcome: 'succeeded', record: undefined }
												} satisfies Partial<Context>
											}
										},
										always: { target: 'waiting' }
									},
									conflicting: {
										entry: (args, enq) => {
											enq.sendTo('resource', { type: 'ABORT' })
											return {
												context: { result: { outcome: 'conflict' } } satisfies Partial<Context>
											}
										},
										always: { target: 'aborting' }
									},
									aborting: {},
									waiting: {}
								}
							},
							closingDatabase: {
								entry: (args, enq) => {
									enq.sendTo('database', { type: 'CLOSE' })
								},
								on: {
									CLOSED: { target: 'finishing' },
									CLOSE_FAILED: (args) => {
										return {
											target: 'finishing',
											context: {
												result: {
													outcome: 'failed',
													error: args.event.error
												}
											} satisfies Partial<Context>
										}
									}
								}
							},
							finishing: {
								always: (args, enq) => {
									const { context } = args
									if (context.result?.outcome === 'failed') {
										{
											return complete('failed', args, enq, {
												target: '#workspace-creation-journal.failed'
											})
										}
									}
									if (matchesState({ running: { control: 'closing' } }, args.value)) {
										{
											return complete('cancelled', args, enq, {
												target: '#workspace-creation-journal.cancelled'
											})
										}
									}
									if (context.result?.outcome === 'succeeded') {
										return { target: '#workspace-creation-journal.succeeded' }
									}
									if (context.result?.outcome === 'conflict') {
										return { target: '#workspace-creation-journal.conflict' }
									}
									{
										return complete('failed', args, enq, {
											target: '#workspace-creation-journal.failed'
										})
									}
								}
							}
						}
					}
				}
			},
			succeeded: { type: 'final' },
			conflict: { type: 'final' },
			cancelled: {
				type: 'final'
			},
			failed: {
				type: 'final'
			}
		}
	})
	return machine
}
