import { assign, fromPromise, sendTo, setup } from 'xstate'
import { sameBackupBinding } from '../../backup/export.js'
import type { RestoreJournalRecord } from '../../backup/restore-journal.js'
import {
	requirePreparationValue,
	type RestorePreparationEvent
} from '../../backup/restore-preparation.js'
import { createRestoreJournalStepMachine } from './restore-journal-step.js'
import { createRestoreWriteStepMachine } from './restore-preparation-write.js'
import {
	validateRestoreBatchInput,
	requestedBatchIsCurrent,
	type RestoreBatchInput,
	type RestoreWriteInput,
	type RestoreStepWriter,
	type RestoreWriteResult
} from '../../backup/restore-write-step.js'

import { operationLock, type LockEvent } from './restore-operation-lock.js'

/** Existing-operation continuation: admits exactly one requested current batch, never creates intent. */
export function createRestoreBatchMachine<Transaction, Write>(
	writer: RestoreStepWriter<Transaction, Write>
) {
	type Context = RestoreBatchInput & {
		record: RestoreJournalRecord | undefined
		outcome: RestoreWriteResult<'batchWritten'>['outcome']
		interruption: 'cancelled' | 'closed' | 'invalidated' | undefined
	}
	const actors = {
		validate: fromPromise(({ input }: { input: RestoreBatchInput }) =>
			Promise.resolve(validateRestoreBatchInput(input))
		),
		lock: operationLock,
		journal: createRestoreJournalStepMachine(),
		write: createRestoreWriteStepMachine(
			writer,
			(input: RestoreWriteInput & { writeId: string }) =>
				requirePreparationValue(
					input.intent.plan.batches.find((step) => step.writeId === input.writeId)
				),
			'batchWritten'
		)
	}
	const model = setup<
		Context,
		RestorePreparationEvent | LockEvent,
		typeof actors,
		{},
		{ interrupt: undefined },
		{ interrupted: undefined; currentBinding: undefined },
		never,
		string,
		RestoreBatchInput,
		RestoreWriteResult<'batchWritten'>
	>({
		actors,
		guards: {
			interrupted: ({ context }) => context.interruption !== undefined,
			currentBinding: ({ context, event }) =>
				event.type === 'INVALIDATE' && sameBackupBinding(context.binding, event.binding)
		},
		actions: {
			interrupt: assign({
				interruption: ({ event }) =>
					event.type === 'SHUTDOWN'
						? 'closed'
						: event.type === 'INVALIDATE'
							? 'invalidated'
							: 'cancelled'
			})
		}
	})
	const input = ({ context }: { context: Context }) => ({
		binding: context.binding,
		databaseName: context.databaseName,
		intent: context.intent,
		writeId: context.writeId
	})
	const forward = model.enqueueActions(({ self, event, enqueue }) => {
		const child = self.getSnapshot().children.write
		if (child?.getSnapshot().status === 'active') enqueue.sendTo(child, event)
	})
	const shutdownWriter = model.enqueueActions(({ self, enqueue }) => {
		const child = self.getSnapshot().children.write
		if (child?.getSnapshot().status === 'active') enqueue.sendTo(child, { type: 'SHUTDOWN' })
	})

	return model.createMachine({
		id: 'restore-batch',
		context: ({ input }) => ({
			...input,
			record: undefined,
			outcome: 'unavailable',
			interruption: undefined
		}),
		initial: 'validating',
		output: ({ context }) => ({
			binding: context.binding,
			outcome: context.interruption ?? context.outcome,
			record: context.record
		}),
		on: {
			CANCEL: { actions: ['interrupt', forward] },
			SHUTDOWN: { actions: ['interrupt', forward] },
			INVALIDATE: { guard: 'currentBinding', actions: ['interrupt', forward] }
		},
		states: {
			validating: {
				invoke: {
					src: 'validate',
					input,
					onDone: [
						{ guard: 'interrupted', target: 'complete' },
						{
							target: 'owned',
							actions: assign({
								binding: ({ event }) => event.output.binding,
								intent: ({ event }) => event.output.record.intent
							})
						}
					],
					onError: 'complete'
				}
			},
			owned: {
				initial: 'acquiring',
				invoke: {
					id: 'lock',
					src: 'lock',
					input,
					onDone: [
						{
							guard: ({ event }) => event.output === 'failed',
							target: 'complete',
							actions: assign({ outcome: 'incomplete', interruption: undefined })
						},
						{ target: 'complete' }
					],
					onError: {
						target: 'complete',
						actions: assign({ outcome: 'incomplete', interruption: undefined })
					}
				},
				on: { LOCK_FAILED: { actions: [assign({ interruption: 'closed' }), shutdownWriter] } },
				states: {
					releasing: { id: 'release-batch-lock', entry: sendTo('lock', { type: 'RELEASE' }) },
					acquiring: {
						on: {
							LOCK_ACQUIRED: [
								{
									guard: 'interrupted',
									target: '#release-batch-lock'
								},
								{ target: 'loading' }
							],
							CANCEL: { target: '#release-batch-lock', actions: 'interrupt' },
							SHUTDOWN: { target: '#release-batch-lock', actions: 'interrupt' },
							INVALIDATE: {
								guard: 'currentBinding',
								target: '#release-batch-lock',
								actions: 'interrupt'
							}
						}
					},
					loading: {
						invoke: {
							src: 'journal',
							input: ({ context }) => ({
								databaseName: context.databaseName,
								binding: context.binding,
								command: { mode: 'load', intent: context.intent }
							}),
							onDone: [
								{
									guard: 'interrupted',
									target: '#release-batch-lock',
									actions: assign({ record: ({ event }) => event.output.record })
								},
								{
									guard: ({ event }) =>
										event.output.outcome === 'loaded' && event.output.record !== undefined,
									target: 'admittingWrite',
									actions: assign({
										record: ({ event }) => requirePreparationValue(event.output.record)
									})
								},

								{
									guard: ({ event }) => event.output.outcome === 'conflict',
									target: '#release-batch-lock',
									actions: assign({ outcome: 'conflict' })
								},
								{ target: '#release-batch-lock' }
							],
							onError: '#release-batch-lock'
						}
					},
					admittingWrite: {
						always: [
							{ guard: 'interrupted', target: '#release-batch-lock' },
							{
								guard: ({ context }) => context.record?.checkpoint.kind === 'conflict',
								target: '#release-batch-lock',
								actions: assign({ outcome: 'conflict' })
							},
							{
								guard: ({ context }) => requestedBatchIsCurrent(context.record, context.writeId),
								target: 'writing'
							},
							{ target: '#release-batch-lock', actions: assign({ outcome: 'incomplete' }) }
						]
					},
					writing: {
						invoke: {
							id: 'write',
							src: 'write',
							input: ({ context }) => ({
								...input({ context }),
								record: requirePreparationValue(context.record),
								writeId: context.writeId
							}),
							onDone: {
								target: '#release-batch-lock',
								actions: assign({
									outcome: ({ event }) => event.output.outcome,
									record: ({ event }) => event.output.record
								})
							},
							onError: {
								target: '#release-batch-lock',
								actions: assign({ outcome: 'incomplete' })
							}
						}
					}
				}
			},
			complete: { type: 'final' }
		}
	})
}
