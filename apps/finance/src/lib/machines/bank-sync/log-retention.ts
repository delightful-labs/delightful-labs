import { ReadTier } from 'jazz-tools'
import { app, type SyncAttempt, type SyncAccountResult } from '#lib/schema.js'
import { canManageBankCredentials } from '#lib/domain/organization-permissions.js'
import { createJazzTransactionActors } from '../persistence/jazz-transaction-actors.js'
import { required } from './identity.js'
import type { Dependencies } from './types.js'
import { setup, types, createAsyncLogic, matchesState } from 'xstate'
import type { OutputFrom } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'

export type RetentionScope = { organizationId: string; connectionId: string; userId: string }
export type RetentionResult = {
	kind: 'cleaned' | 'unchanged' | 'deferred' | 'failed' | 'cancelled'
	deletedCount: number
	settlement: 'notStarted' | 'confirmed' | 'unresolved'
}
type Db = Pick<Dependencies['db'], 'beginSerializableTransaction'>
type Transaction = ReturnType<Db['beginSerializableTransaction']>
type Input = { scope: RetentionScope }
type Reader = Pick<Dependencies['db'], 'all'>
type ReadInput = { reader: Reader; scope: RetentionScope; tier: ReadTier }
function sameIds(left: readonly { id: string }[], right: readonly { id: string }[]) {
	const ids = new Set(left.map((row) => row.id))
	return left.length === right.length && right.every((row) => ids.has(row.id))
}
const transactions = createJazzTransactionActors(
	(db: Db) => db.beginSerializableTransaction(),
	(write: ReturnType<Transaction['commit']>) => write.wait()
)
type Context = Input & {
	authorityAttempts: readonly SyncAttempt[]
	authorityAccounts: readonly SyncAccountResult[]
	observedAttempts: readonly SyncAttempt[]
	tx: Transaction | undefined
	write: OutputFrom<typeof transactions.commit> | undefined
	attempts: readonly SyncAttempt[]
	accounts: readonly SyncAccountResult[]
	result: RetentionResult
}

