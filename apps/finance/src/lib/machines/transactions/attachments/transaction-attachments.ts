import { ReadTier } from 'jazz-tools'
import type { getDb } from 'jazz-tools/svelte'
import { app } from '#lib/schema.js'
import {
	MAX_TRANSACTION_ATTACHMENT_BYTES,
	MAX_TRANSACTION_ATTACHMENTS,
	isTransactionAttachmentType,
	TRANSACTION_ATTACHMENT_TYPES
} from '#lib/domain/transaction-attachments.js'
import { imageProcessingMachine } from '../../images/image-processing.js'
import {
	transactionAttachmentUploadMachine,
	type TransactionAttachmentInput
} from './transaction-attachment-upload.js'
import { setup, types, createAsyncLogic } from 'xstate'
import type { EventPayload } from '../../../contracts/event-payload.js'

type Db = Pick<ReturnType<typeof getDb>, 'all' | 'insert' | 'insertStreaming' | 'delete'>
export type TransactionAttachmentsInput = {
	db: Db
	transaction: TransactionAttachmentInput['transaction']
	files: readonly File[]
}
type Output = {
	outcome:
		| 'complete'
		| 'closed'
		| 'cancelled'
		| 'scopeChanged'
		| 'limitReached'
		| 'invalidSelection'
		| 'failed'
	attached: number
	failed: number
	skipped: number
}
type Context = TransactionAttachmentsInput & {
	existingCount: number | undefined
	index: number
	currentFile: Pick<File, 'name' | 'type' | 'size'> | undefined
	bytes: Uint8Array | undefined
	attached: number
	failed: number
	interruption: 'closed' | 'cancelled' | 'scopeChanged' | undefined
	output: Output | undefined
}
type Event = { type: 'SHUTDOWN' | 'CANCEL' | 'INVALIDATE' }
function result(context: Context, outcome: Output['outcome']): Output {
	return {
		outcome,
		attached: context.attached,
		failed: context.failed,
		skipped: context.files.length - context.index
	}
}

