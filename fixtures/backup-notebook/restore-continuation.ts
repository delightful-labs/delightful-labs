import { assign, fromPromise, setup } from 'xstate'
import { sameBackupBinding, type BackupBinding } from 'delightful-local-first/backup/export'
import type {
	RestoreBatchEvent,
	RestoreStepWriter,
	RestoreWriteResult
} from 'delightful-local-first/backup/restore/batch'
import { createRestoreBatchMachine } from 'delightful-local-first/backup/restore/batch/workflow'
import {
	claimNotebookRestore,
	notebookRestoreData as data,
	notebookRestoreResources,
	requiredNotebookRestoreValue as required,
	type NotebookRestoreRequest
} from './restore-request.js'
import { createNotebookRestorePlanningMachine } from './restore-planning.js'
import {
	notebookPreparationComplete,
	notebookRecoveryConflict,
	notebookRecoveryIntentMatches
} from './restore-step-data.js'

export type NotebookContinuationResult<NotApplicable extends string> = Omit<
	RestoreWriteResult<'batchWritten'>,
	'outcome'
> & {
	outcome: RestoreWriteResult<'batchWritten'>['outcome'] | NotApplicable
}
type Continuation<NotApplicable extends string> = {
	currentStep(input: { request: NotebookRestoreRequest }): boolean
	prepareExpected(input: { request: NotebookRestoreRequest }): void
	writeId(input: { request: NotebookRestoreRequest }): string
	notApplicable: NotApplicable
}
/** Static pure domain projections; workflow decisions remain in this statechart. */
export function createNotebookRestoreContinuationMachine<
	Transaction,
	Write,
	NotApplicable extends string
>(writer: RestoreStepWriter<Transaction, Write>, continuation: Continuation<NotApplicable>) {
	type Input = { request: NotebookRestoreRequest }
	type Context = Input & {
		binding: BackupBinding
		databaseName: string
		interruption: 'cancelled' | 'closed' | 'invalidated' | undefined
		result: NotebookContinuationResult<NotApplicable>
	}
	const actors = {
		claim: fromPromise<void, Input>(({ input }) => {
			claimNotebookRestore(input)
			return Promise.resolve()
		}),
		resources: notebookRestoreResources,
		plan: createNotebookRestorePlanningMachine(),
		expected: fromPromise<void, Input>(({ input }) => {
			continuation.prepareExpected(input)
			return Promise.resolve()
		}),
		batch: createRestoreBatchMachine(writer)
	}
	const model = setup<
		Context,
		RestoreBatchEvent | { type: 'RELEASE' },
		typeof actors,
		{},
		{ interrupt: undefined },
		{
			interrupted: undefined
			currentBinding: undefined
			resumeRequest: undefined
			recoveryConflict: undefined
			matchingIntent: undefined
			currentStep: undefined
			preparationComplete: undefined
		},
		never,
		string,
		Input,
		NotebookContinuationResult<NotApplicable>
	>({
		actors,
		guards: {
			interrupted: ({ context }) => context.interruption !== undefined,
			currentBinding: ({ context, event }) =>
				event.type === 'INVALIDATE' && sameBackupBinding(context.binding, event.binding),
			resumeRequest: ({ context }) => data(context).options?.mode === 'resume',
			recoveryConflict: ({ context }) => notebookRecoveryConflict(context),
			matchingIntent: ({ context }) => notebookRecoveryIntentMatches(context),
			preparationComplete: ({ context }) => notebookPreparationComplete(context),
			currentStep: ({ context }) => continuation.currentStep(context)
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
		id: 'notebook-restore-continuation',
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
				initial: 'admittingResume',
				invoke: { src: 'resources', input, onError: 'complete' },
				states: {
					admittingResume: {
						always: [
							{ guard: 'interrupted', target: '#notebook-restore-continuation.complete' },
							{ guard: 'resumeRequest', target: 'planning' },
							{ target: '#notebook-restore-continuation.complete' }
						]
					},
					planning: {
						invoke: {
							id: 'effect',
							src: 'plan',
							input,
							onDone: [
								{ guard: 'interrupted', target: '#notebook-restore-continuation.complete' },
								{
									guard: ({ event }) => event.output.outcome === 'planned',
									target: 'checkingRecovery',
									actions: assign({
										result: ({ context }) => ({
											binding: context.binding,
											outcome: 'incomplete',
											record: data(context).observedJournal
										})
									})
								},
								{ target: '#notebook-restore-continuation.complete' }
							],
							onError: '#notebook-restore-continuation.complete'
						}
					},
					checkingRecovery: {
						always: [
							{ guard: 'recoveryConflict', target: '#notebook-restore-continuation.conflict' },
							{ guard: 'matchingIntent', target: 'checkingPreparation' },
							{ target: '#notebook-restore-continuation.conflict' }
						]
					},
					checkingPreparation: {
						always: [
							{ guard: 'preparationComplete', target: 'selectingStep' },
							{ target: '#notebook-restore-continuation.complete' }
						]
					},
					selectingStep: {
						always: [
							{ guard: 'currentStep', target: 'preparingExpected' },
							{ target: '#notebook-restore-continuation.notApplicable' }
						]
					},
					preparingExpected: {
						invoke: {
							src: 'expected',
							input,
							onDone: [
								{ guard: 'interrupted', target: '#notebook-restore-continuation.complete' },
								{ target: 'writingBatch' }
							],
							onError: '#notebook-restore-continuation.complete'
						}
					},
					writingBatch: {
						invoke: {
							id: 'effect',
							src: 'batch',
							input: ({ context }) => ({
								binding: context.binding,
								databaseName: context.databaseName,
								intent: required(data(context).intent),
								writeId: continuation.writeId(context)
							}),
							onDone: {
								target: '#notebook-restore-continuation.complete',
								actions: assign({ result: ({ event }) => event.output })
							},
							onError: '#notebook-restore-continuation.complete'
						}
					}
				}
			},
			conflict: {
				type: 'final',
				entry: assign({ result: ({ context }) => ({ ...context.result, outcome: 'conflict' }) })
			},
			notApplicable: {
				type: 'final',
				entry: assign({
					result: ({ context }) => ({ ...context.result, outcome: continuation.notApplicable })
				})
			},
			complete: { type: 'final' }
		}
	})
}
