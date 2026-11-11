import { ReadTier, type Db } from 'jazz-tools'
import { app } from '../../schema.js'
import type { FakeDataPlan } from '../../domain/fake-data.js'
import { createJazzTransactionActors } from '../persistence/jazz-transaction-actors.js'
import { setup, types, createAsyncLogic, matchesState } from 'xstate'
import type { OutputFrom } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'

export type FakeDataDb = Pick<Db, 'all' | 'beginSerializableTransaction'>
type Transaction = ReturnType<FakeDataDb['beginSerializableTransaction']>
type Input = { db: FakeDataDb; organizationId: string; userId: string }
type Event = { type: 'CANCEL' } | { type: 'SHUTDOWN' }
type Settlement = 'notStarted' | 'confirmed' | 'unresolved'
export type FakeDataResult =
	| { outcome: 'seeded'; settlement: 'confirmed'; accountCount: number; transactionCount: number }
	| { outcome: 'skipped'; settlement: 'notStarted' }
	| { outcome: 'failed'; settlement: 'notStarted' | 'unresolved'; error: unknown }
	| { outcome: 'cancelled' | 'closed'; settlement: Settlement }

function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Missing fake-data resource')
	return value
}
const transactionActors = createJazzTransactionActors(
	(db: FakeDataDb) => db.beginSerializableTransaction(),
	(write: ReturnType<Transaction['commit']>) => write.wait()
)
const readLocal = createAsyncLogic({
	run: async ({ input }: { input: Input }) => {
		const [accounts, transactions] = await Promise.all([
			input.db.all(app.accounts.limit(1), { tier: ReadTier.LocalFirst }),
			input.db.all(app.transactions.limit(1), { tier: ReadTier.LocalFirst })
		])
		return accounts.length > 0 || transactions.length > 0
	}
})
const readAuthority = createAsyncLogic({
	run: async ({ input }: { input: Input }) => {
		const [accounts, transactions, organizations, categories] = await Promise.all([
			input.db.all(app.accounts.limit(1), { tier: ReadTier.Remote }),
			input.db.all(app.transactions.limit(1), { tier: ReadTier.Remote }),
			input.db.all(app.organizations.where({ id: input.organizationId }), {
				tier: ReadTier.Remote
			}),
			input.db.all(
				app.categories.where({
					organizationId: input.organizationId,
					archivedAt: { isNull: true }
				}),
				{ tier: ReadTier.Remote }
			)
		])
		return {
			hasData: accounts.length > 0 || transactions.length > 0,
			organization: organizations[0],
			categories
		}
	}
})
const prepare = createAsyncLogic({
	run: async ({
		input
	}: {
		input: { scope: Input; records: OutputFrom<typeof readAuthority> }
	}) => {
		const { prepareFakeData } = await import('../../domain/fake-data.js')
		return prepareFakeData(input.scope.organizationId, input.records.categories)
	}
})
const recheck = createAsyncLogic({
	run: async ({ input }: { input: { tx: Transaction; scope: Input } }) => {
		const [accounts, transactions, organizations, categories] = await Promise.all([
			input.tx.all(app.accounts.limit(1)),
			input.tx.all(app.transactions.limit(1)),
			input.tx.all(app.organizations.where({ id: input.scope.organizationId })),
			input.tx.all(
				app.categories.where({
					organizationId: input.scope.organizationId,
					archivedAt: { isNull: true }
				})
			)
		])
		return {
			hasData: accounts.length > 0 || transactions.length > 0,
			organization: organizations[0],
			categories
		}
	}
})
const stage = createAsyncLogic({
	run: ({ input }: { input: { tx: Transaction; plan: FakeDataPlan } }) => {
		for (const account of input.plan.accounts)
			input.tx.insert(app.accounts, account.values, { id: account.id })
		for (const transaction of input.plan.transactions)
			input.tx.insert(app.transactions, transaction.values, { id: transaction.id })
		return Promise.resolve()
	}
})
const actors = { ...transactionActors, readLocal, readAuthority, prepare, recheck, stage }
type Context = Input & {
	tx: Transaction | undefined
	records: OutputFrom<typeof readAuthority> | undefined
	plan: FakeDataPlan | undefined
	write: OutputFrom<typeof transactionActors.commit> | undefined
	result: FakeDataResult | undefined
}
const events0 = {
	CANCEL: types<EventPayload<Event, 'CANCEL'>>(),
	SHUTDOWN: types<EventPayload<Event, 'SHUTDOWN'>>()
}
type NativeEvent0 =
	| import('xstate').InferEvents<typeof events0>
	| import('xstate').DoneActorEvent<
			| import('xstate').OutputFrom<(typeof actors)['readLocal']>
			| import('xstate').OutputFrom<(typeof actors)['readAuthority']>
			| import('xstate').OutputFrom<(typeof actors)['prepare']>
			| import('xstate').OutputFrom<(typeof actors)['recheck']>
			| import('xstate').OutputFrom<(typeof actors)['stage']>
			| import('xstate').OutputFrom<(typeof actors)['open']>
			| import('xstate').OutputFrom<(typeof actors)['commit']>
			| import('xstate').OutputFrom<(typeof actors)['settle']>
			| import('xstate').OutputFrom<(typeof actors)['rollback']>
	  >
	| import('xstate').ErrorActorEvent
	| import('xstate').AfterEvent
	| import('xstate').DoneStateEvent
	| import('xstate').SnapshotEvent
	| import('xstate').TimeoutEvent
	| import('xstate').ActorTimeoutEvent
	| import('xstate').ErrorPlatformEvent

