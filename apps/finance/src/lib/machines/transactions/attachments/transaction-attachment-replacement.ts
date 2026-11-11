import { PersistedWriteRejectedError } from 'jazz-tools'
import type { getDb } from 'jazz-tools/svelte'
import { app } from '#lib/schema.js'
import {
	MAX_TRANSACTION_ATTACHMENT_BYTES,
	isTransactionAttachmentType
} from '#lib/domain/transaction-attachments.js'
import { setup, types, createAsyncLogic, matchesState } from 'xstate'
import type { OutputFrom } from 'xstate'
import type { EventPayload } from '../../../contracts/event-payload.js'

type Db = Pick<ReturnType<typeof getDb>, 'beginTransaction'>
type Transaction = ReturnType<Db['beginTransaction']>
export type AttachmentReplacementInput = {
	db: Db
	transaction: { id: string; accountId: string; organizationId: string }
	attachment: { id: string; fileId: string }
	file: Pick<File, 'name' | 'type' | 'size'>
	bytes: Uint8Array
}
export type AttachmentReplacementOutput = {
	outcome: 'replaced' | 'conflict' | 'failed' | 'cancelled' | 'closed'
	settlement: 'notStarted' | 'locallyPersisted' | 'unresolved'
}
type Event = { type: 'CANCEL' | 'SHUTDOWN' }
function required<Value>(value: Value | undefined): Value {
	if (value === undefined) throw new Error('Missing attachment replacement resource')
	return value
}
const open = createAsyncLogic({ run: async ({ input }: { input: Db }) => input.beginTransaction() })
const read = createAsyncLogic({
	run: async ({ input }: { input: { tx: Transaction; request: AttachmentReplacementInput } }) => {
		const { tx, request } = input
		const [attachment, transaction, file] = await Promise.all([
			tx.one(
				app.transactionAttachments.where({
					id: request.attachment.id,
					transactionId: request.transaction.id
				}),
				{ tier: 'local-first' }
			),
			tx.one(app.transactions.where({ id: request.transaction.id }), { tier: 'local-first' }),
			tx.one(app.files.where({ id: request.attachment.fileId }), { tier: 'local-first' })
		])
		return { attachment, transaction, file }
	}
})
const stage = createAsyncLogic({
	run: async ({ input }: { input: { tx: Transaction; request: AttachmentReplacementInput } }) => {
		const { tx, request } = input
		const file = tx.insert(app.files, {
			transactionId: request.transaction.id,
			fileName: request.file.name,
			mimeType: request.file.type,
			sizeBytes: request.bytes.byteLength
		})
		const partBytes = 256 * 1024
		for (let offset = 0; offset < request.bytes.byteLength; offset += partBytes) {
			const data = new Uint8Array(request.bytes.subarray(offset, offset + partBytes))
			tx.insert(app.fileParts, {
				fileId: file.id,
				partIndex: offset / partBytes,
				sizeBytes: data.byteLength,
				data
			})
		}
		tx.update(app.transactionAttachments, request.attachment.id, { fileId: file.id })
		return file.id
	}
})
const commit = createAsyncLogic({
	run: async ({ input }: { input: Transaction }) => input.commit()
})
const settle = createAsyncLogic({
	run: ({ input }: { input: OutputFrom<typeof commit> }) => input.wait({ tier: 'local' })
})
const rollback = createAsyncLogic({ run: ({ input }: { input: Transaction }) => input.rollback() })
type Context = {
	request: AttachmentReplacementInput
	tx: Transaction | undefined
	records: OutputFrom<typeof read> | undefined
	write: OutputFrom<typeof commit> | undefined
	settlement: AttachmentReplacementOutput['settlement'] | 'rejected'
	problem: 'conflict' | 'failed' | undefined
	result: AttachmentReplacementOutput | undefined
}
function settlement(context: Context): AttachmentReplacementOutput['settlement'] {
	return context.settlement === 'rejected' ? 'notStarted' : context.settlement
}
const events0 = {
	CANCEL: types<EventPayload<Event, 'CANCEL'>>(),
	SHUTDOWN: types<EventPayload<Event, 'SHUTDOWN'>>()
}
type NativeEvent0 =
	| import('xstate').InferEvents<typeof events0>
	| import('xstate').DoneActorEvent<
			| import('xstate').OutputFrom<typeof open>
			| import('xstate').OutputFrom<typeof read>
			| import('xstate').OutputFrom<typeof stage>
			| import('xstate').OutputFrom<typeof commit>
			| import('xstate').OutputFrom<typeof settle>
			| import('xstate').OutputFrom<typeof rollback>
	  >
	| import('xstate').ErrorActorEvent
	| import('xstate').AfterEvent
	| import('xstate').DoneStateEvent
	| import('xstate').SnapshotEvent
	| import('xstate').TimeoutEvent
	| import('xstate').ActorTimeoutEvent
	| import('xstate').ErrorPlatformEvent

