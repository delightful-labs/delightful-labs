import { assign, fromPromise, sendTo, setup } from 'xstate'
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
	const shutdownWriter = model.enqueueActions(({ self, enqueue }) => {
		const child = self.getSnapshot().children.write
		if (child?.getSnapshot().status === 'active') enqueue.sendTo(child, { type: 'SHUTDOWN' })
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
					releasing: { id: 'release-preparation-lock', entry: sendTo('lock', { type: 'RELEASE' }) },
					acquiring: {
						on: {
							LOCK_ACQUIRED: [
								{
									guard: 'interrupted',
									target: '#release-preparation-lock'
								},
								{ target: 'loading' }
							],
							CANCEL: { target: '#release-preparation-lock', actions: 'interrupt' },
							SHUTDOWN: { target: '#release-preparation-lock', actions: 'interrupt' },
							INVALIDATE: {
								guard: 'currentBinding',
								target: '#release-preparation-lock',
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
									target: '#release-preparation-lock',
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
									target: '#release-preparation-lock',
									actions: assign({ outcome: 'conflict' })
								},
								{ target: '#release-preparation-lock' }
							],
							onError: '#release-preparation-lock'
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
									target: '#release-preparation-lock',
									actions: assign({ outcome: 'conflict' })
								},
								{ target: '#release-preparation-lock' }
							],
							onError: '#release-preparation-lock'
						}
					},
					admittingWrite: {
						always: [
							{ guard: 'interrupted', target: '#release-preparation-lock' },
							{
								guard: ({ context }) => context.record?.checkpoint.kind === 'conflict',
								target: '#release-preparation-lock',
								actions: assign({ outcome: 'conflict' })
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
								target: '#release-preparation-lock',
								actions: assign({
									outcome: ({ event }) => event.output.outcome,
									record: ({ event }) => event.output.record
								})
							},
							onError: {
								target: '#release-preparation-lock',
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
