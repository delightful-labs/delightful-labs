import { canWriteAccount } from '#lib/domain/organization-permissions.js'
import { INCOME, EXPENSE } from '#lib/domain/transaction-kind.js'
import { TRANSACTION_SOURCE } from '#lib/domain/transaction-source.js'
import {
	app,
	type Account,
	type AccountMembership,
	type Category,
	type OrganizationMember
} from '#lib/schema.js'
import {
	amountMinorValue,
	dateOnlyText,
	defaultTransactionCategory
} from '#lib/validation/transactions.js'
import type { getDb } from 'jazz-tools/svelte'
import { z } from 'zod'
import { createJazzTransactionActors } from '../persistence/jazz-transaction-actors.js'
import { setup, types, createAsyncLogic, matchesState } from 'xstate'
import type { OutputFrom } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'

type JazzTransaction = ReturnType<ReturnType<typeof getDb>['beginTransaction']>
type LocalWrite = { txId: Promise<string>; wait(options: { tier: 'local' }): Promise<void> }
type Transaction = Pick<JazzTransaction, 'one' | 'all' | 'insert' | 'rollback'> & {
	commit(): LocalWrite
}
type Db = { beginTransaction(): Transaction }
type TrackedWrite = LocalWrite & { txId: Promise<string> }
type Grant = Pick<AccountMembership, 'accountId' | 'access'>
export type InternalTransferCreateInput = {
	db: Db
	identityId: string
	organizationId: string
	expenseAccountId: string
	incomeAccountId: string
	expenseAmountMinor: number
	incomeAmountMinor: number
	expenseCurrency: string
	incomeCurrency: string
	bookedOn: string
	trackWrite: (write: { transactionId: string; operation: 'create'; transferId: string }) => void
}
type Identifiers = {
	expenseTransactionId: string
	incomeTransactionId: string
	transferId: string
}
type Records = {
	expenseAccount: Account | null
	incomeAccount: Account | null
	membership: OrganizationMember | null
	grants: Grant[]
	categories: Category[]
}
type Assessment =
	| {
			outcome: 'eligible'
			expenseCategoryId: string
			incomeCategoryId: string
			expenseCurrency: string
			incomeCurrency: string
	  }
	| { outcome: 'denied' | 'incompatible' | 'unavailable' }
type Result =
	| {
			outcome: 'succeeded'
			settlement: 'locallyPersisted'
			transferId: string
			expenseTransactionId: string
			incomeTransactionId: string
	  }
	| {
			outcome: 'invalid'
			settlement: 'notStarted'
			issues: readonly z.ZodIssue[]
	  }
	| {
			outcome: 'cancelled' | 'scopeChanged' | 'closed' | 'denied' | 'incompatible' | 'unavailable'
			settlement: 'notStarted' | 'unresolved'
			error?: unknown
	  }
export type InternalTransferCreateEvent =
	{ type: 'CANCEL' } | { type: 'INVALIDATE' } | { type: 'SHUTDOWN' }
export type InternalTransferCreateResult = Result

type Context = {
	request: InternalTransferCreateInput
	identifiers: Identifiers | undefined
	tx: Transaction | undefined
	write: LocalWrite | undefined
	records: Records | undefined
	assessment: Assessment | undefined
	result: Result | undefined
	transactionId: string | undefined
}

function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Missing paired transfer resource')
	return value
}

const requestSchema = z.strictObject({
	identityId: z.uuid(),
	organizationId: z.uuid(),
	expenseAccountId: z.uuid(),
	incomeAccountId: z.uuid(),
	expenseAmountMinor: amountMinorValue,
	incomeAmountMinor: amountMinorValue,
	expenseCurrency: z.string().regex(/^[A-Z]{3}$/),
	incomeCurrency: z.string().regex(/^[A-Z]{3}$/),
	bookedOn: dateOnlyText
})
const validate = createAsyncLogic({
	run: ({ input }: { input: InternalTransferCreateInput }) =>
		Promise.resolve(
			requestSchema.safeParse({
				identityId: input.identityId,
				organizationId: input.organizationId,
				expenseAccountId: input.expenseAccountId,
				incomeAccountId: input.incomeAccountId,
				expenseAmountMinor: input.expenseAmountMinor,
				incomeAmountMinor: input.incomeAmountMinor,
				expenseCurrency: input.expenseCurrency,
				incomeCurrency: input.incomeCurrency,
				bookedOn: input.bookedOn
			})
		)
})
const allocate = createAsyncLogic({
	run: (): Promise<Identifiers> =>
		Promise.resolve({
			expenseTransactionId: crypto.randomUUID(),
			incomeTransactionId: crypto.randomUUID(),
			transferId: crypto.randomUUID()
		})
})

