import { ReadTier } from 'jazz-tools'
import type { getDb } from 'jazz-tools/svelte'
import { app } from '#lib/schema.js'
import { TRANSACTION_ATTACHMENT_TYPES } from '#lib/domain/transaction-attachments.js'
import { setup, types, createAsyncLogic } from 'xstate'

const PART_BYTES = 256 * 1024
type Db = Pick<ReturnType<typeof getDb>, 'all' | 'insert' | 'insertStreaming' | 'delete'>
export type TransactionAttachmentInput = {
	db: Db
	transaction: { id: string; accountId: string; organizationId: string }
	file: Pick<File, 'name' | 'type' | 'size'>
	bytes: Uint8Array
}
export type TransactionAttachmentUploadResult = { outcome: 'attached' | 'failed'; fileId?: string }
type Output = TransactionAttachmentUploadResult
type Context = TransactionAttachmentInput & {
	fileId: string | undefined
	partIndex: number
	partIds: string[]
	output: Output | undefined
}
type Event = { type: 'SHUTDOWN' }

function required(value: string | undefined): string {
	if (value === undefined) throw new Error('Attachment file is not registered')
	return value
}
const ownedActors3 = {
	registerFile: createAsyncLogic({
		run: async ({ input }: { input: TransactionAttachmentInput }) => {
			const result = input.db.insert(app.files, {
				transactionId: input.transaction.id,
				fileName: input.file.name,
				mimeType: input.file.type,
				sizeBytes: input.file.size
			})
			return (await result.wait({ tier: 'local' })).id
		}
	}),
	writePart: createAsyncLogic({
		run: async ({
			input
		}: {
			input: { db: Db; fileId: string; bytes: Uint8Array; partIndex: number }
		}) => {
			const start = input.partIndex * PART_BYTES
			const end = Math.min(input.bytes.byteLength, start + PART_BYTES)
			const chunkBuffer = new ArrayBuffer(end - start)
			new Uint8Array(chunkBuffer).set(input.bytes.subarray(start, end))
			const result = await input.db.insertStreaming(app.fileParts, {
				fileId: input.fileId,
				partIndex: input.partIndex,
				sizeBytes: end - start,
				data: new Blob([chunkBuffer]).stream()
			})
			await result.wait({ tier: 'local' })
			return result.value.id
		}
	}),
	linkAttachment: createAsyncLogic({
		run: async ({ input }: { input: TransactionAttachmentInput & { fileId: string } }) => {
			const result = input.db.insert(app.transactionAttachments, {
				transactionId: input.transaction.id,
				fileId: input.fileId
			})
			await result.wait({ tier: 'local' })
		}
	}),
	deletePart: createAsyncLogic({
		run: async ({ input }: { input: { db: Db; id: string } }) => {
			const result = input.db.delete(app.fileParts, input.id)
			await result.wait({ tier: 'local' })
		}
	}),
	deleteFile: createAsyncLogic({
		run: async ({ input }: { input: { db: Db; id: string } }) => {
			const result = input.db.delete(app.files, input.id)
			await result.wait({ tier: 'local' })
		}
	}),
	readParts: createAsyncLogic({
		run: async ({ input }: { input: { db: Db; fileId: string } }) =>
			input.db.all(app.fileParts.where({ fileId: input.fileId }), { tier: ReadTier.LocalFirst })
	})
}
const events0 = {
	SHUTDOWN: types<{}>()
}
type NativeEvent0 =
	| import('xstate').InferEvents<typeof events0>
	| import('xstate').DoneActorEvent<
			| import('xstate').OutputFrom<(typeof ownedActors3)['registerFile']>
			| import('xstate').OutputFrom<(typeof ownedActors3)['writePart']>
			| import('xstate').OutputFrom<(typeof ownedActors3)['linkAttachment']>
			| import('xstate').OutputFrom<(typeof ownedActors3)['deletePart']>
			| import('xstate').OutputFrom<(typeof ownedActors3)['deleteFile']>
			| import('xstate').OutputFrom<(typeof ownedActors3)['readParts']>
	  >
	| import('xstate').ErrorActorEvent
	| import('xstate').AfterEvent
	| import('xstate').DoneStateEvent
	| import('xstate').SnapshotEvent
	| import('xstate').TimeoutEvent
	| import('xstate').ActorTimeoutEvent
	| import('xstate').ErrorPlatformEvent

