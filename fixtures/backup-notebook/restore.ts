import { assign, fromPromise, setup } from 'xstate'
import { sameBackupBinding, type BackupBinding } from 'delightful-local-first/backup/export'
import type {
	RestorePreparationEvent,
	RestorePreparationResult,
	RestorePreparationWriter
} from 'delightful-local-first/backup/restore/preparation'
import { createRestorePreparationMachine } from 'delightful-local-first/backup/restore/preparation/workflow'
import {
	claimNotebookRestore,
	notebookRestoreData as data,
	notebookRestoreResources,
	requiredNotebookRestoreValue as required,
	type NotebookRestoreRequest
} from './restore-request.js'
import { createNotebookRestorePlanningMachine } from './restore-planning.js'
export { prepareNotebookRestore } from './restore-request.js'
export type { NotebookRestoreRequest } from './restore-request.js'

/** The root owns checked-archive references until planning and the active destination child drain. */
export function createNotebookRestorePreparationMachine<Transaction, Write>(
	writer: RestorePreparationWriter<Transaction, Write>
) {
	type Input = { request: NotebookRestoreRequest }
	type Context = Input & {
		binding: BackupBinding
		databaseName: string
		interruption: 'cancelled' | 'closed' | 'invalidated' | undefined
		result: RestorePreparationResult
	}
	const actors = {
		claim: fromPromise<void, Input>(({ input }) => {
			claimNotebookRestore(input)
			return Promise.resolve()
		}),
		resources: notebookRestoreResources,
		plan: createNotebookRestorePlanningMachine(),
		prepare: createRestorePreparationMachine(writer)
	}
	const model = setup<
		Context,
		RestorePreparationEvent | { type: 'RELEASE' },
		typeof actors,
		{},
		{ interrupt: undefined },
		{ interrupted: undefined; currentBinding: undefined },
		never,
		string,
		Input,
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
				interruption: ({ context, event }) =>
					context.interruption ??
					(event.type === 'SHUTDOWN'
						? 'closed'
						: event.type === 'INVALIDATE'
							? 'invalidated'
							: 'cancelled')
			})
		}
	})
	const input = ({ context }: { context: Context }) => ({ request: context.request })
	const forward = model.enqueueActions(({ self, event, enqueue }) => {
		const child = self.getSnapshot().children.effect
		if (child?.getSnapshot().status === 'active')
			enqueue.sendTo(child, event.type === 'RELEASE' ? { type: 'CANCEL' } : event)
	})
	return model.createMachine({
		id: 'notebook-restore-preparation',
		initial: 'claiming',
		context: ({ input }) => {
			const options = required(data(input).options)
			return {
				request: input.request,
				binding: options.binding,
				databaseName: options.databaseName,
				interruption: undefined,
				result: { binding: options.binding, outcome: 'unavailable', record: undefined }
			}
		},
		output: ({ context }) => ({
			...context.result,
			outcome: context.interruption ?? context.result.outcome
		}),
		on: {
			CANCEL: { actions: ['interrupt', forward] },
			SHUTDOWN: { actions: ['interrupt', forward] },
			INVALIDATE: { guard: 'currentBinding', actions: ['interrupt', forward] },
			RELEASE: { actions: ['interrupt', forward] }
		},
		states: {
			claiming: { invoke: { src: 'claim', input, onDone: 'working', onError: 'complete' } },
			working: {
				initial: 'planning',
				invoke: { src: 'resources', input, onError: 'complete' },
				states: {
					planning: {
						invoke: {
							id: 'effect',
							src: 'plan',
							input,
							onDone: [
								{ guard: 'interrupted', target: '#notebook-restore-preparation.complete' },
								{
									guard: ({ event }) => event.output.outcome === 'planned',
									target: 'preparingDestination'
								},
								{ target: '#notebook-restore-preparation.complete' }
							],
							onError: '#notebook-restore-preparation.complete'
						}
					},
					preparingDestination: {
						invoke: {
							id: 'effect',
							src: 'prepare',
							input: ({ context }) => ({
								binding: context.binding,
								databaseName: context.databaseName,
								intent: required(data(context).intent)
							}),
							onDone: {
								target: '#notebook-restore-preparation.complete',
								actions: assign({ result: ({ event }) => event.output })
							},
							onError: '#notebook-restore-preparation.complete'
						}
					}
				}
			},
			complete: { type: 'final' }
		}
	})
}