/** Seed only authoritative emptiness; own the serializable transaction until confirmed or rolled back. */
export const fakeDataSetup = setup({
	schemas: {
		context: types<Context>(),
		events: events0,
		input: types<Input>(),
		output: types<FakeDataResult>(),
		children: {
			readLocal: types<import('xstate').ActorRefFrom<(typeof actors)['readLocal']>>(),
			readAuthority: types<import('xstate').ActorRefFrom<(typeof actors)['readAuthority']>>(),
			prepare: types<import('xstate').ActorRefFrom<(typeof actors)['prepare']>>(),
			recheck: types<import('xstate').ActorRefFrom<(typeof actors)['recheck']>>(),
			stage: types<import('xstate').ActorRefFrom<(typeof actors)['stage']>>(),
			open: types<import('xstate').ActorRefFrom<(typeof actors)['open']>>(),
			commit: types<import('xstate').ActorRefFrom<(typeof actors)['commit']>>(),
			settle: types<import('xstate').ActorRefFrom<(typeof actors)['settle']>>(),
			rollback: types<import('xstate').ActorRefFrom<(typeof actors)['rollback']>>()
		}
	},
	actors,
	guards: {
		closing: (args: { value: import('xstate').StateValue }) =>
			matchesState({ running: { control: 'closing' } }, args.value),
		cancelling: (args: { value: import('xstate').StateValue }) =>
			matchesState({ running: { control: 'cancelling' } }, args.value),
		hasData: ({ context }: { context: Context }) => context.records?.hasData === true,
		owned: ({ context }: { context: Context }) =>
			context.records?.organization?.ownerId === context.userId,
		categoriesReady: ({ context }: { context: Context }) =>
			['income', 'expense'].every((kind) =>
				context.records?.categories.some((category) => category.kind === kind)
			),
		planStillValid: ({ context }: { context: Context }) =>
			required(context.plan).transactions.every((transaction) =>
				context.records?.categories.some(
					(category) =>
						category.id === transaction.values.categoryId &&
						category.kind === transaction.values.kind
				)
			)
	}
}).createMachine({
	id: 'fake-data-setup',
	context: ({ input }) => ({
		...input,
		tx: undefined,
		records: undefined,
		plan: undefined,
		write: undefined,
		result: undefined
	}),
	initial: 'running',
	output: ({ context }) => required(context.result),
	states: {
		running: {
			type: 'parallel',
			states: {
				control: {
					initial: 'active',
					states: {
						active: { on: { CANCEL: { target: 'cancelling' }, SHUTDOWN: { target: 'closing' } } },
						cancelling: { on: { CANCEL: {}, SHUTDOWN: { target: 'closing' } } },
						closing: { on: { CANCEL: {}, SHUTDOWN: {} } }
					}
				},
				work: {
					initial: 'readingLocal',
					states: {
						readingLocal: {
							on: { CANCEL: { target: 'finishing' }, SHUTDOWN: { target: 'finishing' } },
							invoke: {
								src: 'readLocal',
								input: ({ context }) => context,
								onDone: (args) => {
									if (
										matchesState({ running: { control: 'closing' } }, args.value) ||
										matchesState({ running: { control: 'cancelling' } }, args.value)
									) {
										return { target: 'finishing' }
									}
									if (args.event.output) {
										return { target: 'skipping' }
									}
									return { target: 'readingAuthority' }
								},
								onError: (args) => {
									return {
										target: 'finishing',
										context: {
											result: {
												outcome: 'failed',
												settlement: 'notStarted',
												error: args.event.error
											}
										}
									}
								}
							}
						},
						readingAuthority: {
							on: { CANCEL: { target: 'finishing' }, SHUTDOWN: { target: 'finishing' } },
							invoke: {
								src: 'readAuthority',
								input: ({ context }) => context,
								onDone: (args) => {
									return { target: 'assessing', context: { records: args.event.output } }
								},
								onError: (args) => {
									return {
										target: 'finishing',
										context: {
											result: {
												outcome: 'failed',
												settlement: 'notStarted',
												error: args.event.error
											}
										}
									}
								}
							}
						},
						assessing: {
							always: (args) => {
								if (
									matchesState({ running: { control: 'closing' } }, args.value) ||
									matchesState({ running: { control: 'cancelling' } }, args.value)
								) {
									return { target: 'finishing' }
								}
								if (args.guards.hasData(args)) {
									return { target: 'skipping' }
								}
								if (!args.guards.owned(args)) {
									return { target: 'skipping' }
								}
								if (args.guards.categoriesReady(args)) {
									return { target: 'preparing' }
								}
								return {
									target: 'finishing',
									context: {
										result: {
											outcome: 'failed',
											settlement: 'notStarted',
											error: new Error('Fake data requires income and expense categories')
										}
									}
								}
							}
						},
						preparing: {
							on: { CANCEL: { target: 'finishing' }, SHUTDOWN: { target: 'finishing' } },
							invoke: {
								src: 'prepare',
								input: ({ context }) => ({ scope: context, records: required(context.records) }),
								onDone: (args) => {
									if (
										matchesState({ running: { control: 'closing' } }, args.value) ||
										matchesState({ running: { control: 'cancelling' } }, args.value)
									) {
										return { target: 'finishing' }
									}
									return { target: 'opening', context: { plan: args.event.output } }
								},
								onError: (args) => {
									return {
										target: 'finishing',
										context: {
											result: {
												outcome: 'failed',
												settlement: 'notStarted',
												error: args.event.error
											}
										}
									}
								}
							}
						},
						opening: {
							invoke: {
								src: 'open',
								input: ({ context }) => context.db,
								onDone: (args) => {
									const { event } = args
									if (
										matchesState({ running: { control: 'closing' } }, args.value) ||
										matchesState({ running: { control: 'cancelling' } }, args.value)
									) {
										return { target: 'rollingBack', context: { tx: event.output } }
									}
									return { target: 'rechecking', context: { tx: event.output } }
								},
								onError: (args) => {
									return {
										target: 'finishing',
										context: {
											result: {
												outcome: 'failed',
												settlement: 'notStarted',
												error: args.event.error
											}
										}
									}
								}
							}
						},
						rechecking: {
							invoke: {
								src: 'recheck',
								input: ({ context }) => ({ tx: required(context.tx), scope: context }),
								onDone: (args) => {
									return { target: 'assessingTransaction', context: { records: args.event.output } }
								},
								onError: (args) => {
									return {
										target: 'rollingBack',
										context: {
											result: {
												outcome: 'failed',
												settlement: 'notStarted',
												error: args.event.error
											}
										}
									}
								}
							}
						},
						assessingTransaction: {
							always: (args) => {
								if (
									matchesState({ running: { control: 'closing' } }, args.value) ||
									matchesState({ running: { control: 'cancelling' } }, args.value)
								) {
									return { target: 'rollingBack' }
								}
								if (args.guards.hasData(args)) {
									return {
										target: 'rollingBack',
										context: { result: { outcome: 'skipped', settlement: 'notStarted' } }
									}
								}
								if (!args.guards.owned(args)) {
									return {
										target: 'rollingBack',
										context: { result: { outcome: 'skipped', settlement: 'notStarted' } }
									}
								}
								if (args.guards.planStillValid(args)) {
									return { target: 'staging' }
								}
								return {
									target: 'rollingBack',
									context: {
										result: {
											outcome: 'failed',
											settlement: 'notStarted',
											error: new Error('Fake-data categories changed')
										}
									}
								}
							}
						},
						staging: {
							invoke: {
								src: 'stage',
								input: ({ context }) => ({
									tx: required(context.tx),
									plan: required(context.plan)
								}),
								onDone: (args) => {
									if (
										matchesState({ running: { control: 'closing' } }, args.value) ||
										matchesState({ running: { control: 'cancelling' } }, args.value)
									) {
										return { target: 'rollingBack' }
									}
									return { target: 'committing' }
								},
								onError: (args) => {
									return {
										target: 'rollingBack',
										context: {
											result: {
												outcome: 'failed',
												settlement: 'notStarted',
												error: args.event.error
											}
										}
									}
								}
							}
						},
						committing: {
							invoke: {
								src: 'commit',
								input: ({ context }) => required(context.tx),
								onDone: (args) => {
									return { target: 'settling', context: { write: args.event.output } }
								},
								onError: (args) => {
									return {
										target: 'rollingBack',
										context: {
											result: {
												outcome: 'failed',
												settlement: 'unresolved',
												error: args.event.error
											}
										}
									}
								}
							}
						},
						settling: {
							invoke: {
								src: 'settle',
								input: ({ context }) => required(context.write),
								onDone: (args) => {
									const { context } = args
									return {
										target: 'finishing',
										context: {
											result: {
												outcome: 'seeded',
												settlement: 'confirmed',
												accountCount: required(context.plan).accounts.length,
												transactionCount: required(context.plan).transactions.length
											}
										}
									}
								},
								onError: (args) => {
									return {
										target: 'rollingBack',
										context: {
											result: {
												outcome: 'failed',
												settlement: 'unresolved',
												error: args.event.error
											}
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
											result: {
												outcome: 'failed',
												settlement: 'unresolved',
												error: new Error('Fake-data rollback was not confirmed')
											}
										}
									}
								},
								onError: (args) => {
									return {
										target: 'finishing',
										context: {
											result: {
												outcome: 'failed',
												settlement: 'unresolved',
												error: args.event.error
											}
										}
									}
								}
							}
						},
						skipping: {
							entry: () => {
								return { context: { result: { outcome: 'skipped', settlement: 'notStarted' } } }
							},
							always: { target: 'finishing' }
						},
						finishing: {
							always: (args) => {
								const { context } = args
								if (matchesState({ running: { control: 'closing' } }, args.value)) {
									return { target: '#fake-data-setup.closed' }
								}
								if (matchesState({ running: { control: 'cancelling' } }, args.value)) {
									return { target: '#fake-data-setup.cancelled' }
								}
								if (context.result?.outcome === 'seeded') {
									return { target: '#fake-data-setup.succeeded' }
								}
								if (context.result?.outcome === 'skipped') {
									return { target: '#fake-data-setup.skipped' }
								}
								return { target: '#fake-data-setup.failed' }
							}
						}
					}
				}
			}
		},
		succeeded: {
			type: 'final',
			entry: () => {
				return { context: { tx: undefined, plan: undefined, records: undefined, write: undefined } }
			}
		},
		skipped: {
			type: 'final',
			entry: () => {
				return { context: { tx: undefined, plan: undefined, records: undefined, write: undefined } }
			}
		},
		failed: {
			type: 'final',
			entry: () => {
				return { context: { tx: undefined, plan: undefined, records: undefined, write: undefined } }
			}
		},
		cancelled: {
			type: 'final',
			entry: (args) => {
				return {
					context: {
						tx: undefined,
						plan: undefined,
						records: undefined,
						write: undefined,
						result: {
							outcome: 'cancelled',
							settlement: args.context.result?.settlement ?? 'notStarted'
						}
					}
				}
			}
		},
		closed: {
			type: 'final',
			entry: (args) => {
				return {
					context: {
						tx: undefined,
						plan: undefined,
						records: undefined,
						write: undefined,
						result: {
							outcome: 'closed',
							settlement: args.context.result?.settlement ?? 'notStarted'
						}
					}
				}
			}
		}
	}
})
