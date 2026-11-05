import { forwardTo, raise, assign, setup, type Snapshot } from 'xstate'
import { sameBackupBinding, type BackupBinding } from 'delightful-local-first/backup/binding'
import type {
	RestoreEvent,
	RestoreTransactionWriter,
	RestoreResult,
	RestoreDestinationLogic,
	RestoreDestinationResult
} from 'delightful-local-first/backup/restore'
import { createRestoreMachine } from 'delightful-local-first/backup/restore/workflow'
import {
	claimTestAppRestore,
	testAppRestoreData as data,
	testAppRestoreResources,
	requiredTestAppRestoreValue as required,
	type TestAppRestoreRequest
} from './restore-request.js'
import { createTestAppRestorePlanningMachine } from './restore-planning.js'
import {
	testAppPreparationComplete,
	testAppRecoveryConflict,
	testAppRecoveryIntentMatches
} from './restore-step-data.js'

export type TestAppContinuationResult<NotApplicable extends string> = Omit<
	RestoreResult,
	'outcome'
> & {
	outcome: RestoreResult['outcome'] | NotApplicable
}
type Continuation<NotApplicable extends string> = {
	currentStep(input: { request: TestAppRestoreRequest }): boolean
	prepareExpected(input: { request: TestAppRestoreRequest }): void
	writeId(input: { request: TestAppRestoreRequest }): string
	notApplicable: NotApplicable
}
/** Static pure domain projections; workflow decisions remain in this statechart. */
export function createTestAppRestoreContinuationMachine<
	Transaction,
	Write,
	NotApplicable extends string,
	S extends Snapshot<RestoreDestinationResult>
>(
	writer: RestoreTransactionWriter<Transaction, Write>,
	destination: RestoreDestinationLogic<Transaction, S>,
	continuation: Continuation<NotApplicable>
) {
	type Input = { request: TestAppRestoreRequest }
	type Context = Input & {
		binding: BackupBinding
		databaseName: string
		interruption: 'cancelled' | 'closed' | 'invalidated' | undefined
		result: TestAppContinuationResult<NotApplicable>
	}
	const actors = {
		resources: testAppRestoreResources,
		plan: createTestAppRestorePlanningMachine(),
		batch: createRestoreMachine(writer, destination)
	}
	const model = setup<
		Context,
		| RestoreEvent
		| { type: 'RELEASE' | 'CLAIMED' | 'CLAIM_FAILED' | 'EXPECTED_READY' | 'EXPECTED_FAILED' },
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
		TestAppContinuationResult<NotApplicable>
	>({
		actors,
		guards: {
			interrupted: ({ context }) => context.interruption !== undefined,
			currentBinding: ({ context, event }) =>
				event.type === 'INVALIDATE' && sameBackupBinding(context.binding, event.binding),
			resumeRequest: ({ context }) => data(context).options?.mode === 'resume',
			recoveryConflict: ({ context }) => testAppRecoveryConflict(context),
			matchingIntent: ({ context }) => testAppRecoveryIntentMatches(context),
			preparationComplete: ({ context }) => testAppPreparationComplete(context),
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

	return model.createMachine({
		id: 'test-app-restore-continuation',
		initial: 'claiming',
		context: ({ input }) => {
			const value = data(input)
			return {
				request: input.request,
				binding: value.binding,
				databaseName: value.options?.databaseName ?? '',
				interruption: undefined,
				result: { binding: value.binding, outcome: 'unavailable', record: undefined }
			}
		},
		output: ({ context }) => ({
			...context.result,
			outcome: context.interruption ?? context.result.outcome
		}),
		on: {
			CANCEL: { actions: 'interrupt' },
			SHUTDOWN: { actions: 'interrupt' },
			INVALIDATE: { guard: 'currentBinding', actions: 'interrupt' },
			RELEASE: { actions: raise({ type: 'CANCEL' }) }
		},
		states: {
			claiming: {
				entry: ({ context, self }) => {
					self.send({ type: claimTestAppRestore(context) ? 'CLAIMED' : 'CLAIM_FAILED' })
				},
				on: { CLAIMED: 'working', CLAIM_FAILED: 'complete' }
			},
			working: {
				initial: 'admittingResume',
				invoke: { src: 'resources', input, onError: 'complete' },
				states: {
					admittingResume: {
						always: [
							{ guard: 'interrupted', target: '#test-app-restore-continuation.complete' },
							{ guard: 'resumeRequest', target: 'planning' },
							{ target: '#test-app-restore-continuation.complete' }
						]
					},
					planning: {
						on: {
							CANCEL: { actions: ['interrupt', forwardTo('effect')] },
							SHUTDOWN: { actions: ['interrupt', forwardTo('effect')] },
							INVALIDATE: { guard: 'currentBinding', actions: ['interrupt', forwardTo('effect')] }
						},

						invoke: {
							id: 'effect',
							src: 'plan',
							input,
							onDone: [
								{ guard: 'interrupted', target: '#test-app-restore-continuation.complete' },
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
								{ target: '#test-app-restore-continuation.complete' }
							],
							onError: '#test-app-restore-continuation.complete'
						}
					},
					checkingRecovery: {
						always: [
							{ guard: 'recoveryConflict', target: '#test-app-restore-continuation.conflict' },
							{ guard: 'matchingIntent', target: 'checkingPreparation' },
							{ target: '#test-app-restore-continuation.conflict' }
						]
					},
					checkingPreparation: {
						always: [
							{ guard: 'preparationComplete', target: 'selectingStep' },
							{ target: '#test-app-restore-continuation.complete' }
						]
					},
					selectingStep: {
						always: [
							{ guard: 'currentStep', target: 'preparingExpected' },
							{ target: '#test-app-restore-continuation.notApplicable' }
						]
					},
					preparingExpected: {
						entry: ({ context, self }) => {
							try {
								continuation.prepareExpected(context)
								self.send({ type: 'EXPECTED_READY' })
							} catch {
								self.send({ type: 'EXPECTED_FAILED' })
							}
						},
						on: {
							EXPECTED_READY: [
								{ guard: 'interrupted', target: '#test-app-restore-continuation.complete' },
								{ target: 'writingBatch' }
							],
							EXPECTED_FAILED: '#test-app-restore-continuation.complete'
						}
					},
					writingBatch: {
						on: {
							CANCEL: { actions: ['interrupt', forwardTo('effect')] },
							SHUTDOWN: { actions: ['interrupt', forwardTo('effect')] },
							INVALIDATE: { guard: 'currentBinding', actions: ['interrupt', forwardTo('effect')] }
						},

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
								target: '#test-app-restore-continuation.complete',
								actions: assign({ result: ({ event }) => event.output })
							},
							onError: '#test-app-restore-continuation.complete'
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
