import type { EventPayload } from '../../src/lib/contracts/machine-events.js'
import { setup, type Snapshot, types } from 'xstate'
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
	type Event =
		| RestoreEvent
		| {
				type: 'RELEASE' | 'CLAIMED' | 'CLAIM_FAILED' | 'EXPECTED_READY' | 'EXPECTED_FAILED'
		  }
	const model = setup({
		schemas: {
			output: types<TestAppContinuationResult<NotApplicable>>(),
			context: types<Context>(),
			events: {
				CANCEL: types<EventPayload<Event, 'CANCEL'>>(),
				SHUTDOWN: types<EventPayload<Event, 'SHUTDOWN'>>(),
				INVALIDATE: types<EventPayload<Event, 'INVALIDATE'>>(),
				RELEASE: types<EventPayload<Event, 'RELEASE'>>(),
				CLAIMED: types<EventPayload<Event, 'CLAIMED'>>(),
				CLAIM_FAILED: types<EventPayload<Event, 'CLAIM_FAILED'>>(),
				EXPECTED_READY: types<EventPayload<Event, 'EXPECTED_READY'>>(),
				EXPECTED_FAILED: types<EventPayload<Event, 'EXPECTED_FAILED'>>()
			},
			input: types<Input>()
		},
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
			interrupt: ({
				context,
				event
			}: {
				context: Context
				event:
					| RestoreEvent
					| { type: 'RELEASE' | 'CLAIMED' | 'CLAIM_FAILED' | 'EXPECTED_READY' | 'EXPECTED_FAILED' }
			}) => ({
				context: {
					interruption:
						context.interruption ??
						(event.type === 'SHUTDOWN'
							? 'closed'
							: event.type === 'INVALIDATE'
								? 'invalidated'
								: 'cancelled')
				}
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
			CANCEL: (args) => {
				return args.actions.interrupt(args)
			},
			SHUTDOWN: (args) => {
				return args.actions.interrupt(args)
			},
			INVALIDATE: (args) => {
				if (!args.guards.currentBinding(args)) return
				return args.actions.interrupt(args)
			},
			RELEASE: (args, enq) => {
				enq.raise({ type: 'CANCEL' })
			}
		},
		states: {
			claiming: {
				entry: ({ context, self }) => {
					self.send({ type: claimTestAppRestore(context) ? 'CLAIMED' : 'CLAIM_FAILED' })
				},
				on: { CLAIMED: { target: 'working' }, CLAIM_FAILED: { target: 'complete' } }
			},
			working: {
				initial: 'admittingResume',
				invoke: { src: 'resources', input, onError: { target: 'complete' } },
				states: {
					admittingResume: {
						always: (args) => {
							if (args.guards.interrupted(args)) {
								return { target: '#test-app-restore-continuation.complete' }
							}
							if (args.guards.resumeRequest(args)) {
								return { target: 'planning' }
							}
							return { target: '#test-app-restore-continuation.complete' }
						}
					},
					planning: {
						on: {
							CANCEL: (args, enq) => {
								enq.sendTo('effect', args.event)
								return args.actions.interrupt(args)
							},
							SHUTDOWN: (args, enq) => {
								enq.sendTo('effect', args.event)
								return args.actions.interrupt(args)
							},
							INVALIDATE: (args, enq) => {
								if (!args.guards.currentBinding(args)) return
								enq.sendTo('effect', args.event)
								return args.actions.interrupt(args)
							}
						},

						invoke: {
							id: 'effect',
							src: 'plan',
							input,
							onDone: (args) => {
								const { context } = args
								if (args.guards.interrupted(args)) {
									return { target: '#test-app-restore-continuation.complete' }
								}
								if (args.event.output.outcome === 'planned') {
									return {
										target: 'checkingRecovery',
										context: {
											result: {
												binding: context.binding,
												outcome: 'incomplete',
												record: data(context).observedJournal
											}
										}
									}
								}
								return { target: '#test-app-restore-continuation.complete' }
							},
							onError: { target: '#test-app-restore-continuation.complete' }
						}
					},
					checkingRecovery: {
						always: (args) => {
							if (args.guards.recoveryConflict(args)) {
								return { target: '#test-app-restore-continuation.conflict' }
							}
							if (args.guards.matchingIntent(args)) {
								return { target: 'checkingPreparation' }
							}
							return { target: '#test-app-restore-continuation.conflict' }
						}
					},
					checkingPreparation: {
						always: (args) => {
							if (args.guards.preparationComplete(args)) {
								return { target: 'selectingStep' }
							}
							return { target: '#test-app-restore-continuation.complete' }
						}
					},
					selectingStep: {
						always: (args) => {
							if (args.guards.currentStep(args)) {
								return { target: 'preparingExpected' }
							}
							return { target: '#test-app-restore-continuation.notApplicable' }
						}
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
							EXPECTED_READY: (args) => {
								if (args.guards.interrupted(args)) {
									return { target: '#test-app-restore-continuation.complete' }
								}
								return { target: 'writingBatch' }
							},
							EXPECTED_FAILED: { target: '#test-app-restore-continuation.complete' }
						}
					},
					writingBatch: {
						on: {
							CANCEL: (args, enq) => {
								enq.sendTo('effect', args.event)
								return args.actions.interrupt(args)
							},
							SHUTDOWN: (args, enq) => {
								enq.sendTo('effect', args.event)
								return args.actions.interrupt(args)
							},
							INVALIDATE: (args, enq) => {
								if (!args.guards.currentBinding(args)) return
								enq.sendTo('effect', args.event)
								return args.actions.interrupt(args)
							}
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
							onDone: (args) => {
								return {
									target: '#test-app-restore-continuation.complete',
									context: { result: args.event.output }
								}
							},
							onError: { target: '#test-app-restore-continuation.complete' }
						}
					}
				}
			},
			conflict: {
				type: 'final',
				entry: (args) => {
					return { context: { result: { ...args.context.result, outcome: 'conflict' } } }
				}
			},
			notApplicable: {
				type: 'final',
				entry: (args) => {
					return {
						context: { result: { ...args.context.result, outcome: continuation.notApplicable } }
					}
				}
			},
			complete: { type: 'final' }
		}
	})
}