/** Loads, stores, and links each image sequentially after the transaction has been saved. */
export function createTransactionAttachmentsMachine() {
	const readExisting = createAsyncLogic({
		run: ({ input }: { input: { db: Db; transactionId: string } }) =>
			input.db.all(app.transactionAttachments.where({ transactionId: input.transactionId }), {
				tier: ReadTier.LocalFirst
			})
	})
	const patchRecordFailure = ({ context }: { context: Context }): Partial<Context> => ({
		index: context.index + 1,
		failed: context.failed + 1,
		currentFile: undefined,
		bytes: undefined
	})
	const events0 = {
		SHUTDOWN: types<EventPayload<Event, 'SHUTDOWN'>>(),
		CANCEL: types<EventPayload<Event, 'CANCEL'>>(),
		INVALIDATE: types<EventPayload<Event, 'INVALIDATE'>>()
	}
	type NativeEvent0 =
		| import('xstate').InferEvents<typeof events0>
		| import('xstate').DoneActorEvent<
				| import('xstate').OutputFrom<typeof imageProcessingMachine>
				| import('xstate').OutputFrom<typeof transactionAttachmentUploadMachine>
				| import('xstate').OutputFrom<typeof readExisting>
		  >
		| import('xstate').ErrorActorEvent
	const model = setup({
		schemas: {
			context: types<Context>(),
			events: events0,
			input: types<TransactionAttachmentsInput>(),
			output: types<Output>(),
			children: {
				imageProcessing: types<
					import('xstate').ActorRefFrom<
						{
							imageProcessing: typeof imageProcessingMachine
							storeAttachment: typeof transactionAttachmentUploadMachine
							readExisting: typeof readExisting
						}['imageProcessing']
					>
				>(),
				storeAttachment: types<
					import('xstate').ActorRefFrom<
						{
							imageProcessing: typeof imageProcessingMachine
							storeAttachment: typeof transactionAttachmentUploadMachine
							readExisting: typeof readExisting
						}['storeAttachment']
					>
				>(),
				readExisting: types<
					import('xstate').ActorRefFrom<
						{
							imageProcessing: typeof imageProcessingMachine
							storeAttachment: typeof transactionAttachmentUploadMachine
							readExisting: typeof readExisting
						}['readExisting']
					>
				>()
			}
		},
		actors: {
			imageProcessing: imageProcessingMachine,
			storeAttachment: transactionAttachmentUploadMachine,
			readExisting
		},
		actions: {}
	})
	return model.createMachine({
		id: 'transaction-attachments',
		initial: 'readingExisting',
		context: ({ input }) => ({
			...input,
			existingCount: undefined,
			index: 0,
			currentFile: undefined,
			bytes: undefined,
			attached: 0,
			failed: 0,
			interruption: undefined,
			output: undefined
		}),
		output: ({ context }) => context.output ?? result(context, 'complete'),
		on: {
			SHUTDOWN: (args, enq) => {
				{
					const type = 'SHUTDOWN'
					const child = args.children.imageProcessing
					if (child?.getSnapshot().status === 'active') enq.sendTo(child, { type })
				}
				return { context: { interruption: 'closed' } }
			},
			CANCEL: (args, enq) => {
				{
					const type = 'CANCEL'
					const child = args.children.imageProcessing
					if (child?.getSnapshot().status === 'active') enq.sendTo(child, { type })
				}
				return { context: { interruption: 'cancelled' } }
			},
			INVALIDATE: (args, enq) => {
				{
					const type = 'CANCEL'
					const child = args.children.imageProcessing
					if (child?.getSnapshot().status === 'active') enq.sendTo(child, { type })
				}
				return { context: { interruption: 'scopeChanged' } }
			}
		},
		states: {
			readingExisting: {
				invoke: {
					src: 'readExisting',
					input: ({ context }) => ({
						db: context.db,
						transactionId: context.transaction.id
					}),
					onDone: (args) => {
						return { target: 'validating', context: { existingCount: args.event.output.length } }
					},
					onError: (args) => {
						const { context } = args
						return { target: 'failed', context: { output: result(context, 'failed') } }
					}
				}
			},
			validating: {
				always: (args) => {
					const { context } = args
					if ((context.existingCount ?? 0) + context.files.length > MAX_TRANSACTION_ATTACHMENTS) {
						return { target: 'limitReached', context: { output: result(context, 'limitReached') } }
					}
					if (
						context.files.some(
							(file) =>
								!TRANSACTION_ATTACHMENT_TYPES.some((type) => type === file.type) ||
								file.size <= 0 ||
								file.size > MAX_TRANSACTION_ATTACHMENT_BYTES
						)
					) {
						return {
							target: 'invalidSelection',
							context: { output: result(context, 'invalidSelection') }
						}
					}
					return { target: 'checking' }
				}
			},
			checking: {
				always: (args) => {
					const { context } = args
					if (context.interruption !== undefined) {
						return {
							target: 'interrupted',
							context: { output: result(context, context.interruption ?? 'closed') }
						}
					}
					if (context.index >= context.files.length) {
						return { target: 'complete', context: { output: result(context, 'complete') } }
					}
					return { target: 'uploading' }
				}
			},
			uploading: {
				invoke: {
					id: 'imageProcessing',
					src: 'imageProcessing',
					input: ({ context }) => {
						const file = context.files[context.index]
						if (!file) throw new Error('Missing transaction image')
						return {
							file,
							options: {
								maxWidth: 2048,
								maxHeight: 2048,
								mimeType: isTransactionAttachmentType(file.type)
									? file.type
									: (() => {
											throw new Error('Unsupported transaction image')
										})(),
								quality: 0.85
							}
						}
					},
					onDone: (args) => {
						const { event } = args
						if (event.output.outcome === 'processed') {
							return {
								target: 'storing',
								context: {
									bytes: event.output.outcome === 'processed' ? event.output.bytes : undefined,
									currentFile: (({ context, event }) => {
										const file = context.files[context.index]
										if (!file || event.output.outcome !== 'processed') return undefined
										return {
											name: file.name,
											type: event.output.blob.type,
											size: event.output.blob.size
										}
									})(args)
								}
							}
						}
						return { target: 'checking', context: patchRecordFailure(args) }
					},
					onError: (args) => {
						return { target: 'checking', context: patchRecordFailure(args) }
					}
				}
			},
			storing: {
				invoke: {
					src: 'storeAttachment',
					input: ({ context }) => ({
						db: context.db,
						transaction: context.transaction,
						file:
							context.currentFile ??
							(() => {
								throw new Error('Missing transaction image')
							})(),
						bytes: context.bytes ?? new Uint8Array()
					}),
					onDone: (args) => {
						const { context, event } = args
						return {
							target: 'checking',
							context: {
								index: context.index + 1,
								attached: context.attached + (event.output.outcome === 'attached' ? 1 : 0),
								failed: context.failed + (event.output.outcome === 'failed' ? 1 : 0),
								currentFile: undefined,
								bytes: undefined
							}
						}
					},
					onError: (args) => {
						return { target: 'checking', context: patchRecordFailure(args) }
					}
				}
			},
			limitReached: { type: 'final' },
			invalidSelection: { type: 'final' },
			failed: { type: 'final' },
			interrupted: { type: 'final' },
			complete: { type: 'final' }
		}
	})
}