const transactionActors = createJazzTransactionActors(
	(db: Db) => db.beginTransaction(),
	(write: LocalWrite) => write.wait({ tier: 'local' })
)
const { open, commit, settle, rollback } = transactionActors
const identifyWrite = createAsyncLogic({ run: ({ input }: { input: TrackedWrite }) => input.txId })
const read = createAsyncLogic({
	run: async ({ input }: { input: { tx: Transaction; request: InternalTransferCreateInput } }) => {
		const { tx, request } = input
		const [expenseAccount, incomeAccount, membership, grants, categories] = await Promise.all([
			tx.one(app.accounts.where({ id: request.expenseAccountId })),
			tx.one(app.accounts.where({ id: request.incomeAccountId })),
			tx.one(
				app.organizationMembers.where({
					organizationId: request.organizationId,
					userId: request.identityId
				})
			),
			tx.all(
				app.accountMemberships.where({
					organizationId: request.organizationId,
					userId: request.identityId
				})
			),
			tx.all(app.categories.where({ organizationId: request.organizationId }))
		])
		return {
			expenseAccount,
			incomeAccount,
			membership,
			grants: grants.map(({ accountId, access }) => ({ accountId, access })),
			categories
		}
	}
})

function assess(records: Records, request: InternalTransferCreateInput): Assessment {
	const { expenseAccount, incomeAccount, membership, grants, categories } = records
	if (
		!expenseAccount ||
		!incomeAccount ||
		!membership ||
		membership.userId !== request.identityId ||
		membership.organizationId !== request.organizationId
	)
		return { outcome: 'unavailable' }
	if (
		expenseAccount.organizationId !== request.organizationId ||
		incomeAccount.organizationId !== request.organizationId ||
		expenseAccount.archivedAt !== null ||
		incomeAccount.archivedAt !== null ||
		expenseAccount.id === incomeAccount.id
	)
		return { outcome: 'incompatible' }
	if (
		expenseAccount.currency !== request.expenseCurrency ||
		incomeAccount.currency !== request.incomeCurrency
	)
		return { outcome: 'incompatible' }
	if (
		expenseAccount.currency === incomeAccount.currency &&
		request.expenseAmountMinor !== request.incomeAmountMinor
	)
		return { outcome: 'incompatible' }
	if (
		!canWriteAccount(membership, request.organizationId, expenseAccount.id, grants) ||
		!canWriteAccount(membership, request.organizationId, incomeAccount.id, grants)
	)
		return { outcome: 'denied' }
	const expenseCategory = defaultTransactionCategory({
		organizationId: request.organizationId,
		kind: EXPENSE,
		categories
	})
	const incomeCategory = defaultTransactionCategory({
		organizationId: request.organizationId,
		kind: INCOME,
		categories
	})
	if (!expenseCategory || !incomeCategory) return { outcome: 'unavailable' }
	return {
		outcome: 'eligible',
		expenseCategoryId: expenseCategory.id,
		incomeCategoryId: incomeCategory.id,
		expenseCurrency: expenseAccount.currency,
		incomeCurrency: incomeAccount.currency
	}
}

function eligibleAssessment(value: Assessment | undefined) {
	if (value?.outcome !== 'eligible') throw new Error('Paired transfer was not eligible')
	return value
}

function rejectedAssessment(value: Assessment | undefined): Result {
	const assessment = required(value)
	if (assessment.outcome === 'eligible') return { outcome: 'unavailable', settlement: 'notStarted' }
	return { outcome: assessment.outcome, settlement: 'notStarted' }
}

function settlementResult(result: Result | undefined, rolledBack: boolean): Result {
	if (rolledBack) return result ?? { outcome: 'unavailable', settlement: 'notStarted' }
	if (!result || result.outcome === 'succeeded' || result.outcome === 'invalid')
		return { outcome: 'unavailable', settlement: 'unresolved' }
	return { ...result, settlement: 'unresolved' }
}

