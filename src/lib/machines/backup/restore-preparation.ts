import { assign, fromPromise, setup } from 'xstate'
import { sameBackupBinding } from '../../backup/export.js'
import type { RestoreJournalRecord } from '../../backup/restore-journal.js'
import {
	requirePreparationValue,
	validatePreparationInput,
	type RestorePreparationEvent,
	type RestorePreparationInput,
	type RestorePreparationOutcome,
	type RestorePreparationResult,
	type RestorePreparationWriter
} from '../../backup/restore-preparation.js'
import { createRestoreJournalStepMachine } from './restore-journal-step.js'
import { createRestorePreparationWriteMachine } from './restore-preparation-write.js'

import { operationLock, type LockEvent } from './restore-operation-lock.js'

/** Preparation only. A prepared destination remains incomplete and unavailable for ordinary use. */
export function createRestorePreparationMachine<Transaction, Write>(
	writer: RestorePreparationWriter<Transaction, Write>
) {
	type Context = RestorePreparationInput & {
		record: RestoreJournalRecord | undefined
		outcome: RestorePreparationOutcome
		interruption: 'cancelled' | 'closed' | 'invalidated' | undefined
	}
	const actors = {
		validate: fromPromise(({ input }: { input: RestorePreparationInput }) =>
			Promise.resolve(validatePreparationInput(input))
		),
		lock: operationLock,
		journal: createRestoreJournalStepMachine(),
		write: createRestorePreparationWriteMachine(writer)
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
		RestorePreparationInput,
		RestorePreparationResult
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
		intent: context.intent
	})
	const forward = model.enqueueActions(({ self, event, enqueue }) => {
		const child = self.getSnapshot().children.write
		if (child?.getSnapshot().status === 'active') enqueue.sendTo(child, event)
	})
	return model.createMachine({
		id: 'restore-preparation',
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
								record: ({ event }) => event.output.record,
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
				on: { LOCK_FAILED: '#restore-preparation.complete' },
				states: {
					acquiring: {
						on: {
							LOCK_ACQUIRED: [
								{
									guard: 'interrupted',
									target: '#restore-preparation.complete'
								},
								{ target: 'loading' }
							],
							LOCK_UNAVAILABLE: '#restore-preparation.complete'
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
									target: '#restore-preparation.complete',
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
									guard: ({ event }) => event.output.outcome === 'missing',
									target: 'creatingIntent'
								},
								{
									guard: ({ event }) => event.output.outcome === 'conflict',
									target: '#restore-preparation.conflict'
								},
								{ target: '#restore-preparation.complete' }
							],
							onError: '#restore-preparation.complete'
						}
					},
					creatingIntent: {
						invoke: {
							src: 'journal',
							input: ({ context }) => ({
								databaseName: context.databaseName,
								binding: context.binding,
								command: { mode: 'create', record: requirePreparationValue(context.record) }
							}),
							onDone: [
								{
									guard: ({ event }) =>
										(event.output.outcome === 'created' || event.output.outcome === 'existing') &&
										event.output.record !== undefined,
									target: 'admittingWrite',
									actions: assign({
										record: ({ event }) => requirePreparationValue(event.output.record)
									})
								},
								{
									guard: ({ event }) => event.output.outcome === 'conflict',
									target: '#restore-preparation.conflict'
								},
								{ target: '#restore-preparation.complete' }
							],
							onError: '#restore-preparation.complete'
						}
					},
					admittingWrite: {
						always: [
							{ guard: 'interrupted', target: '#restore-preparation.complete' },
							{
								guard: ({ context }) => context.record?.checkpoint.kind === 'conflict',
								target: '#restore-preparation.conflict'
							},
							{ target: 'writing' }
						]
					},
					writing: {
						invoke: {
							id: 'write',
							src: 'write',
							input: ({ context }) => ({
								...input({ context }),
								record: requirePreparationValue(context.record)
							}),
							onDone: {
								target: '#restore-preparation.complete',
								actions: assign({
									outcome: ({ event }) => event.output.outcome,
									record: ({ event }) => event.output.record
								})
							},
							onError: {
								target: '#restore-preparation.complete',
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

export { createRestoreJournalStepMachine } from './restore-journal-step.js'
