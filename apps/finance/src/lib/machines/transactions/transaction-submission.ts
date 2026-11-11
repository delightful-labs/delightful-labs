import type { getDb } from 'jazz-tools/svelte'
import type {
	FormChildEvent,
	FormOperationInput,
	FormOperationResult
} from '#lib/contracts/form-contract.js'
import type {
	TransactionEntryObservation,
	TransactionEntryReason,
	TransactionEntryScope
} from '#lib/contracts/transaction-entry-contract.js'
import type { TransactionSaveValues } from '#lib/validation/transactions.js'
import { createTransactionAttachmentsMachine } from './attachments/transaction-attachments.js'
import {
	createTransactionSaveMachine,
	type TransactionSaveDb,
	type TransactionSaveResult
} from './transaction-save.js'
import { setup, types } from 'xstate'
import type { SnapshotFrom } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'

export type TransactionAttachmentDb = Pick<
	ReturnType<typeof getDb>,
	'all' | 'insert' | 'insertStreaming' | 'delete'
>
export type TransactionSubmissionDb = TransactionSaveDb & TransactionAttachmentDb
type Input = FormOperationInput<
	TransactionSaveValues,
	TransactionEntryScope,
	TransactionEntryObservation
>
type Result = FormOperationResult<void, TransactionEntryReason> & { transactionId?: string }
type Event = FormChildEvent<TransactionEntryObservation>
type Attachments = ReturnType<typeof createTransactionAttachmentsMachine>
type AttachmentsResult = SnapshotFrom<Attachments>['output']
type Context = {
	input: Input | undefined
	attachmentDb: (TransactionSaveDb & TransactionAttachmentDb) | undefined
	files: readonly File[]
	saved: TransactionSaveResult | undefined
	attachmentResult: AttachmentsResult | undefined
	result: Result | undefined
}

function required<Value>(value: Value | undefined): Value {
	if (value === undefined) throw new Error('Missing transaction submission result')
	return value
}

function hasAttachmentOperations(
	db: TransactionSaveDb
): db is TransactionSaveDb & TransactionAttachmentDb {
	return (
		'insert' in db &&
		typeof db.insert === 'function' &&
		'insertStreaming' in db &&
		typeof db.insertStreaming === 'function' &&
		'delete' in db &&
		typeof db.delete === 'function'
	)
}

function interruption(
	saved: TransactionSaveResult,
	outcome: 'cancelled' | 'scopeChanged' | 'closed'
): Result {
	return {
		outcome,
		settlement: saved.settlement,
		...(saved.checkpoint === undefined ? {} : { checkpoint: saved.checkpoint }),
		...(saved.transactionId === undefined ? {} : { transactionId: saved.transactionId })
	}
}

function attachmentFailure(saved: TransactionSaveResult): Result {
	return {
		...saved,
		outcome: 'partial',
		value: undefined,
		reason: 'attachmentsFailed',
		settlement: saved.settlement === 'confirmed' ? 'confirmed' : 'locallyPersisted'
	}
}

