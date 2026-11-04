import { assign, fromPromise, setup } from 'xstate'
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
				invoke: { src: 'lock', input, onError: 'complete' },
				on: { LOCK_FAILED: '#restore-batch.complete' },
				states: {
					acquiring: {
						on: {
							LOCK_ACQUIRED: [
								{
									guard: 'interrupted',
									target: '#restore-batch.complete'
								},
								{ target: 'loading' }
							],
							LOCK_UNAVAILABLE: '#restore-batch.complete'
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
									target: '#restore-batch.complete',
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
									target: '#restore-batch.conflict'
								},
								{ target: '#restore-batch.complete' }
							],
							onError: '#restore-batch.complete'
						}
					},
					admittingWrite: {
						always: [
							{ guard: 'interrupted', target: '#restore-batch.complete' },
							{
								guard: ({ context }) => context.record?.checkpoint.kind === 'conflict',
								target: '#restore-batch.conflict'
							},
							{
								guard: ({ context }) => requestedBatchIsCurrent(context.record, context.writeId),
								target: 'writing'
							},
							{ target: '#restore-batch.complete', actions: assign({ outcome: 'incomplete' }) }
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
								target: '#restore-batch.complete',
								actions: assign({
									outcome: ({ event }) => event.output.outcome,
									record: ({ event }) => event.output.record
								})
							},
							onError: {
								target: '#restore-batch.complete',
								actions: assign({ outcome: 'incomplete' })
							}
						}
					}
				}
			},
			conflict: { type: 'final', entry: assign({ outcome: 'conflict' }) },
			complete: { type: 'final' }
		}
	})
}
