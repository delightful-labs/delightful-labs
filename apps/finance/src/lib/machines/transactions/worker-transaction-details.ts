import { SYSTEM_ACCOUNT_ID } from 'jazz-tools'
import { createCallbackLogic, setup, types, type SnapshotFrom } from 'xstate'
import type { Db as JazzDb } from 'jazz-tools'
import { app, transactionDetailQuery } from '../../queries.js'
import { workerProfile } from '../../contracts/worker-identity.js'
import {
	workerTransactionMetadata,
	type WorkerTransactionDetailsView
} from '../../contracts/worker-images.js'
import type { TransactionEntryObservation } from '../../contracts/transaction-entry-contract.js'
import { attachmentFile } from '../../domain/transaction-attachments.js'
import type { z } from 'zod'
type Input = { observation: TransactionEntryObservation }
type Context = Input & {
	token: object
	transaction: WorkerTransactionDetailsView['transaction'] | undefined
	images: WorkerTransactionDetailsView['images']
	creator: z.output<typeof workerProfile> | null
	editor: z.output<typeof workerProfile> | null
	failed: boolean
}
function queryKey(observation: TransactionEntryObservation) {
	const row = observation.transaction
	return [
		observation.identityId,
		observation.organizationId,
		observation.transactionId,
		row?.$createdBy.account,
		row?.$updatedBy.account
	].join(':')
}
/** Three native presentation subscriptions share the selected transaction's invocation lifetime. */
export function createWorkerTransactionDetails(db: Pick<JazzDb, 'subscribe'>) {
	const observe = createCallbackLogic<never, Input & { token: object }>(({ input, sendBack }) => {
		const row = input.observation.transaction
		if (
			!row ||
			row.id !== input.observation.transactionId ||
			row.organizationId !== input.observation.organizationId
		)
			return
		let active = true
		const failed = () => {
			if (active) sendBack({ type: 'READ_FAILED', token: input.token })
		}
		const releases: (() => void)[] = []
		const dispose = () => {
			active = false
			const failures: unknown[] = []
			for (const release of releases.splice(0)) {
				try {
					release()
				} catch (error) {
					failures.push(error)
				}
			}
			if (failures.length) throw new AggregateError(failures, 'Subscription cleanup failed')
		}
		try {
			const detail = db.subscribe(
				transactionDetailQuery.where({ id: row.id, organizationId: row.organizationId }),
				{
					onUpdate: (rows) => {
						if (!active) return
						try {
							const record = rows[0]
							const metadata = record
								? workerTransactionMetadata.parse({
										$createdBy: {
											account: record.$createdBy.account,
											system: record.$createdBy.account === SYSTEM_ACCOUNT_ID
										},
										$updatedBy: {
											account: record.$updatedBy.account,
											system: record.$updatedBy.account === SYSTEM_ACCOUNT_ID
										},
										$createdAt: record.$createdAt,
										$updatedAt: record.$updatedAt
									})
								: null
							const images = (record?.attachments ?? []).flatMap((link) => {
								const file = link.file ? attachmentFile(link.file) : undefined
								return file ? [{ id: link.id, fileId: link.fileId, file }] : []
							})
							sendBack({ type: 'DETAIL', token: input.token, transaction: metadata, images })
						} catch {
							failed()
						}
					},
					onError: failed
				},
				{ tier: 'local-first' }
			)
			releases.push(detail)
			const creator = db.subscribe(
				app.profiles.where({ userId: row.$createdBy.account }),
				{
					onUpdate: (rows) => {
						try {
							if (active)
								sendBack({
									type: 'CREATOR',
									token: input.token,
									profile: rows[0]
										? workerProfile.parse({
												id: rows[0].id,
												userId: rows[0].userId,
												displayName: rows[0].displayName,
												avatarData: rows[0].avatarData,
												avatarMimeType: rows[0].avatarMimeType
											})
										: null
								})
						} catch {
							failed()
						}
					},
					onError: failed
				},
				{ tier: 'local-first' }
			)
			releases.push(creator)
			const editor = db.subscribe(
				app.profiles.where({ userId: row.$updatedBy.account }),
				{
					onUpdate: (rows) => {
						try {
							if (active)
								sendBack({
									type: 'EDITOR',
									token: input.token,
									profile: rows[0]
										? workerProfile.parse({
												id: rows[0].id,
												userId: rows[0].userId,
												displayName: rows[0].displayName,
												avatarData: rows[0].avatarData,
												avatarMimeType: rows[0].avatarMimeType
											})
										: null
								})
						} catch {
							failed()
						}
					},
					onError: failed
				},
				{ tier: 'local-first' }
			)
			releases.push(editor)
		} catch (error) {
			try {
				dispose()
			} finally {
				throw error
			}
		}
		return dispose
	})
	return setup({
		schemas: {
			input: types<Input>(),
			context: types<Context>(),
			events: {
				OBSERVE: types<Input>(),
				DETAIL: types<{
					token: object
					transaction: WorkerTransactionDetailsView['transaction']
					images: WorkerTransactionDetailsView['images']
				}>(),
				CREATOR: types<{ token: object; profile: Context['creator'] }>(),
				EDITOR: types<{ token: object; profile: Context['editor'] }>(),
				READ_FAILED: types<{ token: object }>(),
				SHUTDOWN: types()
			}
		},
		actors: { observe }
	}).createMachine({
		id: 'finance-worker-transaction-details',
		context: ({ input }) => ({
			...input,
			token: {},
			transaction: undefined,
			images: [],
			creator: null,
			editor: null,
			failed: false
		}),
		initial: 'observing',
		on: { SHUTDOWN: { target: '.closed' } },
		states: {
			observing: {
				invoke: { src: 'observe', input: ({ context }) => context, onError: { target: 'failed' } },
				on: {
					OBSERVE: ({ context, event }) =>
						context.observation.binding !== event.observation.binding ||
						queryKey(context.observation) !== queryKey(event.observation)
							? {
									target: 'observing',
									reenter: true,
									context: {
										observation: event.observation,
										token: {},
										transaction: undefined,
										images: [],
										creator: null,
										editor: null,
										failed: false
									}
								}
							: { context: { observation: event.observation } },
					DETAIL: ({ context, event }) =>
						event.token === context.token
							? { context: { transaction: event.transaction, images: event.images } }
							: undefined,
					CREATOR: ({ context, event }) =>
						event.token === context.token ? { context: { creator: event.profile } } : undefined,
					EDITOR: ({ context, event }) =>
						event.token === context.token ? { context: { editor: event.profile } } : undefined,
					READ_FAILED: ({ context, event }) =>
						event.token === context.token
							? {
									context: {
										failed: true,
										transaction: null,
										images: [],
										creator: null,
										editor: null
									}
								}
							: undefined
				}
			},
			failed: {
				on: {
					OBSERVE: ({ context, event }) =>
						queryKey(context.observation) !== queryKey(event.observation) ||
						context.observation.binding !== event.observation.binding
							? {
									target: 'observing',
									context: {
										observation: event.observation,
										token: {},
										transaction: undefined,
										images: [],
										creator: null,
										editor: null,
										failed: false
									}
								}
							: { context: { observation: event.observation } }
				}
			},
			closed: { type: 'final' }
		}
	})
}
export function selectWorkerTransactionDetails(
	snapshot: SnapshotFrom<ReturnType<typeof createWorkerTransactionDetails>>
) {
	const c = snapshot.context
	const row = c.observation.transaction
	return {
		observation: c.observation,
		view:
			row && row.id === c.observation.transactionId
				? ({
						transactionId: row.id,
						transaction: c.transaction ?? null,
						images: c.images,
						creatorProfile: c.creator,
						editorProfile: c.editor,
						loading: c.transaction === undefined,
						failed: c.failed || snapshot.matches('failed')
					} satisfies WorkerTransactionDetailsView)
				: null
	}
}