const stage = createAsyncLogic({
	run: ({
		input
	}: {
		input: {
			tx: Transaction
			request: InternalTransferCreateInput
			identifiers: Identifiers
			assessment: Assessment
		}
	}) => {
		const { tx, request, identifiers } = input
		const assessment = eligibleAssessment(input.assessment)
		const common = {
			organizationId: request.organizationId,
			bookedOn: request.bookedOn,
			description: null,
			memo: null,
			source: TRANSACTION_SOURCE.MANUAL,
			paymentMethod: null,
			checkId: null,
			internalTransferId: identifiers.transferId
		}
		tx.insert(
			app.transactions,
			{
				...common,
				amountMinor: request.expenseAmountMinor,
				currency: assessment.expenseCurrency,
				accountId: request.expenseAccountId,
				categoryId: assessment.expenseCategoryId,
				kind: EXPENSE
			},
			{ id: identifiers.expenseTransactionId }
		)
		tx.insert(
			app.transactions,
			{
				...common,
				amountMinor: request.incomeAmountMinor,
				currency: assessment.incomeCurrency,
				accountId: request.incomeAccountId,
				categoryId: assessment.incomeCategoryId,
				kind: INCOME
			},
			{ id: identifiers.incomeTransactionId }
		)
		tx.insert(
			app.internalTransfers,
			{
				organizationId: request.organizationId,
				expenseTransactionId: identifiers.expenseTransactionId,
				incomeTransactionId: identifiers.incomeTransactionId,
				expenseAccountId: request.expenseAccountId,
				incomeAccountId: request.incomeAccountId,
				expenseAmountMinor: request.expenseAmountMinor,
				expenseCurrency: assessment.expenseCurrency,
				incomeAmountMinor: request.incomeAmountMinor,
				incomeCurrency: assessment.incomeCurrency
			},
			{ id: identifiers.transferId }
		)
		return Promise.resolve()
	}
})

