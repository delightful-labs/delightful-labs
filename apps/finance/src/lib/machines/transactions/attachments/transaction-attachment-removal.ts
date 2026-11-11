import { ReadTier } from 'jazz-tools'
import type { getDb } from 'jazz-tools/svelte'
import { app } from '#lib/schema.js'
import { setup, types, createAsyncLogic } from 'xstate'

type Db = Pick<ReturnType<typeof getDb>, 'all' | 'delete'>
export type TransactionAttachmentRemovalInput = {
	db: Db
	transactionId: string
	attachmentId: string
}
export type TransactionAttachmentRemovalResult = { outcome: 'removed' | 'failed' }
type Output = TransactionAttachmentRemovalResult
type Context = TransactionAttachmentRemovalInput & { output: Output | undefined }
const ownedActors2 = {
	readAttachment: createAsyncLogic({
		run: async ({ input }: { input: TransactionAttachmentRemovalInput }) =>
			input.db.all(
				app.transactionAttachments.where({
					id: input.attachmentId,
					transactionId: input.transactionId
				}),
				{ tier: ReadTier.LocalFirst }
			)
	}),
	deleteLink: createAsyncLogic({
		run: async ({ input }: { input: TransactionAttachmentRemovalInput }) => {
			const result = input.db.delete(app.transactionAttachments, input.attachmentId)
			await result.wait({ tier: 'local' })
		}
	})
}
const patchRemoved = (): Partial<Context> => ({ output: { outcome: 'removed' } })
const patchFail = (): Partial<Context> => ({ output: { outcome: 'failed' } })

/** Removes the authorized link while retaining file data for shared references and future recovery. */
export const transactionAttachmentRemovalMachine = setup({
	schemas: {
		context: types<Context>(),
		input: types<TransactionAttachmentRemovalInput>(),
		output: types<Output>(),
		children: {
			readAttachment:
				types<import('xstate').ActorRefFrom<(typeof ownedActors2)['readAttachment']>>(),
			deleteLink: types<import('xstate').ActorRefFrom<(typeof ownedActors2)['deleteLink']>>()
		}
	},
	actors: ownedActors2,
	actions: {},
	guards: { found: ({ event }) => event.output.length === 1 }
}).createMachine({
	id: 'transaction-attachment-removal',
	initial: 'checkingAttachment',
	context: ({ input }) => ({ ...input, output: undefined }),
	output: ({ context }) => context.output ?? { outcome: 'failed' },
	states: {
		checkingAttachment: {
			invoke: {
				src: 'readAttachment',
				input: ({ context }) => context,
				onDone: (args) => {
					if (args.guards.found(args)) {
						return { target: 'deletingLink' }
					}
					return { target: 'failed', context: patchFail() }
				},
				onError: (args) => {
					return { target: 'failed', context: patchFail() }
				}
			}
		},
		deletingLink: {
			invoke: {
				src: 'deleteLink',
				input: ({ context }) => context,
				onDone: (args) => {
					return { target: 'removed', context: patchRemoved() }
				},
				onError: (args) => {
					return { target: 'failed', context: patchFail() }
				}
			}
		},
		removed: { type: 'final' },
		failed: { type: 'final' }
	}
})