/** Atomically stages replacement bytes and the existing attachment link, retaining old files. */
export const transactionAttachmentReplacementMachine = setup({
	schemas: {
		context: types<Context>(),
		events: events0,
		input: types<AttachmentReplacementInput>(),
		output: types<AttachmentReplacementOutput>(),
		children: {
			open: types<
				import('xstate').ActorRefFrom<
					{
						open: typeof open
						read: typeof read
						stage: typeof stage
						commit: typeof commit
						settle: typeof settle
						rollback: typeof rollback
					}['open']
				>
			>(),
			read: types<
				import('xstate').ActorRefFrom<
					{
						open: typeof open
						read: typeof read
						stage: typeof stage
						commit: typeof commit
						settle: typeof settle
						rollback: typeof rollback
					}['read']
				>
			>(),
			stage: types<
				import('xstate').ActorRefFrom<
					{
						open: typeof open
						read: typeof read
						stage: typeof stage
						commit: typeof commit
						settle: typeof settle
						rollback: typeof rollback
					}['stage']
				>
			>(),
			commit: types<
				import('xstate').ActorRefFrom<
					{
						open: typeof open
						read: typeof read
						stage: typeof stage
						commit: typeof commit
						settle: typeof settle
						rollback: typeof rollback
					}['commit']
				>
			>(),
			settle: types<
				import('xstate').ActorRefFrom<
					{
						open: typeof open
						read: typeof read
						stage: typeof stage
						commit: typeof commit
						settle: typeof settle
						rollback: typeof rollback
					}['settle']
				>
			>(),
			rollback: types<
				import('xstate').ActorRefFrom<
					{
						open: typeof open
						read: typeof read
						stage: typeof stage
						commit: typeof commit
						settle: typeof settle
						rollback: typeof rollback
					}['rollback']
				>
			>()
		}
	},
	actors: { open, read, stage, commit, settle, rollback },
	guards: {}
}).createMachine({
	id: 'attachment-replacement',
	initial: 'validating',
	context: ({ input }) => ({
		request: input,
		tx: undefined,
		records: undefined,
		write: undefined,
		settlement: 'notStarted',
		problem: undefined,
		result: undefined
	}),
	output: ({ context }) => context.result ?? { outcome: 'failed', settlement: settlement(context) },
	states: {
		validating: {
			always: (args) => {
				const { context } = args
				if (
					isTransactionAttachmentType(context.request.file.type) &&
					context.request.bytes.byteLength > 0 &&
					context.request.bytes.byteLength <= MAX_TRANSACTION_ATTACHMENT_BYTES &&
					context.request.bytes.byteLength === context.request.file.size
				) {
					return { target: 'running' }
				}
				return { target: 'failed' }
			}
		},
		running: {
			type: 'parallel',
			states: {
				control: {
					initial: 'active',
					states: {
						active: { on: { CANCEL: { target: 'cancelled' }, SHUTDOWN: { target: 'closed' } } },
						cancelled: { on: { CANCEL: {}, SHUTDOWN: { target: 'closed' } } },
						closed: { on: { CANCEL: {}, SHUTDOWN: {} } }
					}
				},
				work: {
					initial: 'opening',
					states: {
						opening: {
							invoke: {
								src: 'open',
								input: ({ context }) => context.request.db,
								onDone: (args) => {
									const { event } = args
									if (
										matchesState({ running: { control: 'closed' } }, args.value) ||
										matchesState({ running: { control: 'cancelled' } }, args.value)
									) {
										return { target: 'rollingBack', context: { tx: event.output } }
									}
									return { target: 'reading', context: { tx: event.output } }
								},
								onError: () => {
									return { target: 'finishing', context: { problem: 'failed' } }
								}
							}
						},
						reading: {
							invoke: {
								src: 'read',
								input: ({ context }) => ({ tx: required(context.tx), request: context.request }),
								onDone: (args) => {
									return { target: 'checking', context: { records: args.event.output } }
								},
								onError: () => {
									return { target: 'rollingBack', context: { problem: 'failed' } }
								}
							}
						},
						checking: {
							always: (args) => {
								if (
									matchesState({ running: { control: 'closed' } }, args.value) ||
									matchesState({ running: { control: 'cancelled' } }, args.value)
								) {
									return { target: 'rollingBack' }
								}
								if (
									(({ context }) => {
										const { request, records } = context
										return (
											records?.attachment?.fileId === request.attachment.fileId &&
											records.transaction?.accountId === request.transaction.accountId &&
											records.transaction.organizationId === request.transaction.organizationId &&
											records.file?.fileName === request.file.name &&
											records.file.mimeType === request.file.type
										)
									})(args)
								) {
									return { target: 'staging' }
								}
								return { target: 'rollingBack', context: { problem: 'conflict' } }
							}
						},
						staging: {
							invoke: {
								src: 'stage',
								input: ({ context }) => ({ tx: required(context.tx), request: context.request }),
								onDone: (args) => {
									if (
										matchesState({ running: { control: 'closed' } }, args.value) ||
										matchesState({ running: { control: 'cancelled' } }, args.value)
									) {
										return { target: 'rollingBack' }
									}
									return { target: 'committing' }
								},
								onError: () => {
									return { target: 'rollingBack', context: { problem: 'failed' } }
								}
							}
						},
						committing: {
							entry: () => {
								return { context: { settlement: 'unresolved' } }
							},
							invoke: {
								src: 'commit',
								input: ({ context }) => required(context.tx),
								onDone: (args) => {
									return { target: 'settling', context: { write: args.event.output } }
								},
								onError: (args) => {
									return {
										target: 'rollingBack',
										context: {
											problem: 'failed',
											settlement:
												args.event.error instanceof PersistedWriteRejectedError
													? 'rejected'
													: args.context.settlement
										}
									}
								}
							}
						},
						settling: {
							invoke: {
								src: 'settle',
								input: ({ context }) => required(context.write),
								onDone: () => {
									return { target: 'finishing', context: { settlement: 'locallyPersisted' } }
								},
								onError: (args) => {
									return {
										target: 'rollingBack',
										context: {
											problem: 'failed',
											settlement:
												args.event.error instanceof PersistedWriteRejectedError
													? 'rejected'
													: args.context.settlement
										}
									}
								}
							}
						},
						rollingBack: {
							invoke: {
								src: 'rollback',
								input: ({ context }) => required(context.tx),
								onDone: (args) => {
									const { context } = args
									return {
										target: 'finishing',
										context: {
											settlement:
												context.settlement === 'rejected' ||
												(args.event.output && context.settlement === 'notStarted')
													? 'rejected'
													: 'unresolved'
										}
									}
								},
								onError: () => {
									return {
										target: 'finishing',
										context: { settlement: 'unresolved', problem: 'failed' }
									}
								}
							}
						},
						finishing: {
							always: (args) => {
								const { context } = args
								if (matchesState({ running: { control: 'closed' } }, args.value)) {
									return {
										target: '#attachment-replacement.closed',
										context: {
											result: {
												outcome: 'closed',
												settlement: settlement(context)
											}
										}
									}
								}
								if (matchesState({ running: { control: 'cancelled' } }, args.value)) {
									return {
										target: '#attachment-replacement.cancelled',
										context: {
											result: {
												outcome: 'cancelled',
												settlement: settlement(context)
											}
										}
									}
								}
								if (context.settlement === 'locallyPersisted') {
									return {
										target: '#attachment-replacement.replaced',
										context: {
											result: {
												outcome: 'replaced',
												settlement: 'locallyPersisted'
											}
										}
									}
								}
								if (context.problem === 'conflict' && settlement(context) === 'notStarted') {
									return {
										target: '#attachment-replacement.conflict',
										context: {
											result: {
												outcome: 'conflict',
												settlement: 'notStarted'
											}
										}
									}
								}
								return {
									target: '#attachment-replacement.failed',
									context: {
										result: {
											outcome: 'failed',
											settlement: settlement(context)
										}
									}
								}
							}
						}
					}
				}
			}
		},
		replaced: { type: 'final' },
		conflict: { type: 'final' },
		failed: { type: 'final' },
		cancelled: { type: 'final' },
		closed: { type: 'final' }
	}
})