export function createInternalTransferCreateMachine() {
	const actors = { validate, allocate, open, read, stage, commit, identifyWrite, settle, rollback }
	const events0 = {
		CANCEL: types<EventPayload<InternalTransferCreateEvent, 'CANCEL'>>(),
		INVALIDATE: types<EventPayload<InternalTransferCreateEvent, 'INVALIDATE'>>(),
		SHUTDOWN: types<EventPayload<InternalTransferCreateEvent, 'SHUTDOWN'>>()
	}
	type NativeEvent0 =
		| import('xstate').InferEvents<typeof events0>
		| import('xstate').DoneActorEvent<
				| import('xstate').OutputFrom<(typeof actors)['validate']>
				| import('xstate').OutputFrom<(typeof actors)['allocate']>
				| import('xstate').OutputFrom<(typeof actors)['open']>
				| import('xstate').OutputFrom<(typeof actors)['read']>
				| import('xstate').OutputFrom<(typeof actors)['stage']>
				| import('xstate').OutputFrom<(typeof actors)['commit']>
				| import('xstate').OutputFrom<(typeof actors)['identifyWrite']>
				| import('xstate').OutputFrom<(typeof actors)['settle']>
				| import('xstate').OutputFrom<(typeof actors)['rollback']>
		  >
		| import('xstate').ErrorActorEvent
	const model = setup({
		schemas: {
			context: types<Context>(),
			events: events0,
			input: types<InternalTransferCreateInput>(),
			output: types<InternalTransferCreateResult>(),
			children: {
				validate: types<import('xstate').ActorRefFrom<(typeof actors)['validate']>>(),
				allocate: types<import('xstate').ActorRefFrom<(typeof actors)['allocate']>>(),
				open: types<import('xstate').ActorRefFrom<(typeof actors)['open']>>(),
				read: types<import('xstate').ActorRefFrom<(typeof actors)['read']>>(),
				stage: types<import('xstate').ActorRefFrom<(typeof actors)['stage']>>(),
				commit: types<import('xstate').ActorRefFrom<(typeof actors)['commit']>>(),
				identifyWrite: types<import('xstate').ActorRefFrom<(typeof actors)['identifyWrite']>>(),
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
			invalidated: (args: { value: import('xstate').StateValue }) =>
				matchesState({ running: { control: 'invalidated' } }, args.value)
		}
	})
	return model.createMachine({
		id: 'internal-transfer-create',
		context: ({ input }) => ({
			request: input,
			identifiers: undefined,
			tx: undefined,
			write: undefined,
			records: undefined,
			assessment: undefined,
			result: undefined,
			transactionId: undefined
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
							active: {
								on: {
									CANCEL: { target: 'cancelling' },
									INVALIDATE: { target: 'invalidated' },
									SHUTDOWN: { target: 'closing' }
								}
							},
							cancelling: { on: { CANCEL: {}, SHUTDOWN: { target: 'closing' } } },
							invalidated: { on: { CANCEL: {}, INVALIDATE: {}, SHUTDOWN: { target: 'closing' } } },
							closing: { on: { CANCEL: {}, INVALIDATE: {}, SHUTDOWN: {} } }
						}
					},
					work: {
						initial: 'validating',
						states: {
							validating: {
								invoke: {
									src: 'validate',
									input: ({ context }) => context.request,
									onDone: (args) => {
										const { event } = args
										if (matchesState({ running: { control: 'closing' } }, args.value)) {
											return { target: 'finishing' }
										}
										if (matchesState({ running: { control: 'cancelling' } }, args.value)) {
											return { target: 'finishing' }
										}
										if (matchesState({ running: { control: 'invalidated' } }, args.value)) {
											return { target: 'finishing' }
										}
										if (event.output.success) {
											return { target: 'allocating' }
										}
										return {
											target: 'finishing',
											context: {
												result: event.output.success
													? { outcome: 'unavailable', settlement: 'notStarted' }
													: {
															outcome: 'invalid',
															settlement: 'notStarted',
															issues: event.output.error.issues
														}
											}
										}
									},
									onError: (args) => {
										return {
											target: 'finishing',
											context: {
												result: {
													outcome: 'unavailable',
													settlement: 'notStarted',
													error: args.event.error
												}
											}
										}
									}
								}
							},
							allocating: {
								invoke: {
									src: 'allocate',
									input: undefined,
									onDone: (args) => {
										return {
											target: 'checkingAfterAllocate',
											context: { identifiers: args.event.output }
										}
									},
									onError: (args) => {
										return {
											target: 'finishing',
											context: {
												result: {
													outcome: 'unavailable',
													settlement: 'notStarted',
													error: args.event.error
												}
											}
										}
									}
								}
							},
							checkingAfterAllocate: {
								always: (args) => {
									if (matchesState({ running: { control: 'closing' } }, args.value)) {
										return { target: 'finishing' }
									}
									if (matchesState({ running: { control: 'cancelling' } }, args.value)) {
										return { target: 'finishing' }
									}
									if (matchesState({ running: { control: 'invalidated' } }, args.value)) {
										return { target: 'finishing' }
									}
									return { target: 'opening' }
								}
							},
							opening: {
								invoke: {
									src: 'open',
									input: ({ context }) => context.request.db,
									onDone: (args) => {
										return { target: 'checkingAfterOpen', context: { tx: args.event.output } }
									},
									onError: (args) => {
										return {
											target: 'finishing',
											context: {
												result: {
													outcome: 'unavailable',
													settlement: 'notStarted',
													error: args.event.error
												}
											}
										}
									}
								}
							},
							checkingAfterOpen: {
								always: (args) => {
									if (matchesState({ running: { control: 'closing' } }, args.value)) {
										return { target: 'rollingBack' }
									}
									if (matchesState({ running: { control: 'cancelling' } }, args.value)) {
										return { target: 'rollingBack' }
									}
									if (matchesState({ running: { control: 'invalidated' } }, args.value)) {
										return { target: 'rollingBack' }
									}
									return { target: 'reading' }
								}
							},
							reading: {
								invoke: {
									src: 'read',
									input: ({ context }) => ({ tx: required(context.tx), request: context.request }),
									onDone: (args) => {
										return { target: 'checkingAfterRead', context: { records: args.event.output } }
									},
									onError: (args) => {
										return {
											target: 'rollingBack',
											context: {
												result: {
													outcome: 'unavailable',
													settlement: 'notStarted',
													error: args.event.error
												}
											}
										}
									}
								}
							},
							checkingAfterRead: {
								always: (args) => {
									if (matchesState({ running: { control: 'closing' } }, args.value)) {
										return { target: 'rollingBack' }
									}
									if (matchesState({ running: { control: 'cancelling' } }, args.value)) {
										return { target: 'rollingBack' }
									}
									if (matchesState({ running: { control: 'invalidated' } }, args.value)) {
										return { target: 'rollingBack' }
									}
									return { target: 'assessing' }
								}
							},
							assessing: {
								always: (args) => {
									const { context } = args
									return {
										target: 'checkingAssessment',
										context: { assessment: assess(required(context.records), context.request) }
									}
								}
							},
							checkingAssessment: {
								always: (args) => {
									const { context } = args
									if (matchesState({ running: { control: 'closing' } }, args.value)) {
										return { target: 'rollingBack' }
									}
									if (matchesState({ running: { control: 'cancelling' } }, args.value)) {
										return { target: 'rollingBack' }
									}
									if (matchesState({ running: { control: 'invalidated' } }, args.value)) {
										return { target: 'rollingBack' }
									}
									if (required(context.assessment).outcome !== 'eligible') {
										return {
											target: 'rollingBack',
											context: { result: rejectedAssessment(context.assessment) }
										}
									}
									return { target: 'staging' }
								}
							},
							staging: {
								invoke: {
									src: 'stage',
									input: ({ context }) => ({
										tx: required(context.tx),
										request: context.request,
										identifiers: required(context.identifiers),
										assessment: required(context.assessment)
									}),
									onDone: { target: 'checkingAfterStage' },
									onError: (args) => {
										return {
											target: 'rollingBack',
											context: {
												result: {
													outcome: 'unavailable',
													settlement: 'notStarted',
													error: args.event.error
												}
											}
										}
									}
								}
							},
							checkingAfterStage: {
								always: (args) => {
									if (matchesState({ running: { control: 'closing' } }, args.value)) {
										return { target: 'rollingBack' }
									}
									if (matchesState({ running: { control: 'cancelling' } }, args.value)) {
										return { target: 'rollingBack' }
									}
									if (matchesState({ running: { control: 'invalidated' } }, args.value)) {
										return { target: 'rollingBack' }
									}
									return { target: 'committing' }
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
											target: 'finishing',
											context: {
												result: {
													outcome: 'unavailable',
													settlement: 'unresolved',
													error: args.event.error
												}
											}
										}
									}
								}
							},
							settling: {
								initial: 'identifying',
								states: {
									identifying: {
										invoke: {
											src: 'identifyWrite',
											input: ({ context }) => required(context.write),
											onDone: (args, enq) => {
												let context = args.context
												const { event } = args
												let patch = {}
												patch = { ...patch, transactionId: event.output }
												context = { ...args.context, ...patch }
												enq(() =>
													context.request.trackWrite({
														transactionId: event.output,
														operation: 'create',
														transferId: required(context.identifiers).transferId
													})
												)
												return { target: 'waiting', context: patch }
											},
											onError: (args) => {
												return {
													target: '#internal-transfer-create.terminal',
													context: {
														result: {
															outcome: 'unavailable',
															settlement: 'unresolved',
															error: args.event.error
														}
													}
												}
											}
										}
									},
									waiting: {
										invoke: {
											src: 'settle',
											input: ({ context }) => required(context.write),
											onDone: (args) => {
												const { context } = args
												return {
													target: '#internal-transfer-create.terminal',
													context: {
														result: {
															outcome: 'succeeded',
															settlement: 'locallyPersisted',
															transferId: required(context.identifiers).transferId,
															expenseTransactionId: required(context.identifiers)
																.expenseTransactionId,
															incomeTransactionId: required(context.identifiers).incomeTransactionId
														}
													}
												}
											},
											onError: (args) => {
												return {
													target: '#internal-transfer-create.terminal',
													context: {
														result: {
															outcome: 'unavailable',
															settlement: 'unresolved',
															error: args.event.error
														}
													}
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
										return {
											target: 'finishing',
											context: { result: settlementResult(args.context.result, args.event.output) }
										}
									},
									onError: (args) => {
										return {
											target: 'finishing',
											context: {
												result: {
													outcome: 'unavailable',
													settlement: 'unresolved',
													error: args.event.error
												}
											}
										}
									}
								}
							},
							finishing: {
								always: (args) => {
									const { context } = args
									if (matchesState({ running: { control: 'closing' } }, args.value)) {
										return {
											target: '#internal-transfer-create.terminal',
											context: {
												result: context.result ?? { outcome: 'closed', settlement: 'notStarted' }
											}
										}
									}
									if (matchesState({ running: { control: 'cancelling' } }, args.value)) {
										return {
											target: '#internal-transfer-create.terminal',
											context: {
												result: context.result ?? { outcome: 'cancelled', settlement: 'notStarted' }
											}
										}
									}
									if (matchesState({ running: { control: 'invalidated' } }, args.value)) {
										return {
											target: '#internal-transfer-create.terminal',
											context: {
												result: context.result ?? {
													outcome: 'scopeChanged',
													settlement: 'notStarted'
												}
											}
										}
									}
									return {
										target: '#internal-transfer-create.terminal',
										context: {
											result: context.result ?? { outcome: 'unavailable', settlement: 'notStarted' }
										}
									}
								}
							}
						}
					}
				}
			},
			terminal: { type: 'final' }
		}
	})
}
