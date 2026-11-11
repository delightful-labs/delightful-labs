import { createBankOperationMachine, type OperationResult } from './operation.js'
import { createPreparationMachine, type PreparedScope } from './preparation.js'
import { createSyncLogMachine } from './sync-log.js'
import { required } from './identity.js'
import {
	emptyCounts,
	bankErrorCode,
	type BankCommand,
	type Dependencies,
	type ProviderSummary,
	type RequestIdentity,
	type ProgressEvent,
	type LockEvent
} from './types.js'
import type {
	SyncLogStart,
	SyncLogCompletion,
	SyncLogOutput,
	SyncLogParentEvent,
	SyncLogEvent,
	SyncLogAccountResult
} from '#lib/contracts/bank-sync-log.js'
import { setup, types, matchesState, createAsyncLogic } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'

type Input = { command: BankCommand; discovered: ProviderSummary[] }
export type LoggedOperationResult = OperationResult & { logging: SyncLogOutput | undefined }
type FinishCommand = Extract<SyncLogEvent, { type: 'FINISH' }>
type Context = Input & {
	identity: RequestIdentity
	start: SyncLogStart | undefined
	completion: FinishCommand | undefined
	result: OperationResult | undefined
	logging: SyncLogOutput | undefined
}
function failure(error: unknown): OperationResult {
	return {
		kind: 'failed',
		error,
		counts: emptyCounts(),
		discovered: undefined,
		settlement: 'settled',
		accountResults: []
	}
}
function cancelled(): OperationResult {
	return {
		kind: 'cancelled',
		error: undefined,
		counts: emptyCounts(),
		discovered: undefined,
		settlement: 'settled',
		accountResults: []
	}
}
function operationInput(context: Context) {
	return { command: context.command, discovered: context.discovered, identity: context.identity }
}
function operationCrash(error: unknown): OperationResult {
	return { ...failure(error), settlement: 'unresolved' }
}
function startLogFailure(context: Context): SyncLogOutput {
	return { kind: 'notStarted', attemptId: required(context.start).id, reason: 'startWriteFailed' }
}
const failureCodes: Readonly<Record<string, NonNullable<SyncLogCompletion['failureCode']>>> = {
	unlock_failure: 'passkey',
	passkey_failure: 'passkey',
	provider_failure: 'provider',
	mapping: 'mapping',
	other_tab: 'interrupted'
}
function finishedLog(result: OperationResult, finishedAt: Date): FinishCommand {
	const reports = result.accountResults
	const accounts: SyncLogAccountResult[] = []
	for (const report of reports) {
		if (report.account)
			accounts.push({
				accountId: report.account.id,
				accountName: report.account.name,
				outcome:
					report.kind === 'complete'
						? report.counts.omitted > 0
							? 'partial'
							: 'succeeded'
						: report.kind,
				importedCount: report.counts.imported,
				existingCount: report.counts.existing,
				omittedCount: report.counts.omitted,
				failureCode: report.kind === 'failed' ? 'import' : null
			})
	}
	const countsKnown = reports.length > 0 || result.kind === 'complete' || result.kind === 'partial'
	return {
		type: 'FINISH',
		accounts,
		result: {
			outcome: result.kind === 'complete' ? 'succeeded' : result.kind,
			finishedAt,
			importSettlement:
				result.settlement === 'unresolved'
					? 'unresolved'
					: result.counts.imported > 0
						? 'locallyPersisted'
						: 'notStarted',
			failureCode:
				result.kind === 'failed'
					? (failureCodes[bankErrorCode(result.error)] ??
						(reports.some((report) => report.kind === 'failed') ? 'import' : 'unexpected'))
					: null,
			importedCount: countsKnown ? result.counts.imported : null,
			existingCount: countsKnown ? result.counts.existing : null,
			omittedCount: countsKnown ? result.counts.omitted : null
		}
	}
}