/** Keeps finance persistence independent, then coordinates its saved ID with the image batch. */
export function createTransactionSubmissionMachine(
	db: TransactionSaveDb,
	observe: () => TransactionEntryObservation,
	getAttachments: () => readonly File[] = () => []
) {
	const save = createTransactionSaveMachine(db, observe)
	const attachments = createTransactionAttachmentsMachine()
	const actors = { save, attachments }
	const events0 = {
		INVALIDATE: types<EventPayload<Event, 'INVALIDATE'>>(),
		CANCEL: types<EventPayload<Event, 'CANCEL'>>(),
		SHUTDOWN: types<EventPayload<Event, 'SHUTDOWN'>>(),
		OBSERVE: types<EventPayload<Event, 'OBSERVE'>>()
	}
	type NativeEvent0 =
		| import('xstate').InferEvents<typeof events0>
		| import('xstate').DoneActorEvent<
				| import('xstate').OutputFrom<(typeof actors)['save']>
				| import('xstate').OutputFrom<(typeof actors)['attachments']>
		  >
		| import('xstate').ErrorActorEvent
	const model = setup({
		schemas: {
			context: types<Context>(),
			events: events0,
			input: types<Input>(),
			output: types<Result>(),
			children: {
				save: types<import('xstate').ActorRefFrom<(typeof actors)['save']>>(),
				attachments: types<import('xstate').ActorRefFrom<(typeof actors)['attachments']>>()
			}
		},
		actors,
		actions: {}
	})
	return model.createMachine({
		id: 'transaction-submission',
		initial: 'saving',
		context: ({ input }) => ({
			input,
			attachmentDb: hasAttachmentOperations(db) ? db : undefined,
			files: getAttachments(),
			saved: undefined,
			attachmentResult: undefined,
			result: undefined
		}),
		output: ({ context }) => required(context.result),
		on: {
			OBSERVE: (args, enq) => {
				const { event } = args
				{
					const children = args.children
					if (children.save?.getSnapshot().status === 'active') enq.sendTo(children.save, event)
				}
			},
			INVALIDATE: (args, enq) => {
				const { event } = args
				{
					const children = args.children
					if (children.save?.getSnapshot().status === 'active') enq.sendTo(children.save, event)
					if (children.attachments?.getSnapshot().status === 'active')
						enq.sendTo(children.attachments, event)
				}
			},
			CANCEL: (args, enq) => {
				const { event } = args
				{
					const children = args.children
					if (children.save?.getSnapshot().status === 'active') enq.sendTo(children.save, event)
					if (children.attachments?.getSnapshot().status === 'active')
						enq.sendTo(children.attachments, event)
				}
			},
			SHUTDOWN: (args, enq) => {
				const { event } = args
				{
					const children = args.children
					if (children.save?.getSnapshot().status === 'active') enq.sendTo(children.save, event)
					if (children.attachments?.getSnapshot().status === 'active')
						enq.sendTo(children.attachments, event)
				}
			}
		},
		states: {
			saving: {
				invoke: {
					id: 'save',
					src: 'save',
					input: ({ context }) => {
						const input = required(context.input)
						return input
					},
					onDone: (args) => {
						const { event } = args
						if (
							(event.output.outcome === 'succeeded' || event.output.outcome === 'partial') &&
							event.output.transactionId !== undefined
						) {
							return { target: 'checkingAttachments', context: { saved: event.output } }
						}
						return { target: 'completed', context: { result: event.output } }
					},
					onError: () => {
						return {
							target: 'completed',
							context: {
								result: { outcome: 'failed', code: 'operationFailed', settlement: 'unknown' }
							}
						}
					}
				}
			},
			checkingAttachments: {
				always: (args) => {
					const { context } = args
					if (context.files.length > 0 && context.attachmentDb !== undefined) {
						return { target: 'attaching' }
					}
					if (context.files.length > 0) {
						return {
							target: 'completed',
							context: { result: attachmentFailure(required(context.saved)) }
						}
					}
					return { target: 'completed', context: { result: required(context.saved) } }
				}
			},
			attaching: {
				invoke: {
					id: 'attachments',
					src: 'attachments',
					input: ({ context }) => {
						const input = required(context.input)
						const saved = required(context.saved)
						const transactionId = required(saved.transactionId)
						return {
							db: required(context.attachmentDb),
							transaction: {
								id: transactionId,
								accountId: input.request.values.accountId,
								organizationId: input.request.values.organizationId
							},
							files: context.files
						}
					},
					onDone: (args) => {
						return {
							target: 'completingAttachments',
							context: { attachmentResult: args.event.output }
						}
					},
					onError: (args) => {
						return {
							target: 'completed',
							context: { result: attachmentFailure(required(args.context.saved)) }
						}
					}
				}
			},
			completingAttachments: {
				always: (args) => {
					const { context } = args
					if (
						(({ context }) => {
							const result = required(context.attachmentResult)
							return (
								result.outcome === 'closed' ||
								result.outcome === 'cancelled' ||
								result.outcome === 'scopeChanged'
							)
						})(args)
					) {
						return {
							target: 'completed',
							context: {
								result: interruption(
									required(context.saved),
									required(context.attachmentResult).outcome as
										'closed' | 'cancelled' | 'scopeChanged'
								)
							}
						}
					}
					if (
						(({ context }) => {
							const result = required(context.attachmentResult)
							return result.outcome === 'complete' && result.failed === 0
						})(args)
					) {
						return { target: 'completed', context: { result: required(context.saved) } }
					}
					return {
						target: 'completed',
						context: {
							result: {
								...required(context.saved),
								outcome: 'partial',
								value: undefined,
								reason: 'attachmentsFailed',
								settlement:
									required(context.saved).settlement === 'confirmed'
										? 'confirmed'
										: 'locallyPersisted'
							}
						}
					}
				}
			},
			completed: { type: 'final' }
		}
	})
}