export const transactionAttachmentUploadMachine = setup({
	schemas: {
		context: types<Context>(),
		events: events0,
		input: types<TransactionAttachmentInput>(),
		output: types<Output>(),
		children: {
			registerFile: types<import('xstate').ActorRefFrom<(typeof ownedActors3)['registerFile']>>(),
			writePart: types<import('xstate').ActorRefFrom<(typeof ownedActors3)['writePart']>>(),
			linkAttachment:
				types<import('xstate').ActorRefFrom<(typeof ownedActors3)['linkAttachment']>>(),
			deletePart: types<import('xstate').ActorRefFrom<(typeof ownedActors3)['deletePart']>>(),
			deleteFile: types<import('xstate').ActorRefFrom<(typeof ownedActors3)['deleteFile']>>(),
			readParts: types<import('xstate').ActorRefFrom<(typeof ownedActors3)['readParts']>>()
		}
	},
	actors: ownedActors3
}).createMachine({
	id: 'transaction-attachment-upload',
	initial: 'validating',
	context: ({ input }) => ({
		...input,
		fileId: undefined,
		partIndex: 0,
		partIds: [],
		output: undefined
	}),
	output: ({ context }) => context.output ?? { outcome: 'failed' },
	states: {
		validating: {
			always: (args) => {
				if (TRANSACTION_ATTACHMENT_TYPES.some((type) => type === args.context.file.type)) {
					return { target: 'registeringFile' }
				}
				return { target: 'failed' }
			}
		},
		registeringFile: {
			invoke: {
				src: 'registerFile',
				input: ({ context }) => context,
				onDone: (args) => {
					return { target: 'writingPart', context: { fileId: args.event.output } }
				},
				onError: () => {
					return { target: 'failed', context: { output: { outcome: 'failed' } } }
				}
			}
		},
		writingPart: {
			invoke: {
				src: 'writePart',
				input: ({ context }) => {
					return {
						db: context.db,
						bytes: context.bytes,
						fileId: required(context.fileId),
						partIndex: context.partIndex
					}
				},
				onDone: (args) => {
					const { context } = args
					return {
						target: 'checkingParts',
						context: {
							partIds: [...context.partIds, args.event.output],
							partIndex: context.partIndex + 1
						}
					}
				},
				onError: { target: 'cleaningParts' }
			}
		},
		checkingParts: {
			always: (args) => {
				const { context } = args
				if (context.partIndex * PART_BYTES < context.bytes.byteLength) {
					return { target: 'writingPart' }
				}
				return { target: 'linkingAttachment' }
			}
		},
		linkingAttachment: {
			invoke: {
				src: 'linkAttachment',
				input: ({ context }) => {
					return { ...context, fileId: required(context.fileId) }
				},
				onDone: (args) => {
					return {
						target: 'attached',
						context: { output: { outcome: 'attached', fileId: required(args.context.fileId) } }
					}
				},
				// A rejected local wait may have created the link. Keep the file intact
				// so a link that did commit cannot point at deleted file data.
				onError: () => {
					return { target: 'failed', context: { output: { outcome: 'failed' } } }
				}
			}
		},
		cleaningParts: {
			initial: 'readingParts',
			onDone: { target: 'failed' },
			states: {
				readingParts: {
					invoke: {
						src: 'readParts',
						input: ({ context }) => ({ db: context.db, fileId: required(context.fileId) }),
						onDone: (args) => {
							return {
								target: 'checking',
								context: { partIds: args.event.output.map(({ id }) => id) }
							}
						},
						onError: { target: '#transaction-attachment-upload.failed' }
					}
				},
				checking: {
					always: (args) => {
						if (args.context.partIds.length > 0) {
							return { target: 'deletingPart' }
						}
						return { target: 'deletingFile' }
					}
				},
				deletingPart: {
					invoke: {
						src: 'deletePart',
						input: ({ context }) => ({ db: context.db, id: context.partIds.at(-1) ?? '' }),
						onDone: (args) => {
							return { target: 'checking', context: { partIds: args.context.partIds.slice(0, -1) } }
						},
						onError: (args) => {
							return { target: 'checking', context: { partIds: args.context.partIds.slice(0, -1) } }
						}
					}
				},
				deletingFile: {
					always: (args) => {
						if (args.context.fileId !== undefined) {
							return { target: 'deleting' }
						}
						return { target: 'done' }
					}
				},
				deleting: {
					invoke: {
						src: 'deleteFile',
						input: ({ context }) => ({ db: context.db, id: context.fileId ?? '' }),
						onDone: { target: 'done' },
						onError: { target: 'done' }
					}
				},
				done: { type: 'final' }
			}
		},
		attached: {
			type: 'final'
		},
		failed: {
			type: 'final',
			entry: () => {
				return { context: { output: { outcome: 'failed' } } }
			}
		}
	}
})