/** Supervises logging; the existing operation retains ownership of locks and credentials. */
export function createLoggedBankOperationMachine(dependencies: Dependencies) {
	const actors = {
		allocateStart: createAsyncLogic<SyncLogStart, PreparedScope>({
			run: async ({ input }) => ({
				id: crypto.randomUUID(),
				organizationId: input.scope.organizationId,
				connectionId: input.scope.connectionId,
				initiatedBy: input.scope.ownerId,
				startedAt: new Date()
			})
		}),
		allocateCompletion: createAsyncLogic<
			FinishCommand,
			{ result: OperationResult; completion: FinishCommand | undefined }
		>({
			run: async ({ input }) => input.completion ?? finishedLog(input.result, new Date())
		}),
		prepare: createPreparationMachine(dependencies),
		log: createSyncLogMachine(dependencies),
		operation: createBankOperationMachine(dependencies)
	}
	const events0 = {
		CANCEL:
			types<
				EventPayload<
					| { type: 'CANCEL' }
					| { type: 'LOG_FAILED' }
					| ProgressEvent
					| SyncLogParentEvent
					| LockEvent,
					'CANCEL'
				>
			>(),
		LOG_FAILED:
			types<
				EventPayload<
					| { type: 'CANCEL' }
					| { type: 'LOG_FAILED' }
					| ProgressEvent
					| SyncLogParentEvent
					| LockEvent,
					'LOG_FAILED'
				>
			>(),
		IMPORT_PROGRESS:
			types<
				EventPayload<
					| { type: 'CANCEL' }
					| { type: 'LOG_FAILED' }
					| ProgressEvent
					| SyncLogParentEvent
					| LockEvent,
					'IMPORT_PROGRESS'
				>
			>(),
		SYNC_LOG_READY:
			types<
				EventPayload<
					| { type: 'CANCEL' }
					| { type: 'LOG_FAILED' }
					| ProgressEvent
					| SyncLogParentEvent
					| LockEvent,
					'SYNC_LOG_READY'
				>
			>(),
		LOCK_ACQUIRED:
			types<
				EventPayload<
					| { type: 'CANCEL' }
					| { type: 'LOG_FAILED' }
					| ProgressEvent
					| SyncLogParentEvent
					| LockEvent,
					'LOCK_ACQUIRED'
				>
			>(),
		LOCK_FAILED:
			types<
				EventPayload<
					| { type: 'CANCEL' }
					| { type: 'LOG_FAILED' }
					| ProgressEvent
					| SyncLogParentEvent
					| LockEvent,
					'LOCK_FAILED'
				>
			>()
	}
	type NativeEvent0 =
		| import('xstate').InferEvents<typeof events0>
		| import('xstate').DoneActorEvent<
				| import('xstate').OutputFrom<(typeof actors)['prepare']>
				| import('xstate').OutputFrom<(typeof actors)['log']>
				| import('xstate').OutputFrom<(typeof actors)['operation']>
		  >
		| import('xstate').ErrorActorEvent
	const workflow = setup({
		schemas: {
			context: types<Context>(),
			events: events0,
			input: types<Input>(),
			output: types<LoggedOperationResult>(),
			children: {
				prepare: types<import('xstate').ActorRefFrom<(typeof actors)['prepare']>>(),
				allocateStart: types<import('xstate').ActorRefFrom<(typeof actors)['allocateStart']>>(),
				allocateCompletion:
					types<import('xstate').ActorRefFrom<(typeof actors)['allocateCompletion']>>(),
				log: types<import('xstate').ActorRefFrom<(typeof actors)['log']>>(),
				operation: types<import('xstate').ActorRefFrom<(typeof actors)['operation']>>()
			}
		},
		states: {
			choosing: {},
			unlogged: { id: 'logged-bank-operation.unlogged', states: { working: {}, cancelling: {} } },
			preparing: {},
			allocatingStart: { schemas: { input: types<PreparedScope>() } },
			logged: {
				states: {
					starting: {},
					cancellingStart: {},
					operating: { states: { working: {}, cancelling: {}, logFailed: {} } },
					resultLogFailed: {},
					finishing: { states: { preparing: {}, waiting: {} } }
				}
			},
			done: { id: 'logged-bank-operation.done', type: 'final' }
		},
		actors,
		guards: {
			logFailed: (args: { value: import('xstate').StateValue }) =>
				matchesState({ logged: { operating: 'logFailed' } }, args.value)
		},
		delays: { logDeadline: 5000 }
	})
	// A deadline stops waiting; it does not abort or retry the issued Jazz write.
	const startFailure = ({
		context
	}: {
		context: Context
	}): { target: '#logged-bank-operation.unlogged'; context: Pick<Context, 'logging'> } => ({
		target: '#logged-bank-operation.unlogged',
		context: { logging: startLogFailure(context) }
	})
	const cancelledStartFailure = ({
		context
	}: {
		context: Context
	}): { target: '#logged-bank-operation.done'; context: Pick<Context, 'logging' | 'result'> } => ({
		target: '#logged-bank-operation.done',
		context: { result: cancelled(), logging: startLogFailure(context) }
	})
	return workflow.createMachine({
		id: 'logged-bank-operation',
		context: ({ input }) => {
			const observed = dependencies.observe()
			return {
				...input,
				identity: { userId: observed.userId, organizationId: observed.organizationId },
				start: undefined,
				completion: undefined,
				result: undefined,
				logging: undefined
			}
		},
		initial: 'choosing',
		output: ({ context }) => ({ ...required(context.result), logging: context.logging }),
		on: {
			IMPORT_PROGRESS: (args, enq) => {
				const { event } = args
				enq.sendTo(args.parent, event)
			}
		},
		states: {
			choosing: {
				always: (args) => {
					if (args.context.command.type === 'SYNC') {
						return { target: 'preparing' }
					}
					return { target: 'unlogged' }
				}
			},
			unlogged: {
				initial: 'working',
				states: { working: {}, cancelling: {} },
				on: {
					CANCEL: (args, enq) => {
						enq.sendTo('operation', { type: 'CANCEL' })
						return { target: '.cancelling' }
					},
					LOCK_FAILED: (args, enq) => {
						const { event } = args
						enq.sendTo('operation', event)
					}
				},
				invoke: {
					id: 'operation',
					src: 'operation',
					input: ({ context }) => operationInput(context),
					onSnapshot: {},
					onDone: (args) => {
						return { target: 'done', context: { result: args.event.output } }
					},
					onError: (args) => {
						return { target: 'done', context: { result: operationCrash(args.event.error) } }
					}
				}
			},
			preparing: {
				on: {
					CANCEL: () => {
						return { target: 'done', context: { result: cancelled() } }
					}
				},
				invoke: {
					src: 'prepare',
					input: ({ context }) => ({ identity: context.identity, requireConnection: true }),
					onDone: (args) => {
						const { event } = args
						if (!event.output.ok) {
							return {
								target: 'done',
								context: { result: failure(event.output.ok ? undefined : event.output.error) }
							}
						}
						return { target: 'allocatingStart', input: event.output.value }
					},
					onError: (args) => {
						return { target: 'done', context: { result: failure(args.event.error) } }
					}
				}
			},
			allocatingStart: {
				on: { CANCEL: () => ({ target: 'done', context: { result: cancelled() } }) },
				invoke: {
					id: 'allocateStart',
					src: 'allocateStart',
					input: ({ input }) => input,
					onDone: ({ event }) => ({ target: 'logged', context: { start: event.output } }),
					onError: ({ event }) => ({ target: 'done', context: { result: failure(event.error) } })
				}
			},
			logged: {
				initial: 'starting',
				invoke: {
					id: 'log',
					src: 'log',
					input: ({ context }) => required(context.start),
					onError: (args, enq) => {
						enq.raise({ type: 'LOG_FAILED' })
					},
					onDone: (args) => {
						const { event } = args
						if (
							matchesState({ logged: 'starting' }, args.value) &&
							event.output.kind === 'notStarted'
						) {
							return { target: 'unlogged', context: { logging: event.output } }
						}
						return {
							target: 'done',
							context: { logging: event.output, result: args.context.result ?? cancelled() }
						}
					}
				},
				states: {
					starting: {
						after: { logDeadline: startFailure },
						on: {
							LOG_FAILED: startFailure,
							SYNC_LOG_READY: (args) => {
								if (!(args.event.attemptId === args.context.start?.id)) return
								return { target: 'operating' }
							},
							CANCEL: (args, enq) => {
								enq.sendTo('log', { type: 'CANCEL' })
								return { target: 'cancellingStart' }
							}
						}
					},
					cancellingStart: {
						after: { logDeadline: cancelledStartFailure },
						on: {
							LOG_FAILED: cancelledStartFailure,
							CANCEL: {},
							SYNC_LOG_READY: (args) => {
								if (args.event.attemptId !== args.context.start?.id) return
								return { target: 'finishing', context: { result: cancelled() } }
							}
						}
					},
					operating: {
						initial: 'working',
						states: {
							working: {},
							cancelling: {},
							logFailed: {
								on: {
									CANCEL: (args, enq) => {
										enq.sendTo('operation', { type: 'CANCEL' })
									}
								}
							}
						},
						on: {
							LOG_FAILED: { target: '.logFailed' },
							LOCK_FAILED: (args, enq) => {
								const { event } = args
								enq.sendTo('operation', event)
							},
							CANCEL: (args, enq) => {
								enq.sendTo('operation', { type: 'CANCEL' })
								enq.sendTo('log', { type: 'CANCEL' })
								return { target: '.cancelling' }
							}
						},
						invoke: {
							id: 'operation',
							src: 'operation',
							input: ({ context }) => operationInput(context),
							onSnapshot: {},
							onDone: (args) => {
								const { event } = args
								if (matchesState({ logged: { operating: 'logFailed' } }, args.value)) {
									return { target: 'resultLogFailed', context: { result: event.output } }
								}
								return { target: 'finishing', context: { result: event.output } }
							},
							onError: (args) => {
								const { event } = args
								if (matchesState({ logged: { operating: 'logFailed' } }, args.value)) {
									return {
										target: 'resultLogFailed',
										context: { result: operationCrash(event.error) }
									}
								}
								return { target: 'finishing', context: { result: operationCrash(event.error) } }
							}
						}
					},
					resultLogFailed: {
						invoke: {
							id: 'allocateCompletion',
							src: 'allocateCompletion',
							input: ({ context }) => ({
								result: required(context.result),
								completion: context.completion
							}),
							onDone: ({ context, event }) => ({
								target: '#logged-bank-operation.done',
								context: {
									completion: event.output,
									logging: {
										kind: 'resultUnrecorded',
										attemptId: required(context.start).id,
										result: event.output.result,
										reason: 'resultWriteFailed'
									}
								}
							})
						}
					},
					finishing: {
						after: { logDeadline: { target: 'resultLogFailed' } },
						on: { CANCEL: {}, LOG_FAILED: { target: 'resultLogFailed' } },
						initial: 'preparing',
						states: {
							preparing: {
								invoke: {
									id: 'allocateCompletion',
									src: 'allocateCompletion',
									input: ({ context }) => ({
										result: required(context.result),
										completion: context.completion
									}),
									onDone: ({ event }, enq) => {
										enq.sendTo('log', event.output)
										return { target: 'waiting', context: { completion: event.output } }
									}
								}
							},
							waiting: {}
						}
					}
				}
			},
			done: { type: 'final' }
		}
	})
}
