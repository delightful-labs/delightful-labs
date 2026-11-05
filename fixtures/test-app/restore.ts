import { forwardTo, raise, assign, setup, type Snapshot } from 'xstate'
import { sameBackupBinding, type BackupBinding } from 'delightful-local-first/backup/export'
import type {
	RestoreEvent,
	RestoreResult,
	RestoreTransactionWriter,
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
export { prepareTestAppRestore } from './restore-request.js'
export type { TestAppRestoreRequest } from './restore-request.js'

/** The root owns checked-archive references until planning and the active destination child drain. */
export function createTestAppRestorePreparationMachine<
	Transaction,
	Write,
	S extends Snapshot<RestoreDestinationResult>
>(
	writer: RestoreTransactionWriter<Transaction, Write>,
	destination: RestoreDestinationLogic<Transaction, S>
) {
	type Input = { request: TestAppRestoreRequest }
	type Context = Input & {
		binding: BackupBinding
		databaseName: string
		interruption: 'cancelled' | 'closed' | 'invalidated' | undefined
		result: RestoreResult
	}
	const actors = {
		resources: testAppRestoreResources,
		plan: createTestAppRestorePlanningMachine(),
		prepare: createRestoreMachine(writer, destination)
	}
	const model = setup<
		Context,
		RestoreEvent | { type: 'RELEASE' | 'CLAIMED' | 'CLAIM_FAILED' },
		typeof actors,
		{},
		{ interrupt: undefined },
		{ interrupted: undefined; currentBinding: undefined },
		never,
		string,
		Input,
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
		id: 'test-app-restore-preparation',
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
				entry: ({ context, self }) =>
					self.send({ type: claimTestAppRestore(context) ? 'CLAIMED' : 'CLAIM_FAILED' }),
				on: { CLAIMED: 'working', CLAIM_FAILED: 'complete' }
			},
			working: {
				initial: 'planning',
				invoke: { src: 'resources', input, onError: 'complete' },
				states: {
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
								{ guard: 'interrupted', target: '#test-app-restore-preparation.complete' },
								{
									guard: ({ event }) => event.output.outcome === 'planned',
									target: 'preparingDestination'
								},
								{ target: '#test-app-restore-preparation.complete' }
							],
							onError: '#test-app-restore-preparation.complete'
						}
					},
					preparingDestination: {
						on: {
							CANCEL: { actions: ['interrupt', forwardTo('effect')] },
							SHUTDOWN: { actions: ['interrupt', forwardTo('effect')] },
							INVALIDATE: { guard: 'currentBinding', actions: ['interrupt', forwardTo('effect')] }
						},

						invoke: {
							id: 'effect',
							src: 'prepare',
							input: ({ context }) => ({
								binding: context.binding,
								databaseName: context.databaseName,
								writeId: required(data(context).intent).plan.preparation.writeId,
								intent: required(data(context).intent)
							}),
							onDone: {
								target: '#test-app-restore-preparation.complete',
								actions: assign({ result: ({ event }) => event.output })
							},
							onError: '#test-app-restore-preparation.complete'
						}
					}
				}
			},
			complete: { type: 'final' }
		}
	})
}
