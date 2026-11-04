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
	prepareNotebookRestore,
	requiredNotebookRestoreValue as required,
	type NotebookRestoreRequest,
	type NotebookRestoreOptions
} from './restore-request.js'
import { createNotebookRestorePlanningMachine } from './restore-planning.js'
import {
	notebookCurrentStepIsAttachment,
	notebookPreparationComplete,
	notebookRecoveryConflict,
	notebookRecoveryIntentMatches,
	prepareNotebookAttachmentBytes
} from './restore-attachment-data.js'

export type NotebookAttachmentResult = Omit<RestoreWriteResult<'batchWritten'>, 'outcome'> & {
	outcome: RestoreWriteResult<'batchWritten'>['outcome'] | 'noAttachmentStep'
}
/** Same operation/file, new live generation. No new destination or mappings are allocated. */
export function prepareNotebookAttachmentRestore(options: Omit<NotebookRestoreOptions, 'mode'>) {
	return prepareNotebookRestore({ ...options, mode: 'resume' })
}

export function createNotebookRestoreAttachmentMachine<Transaction, Write>(
	writer: RestoreStepWriter<Transaction, Write>
) {
	type Input = { request: NotebookRestoreRequest }
	type Context = Input & {
		binding: BackupBinding
		databaseName: string
		interruption: 'cancelled' | 'closed' | 'invalidated' | undefined
		result: NotebookAttachmentResult
	}
	const actors = {
		claim: fromPromise<void, Input>(({ input }) => {
			claimNotebookRestore(input)
			return Promise.resolve()
		}),
		resources: notebookRestoreResources,
		plan: createNotebookRestorePlanningMachine(),
		bytes: fromPromise<void, Input>(({ input }) => {
			prepareNotebookAttachmentBytes(input)
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
			attachmentStep: undefined
			preparationComplete: undefined
		},
		never,
		string,
		Input,
		NotebookAttachmentResult
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
			attachmentStep: ({ context }) => notebookCurrentStepIsAttachment(context)
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
		id: 'notebook-restore-attachment',
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
							{ guard: 'interrupted', target: '#notebook-restore-attachment.complete' },
							{ guard: 'resumeRequest', target: 'planning' },
							{ target: '#notebook-restore-attachment.complete' }
						]
					},
					planning: {
						invoke: {
							id: 'effect',
							src: 'plan',
							input,
							onDone: [
								{ guard: 'interrupted', target: '#notebook-restore-attachment.complete' },
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
								{ target: '#notebook-restore-attachment.complete' }
							],
							onError: '#notebook-restore-attachment.complete'
						}
					},
					checkingRecovery: {
						always: [
							{ guard: 'recoveryConflict', target: '#notebook-restore-attachment.conflict' },
							{ guard: 'matchingIntent', target: 'checkingPreparation' },
							{ target: '#notebook-restore-attachment.conflict' }
						]
					},
					checkingPreparation: {
						always: [
							{ guard: 'preparationComplete', target: 'selectingAttachment' },
							{ target: '#notebook-restore-attachment.complete' }
						]
					},
					selectingAttachment: {
						always: [
							{ guard: 'attachmentStep', target: 'preparingBytes' },
							{ target: '#notebook-restore-attachment.notApplicable' }
						]
					},
					preparingBytes: {
						invoke: {
							src: 'bytes',
							input,
							onDone: [
								{ guard: 'interrupted', target: '#notebook-restore-attachment.complete' },
								{ target: 'writingBatch' }
							],
							onError: '#notebook-restore-attachment.complete'
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
								writeId: required(data(context).attachment).writeId
							}),
							onDone: {
								target: '#notebook-restore-attachment.complete',
								actions: assign({ result: ({ event }) => event.output })
							},
							onError: '#notebook-restore-attachment.complete'
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
					result: ({ context }) => ({ ...context.result, outcome: 'noAttachmentStep' })
				})
			},
			complete: { type: 'final' }
		}
	})
}
