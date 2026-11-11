import { app } from '#lib/schema.js'
import { syncAttemptSchema, syncAccountCompletionSchema } from '#lib/validation/bank-sync-log.js'
import { stableUuid } from '#lib/data.js'
import type {
	SyncLogStart,
	SyncLogCompletion,
	SyncLogEvent,
	SyncLogOutput,
	SyncLogParentEvent,
	SyncLogAccountResult
} from '#lib/contracts/bank-sync-log.js'
import type { Dependencies } from './types.js'
import { setup, types, createAsyncLogic, matchesState } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'

type Context = {
	start: SyncLogStart
	result: SyncLogCompletion | undefined
	output: SyncLogOutput | undefined
	accounts: readonly SyncLogAccountResult[]
	accountIndex: number
	accountRowId: string | undefined
}
function accountValues(context: Context) {
	const account = context.accounts[context.accountIndex]
	if (!account) throw new Error('Missing account log result')
	return { ...account, attemptId: context.start.id, organizationId: context.start.organizationId }
}
function initialValues(start: SyncLogStart) {
	return {
		organizationId: start.organizationId,
		connectionId: start.connectionId,
		initiatedBy: start.initiatedBy,
		startedAt: start.startedAt,
		finishedAt: null,
		outcome: 'unfinished',
		importSettlement: 'notStarted',
		failureCode: null,
		importedCount: null,
		existingCount: null,
		omittedCount: null
	}
}
function completion(context: Context) {
	if (!context.result) throw new Error('Missing sync result')
	return context.result
}

function logFailure(
	context: Context,
	reason: Exclude<SyncLogOutput, { kind: 'recorded' }>['reason']
): SyncLogOutput {
	const attemptId = context.start.id
	return reason === 'invalidStart' || reason === 'startWriteFailed'
		? { kind: 'notStarted', attemptId, reason }
		: { kind: 'resultUnrecorded', attemptId, result: completion(context), reason }
}

