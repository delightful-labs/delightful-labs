import { assign, sendTo, setup, type Snapshot } from 'xstate'
import { sameBackupBinding } from '../../backup/export.js'
import {
	createRestoreJournalRecord,
	type RestoreJournalRecord
} from '../../backup/restore-journal.js'
import { createRestoreJournalStepMachine } from './restore-journal-step.js'
import { createRestoreWriteStepMachine } from './restore-write-step.js'
import {
	requireRestoreValue,
	validateRestoreInput,
	requestedBatchIsCurrent,
	type RestoreInput,
	type RestoreEvent,
	type RestoreResult,
	type RestoreOutcome,
	type RestorePlannedWrite,
	type RestoreDestinationResult,
	type RestoreDestinationLogic,
	type RestoreTransactionWriter
} from '../../backup/restore.js'

import { operationLock, type LockEvent } from './restore-operation-lock.js'

/** One selected write per invocation. Only preparation may initialize a missing durable intent. */
export function createRestoreMachine<
	Transaction,
	Write,
	S extends Snapshot<RestoreDestinationResult>
>(
	writer: RestoreTransactionWriter<Transaction, Write>,
	destination: RestoreDestinationLogic<Transaction, S>
) {
	type Context = RestoreInput & {
		step: RestorePlannedWrite | undefined
		record: RestoreJournalRecord | undefined
		outcome: RestoreOutcome
		interruption: 'cancelled' | 'closed' | 'invalidated' | undefined
	}
	const actors = {
		lock: operationLock,
		journal: createRestoreJournalStepMachine(),
		write: createRestoreWriteStepMachine(writer, destination)
	}
	const model = setup<
		Context,
		| RestoreEvent
		| LockEvent
		| { type: 'INPUT_VALIDATED'; value: ReturnType<typeof validateRestoreInput> }
		| { type: 'INPUT_INVALID' },
		typeof actors,
		{},
		{ interrupt: undefined },
		{ interrupted: undefined; currentBinding: undefined },
		never,
		string,
		RestoreInput,
		RestoreResult
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
		if (
			child?.getSnapshot().status === 'active' &&
			(event.type === 'CANCEL' || event.type === 'SHUTDOWN' || event.type === 'INVALIDATE')
		)
			enqueue.sendTo(child, event)
	})
	const shutdownWriter = model.enqueueActions(({ self, enqueue }) => {
		const child = self.getSnapshot().children.write
		if (child?.getSnapshot().status === 'active') enqueue.sendTo(child, { type: 'SHUTDOWN' })
	})

	return model.createMachine({
		id: 'restore',
		context: ({ input }) => ({
			...input,
			record: undefined,
			step: undefined,
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
				entry: ({ context, self }) => {
					try {
						self.send({ type: 'INPUT_VALIDATED', value: validateRestoreInput(input({ context })) })
					} catch {
						self.send({ type: 'INPUT_INVALID' })
					}
				},
				on: {
					INPUT_VALIDATED: [
						{ guard: 'interrupted', target: 'complete' },
						{
							target: 'owned',
							actions: assign({
								step: ({ event }) => event.value.step,
								binding: ({ event }) => event.value.binding,
								intent: ({ event }) => event.value.record.intent
							})
						}
					],
					INPUT_INVALID: 'complete'
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
					releasing: { id: 'release-restore-lock', entry: sendTo('lock', { type: 'RELEASE' }) },
					acquiring: {
						on: {
							LOCK_ACQUIRED: [
								{
									guard: 'interrupted',
									target: '#release-restore-lock'
								},
								{ target: 'loading' }
							],
							CANCEL: { target: '#release-restore-lock', actions: 'interrupt' },
							SHUTDOWN: { target: '#release-restore-lock', actions: 'interrupt' },
							INVALIDATE: {
								guard: 'currentBinding',
								target: '#release-restore-lock',
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
									target: '#release-restore-lock',
									actions: assign({ record: ({ event }) => event.output.record })
								},
								{
									guard: ({ event }) =>
										event.output.outcome === 'loaded' && event.output.record !== undefined,
									target: 'admittingWrite',
									actions: assign({
										record: ({ event }) => requireRestoreValue(event.output.record)
									})
								},

								{
									guard: ({ context, event }) =>
										event.output.outcome === 'missing' &&
										context.writeId === context.intent.plan.preparation.writeId,
									target: 'creatingIntent'
								},

								{
									guard: ({ event }) => event.output.outcome === 'conflict',
									target: '#release-restore-lock',
									actions: assign({ outcome: 'conflict' })
								},
								{ target: '#release-restore-lock' }
							],
							onError: '#release-restore-lock'
						}
					},
					creatingIntent: {
						invoke: {
							src: 'journal',
							input: ({ context }) => ({
								databaseName: context.databaseName,
								binding: context.binding,
								command: { mode: 'create', record: createRestoreJournalRecord(context.intent) }
							}),
							onDone: [
								{
									guard: ({ event }) =>
										(event.output.outcome === 'created' || event.output.outcome === 'existing') &&
										event.output.record !== undefined,
									target: 'admittingWrite',
									actions: assign({
										record: ({ event }) => requireRestoreValue(event.output.record)
									})
								},
								{
									guard: ({ event }) => event.output.outcome === 'conflict',
									target: '#release-restore-lock',
									actions: assign({ outcome: 'conflict' })
								},
								{ target: '#release-restore-lock' }
							],
							onError: '#release-restore-lock'
						}
					},
					admittingWrite: {
						always: [
							{ guard: 'interrupted', target: '#release-restore-lock' },
							{
								guard: ({ context }) => context.record?.checkpoint.kind === 'conflict',
								target: '#release-restore-lock',
								actions: assign({ outcome: 'conflict' })
							},
							{
								guard: ({ context }) =>
									context.writeId === context.intent.plan.preparation.writeId ||
									requestedBatchIsCurrent(context.record, context.writeId),
								target: 'writing'
							},
							{ target: '#release-restore-lock', actions: assign({ outcome: 'incomplete' }) }
						]
					},
					writing: {
						invoke: {
							id: 'write',
							src: 'write',
							input: ({ context }) => ({
								...input({ context }),
								record: requireRestoreValue(context.record),
								step: requireRestoreValue(context.step)
							}),
							onDone: [
								{
									guard: ({ context, event }) =>
										event.output.outcome === 'written' &&
										context.writeId === context.intent.plan.preparation.writeId,
									target: '#release-restore-lock',
									actions: assign({
										outcome: 'prepared',
										record: ({ event }) => event.output.record
									})
								},
								{
									guard: ({ event }) => event.output.outcome === 'written',
									target: '#release-restore-lock',
									actions: assign({
										outcome: 'batchWritten',
										record: ({ event }) => event.output.record
									})
								},
								{
									guard: ({ event }) => event.output.outcome === 'conflict',
									target: '#release-restore-lock',
									actions: assign({
										outcome: 'conflict',
										record: ({ event }) => event.output.record
									})
								},
								{
									target: '#release-restore-lock',
									actions: assign({
										outcome: 'incomplete',
										record: ({ event }) => event.output.record
									})
								}
							],
							onError: {
								target: '#release-restore-lock',
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

export { createRestoreJournalStepMachine } from './restore-journal-step.js'
