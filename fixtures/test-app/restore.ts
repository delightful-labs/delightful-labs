import type { EventPayload } from '../../src/lib/contracts/machine-events.js'
import { setup, type Snapshot, types } from 'xstate'
import { sameBackupBinding, type BackupBinding } from 'delightful-local-first/backup/binding'
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
	type Event = RestoreEvent | { type: 'RELEASE' | 'CLAIMED' | 'CLAIM_FAILED' }
	const model = setup({
		schemas: {
			output: types<RestoreResult>(),
			context: types<Context>(),
			events: {
				CANCEL: types<EventPayload<Event, 'CANCEL'>>(),
				SHUTDOWN: types<EventPayload<Event, 'SHUTDOWN'>>(),
				INVALIDATE: types<EventPayload<Event, 'INVALIDATE'>>(),
				RELEASE: types<EventPayload<Event, 'RELEASE'>>(),
				CLAIMED: types<EventPayload<Event, 'CLAIMED'>>(),
				CLAIM_FAILED: types<EventPayload<Event, 'CLAIM_FAILED'>>()
			},
			input: types<Input>()
		},
		actors,
		guards: {
			interrupted: ({ context }) => context.interruption !== undefined,
			currentBinding: ({ context, event }) =>
				event.type === 'INVALIDATE' && sameBackupBinding(context.binding, event.binding)
		},
		actions: {
			interrupt: ({ context, event }: { context: Context; event: Event }) => ({
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
				entry: ({ context, self }) =>
					self.send({ type: claimTestAppRestore(context) ? 'CLAIMED' : 'CLAIM_FAILED' }),
				on: { CLAIMED: { target: 'working' }, CLAIM_FAILED: { target: 'complete' } }
			},
			working: {
				initial: 'planning',
				invoke: { src: 'resources', input, onError: { target: 'complete' } },
				states: {
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
								if (args.guards.interrupted(args)) {
									return { target: '#test-app-restore-preparation.complete' }
								}
								if (args.event.output.outcome === 'planned') {
									return { target: 'preparingDestination' }
								}
								return { target: '#test-app-restore-preparation.complete' }
							},
							onError: { target: '#test-app-restore-preparation.complete' }
						}
					},
					preparingDestination: {
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
							src: 'prepare',
							input: ({ context }) => ({
								binding: context.binding,
								databaseName: context.databaseName,
								writeId: required(data(context).intent).plan.preparation.writeId,
								intent: required(data(context).intent)
							}),
							onDone: (args) => {
								return {
									target: '#test-app-restore-preparation.complete',
									context: { result: args.event.output }
								}
							},
							onError: { target: '#test-app-restore-preparation.complete' }
						}
					}
				}
			},
			complete: { type: 'final' }
		}
	})
}