/** Owns log writes only. The bank operation retains credentials, locks and import cleanup. */
export function createSyncLogMachine({ db }: Pick<Dependencies, 'db'>) {
	const actors = {
		dateCancellation: createAsyncLogic<SyncLogCompletion, undefined>({
			run: async () => ({
				outcome: 'cancelled',
				finishedAt: new Date(),
				importSettlement: 'notStarted',
				failureCode: null,
				importedCount: null,
				existingCount: null,
				omittedCount: null
			})
		}),
		accountId: createAsyncLogic<string, { attemptId: string; accountId: string }>({
			run: ({ input }) => stableUuid(input.attemptId, `sync-account:${input.accountId}`)
		}),
		recordAccount: createAsyncLogic<void, { id: string; values: ReturnType<typeof accountValues> }>(
			{
				run: async ({ input }) => {
					await db
						.insert(app.simplefinSyncAccountResults, input.values, { id: input.id })
						.wait({ tier: 'local' })
				}
			}
		),
		recordStart: createAsyncLogic<void, SyncLogStart>({
			run: async ({ input }) => {
				await db
					.insert(app.simplefinSyncAttempts, syncAttemptSchema.parse(initialValues(input)), {
						id: input.id
					})
					.wait({ tier: 'local' })
			}
		}),
		recordResult: createAsyncLogic<void, { start: SyncLogStart; result: SyncLogCompletion }>({
			run: async ({ input }) => {
				await db
					.update(app.simplefinSyncAttempts, input.start.id, input.result)
					.wait({ tier: 'local' })
			}
		})
	}
	const events0 = {
		CANCEL: types<EventPayload<SyncLogEvent, 'CANCEL'>>(),
		FINISH: types<EventPayload<SyncLogEvent, 'FINISH'>>()
	}
	type NativeEvent0 =
		| import('xstate').InferEvents<typeof events0>
		| import('xstate').DoneActorEvent<
				| import('xstate').OutputFrom<(typeof actors)['accountId']>
				| import('xstate').OutputFrom<(typeof actors)['recordAccount']>
				| import('xstate').OutputFrom<(typeof actors)['recordStart']>
				| import('xstate').OutputFrom<(typeof actors)['recordResult']>
		  >
		| import('xstate').ErrorActorEvent
	return setup({
		schemas: {
			context: types<Context>(),
			events: events0,
			input: types<SyncLogStart>(),
			output: types<SyncLogOutput>(),
			children: {
				accountId: types<import('xstate').ActorRefFrom<(typeof actors)['accountId']>>(),
				dateCancellation:
					types<import('xstate').ActorRefFrom<(typeof actors)['dateCancellation']>>(),
				recordAccount: types<import('xstate').ActorRefFrom<(typeof actors)['recordAccount']>>(),
				recordStart: types<import('xstate').ActorRefFrom<(typeof actors)['recordStart']>>(),
				recordResult: types<import('xstate').ActorRefFrom<(typeof actors)['recordResult']>>()
			}
		},
		actors,
		guards: {}
	}).createMachine({
		id: 'bank-sync-log',
		context: ({ input }) => ({
			start: input,
			result: undefined,
			output: undefined,
			accounts: [],
			accountIndex: 0,
			accountRowId: undefined
		}),
		initial: 'validatingStart',
		output: ({ context }) => {
			if (!context.output) throw new Error('Missing sync log output')
			return context.output
		},
		states: {
			validatingStart: {
				always: (args) => {
					if (syncAttemptSchema.safeParse(initialValues(args.context.start)).success) {
						return { target: 'recordingStart' }
					}
					return { target: 'invalidStart' }
				},
				on: { CANCEL: { target: 'invalidStart' } }
			},
			recordingStart: {
				initial: 'working',
				states: { working: { on: { CANCEL: { target: 'cancelling' } } }, cancelling: {} },
				invoke: {
					src: 'recordStart',
					input: ({ context }) => context.start,
					onDone: (args) => {
						if (matchesState({ recordingStart: 'cancelling' }, args.value)) {
							return { target: 'datingCancellation' }
						}
						return { target: 'awaitingResult' }
					},
					onError: { target: 'startWriteFailed' }
				}
			},
			datingCancellation: {
				on: { CANCEL: {} },
				invoke: {
					id: 'dateCancellation',
					src: 'dateCancellation',
					onDone: ({ event }) => ({ target: 'validatingResult', context: { result: event.output } })
				}
			},
			awaitingResult: {
				initial: 'working',
				entry: (args, enq) => {
					enq.sendTo(args.parent, {
						type: 'SYNC_LOG_READY',
						attemptId: args.context.start.id
					})
				},
				states: { working: { on: { CANCEL: { target: 'cancelling' } } }, cancelling: {} },
				// Cancellation requests do not invent an import outcome. Wait for the operation's drained result.
				on: {
					FINISH: (args) => {
						const { event } = args
						return {
							target: 'validatingResult',
							context: { result: event.result, accounts: event.accounts ?? [] }
						}
					}
				}
			},
			validatingResult: {
				always: (args) => {
					const { context } = args
					if (
						syncAttemptSchema.safeParse({
							...initialValues(context.start),
							...completion(context)
						}).success &&
						new Set(context.accounts.map((account) => account.accountId)).size ===
							context.accounts.length &&
						context.accounts.every(
							(account) =>
								syncAccountCompletionSchema.safeParse({
									...account,
									attemptId: context.start.id,
									organizationId: context.start.organizationId
								}).success
						)
					) {
						return { target: 'nextAccount' }
					}
					return { target: 'invalidResult' }
				}
			},
			nextAccount: {
				always: (args) => {
					const { context } = args
					if (context.accountIndex < context.accounts.length) {
						return { target: 'identifyingAccount' }
					}
					return { target: 'recordingResult' }
				}
			},
			identifyingAccount: {
				on: { CANCEL: {} },
				invoke: {
					src: 'accountId',
					input: ({ context }) => ({
						attemptId: context.start.id,
						accountId: accountValues(context).accountId
					}),
					onDone: (args) => {
						return { target: 'recordingAccount', context: { accountRowId: args.event.output } }
					},
					onError: { target: 'accountWriteFailed' }
				}
			},
			recordingAccount: {
				on: { CANCEL: {} },
				invoke: {
					src: 'recordAccount',
					input: ({ context }) => {
						if (!context.accountRowId) throw new Error('Missing account log identity')
						return { id: context.accountRowId, values: accountValues(context) }
					},
					onDone: (args) => {
						return {
							target: 'nextAccount',
							context: { accountIndex: args.context.accountIndex + 1, accountRowId: undefined }
						}
					},
					onError: { target: 'accountWriteFailed' }
				}
			},
			accountWriteFailed: {
				type: 'final',
				entry: (args) => {
					const { context } = args
					return { context: { output: logFailure(context, 'accountWriteFailed') } }
				}
			},
			recordingResult: {
				// Cancellation does not abort the SDK write. The wrapper bounds its wait.
				on: { CANCEL: {} },
				invoke: {
					src: 'recordResult',
					input: ({ context }) => ({ start: context.start, result: completion(context) }),
					onDone: { target: 'recorded' },
					onError: { target: 'resultWriteFailed' }
				}
			},
			invalidStart: {
				type: 'final',
				entry: (args) => {
					const { context } = args
					return { context: { output: logFailure(context, 'invalidStart') } }
				}
			},
			startWriteFailed: {
				type: 'final',
				entry: (args) => {
					const { context } = args
					return { context: { output: logFailure(context, 'startWriteFailed') } }
				}
			},
			recorded: {
				type: 'final',
				entry: (args) => {
					const { context } = args
					return {
						context: {
							output: {
								kind: 'recorded',
								attemptId: context.start.id,
								result: completion(context)
							}
						}
					}
				}
			},
			invalidResult: {
				type: 'final',
				entry: (args) => {
					const { context } = args
					return { context: { output: logFailure(context, 'invalidResult') } }
				}
			},
			resultWriteFailed: {
				type: 'final',
				entry: (args) => {
					const { context } = args
					return { context: { output: logFailure(context, 'resultWriteFailed') } }
				}
			}
		}
	})
}