/** Owns the serializable snapshot and atomic deletion; never performs provider work. */
export function createSyncLogRetentionMachine(
	dependencies: Pick<Dependencies, 'db' | 'observe'>,
	deadlineMs = 5000
) {
	const currentIdentity = (scope: RetentionScope) => {
		const observed = dependencies.observe()
		return (
			observed.allowed &&
			observed.userId === scope.userId &&
			observed.organizationId === scope.organizationId
		)
	}
	const actors = {
		...transactions,
		authorization: createAsyncLogic({
			run: async ({ input }: { input: ReadInput }) => {
				const [members, connections] = await Promise.all([
					input.reader.all(
						app.organizationMembers.where({
							organizationId: input.scope.organizationId,
							userId: input.scope.userId
						}),
						{ tier: input.tier }
					),
					input.reader.all(
						app.simplefinConnections.where({
							id: input.scope.connectionId,
							organizationId: input.scope.organizationId,
							ownerId: input.scope.userId
						}),
						{ tier: input.tier }
					)
				])
				return (
					connections.length === 1 &&
					members.some((member) => canManageBankCredentials(member, input.scope.organizationId))
				)
			}
		}),
		history: createAsyncLogic({
			run: ({ input }: { input: ReadInput }) =>
				input.reader.all(
					app.simplefinSyncAttempts
						.where({
							organizationId: input.scope.organizationId,
							connectionId: input.scope.connectionId,
							outcome: { ne: 'unfinished' },
							finishedAt: { isNull: false }
						})
						.orderBy('finishedAt', 'desc')
						.orderBy('id', 'desc'),
					{ tier: input.tier }
				)
		}),
		accounts: createAsyncLogic({
			run: ({ input }: { input: ReadInput & { ids: string[] } }) =>
				input.reader.all(
					app.simplefinSyncAccountResults.where({
						organizationId: input.scope.organizationId,
						attemptId: { in: input.ids }
					}),
					{ tier: input.tier }
				)
		}),
		stage: createAsyncLogic({
			run: ({
				input
			}: {
				input: {
					tx: Transaction
					attempts: readonly SyncAttempt[]
					accounts: readonly SyncAccountResult[]
				}
			}) => {
				for (const row of input.accounts) input.tx.delete(app.simplefinSyncAccountResults, row.id)
				for (const row of input.attempts) input.tx.delete(app.simplefinSyncAttempts, row.id)
				return Promise.resolve()
			}
		})
	}
	const events0 = { CANCEL: types<EventPayload<{ type: 'CANCEL' }, 'CANCEL'>>() }
	type NativeEvent0 =
		| import('xstate').InferEvents<typeof events0>
		| import('xstate').DoneActorEvent<
				| import('xstate').OutputFrom<(typeof actors)['authorization']>
				| import('xstate').OutputFrom<(typeof actors)['history']>
				| import('xstate').OutputFrom<(typeof actors)['accounts']>
				| import('xstate').OutputFrom<(typeof actors)['stage']>
				| import('xstate').OutputFrom<(typeof actors)['open']>
				| import('xstate').OutputFrom<(typeof actors)['commit']>
				| import('xstate').OutputFrom<(typeof actors)['settle']>
				| import('xstate').OutputFrom<(typeof actors)['rollback']>
		  >
		| import('xstate').ErrorActorEvent
	return setup({
		schemas: {
			context: types<Context>(),
			events: events0,
			input: types<Input>(),
			output: types<RetentionResult>(),
			children: {
				authorization: types<import('xstate').ActorRefFrom<(typeof actors)['authorization']>>(),
				history: types<import('xstate').ActorRefFrom<(typeof actors)['history']>>(),
				accounts: types<import('xstate').ActorRefFrom<(typeof actors)['accounts']>>(),
				stage: types<import('xstate').ActorRefFrom<(typeof actors)['stage']>>(),
				open: types<import('xstate').ActorRefFrom<(typeof actors)['open']>>(),
				commit: types<import('xstate').ActorRefFrom<(typeof actors)['commit']>>(),
				settle: types<import('xstate').ActorRefFrom<(typeof actors)['settle']>>(),
				rollback: types<import('xstate').ActorRefFrom<(typeof actors)['rollback']>>()
			}
		},
		actors,
		guards: {
			interrupted: (args: { value: import('xstate').StateValue }) =>
				matchesState({ running: { control: 'cancelling' } }, args.value),
			identityCurrent: ({ context }: { context: Context }) => currentIdentity(context.scope)
		},
		delays: { deadline: deadlineMs }
	}).createMachine({
		id: 'sync-log-retention',
		context: ({ input }) => ({
			...input,
			authorityAttempts: [],
			authorityAccounts: [],
			observedAttempts: [],
			tx: undefined,
			write: undefined,
			attempts: [],
			accounts: [],
			result: { kind: 'deferred', deletedCount: 0, settlement: 'notStarted' }
		}),
		initial: 'running',
		output: ({ context }) => context.result,
		states: {
			running: {
				type: 'parallel',
				states: {
					control: {
						initial: 'active',
						states: {
							active: { on: { CANCEL: { target: 'cancelling' } } },
							cancelling: { on: { CANCEL: {} } }
						}
					},
					work: {
						initial: 'checkingIdentity',
						states: {
							checkingIdentity: {
								always: (args) => {
									if (args.guards.identityCurrent(args)) {
										return { target: 'authorizingAuthority' }
									}
									return { target: 'finishing' }
								}
							},
							authorizingAuthority: {
								after: { deadline: { target: 'finishing' } },
								on: { CANCEL: { target: 'finishing' } },
								invoke: {
									src: 'authorization',
									input: ({ context }) => ({
										reader: dependencies.db,
										scope: context.scope,
										tier: ReadTier.Remote
									}),
									onDone: (args) => {
										if (args.event.output) {
											return { target: 'readingAuthorityHistory' }
										}
										return { target: 'finishing' }
									},
									onError: { target: 'finishing' }
								}
							},
							readingAuthorityHistory: {
								after: { deadline: { target: 'finishing' } },
								on: { CANCEL: { target: 'finishing' } },
								invoke: {
									src: 'history',
									input: ({ context }) => ({
										reader: dependencies.db,
										scope: context.scope,
										tier: ReadTier.Remote
									}),
									onDone: (args) => {
										return {
											target: 'selectingAuthority',
											context: { authorityAttempts: args.event.output }
										}
									},
									onError: { target: 'finishing' }
								}
							},
							selectingAuthority: {
								always: (args) => {
									if (args.guards.interrupted(args)) {
										return { target: 'finishing' }
									}
									if (args.context.authorityAttempts.length <= 100) {
										return {
											target: 'finishing',
											context: {
												result: { kind: 'unchanged', deletedCount: 0, settlement: 'notStarted' }
											}
										}
									}
									if (args.guards.identityCurrent(args)) {
										return { target: 'readingAuthorityAccounts' }
									}
									return { target: 'finishing' }
								}
							},
							readingAuthorityAccounts: {
								after: { deadline: { target: 'finishing' } },
								on: { CANCEL: { target: 'finishing' } },
								invoke: {
									src: 'accounts',
									input: ({ context }) => ({
										reader: dependencies.db,
										scope: context.scope,
										tier: ReadTier.Remote,
										ids: context.authorityAttempts.slice(100).map((row) => row.id)
									}),
									onDone: (args) => {
										return { target: 'opening', context: { authorityAccounts: args.event.output } }
									},
									onError: { target: 'finishing' }
								}
							},
							opening: {
								invoke: {
									src: 'open',
									input: () => dependencies.db,
									onDone: (args) => {
										return { target: 'checkingOpened', context: { tx: args.event.output } }
									},
									onError: { target: 'finishing' }
								}
							},
							checkingOpened: {
								always: (args) => {
									if (args.guards.interrupted(args)) {
										return { target: 'rollingBack' }
									}
									return { target: 'authorizing' }
								}
							},
							authorizing: {
								after: { deadline: { target: 'rollingBack' } },
								on: { CANCEL: { target: 'rollingBack' } },
								invoke: {
									src: 'authorization',
									input: ({ context }) => ({
										reader: required(context.tx),
										scope: context.scope,
										tier: ReadTier.LocalFirst
									}),
									onDone: (args) => {
										if (args.event.output) {
											return { target: 'readingHistory' }
										}
										return { target: 'rollingBack' }
									},
									onError: { target: 'rollingBack' }
								}
							},
							readingHistory: {
								after: { deadline: { target: 'rollingBack' } },
								on: { CANCEL: { target: 'rollingBack' } },
								invoke: {
									src: 'history',
									input: ({ context }) => ({
										reader: required(context.tx),
										scope: context.scope,
										tier: ReadTier.LocalFirst
									}),
									onDone: (args) => {
										return { target: 'selecting', context: { observedAttempts: args.event.output } }
									},
									onError: { target: 'rollingBack' }
								}
							},
							selecting: {
								always: (args) => {
									const { context } = args
									if (args.guards.interrupted(args)) {
										return { target: 'rollingBack' }
									}
									if (!sameIds(context.authorityAttempts, context.observedAttempts)) {
										return { target: 'rollingBack' }
									}
									return {
										target: 'readingAccounts',
										context: { attempts: context.observedAttempts.slice(100) }
									}
								}
							},
							readingAccounts: {
								after: { deadline: { target: 'rollingBack' } },
								on: { CANCEL: { target: 'rollingBack' } },
								invoke: {
									src: 'accounts',
									input: ({ context }) => ({
										reader: required(context.tx),
										scope: context.scope,
										tier: ReadTier.LocalFirst,
										ids: context.attempts.map((row) => row.id)
									}),
									onDone: (args) => {
										return {
											target: 'checkingBeforeStage',
											context: { accounts: args.event.output }
										}
									},
									onError: { target: 'rollingBack' }
								}
							},
							checkingBeforeStage: {
								always: (args) => {
									const { context } = args
									if (!sameIds(context.authorityAccounts, context.accounts)) {
										return { target: 'rollingBack' }
									}
									if (args.guards.interrupted(args)) {
										return { target: 'rollingBack' }
									}
									if (args.guards.identityCurrent(args)) {
										return { target: 'staging' }
									}
									return { target: 'rollingBack' }
								}
							},
							staging: {
								invoke: {
									src: 'stage',
									input: ({ context }) => ({
										tx: required(context.tx),
										attempts: context.attempts,
										accounts: context.accounts
									}),
									onDone: { target: 'checkingBeforeCommit' },
									onError: { target: 'rollingBack' }
								}
							},
							checkingBeforeCommit: {
								always: (args) => {
									if (args.guards.interrupted(args)) {
										return { target: 'rollingBack' }
									}
									if (args.guards.identityCurrent(args)) {
										return { target: 'committing' }
									}
									return { target: 'rollingBack' }
								}
							},
							committing: {
								invoke: {
									src: 'commit',
									input: ({ context }) => required(context.tx),
									onDone: (args) => {
										return { target: 'settling', context: { write: args.event.output } }
									},
									onError: () => {
										return {
											target: 'rollingBack',
											context: {
												result: { kind: 'failed', deletedCount: 0, settlement: 'unresolved' }
											}
										}
									}
								}
							},
							settling: {
								after: {
									deadline: () => {
										return {
											target: 'finishing',
											context: {
												result: { kind: 'deferred', deletedCount: 0, settlement: 'unresolved' }
											}
										}
									}
								},
								invoke: {
									src: 'settle',
									input: ({ context }) => required(context.write),
									onDone: (args) => {
										return {
											target: 'finishing',
											context: {
												result: {
													kind: 'cleaned',
													deletedCount: args.context.attempts.length,
													settlement: 'confirmed'
												}
											}
										}
									},
									onError: () => {
										return {
											target: 'finishing',
											context: {
												result: { kind: 'failed', deletedCount: 0, settlement: 'unresolved' }
											}
										}
									}
								}
							},
							rollingBack: {
								invoke: {
									src: 'rollback',
									input: ({ context }) => required(context.tx),
									onDone: (args) => {
										if (args.event.output) {
											return { target: 'finishing' }
										}
										return {
											target: 'finishing',
											context: {
												result: { kind: 'failed', deletedCount: 0, settlement: 'unresolved' }
											}
										}
									},
									onError: () => {
										return {
											target: 'finishing',
											context: {
												result: { kind: 'failed', deletedCount: 0, settlement: 'unresolved' }
											}
										}
									}
								}
							},
							finishing: {
								entry: () => {
									return {
										context: {
											tx: undefined,
											write: undefined,
											attempts: [],
											accounts: [],
											authorityAttempts: [],
											authorityAccounts: [],
											observedAttempts: []
										}
									}
								},
								always: (args) => {
									if (args.guards.interrupted(args)) {
										return { target: '#sync-log-retention.cancelled' }
									}
									return { target: '#sync-log-retention.done' }
								}
							}
						}
					}
				}
			},
			cancelled: {
				type: 'final',
				entry: (args) => {
					return { context: { result: { ...args.context.result, kind: 'cancelled' } } }
				}
			},
			done: { type: 'final' }
		}
	})
}
