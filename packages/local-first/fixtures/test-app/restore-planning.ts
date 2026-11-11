import type { EventPayload } from './restore-events.js'
import { setup, createAsyncLogic, types } from 'xstate'
import { sameBackupBinding, type BackupBinding } from 'delightful-local-first/backup/binding'
import type { RestoreEvent } from 'delightful-local-first/backup/restore'
import { createRestoreJournalStepMachine } from 'delightful-local-first/backup/restore/workflow'
import { testAppProfile } from './profile.js'
import {
	allocateTestAppMappings,
	buildTestAppIntent,
	hashTestAppProjection,
	testAppCanonical,
	testAppPlan,
	projectTestAppControl,
	projectTestAppGraph
} from './restore-plan.js'
import {
	testAppRestoreData as data,
	requiredTestAppRestoreValue as required,
	type TestAppRestoreRequest
} from './restore-request.js'

// One synchronous pure operation per boundary; routing and failures remain visible in the chart.
function planningSucceeded(operation: () => boolean | void): boolean {
	try {
		return operation() !== false
	} catch {
		return false
	}
}
type Input = { request: TestAppRestoreRequest }
type Result = { outcome: 'planned' | 'unavailable' | 'cancelled' | 'closed' | 'invalidated' }
/** Finite planner; its parent owns the checked archive and all content-bearing capsule references. */
export function createTestAppRestorePlanningMachine() {
	type Context = Input & {
		binding: BackupBinding
		mode: 'new' | 'resume'
		databaseName: string
		index: number
		planningSucceeded: boolean
		planSha256: string
		interruption: 'cancelled' | 'closed' | 'invalidated' | undefined
		outcome: 'planned' | 'unavailable'
	}
	const actors = {
		discover: createRestoreJournalStepMachine(),
		graphHash: createAsyncLogic<string, Input>({
			run: ({ input }) => hashTestAppProjection(data(input).graph)
		}),
		preparationHash: createAsyncLogic<string, Input>({
			run: ({ input }) => hashTestAppProjection(data(input).preparation)
		}),
		batchHash: createAsyncLogic<string, Input & { index: number }>({
			run: ({ input }) => hashTestAppProjection(required(data(input).batches[input.index]).contents)
		}),
		activationHash: createAsyncLogic<string, Input>({
			run: ({ input }) => hashTestAppProjection(data(input).activation)
		}),
		planHash: createAsyncLogic<string, Input>({
			run: ({ input }) => hashTestAppProjection(testAppCanonical(testAppPlan(data(input))))
		})
	}
	type Event =
		| RestoreEvent
		| { type: 'PLANNING_DONE'; success: boolean }
		| { type: 'PLANNING_APPLIED' }
	const model = setup({
		schemas: {
			output: types<Result>(),
			context: types<Context>(),
			events: {
				CANCEL: types<EventPayload<Event, 'CANCEL'>>(),
				SHUTDOWN: types<EventPayload<Event, 'SHUTDOWN'>>(),
				INVALIDATE: types<EventPayload<Event, 'INVALIDATE'>>(),
				PLANNING_DONE: types<EventPayload<Event, 'PLANNING_DONE'>>(),
				PLANNING_APPLIED: types<EventPayload<Event, 'PLANNING_APPLIED'>>()
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
			interrupt: ({
				context,
				event
			}: {
				context: Context
				event:
					| RestoreEvent
					| { type: 'PLANNING_DONE'; success: boolean }
					| { type: 'PLANNING_APPLIED' }
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
	type Entry = Extract<
		NonNullable<Parameters<typeof model.createStateConfig>[0]['entry']>,
		(...args: never[]) => unknown
	>
	const synchronous =
		(operation: (context: Context) => boolean | void): Entry =>
		({ context, self }, enq) => {
			enq(() =>
				self.send({ type: 'PLANNING_DONE', success: planningSucceeded(() => operation(context)) })
			)
		}
	const input = ({ context }: { context: Context }) => ({ request: context.request })
	return model.createMachine({
		id: 'test-app-restore-plan',
		initial: 'validating',
		context: ({ input }) => {
			const options = required(data(input).options)
			return {
				request: input.request,
				binding: options.binding,
				mode: options.mode,
				databaseName: options.databaseName,
				index: 0,
				planSha256: '',
				planningSucceeded: false,
				interruption: undefined,
				outcome: 'unavailable'
			}
		},
		output: ({ context }) => ({ outcome: context.interruption ?? context.outcome }),
		on: {
			PLANNING_DONE: (args, enq) => {
				const { event } = args
				enq.raise({ type: 'PLANNING_APPLIED' })
				return {
					context: {
						planningSucceeded:
							event.type === 'PLANNING_DONE' ? event.success : args.context.planningSucceeded
					}
				}
			},
			CANCEL: (args) => {
				return args.actions.interrupt(args)
			},
			SHUTDOWN: (args) => {
				return args.actions.interrupt(args)
			},
			INVALIDATE: (args) => {
				if (!args.guards.currentBinding(args)) return
				return args.actions.interrupt(args)
			}
		},
		states: {
			validating: {
				entry: synchronous((context) =>
					testAppProfile.validate(data(context).archive.readPayload())
				),
				on: {
					PLANNING_APPLIED: (args) => {
						const { context } = args
						if (args.guards.interrupted(args)) {
							return { target: '#test-app-restore-plan.complete' }
						}
						if (context.planningSucceeded && context.mode === 'new') {
							return { target: 'allocating' }
						}
						if (context.planningSucceeded) {
							return { target: 'discovering' }
						}
						return { target: '#test-app-restore-plan.complete' }
					}
				}
			},
			discovering: {
				invoke: {
					src: 'discover',
					input: ({ context }) => ({
						binding: context.binding,
						databaseName: context.databaseName,
						command: { mode: 'discover' }
					}),
					onDone: (args, enq) => {
						const { event } = args
						if (args.guards.interrupted(args)) {
							return { target: '#test-app-restore-plan.complete' }
						}
						if (event.output.outcome === 'loaded' && event.output.record !== undefined) {
							enq(() => {
								const { context, event } = args
								const record = required(event.output.record)
								data(context).mappings = record.intent.plan.mappings
								data(context).observedJournal = record
							})
							return { target: 'projecting' }
						}
						return { target: '#test-app-restore-plan.complete' }
					},
					onError: { target: '#test-app-restore-plan.complete' }
				}
			},
			allocating: {
				entry: synchronous((context) => {
					const value = data(context)
					value.mappings = allocateTestAppMappings(value.archive.readPayload())
				}),
				on: {
					PLANNING_APPLIED: (args) => {
						if (args.guards.interrupted(args)) {
							return { target: '#test-app-restore-plan.complete' }
						}
						if (args.context.planningSucceeded) {
							return { target: 'projecting' }
						}
						return { target: '#test-app-restore-plan.complete' }
					}
				}
			},
			projecting: {
				entry: synchronous((context) => {
					projectTestAppGraph(data(context), data(context).observedJournal?.intent.plan)
				}),
				on: {
					PLANNING_APPLIED: (args) => {
						if (args.guards.interrupted(args)) {
							return { target: '#test-app-restore-plan.complete' }
						}
						if (args.context.planningSucceeded) {
							return { target: 'hashingGraph' }
						}
						return { target: '#test-app-restore-plan.complete' }
					}
				}
			},
			hashingGraph: {
				invoke: {
					src: 'graphHash',
					input,
					onDone: (args, enq) => {
						if (args.guards.interrupted(args)) {
							return { target: '#test-app-restore-plan.complete' }
						}
						enq(() => {
							const { context, event } = args
							data(context).graphSha256 = event.output
						})
						return { target: 'projectingControl' }
					},
					onError: { target: '#test-app-restore-plan.complete' }
				}
			},
			projectingControl: {
				entry: synchronous((context) => {
					projectTestAppControl(data(context))
				}),
				on: {
					PLANNING_APPLIED: (args) => {
						if (args.guards.interrupted(args)) {
							return { target: '#test-app-restore-plan.complete' }
						}
						if (args.context.planningSucceeded) {
							return { target: 'hashingPreparation' }
						}
						return { target: '#test-app-restore-plan.complete' }
					}
				}
			},
			hashingPreparation: {
				invoke: {
					src: 'preparationHash',
					input,
					onDone: (args, enq) => {
						if (args.guards.interrupted(args)) {
							return { target: '#test-app-restore-plan.complete' }
						}
						enq(() => {
							const { context, event } = args
							data(context).preparationSha256 = event.output
						})
						return { target: 'hashingBatch' }
					},
					onError: { target: '#test-app-restore-plan.complete' }
				}
			},
			hashingBatch: {
				invoke: {
					src: 'batchHash',
					input: ({ context }) => ({ ...input({ context }), index: context.index }),
					onDone: (args, enq) => {
						const { context } = args
						if (args.guards.interrupted(args)) {
							return { target: '#test-app-restore-plan.complete' }
						}
						if (context.index + 1 < data(context).batches.length) {
							enq(() => {
								const { context, event } = args
								required(data(context).batches[context.index]).sha256 = event.output
							})
							return {
								target: 'hashingBatch',
								reenter: true,
								context: { index: context.index + 1 }
							}
						}
						enq(() => {
							const { context, event } = args
							required(data(context).batches[context.index]).sha256 = event.output
						})
						return { target: 'hashingActivation' }
					},
					onError: { target: '#test-app-restore-plan.complete' }
				}
			},
			hashingActivation: {
				invoke: {
					src: 'activationHash',
					input,
					onDone: (args, enq) => {
						if (args.guards.interrupted(args)) {
							return { target: '#test-app-restore-plan.complete' }
						}
						enq(() => {
							const { context, event } = args
							data(context).activationSha256 = event.output
						})
						return { target: 'hashingPlan' }
					},
					onError: { target: '#test-app-restore-plan.complete' }
				}
			},
			hashingPlan: {
				invoke: {
					src: 'planHash',
					input,
					onDone: (args) => {
						if (args.guards.interrupted(args)) {
							return { target: '#test-app-restore-plan.complete' }
						}
						return { target: 'buildingIntent', context: { planSha256: args.event.output } }
					},
					onError: { target: '#test-app-restore-plan.complete' }
				}
			},
			buildingIntent: {
				entry: synchronous((context) => {
					const value = data(context)
					value.intent = buildTestAppIntent(value, context.planSha256)
				}),
				on: {
					PLANNING_APPLIED: (args) => {
						if (args.guards.interrupted(args)) {
							return { target: '#test-app-restore-plan.complete' }
						}
						if (args.context.planningSucceeded) {
							return { target: 'planned' }
						}
						return { target: '#test-app-restore-plan.complete' }
					}
				}
			},
			planned: {
				type: 'final',
				entry: () => {
					return { context: { outcome: 'planned' } }
				}
			},
			complete: { type: 'final' }
		}
	})
}
