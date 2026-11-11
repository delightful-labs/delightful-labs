import { EXPENSE, INCOME } from '#lib/domain/transaction-kind.js'
import { canDeleteAccount, canWriteAccount } from '#lib/domain/organization-permissions.js'
import { findInternalTransferCounterparts } from '#lib/domain/internal-transfer.js'
import type { getDb } from 'jazz-tools/svelte'
import {
	app,
	type InternalTransfer,
	type OrganizationMember,
	type TransactionRow
} from '#lib/schema.js'
import { createJazzTransactionActors } from '../persistence/jazz-transaction-actors.js'
import { setup, types, createAsyncLogic, matchesState } from 'xstate'
import type { OutputFrom } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'

type LocalWrite = {
	txId: Promise<string>
	wait(options: { tier: 'local' }): Promise<void>
}
type JazzTransaction = ReturnType<ReturnType<typeof getDb>['beginTransaction']>
type Tx = Pick<JazzTransaction, 'one' | 'all' | 'insert' | 'update' | 'delete' | 'rollback'> & {
	commit(): LocalWrite
}
type Db = { beginTransaction(): Tx }
type TransferWrite = LocalWrite & { txId: Promise<string> }
type TransferReadDb = Pick<ReturnType<typeof getDb>, 'one' | 'all'>
type TransferEndpointRequest = {
	db: TransferReadDb
	organizationId: string
	identityId: string
	transferId: string
	expenseTransactionId: string
	incomeTransactionId: string
}
type UnlinkDb = TransferReadDb & {
	transaction(callback: (tx: Pick<JazzTransaction, 'update'>) => void): Promise<TransferWrite>
	delete(table: typeof app.internalTransfers, id: string): TransferWrite
}
type DeleteDb = TransferReadDb & {
	transaction(
		callback: (tx: Pick<JazzTransaction, 'update' | 'delete'>) => void
	): Promise<TransferWrite>
}
type Grant = { accountId: string; access: 'read' | 'write'; canDelete: boolean }
export type TransferWriteTracking = {
	transactionId: string
	operation: 'create' | 'link' | 'unlink' | 'delete'
	transferId: string
}
type TrackTransferWrite = (write: TransferWriteTracking) => void
export type InternalTransferLinkInput = {
	db: Db
	organizationId: string
	identityId: string
	expenseTransactionId: string
	incomeTransactionId: string
	trackWrite: TrackTransferWrite
}
export type InternalTransferLinkEvent = { type: 'CANCEL' } | { type: 'SHUTDOWN' }
export type InternalTransferLinkResult =
	| { outcome: 'succeeded'; transferId: string; settlement: 'locallyPersisted' }
	| {
			outcome: 'cancelled' | 'closed' | 'denied' | 'incompatible' | 'alreadyLinked' | 'unavailable'
			settlement: 'notStarted' | 'unresolved'
			phase?: 'commit' | 'localSettlement'
			error?: unknown
	  }

export type InternalTransferUnlinkResult =
	| { outcome: 'succeeded'; transferId: string; settlement: 'locallyPersisted' }
	| {
			outcome: 'recoveryRequired'
			transferId: string
			settlement: 'locallyPersisted' | 'unresolved'
			error?: unknown
	  }
	| {
			outcome: 'cancelled' | 'closed' | 'denied' | 'incompatible' | 'unavailable'
			settlement: 'notStarted' | 'unresolved'
			error?: unknown
	  }

export type InternalTransferDeleteResult =
	| {
			outcome: 'succeeded'
			transferId: string
			choice: InternalTransferDeleteChoice
			deletedTransactionIds: readonly string[]
			settlement: 'locallyPersisted'
	  }
	| {
			outcome: 'recoveryRequired'
			transferId: string
			choice: InternalTransferDeleteChoice
			settlement: 'locallyPersisted' | 'unresolved'
			phase: 'clearingMarkers' | 'deletingRecords'
			error?: unknown
	  }
	| {
			outcome: 'cancelled' | 'closed' | 'denied' | 'incompatible' | 'unavailable'
			settlement: 'notStarted' | 'unresolved'
			error?: unknown
	  }

type Endpoint = Pick<
	TransactionRow,
	| 'id'
	| 'organizationId'
	| 'accountId'
	| 'kind'
	| 'amountMinor'
	| 'currency'
	| 'bookedOn'
	| 'internalTransferId'
>
type Records = {
	expense: Endpoint | null
	income: Endpoint | null
	membership: OrganizationMember | null
	grants: Grant[]
	links: InternalTransfer[]
}
type Assessment =
	| { outcome: 'eligible'; expense: Endpoint; income: Endpoint }
	| { outcome: 'denied' | 'incompatible' | 'alreadyLinked' | 'unavailable' }

function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Missing internal transfer transaction resource')
	return value
}
function eligibleAssessment(
	value: Assessment | undefined
): Extract<Assessment, { outcome: 'eligible' }> {
	if (value?.outcome !== 'eligible') throw new Error('Transfer link was not eligible')
	return value
}

const transactionActors = createJazzTransactionActors(
	(db: Db) => db.beginTransaction(),
	(write: ReturnType<Tx['commit']>) => write.wait({ tier: 'local' })
)
const { open, commit, settle, rollback } = transactionActors
const identifyTransferWrite = createAsyncLogic({
	run: ({ input }: { input: TransferWrite }) => input.txId
})
const read = createAsyncLogic({
	run: async ({
		input
	}: {
		input: { tx: Tx; request: InternalTransferLinkInput }
	}): Promise<Records> => {
		const { tx, request } = input
		const [
			expense,
			income,
			membership,
			grants,
			expenseOutgoing,
			expenseIncoming,
			incomeOutgoing,
			incomeIncoming
		] = await Promise.all([
			tx.one(app.transactions.where({ id: request.expenseTransactionId })),
			tx.one(app.transactions.where({ id: request.incomeTransactionId })),
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
			tx.all(app.internalTransfers.where({ expenseTransactionId: request.expenseTransactionId })),
			tx.all(app.internalTransfers.where({ incomeTransactionId: request.expenseTransactionId })),
			tx.all(app.internalTransfers.where({ expenseTransactionId: request.incomeTransactionId })),
			tx.all(app.internalTransfers.where({ incomeTransactionId: request.incomeTransactionId }))
		])
		return {
			expense,
			income,
			membership,
			grants: grants.map(({ accountId, access, canDelete }) => ({ accountId, access, canDelete })),
			links: [...expenseOutgoing, ...expenseIncoming, ...incomeOutgoing, ...incomeIncoming]
		}
	}
})

function assess(records: Records, request: InternalTransferLinkInput): Assessment {
	const { expense, income, membership, grants, links } = records
	if (!expense || !income) return { outcome: 'unavailable' }
	if (links.length > 0 || expense.internalTransferId || income.internalTransferId)
		return { outcome: 'alreadyLinked' }
	if (
		expense.organizationId !== request.organizationId ||
		income.organizationId !== request.organizationId ||
		expense.kind !== EXPENSE ||
		income.kind !== INCOME
	)
		return { outcome: 'incompatible' }
	if (
		!canWriteAccount(membership, request.organizationId, expense.accountId, grants) ||
		!canWriteAccount(membership, request.organizationId, income.accountId, grants)
	)
		return { outcome: 'denied' }
	const candidates = findInternalTransferCounterparts(expense, [income], new Set())
	return candidates.length === 1
		? { outcome: 'eligible', expense, income }
		: { outcome: 'incompatible' }
}

const stage = createAsyncLogic({
	run: ({
		input
	}: {
		input: { tx: Tx; assessment: Extract<Assessment, { outcome: 'eligible' }> }
	}) => {
		const { tx, assessment } = input
		const transferId = crypto.randomUUID()
		tx.update(app.transactions, assessment.expense.id, { internalTransferId: transferId })
		tx.update(app.transactions, assessment.income.id, { internalTransferId: transferId })
		const transfer = tx.insert(
			app.internalTransfers,
			{
				organizationId: assessment.expense.organizationId,
				expenseTransactionId: assessment.expense.id,
				incomeTransactionId: assessment.income.id,
				expenseAccountId: assessment.expense.accountId,
				incomeAccountId: assessment.income.accountId,
				expenseAmountMinor: assessment.expense.amountMinor,
				expenseCurrency: assessment.expense.currency,
				incomeAmountMinor: assessment.income.amountMinor,
				incomeCurrency: assessment.income.currency
			},
			{ id: transferId }
		)
		return Promise.resolve(transfer.id)
	}
})

export type InternalTransferUnlinkInput = Omit<TransferEndpointRequest, 'db'> & {
	db: UnlinkDb
	trackWrite: TrackTransferWrite
}
export type InternalTransferDeleteChoice =
	{ kind: 'both' } | { kind: 'selected'; transactionId: string }
export type InternalTransferDeleteInput = Omit<TransferEndpointRequest, 'db'> & {
	db: DeleteDb
	trackWrite: TrackTransferWrite
	choice: InternalTransferDeleteChoice
}
type UnlinkRecords = {
	transfer: InternalTransfer | null
	expense: Endpoint | null
	income: Endpoint | null
	membership: OrganizationMember | null
	grants: Grant[]
}
type UnlinkAssessment =
	| {
			outcome: 'eligible'
			state: 'linked' | 'pending'
			transfer: InternalTransfer
			expense: Endpoint
			income: Endpoint
	  }
	| { outcome: 'denied' | 'incompatible' | 'unavailable' }
type DeleteAssessment =
	| (Extract<UnlinkAssessment, { outcome: 'eligible' }> & { transactionIds: readonly string[] })
	| { outcome: 'denied' | 'incompatible' | 'unavailable' }
type UnlinkContext = {
	request: InternalTransferUnlinkInput
	records: UnlinkRecords | undefined
	assessment: UnlinkAssessment | undefined
	write: TransferWrite | undefined
	result: InternalTransferUnlinkResult | undefined
}
type EligibleUnlink = Extract<UnlinkAssessment, { outcome: 'eligible' }>

function eligibleUnlink(value: UnlinkAssessment | undefined): EligibleUnlink {
	if (value?.outcome !== 'eligible') throw new Error('Transfer unlink was not eligible')
	return value
}

const readUnlink = createAsyncLogic({
	run: async ({ input }: { input: TransferEndpointRequest }): Promise<UnlinkRecords> => {
		const [transfer, expense, income, membership, grants] = await Promise.all([
			input.db.one(app.internalTransfers.where({ id: input.transferId })),
			input.db.one(app.transactions.where({ id: input.expenseTransactionId })),
			input.db.one(app.transactions.where({ id: input.incomeTransactionId })),
			input.db.one(
				app.organizationMembers.where({
					organizationId: input.organizationId,
					userId: input.identityId
				})
			),
			input.db.all(
				app.accountMemberships.where({
					organizationId: input.organizationId,
					userId: input.identityId
				})
			)
		])
		return {
			transfer,
			expense,
			income,
			membership,
			grants: grants.map(({ accountId, access, canDelete }) => ({ accountId, access, canDelete }))
		}
	}
})

function assessUnlink(records: UnlinkRecords, request: TransferEndpointRequest): UnlinkAssessment {
	const { transfer, expense, income, membership, grants } = records
	if (!transfer) return { outcome: 'unavailable' }
	if (transfer.organizationId !== request.organizationId) return { outcome: 'incompatible' }
	if (
		!expense ||
		!income ||
		expense.id !== transfer.expenseTransactionId ||
		income.id !== transfer.incomeTransactionId ||
		expense.organizationId !== request.organizationId ||
		income.organizationId !== request.organizationId ||
		expense.accountId !== transfer.expenseAccountId ||
		income.accountId !== transfer.incomeAccountId ||
		expense.kind !== EXPENSE ||
		income.kind !== INCOME ||
		!transferEndpointMatches(expense, transfer, 'expense') ||
		!transferEndpointMatches(income, transfer, 'income') ||
		expense.accountId === income.accountId
	)
		return { outcome: 'incompatible' }
	if (
		!canWriteAccount(membership, request.organizationId, expense.accountId, grants) ||
		!canWriteAccount(membership, request.organizationId, income.accountId, grants)
	)
		return { outcome: 'denied' }
	const linked =
		expense.internalTransferId === transfer.id && income.internalTransferId === transfer.id
	const pending = expense.internalTransferId == null && income.internalTransferId == null
	if (!linked && !pending) return { outcome: 'incompatible' }
	return { outcome: 'eligible', state: pending ? 'pending' : 'linked', transfer, expense, income }
}

function transferEndpointMatches(
	transaction: Endpoint,
	transfer: InternalTransfer,
	side: 'expense' | 'income'
): boolean {
	const sideCurrency = side === 'expense' ? transfer.expenseCurrency : transfer.incomeCurrency
	const sideAmount = side === 'expense' ? transfer.expenseAmountMinor : transfer.incomeAmountMinor
	return sideCurrency == null
		? transaction.amountMinor === transfer.amountMinor && transaction.currency === transfer.currency
		: transaction.amountMinor === sideAmount && transaction.currency === sideCurrency
}

const clearUnlinkMarkers = createAsyncLogic({
	run: ({
		input
	}: {
		input: { request: InternalTransferUnlinkInput; assessment: EligibleUnlink }
	}): Promise<TransferWrite> => {
		return input.request.db.transaction((tx) => {
			tx.update(app.transactions, input.assessment.expense.id, { internalTransferId: null })
			tx.update(app.transactions, input.assessment.income.id, { internalTransferId: null })
		})
	}
})
const deleteUnlinkRelationship = createAsyncLogic({
	run: ({
		input
	}: {
		input: { request: InternalTransferUnlinkInput; assessment: EligibleUnlink }
	}): Promise<TransferWrite> =>
		Promise.resolve(input.request.db.delete(app.internalTransfers, input.assessment.transfer.id))
})
const settleUnlinkWrite = createAsyncLogic({
	run: ({ input }: { input: TransferWrite }) => input.wait({ tier: 'local' })
})

type EligibleDelete = Extract<DeleteAssessment, { outcome: 'eligible' }>
function eligibleDelete(value: DeleteAssessment | undefined): EligibleDelete {
	if (value?.outcome !== 'eligible') throw new Error('Transfer deletion was not eligible')
	return value
}
const clearDeleteMarkers = createAsyncLogic({
	run: ({
		input
	}: {
		input: { request: InternalTransferDeleteInput; assessment: EligibleUnlink }
	}) =>
		input.request.db.transaction((tx) => {
			tx.update(app.transactions, input.assessment.expense.id, { internalTransferId: null })
			tx.update(app.transactions, input.assessment.income.id, { internalTransferId: null })
		})
})
const deleteTransferBundle = createAsyncLogic({
	run: ({
		input
	}: {
		input: { request: InternalTransferDeleteInput; assessment: EligibleDelete }
	}): Promise<TransferWrite> =>
		input.request.db.transaction((tx) => {
			tx.delete(app.internalTransfers, input.assessment.transfer.id)
			for (const transactionId of input.assessment.transactionIds)
				tx.delete(app.transactions, transactionId)
		})
})
const events2 = {
	CANCEL: types<EventPayload<InternalTransferLinkEvent, 'CANCEL'>>(),
	SHUTDOWN: types<EventPayload<InternalTransferLinkEvent, 'SHUTDOWN'>>()
}
type NativeEvent2 =
	| import('xstate').InferEvents<typeof events2>
	| import('xstate').DoneActorEvent<
			| import('xstate').OutputFrom<typeof readUnlink>
			| import('xstate').OutputFrom<typeof clearUnlinkMarkers>
			| import('xstate').OutputFrom<typeof deleteUnlinkRelationship>
			| import('xstate').OutputFrom<typeof identifyTransferWrite>
			| import('xstate').OutputFrom<typeof settleUnlinkWrite>
	  >
	| import('xstate').ErrorActorEvent
	| import('xstate').AfterEvent
	| import('xstate').DoneStateEvent
	| import('xstate').SnapshotEvent
	| import('xstate').TimeoutEvent
	| import('xstate').ActorTimeoutEvent
	| import('xstate').ErrorPlatformEvent

/** Owns ordered local-first unlink writes and exposes partial completion for recovery. */
export const internalTransferUnlinkMachine = setup({
	schemas: {
		context: types<UnlinkContext>(),
		events: events2,
		input: types<InternalTransferUnlinkInput>(),
		output: types<InternalTransferUnlinkResult>(),
		children: {
			read: types<
				import('xstate').ActorRefFrom<
					{
						read: typeof readUnlink
						clearMarkers: typeof clearUnlinkMarkers
						deleteRelationship: typeof deleteUnlinkRelationship
						identifyTransferWrite: typeof identifyTransferWrite
						settleWrite: typeof settleUnlinkWrite
					}['read']
				>
			>(),
			clearMarkers: types<
				import('xstate').ActorRefFrom<
					{
						read: typeof readUnlink
						clearMarkers: typeof clearUnlinkMarkers
						deleteRelationship: typeof deleteUnlinkRelationship
						identifyTransferWrite: typeof identifyTransferWrite
						settleWrite: typeof settleUnlinkWrite
					}['clearMarkers']
				>
			>(),
			deleteRelationship: types<
				import('xstate').ActorRefFrom<
					{
						read: typeof readUnlink
						clearMarkers: typeof clearUnlinkMarkers
						deleteRelationship: typeof deleteUnlinkRelationship
						identifyTransferWrite: typeof identifyTransferWrite
						settleWrite: typeof settleUnlinkWrite
					}['deleteRelationship']
				>
			>(),
			identifyTransferWrite: types<
				import('xstate').ActorRefFrom<
					{
						read: typeof readUnlink
						clearMarkers: typeof clearUnlinkMarkers
						deleteRelationship: typeof deleteUnlinkRelationship
						identifyTransferWrite: typeof identifyTransferWrite
						settleWrite: typeof settleUnlinkWrite
					}['identifyTransferWrite']
				>
			>(),
			settleWrite: types<
				import('xstate').ActorRefFrom<
					{
						read: typeof readUnlink
						clearMarkers: typeof clearUnlinkMarkers
						deleteRelationship: typeof deleteUnlinkRelationship
						identifyTransferWrite: typeof identifyTransferWrite
						settleWrite: typeof settleUnlinkWrite
					}['settleWrite']
				>
			>()
		}
	},
	actors: {
		read: readUnlink,
		clearMarkers: clearUnlinkMarkers,
		deleteRelationship: deleteUnlinkRelationship,
		identifyTransferWrite,
		settleWrite: settleUnlinkWrite
	},
	guards: {
		closing: (args: { value: import('xstate').StateValue }) =>
			matchesState({ running: { control: 'closing' } }, args.value),
		cancelling: (args: { value: import('xstate').StateValue }) =>
			matchesState({ running: { control: 'cancelling' } }, args.value)
	}
}).createMachine({
	id: 'internal-transfer-unlink',
	context: ({ input }) => ({
		request: input,
		records: undefined,
		assessment: undefined,
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
					initial: 'reading',
					states: {
						reading: {
							invoke: {
								src: 'read',
								input: ({ context }) => context.request,
								onDone: (args) => {
									return { target: 'checkingAfterRead', context: { records: args.event.output } }
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
						checkingAfterRead: {
							always: (args) => {
								if (matchesState({ running: { control: 'closing' } }, args.value)) {
									return {
										target: 'finishing',
										context: { result: { outcome: 'closed', settlement: 'notStarted' } }
									}
								}
								if (matchesState({ running: { control: 'cancelling' } }, args.value)) {
									return {
										target: 'finishing',
										context: { result: { outcome: 'cancelled', settlement: 'notStarted' } }
									}
								}
								return { target: 'assessing' }
							}
						},
						assessing: {
							always: (args) => {
								const { context } = args
								return {
									target: 'checkingAssessment',
									context: { assessment: assessUnlink(required(context.records), context.request) }
								}
							}
						},
						checkingAssessment: {
							always: (args) => {
								const { context } = args
								if (matchesState({ running: { control: 'closing' } }, args.value)) {
									return {
										target: 'finishing',
										context: { result: { outcome: 'closed', settlement: 'notStarted' } }
									}
								}
								if (matchesState({ running: { control: 'cancelling' } }, args.value)) {
									return {
										target: 'finishing',
										context: { result: { outcome: 'cancelled', settlement: 'notStarted' } }
									}
								}
								if (required(context.assessment).outcome !== 'eligible') {
									return {
										target: 'finishing',
										context: {
											result: (({ context }): InternalTransferUnlinkResult => {
												const assessment = required(context.assessment)
												return assessment.outcome === 'eligible'
													? { outcome: 'unavailable', settlement: 'notStarted' }
													: { outcome: assessment.outcome, settlement: 'notStarted' }
											})(args)
										}
									}
								}
								if (
									context.assessment?.outcome === 'eligible' &&
									context.assessment.state === 'pending'
								) {
									return { target: 'deleting' }
								}
								return { target: 'clearingMarkers' }
							}
						},
						clearingMarkers: {
							invoke: {
								src: 'clearMarkers',
								input: ({ context }) => ({
									request: context.request,
									assessment: eligibleUnlink(context.assessment)
								}),
								onDone: (args) => {
									return { target: 'identifyingClearWrite', context: { write: args.event.output } }
								},
								onError: (args) => {
									return {
										target: 'finishing',
										context: {
											result: {
												outcome: 'recoveryRequired',
												transferId: eligibleUnlink(args.context.assessment).transfer.id,
												settlement: 'unresolved',
												error: args.event.error
											}
										}
									}
								}
							}
						},
						identifyingClearWrite: {
							invoke: {
								src: 'identifyTransferWrite',
								input: ({ context }) => required(context.write),
								onDone: (args, enq) => {
									const { context } = args
									enq(() =>
										context.request.trackWrite({
											transactionId: args.event.output,
											operation: 'unlink',
											transferId: eligibleUnlink(context.assessment).transfer.id
										})
									)
									return { target: 'settlingClearWrite' }
								},
								onError: (args) => {
									return {
										target: 'finishing',
										context: {
											result: {
												outcome: 'recoveryRequired',
												transferId: eligibleUnlink(args.context.assessment).transfer.id,
												settlement: 'unresolved',
												error: args.event.error
											}
										}
									}
								}
							}
						},
						settlingClearWrite: {
							invoke: {
								src: 'settleWrite',
								input: ({ context }) => required(context.write),
								onDone: { target: 'checkingAfterClear' },
								onError: (args) => {
									return {
										target: 'finishing',
										context: {
											result: {
												outcome: 'recoveryRequired',
												transferId: eligibleUnlink(args.context.assessment).transfer.id,
												settlement: 'unresolved',
												error: args.event.error
											}
										}
									}
								}
							}
						},
						checkingAfterClear: {
							always: (args) => {
								const { context } = args
								if (matchesState({ running: { control: 'closing' } }, args.value)) {
									return {
										target: 'finishing',
										context: {
											result: {
												outcome: 'recoveryRequired',
												transferId: eligibleUnlink(context.assessment).transfer.id,
												settlement: 'locallyPersisted'
											}
										}
									}
								}
								if (matchesState({ running: { control: 'cancelling' } }, args.value)) {
									return {
										target: 'finishing',
										context: {
											result: {
												outcome: 'recoveryRequired',
												transferId: eligibleUnlink(context.assessment).transfer.id,
												settlement: 'locallyPersisted'
											}
										}
									}
								}
								return { target: 'deleting' }
							}
						},
						deleting: {
							invoke: {
								src: 'deleteRelationship',
								input: ({ context }) => ({
									request: context.request,
									assessment: eligibleUnlink(context.assessment)
								}),
								onDone: (args) => {
									return { target: 'identifyingDeleteWrite', context: { write: args.event.output } }
								},
								onError: (args) => {
									return {
										target: 'finishing',
										context: {
											result: {
												outcome: 'recoveryRequired',
												transferId: eligibleUnlink(args.context.assessment).transfer.id,
												settlement: 'locallyPersisted',
												error: args.event.error
											}
										}
									}
								}
							}
						},
						identifyingDeleteWrite: {
							invoke: {
								src: 'identifyTransferWrite',
								input: ({ context }) => required(context.write),
								onDone: (args, enq) => {
									const { context } = args
									enq(() =>
										context.request.trackWrite({
											transactionId: args.event.output,
											operation: 'unlink',
											transferId: eligibleUnlink(context.assessment).transfer.id
										})
									)
									return { target: 'settlingDeleteWrite' }
								},
								onError: (args) => {
									return {
										target: 'finishing',
										context: {
											result: {
												outcome: 'recoveryRequired',
												transferId: eligibleUnlink(args.context.assessment).transfer.id,
												settlement: 'locallyPersisted',
												error: args.event.error
											}
										}
									}
								}
							}
						},
						settlingDeleteWrite: {
							invoke: {
								src: 'settleWrite',
								input: ({ context }) => required(context.write),
								onDone: (args) => {
									return {
										target: 'finishing',
										context: {
											result: {
												outcome: 'succeeded',
												transferId: eligibleUnlink(args.context.assessment).transfer.id,
												settlement: 'locallyPersisted'
											}
										}
									}
								},
								onError: (args) => {
									return {
										target: 'finishing',
										context: {
											result: {
												outcome: 'recoveryRequired',
												transferId: eligibleUnlink(args.context.assessment).transfer.id,
												settlement: 'locallyPersisted',
												error: args.event.error
											}
										}
									}
								}
							}
						},
						finishing: { always: { target: '#internal-transfer-unlink.terminal' } }
					}
				}
			}
		},
		terminal: { type: 'final' }
	}
})

type DeleteContext = {
	request: InternalTransferDeleteInput
	records: UnlinkRecords | undefined
	pairState: 'linked' | 'pending' | undefined
	assessment: DeleteAssessment | undefined
	write: TransferWrite | undefined
	result: InternalTransferDeleteResult | undefined
}
const deleteActors = {
	read: readUnlink,
	clearMarkers: clearDeleteMarkers,
	identifyTransferWrite,
	settleWrite: settleUnlinkWrite,
	deleteBundle: deleteTransferBundle
}
function deleteRecovery(
	context: DeleteContext,
	phase: 'clearingMarkers' | 'deletingRecords',
	settlement: 'locallyPersisted' | 'unresolved',
	error?: unknown
): InternalTransferDeleteResult {
	const assessment = eligibleDelete(context.assessment)
	return {
		outcome: 'recoveryRequired',
		transferId: assessment.transfer.id,
		choice: context.request.choice,
		settlement,
		phase,
		...(error === undefined ? {} : { error })
	}
}
function prepareDeleteAssessment(context: DeleteContext): DeleteAssessment {
	const records = required(context.records)
	const transfer = requiredDeleteRecord(records.transfer)
	const expense = requiredDeleteRecord(records.expense)
	const income = requiredDeleteRecord(records.income)
	const transactionIds =
		context.request.choice.kind === 'both'
			? [expense.id, income.id]
			: [context.request.choice.transactionId]
	return {
		outcome: 'eligible',
		state: required(context.pairState),
		transfer,
		expense,
		income,
		transactionIds
	}
}
function requiredDeleteRecord<Value>(value: Value | null): Value {
	if (value === null) throw new Error('Missing verified transfer deletion record')
	return value
}
const events1 = {
	CANCEL: types<EventPayload<InternalTransferLinkEvent, 'CANCEL'>>(),
	SHUTDOWN: types<EventPayload<InternalTransferLinkEvent, 'SHUTDOWN'>>()
}
type NativeEvent1 =
	| import('xstate').InferEvents<typeof events1>
	| import('xstate').DoneActorEvent<
			| import('xstate').OutputFrom<(typeof deleteActors)['read']>
			| import('xstate').OutputFrom<(typeof deleteActors)['clearMarkers']>
			| import('xstate').OutputFrom<(typeof deleteActors)['identifyTransferWrite']>
			| import('xstate').OutputFrom<(typeof deleteActors)['settleWrite']>
			| import('xstate').OutputFrom<(typeof deleteActors)['deleteBundle']>
	  >
	| import('xstate').ErrorActorEvent
	| import('xstate').AfterEvent
	| import('xstate').DoneStateEvent
	| import('xstate').SnapshotEvent
	| import('xstate').TimeoutEvent
	| import('xstate').ActorTimeoutEvent
	| import('xstate').ErrorPlatformEvent
export const internalTransferDeleteMachine = setup({
	schemas: {
		context: types<DeleteContext>(),
		events: events1,
		input: types<InternalTransferDeleteInput>(),
		output: types<InternalTransferDeleteResult>(),
		children: {
			read: types<import('xstate').ActorRefFrom<(typeof deleteActors)['read']>>(),
			clearMarkers: types<import('xstate').ActorRefFrom<(typeof deleteActors)['clearMarkers']>>(),
			identifyTransferWrite:
				types<import('xstate').ActorRefFrom<(typeof deleteActors)['identifyTransferWrite']>>(),
			settleWrite: types<import('xstate').ActorRefFrom<(typeof deleteActors)['settleWrite']>>(),
			deleteBundle: types<import('xstate').ActorRefFrom<(typeof deleteActors)['deleteBundle']>>()
		}
	},
	actors: deleteActors,
	guards: {
		closing: (args: { value: import('xstate').StateValue }) =>
			matchesState({ running: { control: 'closing' } }, args.value),
		cancelling: (args: { value: import('xstate').StateValue }) =>
			matchesState({ running: { control: 'cancelling' } }, args.value),
		transferWorkspaceMatches: ({ context }: { context: DeleteContext }) =>
			context.records?.transfer?.organizationId === context.request.organizationId,
		endpointFactsMatch: ({ context }: { context: DeleteContext }) => {
			const records = context.records
			const transfer = records?.transfer
			const expense = records?.expense
			const income = records?.income
			return Boolean(
				transfer &&
				expense &&
				income &&
				expense.id === transfer.expenseTransactionId &&
				income.id === transfer.incomeTransactionId &&
				expense.organizationId === context.request.organizationId &&
				income.organizationId === context.request.organizationId &&
				expense.accountId === transfer.expenseAccountId &&
				income.accountId === transfer.incomeAccountId &&
				expense.kind === EXPENSE &&
				income.kind === INCOME &&
				transferEndpointMatches(expense, transfer, 'expense') &&
				transferEndpointMatches(income, transfer, 'income') &&
				expense.accountId !== income.accountId
			)
		},
		markersLinked: ({ context }: { context: DeleteContext }) => {
			const transfer = context.records?.transfer
			return Boolean(
				transfer &&
				context.records?.expense?.internalTransferId === transfer.id &&
				context.records?.income?.internalTransferId === transfer.id
			)
		},
		markersPending: ({ context }: { context: DeleteContext }) =>
			context.records?.expense?.internalTransferId == null &&
			context.records?.income?.internalTransferId == null,
		canWriteExpense: ({ context }: { context: DeleteContext }) =>
			Boolean(
				context.records?.expense &&
				canWriteAccount(
					context.records.membership,
					context.request.organizationId,
					context.records.expense.accountId,
					context.records.grants
				)
			),
		canWriteIncome: ({ context }: { context: DeleteContext }) =>
			Boolean(
				context.records?.income &&
				canWriteAccount(
					context.records.membership,
					context.request.organizationId,
					context.records.income.accountId,
					context.records.grants
				)
			),
		deleteChoiceValid: ({ context }: { context: DeleteContext }) => {
			const { choice } = context.request
			return (
				choice.kind === 'both' ||
				choice.transactionId === context.records?.expense?.id ||
				choice.transactionId === context.records?.income?.id
			)
		},
		deleteBoth: ({ context }: { context: DeleteContext }) => context.request.choice.kind === 'both',
		canDeleteExpense: ({ context }: { context: DeleteContext }) =>
			Boolean(
				context.records?.expense &&
				canDeleteAccount(
					context.records.membership,
					context.request.organizationId,
					context.records.expense.accountId,
					context.records.grants
				)
			),
		canDeleteIncome: ({ context }: { context: DeleteContext }) =>
			Boolean(
				context.records?.income &&
				canDeleteAccount(
					context.records.membership,
					context.request.organizationId,
					context.records.income.accountId,
					context.records.grants
				)
			),
		selectedIncome: ({ context }: { context: DeleteContext }) =>
			context.request.choice.kind === 'selected' &&
			context.request.choice.transactionId === context.records?.income?.id
	}
}).createMachine({
	id: 'internal-transfer-delete',
	context: ({ input }) => ({
		request: input,
		records: undefined,
		pairState: undefined,
		assessment: undefined,
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
					initial: 'reading',
					states: {
						reading: {
							invoke: {
								src: 'read',
								input: ({ context }) => context.request,
								onDone: (args) => {
									return { target: 'checkingAfterRead', context: { records: args.event.output } }
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
						checkingAfterRead: {
							always: (args) => {
								if (matchesState({ running: { control: 'closing' } }, args.value)) {
									return {
										target: 'finishing',
										context: { result: { outcome: 'closed', settlement: 'notStarted' } }
									}
								}
								if (matchesState({ running: { control: 'cancelling' } }, args.value)) {
									return {
										target: 'finishing',
										context: { result: { outcome: 'cancelled', settlement: 'notStarted' } }
									}
								}
								return { target: 'checkingTransfer' }
							}
						},
						checkingTransfer: {
							always: (args) => {
								const { context } = args
								if (context.records?.transfer == null) {
									return {
										target: 'finishing',
										context: { result: { outcome: 'unavailable', settlement: 'notStarted' } }
									}
								}
								if (args.guards.transferWorkspaceMatches(args)) {
									return { target: 'checkingEndpoints' }
								}
								if (context.records?.transfer !== null) {
									return {
										target: 'finishing',
										context: { result: { outcome: 'incompatible', settlement: 'notStarted' } }
									}
								}
							}
						},
						checkingEndpoints: {
							always: (args) => {
								const { context } = args
								if (!context.records?.expense || !context.records?.income) {
									return {
										target: 'finishing',
										context: { result: { outcome: 'unavailable', settlement: 'notStarted' } }
									}
								}
								if (args.guards.endpointFactsMatch(args)) {
									return { target: 'checkingMarkers' }
								}
								return {
									target: 'finishing',
									context: { result: { outcome: 'incompatible', settlement: 'notStarted' } }
								}
							}
						},
						checkingMarkers: {
							always: (args) => {
								if (args.guards.markersLinked(args)) {
									return { target: 'checkingExpenseWrite', context: { pairState: 'linked' } }
								}
								if (args.guards.markersPending(args)) {
									return { target: 'checkingExpenseWrite', context: { pairState: 'pending' } }
								}
								return {
									target: 'finishing',
									context: { result: { outcome: 'incompatible', settlement: 'notStarted' } }
								}
							}
						},
						checkingExpenseWrite: {
							always: (args) => {
								if (args.guards.canWriteExpense(args)) {
									return { target: 'checkingIncomeWrite' }
								}
								return {
									target: 'finishing',
									context: { result: { outcome: 'denied', settlement: 'notStarted' } }
								}
							}
						},
						checkingIncomeWrite: {
							always: (args) => {
								if (args.guards.canWriteIncome(args)) {
									return { target: 'checkingChoice' }
								}
								return {
									target: 'finishing',
									context: { result: { outcome: 'denied', settlement: 'notStarted' } }
								}
							}
						},
						checkingChoice: {
							always: (args) => {
								if (args.guards.deleteChoiceValid(args)) {
									return { target: 'checkingChoiceKind' }
								}
								return {
									target: 'finishing',
									context: { result: { outcome: 'incompatible', settlement: 'notStarted' } }
								}
							}
						},
						checkingChoiceKind: {
							always: (args) => {
								if (args.guards.selectedIncome(args)) {
									return { target: 'checkingDeleteIncome' }
								}
								return { target: 'checkingDeleteExpense' }
							}
						},
						checkingDeleteExpense: {
							always: (args) => {
								if (args.guards.canDeleteExpense(args)) {
									return { target: 'checkingDeleteChoice' }
								}
								return {
									target: 'finishing',
									context: { result: { outcome: 'denied', settlement: 'notStarted' } }
								}
							}
						},
						checkingDeleteChoice: {
							always: (args) => {
								if (args.guards.deleteBoth(args)) {
									return { target: 'checkingDeleteIncome' }
								}
								return { target: 'preparingDeletion' }
							}
						},
						checkingDeleteIncome: {
							always: (args) => {
								if (args.guards.canDeleteIncome(args)) {
									return { target: 'preparingDeletion' }
								}
								return {
									target: 'finishing',
									context: { result: { outcome: 'denied', settlement: 'notStarted' } }
								}
							}
						},
						preparingDeletion: {
							always: (args) => {
								const { context } = args
								return {
									target: 'checkingAfterAssessment',
									context: { assessment: prepareDeleteAssessment(context) }
								}
							}
						},
						checkingAfterAssessment: {
							always: (args) => {
								if (matchesState({ running: { control: 'closing' } }, args.value)) {
									return {
										target: 'finishing',
										context: { result: { outcome: 'closed', settlement: 'notStarted' } }
									}
								}
								if (matchesState({ running: { control: 'cancelling' } }, args.value)) {
									return {
										target: 'finishing',
										context: { result: { outcome: 'cancelled', settlement: 'notStarted' } }
									}
								}
								if (args.context.pairState === 'pending') {
									return { target: 'deletingRecords' }
								}
								return { target: 'clearingMarkers' }
							}
						},
						clearingMarkers: {
							invoke: {
								src: 'clearMarkers',
								input: ({ context }) => ({
									request: context.request,
									assessment: eligibleUnlink(context.assessment)
								}),
								onDone: (args) => {
									return { target: 'identifyingClearWrite', context: { write: args.event.output } }
								},
								onError: (args) => {
									const { context } = args
									return {
										target: 'finishing',
										context: {
											result: deleteRecovery(
												context,
												'clearingMarkers',
												'unresolved',
												args.event.error
											)
										}
									}
								}
							}
						},
						identifyingClearWrite: {
							invoke: {
								src: 'identifyTransferWrite',
								input: ({ context }) => required(context.write),
								onDone: (args, enq) => {
									const { context } = args
									enq(() =>
										context.request.trackWrite({
											transactionId: args.event.output,
											operation: 'delete',
											transferId: eligibleDelete(context.assessment).transfer.id
										})
									)
									return { target: 'settlingClearWrite' }
								},
								onError: (args) => {
									const { context } = args
									return {
										target: 'finishing',
										context: {
											result: deleteRecovery(
												context,
												'clearingMarkers',
												'unresolved',
												args.event.error
											)
										}
									}
								}
							}
						},
						settlingClearWrite: {
							invoke: {
								src: 'settleWrite',
								input: ({ context }) => required(context.write),
								onDone: { target: 'checkingAfterClear' },
								onError: (args) => {
									const { context } = args
									return {
										target: 'finishing',
										context: {
											result: deleteRecovery(
												context,
												'clearingMarkers',
												'unresolved',
												args.event.error
											)
										}
									}
								}
							}
						},
						checkingAfterClear: {
							always: (args) => {
								const { context } = args
								if (matchesState({ running: { control: 'closing' } }, args.value)) {
									return {
										target: 'finishing',
										context: {
											result: deleteRecovery(context, 'clearingMarkers', 'locallyPersisted')
										}
									}
								}
								if (matchesState({ running: { control: 'cancelling' } }, args.value)) {
									return {
										target: 'finishing',
										context: {
											result: deleteRecovery(context, 'clearingMarkers', 'locallyPersisted')
										}
									}
								}
								return { target: 'deletingRecords' }
							}
						},
						deletingRecords: {
							invoke: {
								src: 'deleteBundle',
								input: ({ context }) => ({
									request: context.request,
									assessment: eligibleDelete(context.assessment)
								}),
								onDone: (args) => {
									return { target: 'identifyingDeleteWrite', context: { write: args.event.output } }
								},
								onError: (args) => {
									const { context } = args
									return {
										target: 'finishing',
										context: {
											result: deleteRecovery(
												context,
												'deletingRecords',
												'locallyPersisted',
												args.event.error
											)
										}
									}
								}
							}
						},
						identifyingDeleteWrite: {
							invoke: {
								src: 'identifyTransferWrite',
								input: ({ context }) => required(context.write),
								onDone: (args, enq) => {
									const { context } = args
									enq(() =>
										context.request.trackWrite({
											transactionId: args.event.output,
											operation: 'delete',
											transferId: eligibleDelete(context.assessment).transfer.id
										})
									)
									return { target: 'settlingDeleteWrite' }
								},
								onError: (args) => {
									const { context } = args
									return {
										target: 'finishing',
										context: {
											result: deleteRecovery(
												context,
												'deletingRecords',
												'locallyPersisted',
												args.event.error
											)
										}
									}
								}
							}
						},
						settlingDeleteWrite: {
							invoke: {
								src: 'settleWrite',
								input: ({ context }) => required(context.write),
								onDone: (args) => {
									return {
										target: 'finishing',
										context: {
											result: (({ context }): InternalTransferDeleteResult => {
												const assessment = eligibleDelete(context.assessment)
												return {
													outcome: 'succeeded',
													transferId: assessment.transfer.id,
													choice: context.request.choice,
													deletedTransactionIds: assessment.transactionIds,
													settlement: 'locallyPersisted'
												}
											})(args)
										}
									}
								},
								onError: (args) => {
									const { context } = args
									return {
										target: 'finishing',
										context: {
											result: deleteRecovery(
												context,
												'deletingRecords',
												'locallyPersisted',
												args.event.error
											)
										}
									}
								}
							}
						},
						finishing: { always: { target: '#internal-transfer-delete.terminal' } }
					}
				}
			}
		},
		terminal: { type: 'final' }
	}
})
type Context = {
	request: InternalTransferLinkInput
	tx: Tx | undefined
	records: Records | undefined
	assessment: Assessment | undefined
	transferId: string | undefined
	write: OutputFrom<typeof commit> | undefined
	result: InternalTransferLinkResult | undefined
}
const events0 = {
	CANCEL: types<EventPayload<InternalTransferLinkEvent, 'CANCEL'>>(),
	SHUTDOWN: types<EventPayload<InternalTransferLinkEvent, 'SHUTDOWN'>>()
}
type NativeEvent0 =
	| import('xstate').InferEvents<typeof events0>
	| import('xstate').DoneActorEvent<
			| import('xstate').OutputFrom<typeof open>
			| import('xstate').OutputFrom<typeof read>
			| import('xstate').OutputFrom<typeof stage>
			| import('xstate').OutputFrom<typeof commit>
			| import('xstate').OutputFrom<typeof settle>
			| import('xstate').OutputFrom<typeof rollback>
			| import('xstate').OutputFrom<typeof identifyTransferWrite>
	  >
	| import('xstate').ErrorActorEvent
	| import('xstate').AfterEvent
	| import('xstate').DoneStateEvent
	| import('xstate').SnapshotEvent
	| import('xstate').TimeoutEvent
	| import('xstate').ActorTimeoutEvent
	| import('xstate').ErrorPlatformEvent

/** Owns one mergeable Jazz transaction from endpoint read through local persistence. */
export const internalTransferLinkMachine = setup({
	schemas: {
		context: types<Context>(),
		events: events0,
		input: types<InternalTransferLinkInput>(),
		output: types<InternalTransferLinkResult>(),
		children: {
			open: types<
				import('xstate').ActorRefFrom<
					{
						open: typeof open
						read: typeof read
						stage: typeof stage
						commit: typeof commit
						settle: typeof settle
						rollback: typeof rollback
						identifyTransferWrite: typeof identifyTransferWrite
					}['open']
				>
			>(),
			read: types<
				import('xstate').ActorRefFrom<
					{
						open: typeof open
						read: typeof read
						stage: typeof stage
						commit: typeof commit
						settle: typeof settle
						rollback: typeof rollback
						identifyTransferWrite: typeof identifyTransferWrite
					}['read']
				>
			>(),
			stage: types<
				import('xstate').ActorRefFrom<
					{
						open: typeof open
						read: typeof read
						stage: typeof stage
						commit: typeof commit
						settle: typeof settle
						rollback: typeof rollback
						identifyTransferWrite: typeof identifyTransferWrite
					}['stage']
				>
			>(),
			commit: types<
				import('xstate').ActorRefFrom<
					{
						open: typeof open
						read: typeof read
						stage: typeof stage
						commit: typeof commit
						settle: typeof settle
						rollback: typeof rollback
						identifyTransferWrite: typeof identifyTransferWrite
					}['commit']
				>
			>(),
			settle: types<
				import('xstate').ActorRefFrom<
					{
						open: typeof open
						read: typeof read
						stage: typeof stage
						commit: typeof commit
						settle: typeof settle
						rollback: typeof rollback
						identifyTransferWrite: typeof identifyTransferWrite
					}['settle']
				>
			>(),
			rollback: types<
				import('xstate').ActorRefFrom<
					{
						open: typeof open
						read: typeof read
						stage: typeof stage
						commit: typeof commit
						settle: typeof settle
						rollback: typeof rollback
						identifyTransferWrite: typeof identifyTransferWrite
					}['rollback']
				>
			>(),
			identifyTransferWrite: types<
				import('xstate').ActorRefFrom<
					{
						open: typeof open
						read: typeof read
						stage: typeof stage
						commit: typeof commit
						settle: typeof settle
						rollback: typeof rollback
						identifyTransferWrite: typeof identifyTransferWrite
					}['identifyTransferWrite']
				>
			>()
		}
	},
	actors: { open, read, stage, commit, settle, rollback, identifyTransferWrite },
	guards: {
		closing: (args: { value: import('xstate').StateValue }) =>
			matchesState({ running: { control: 'closing' } }, args.value),
		cancelling: (args: { value: import('xstate').StateValue }) =>
			matchesState({ running: { control: 'cancelling' } }, args.value)
	}
}).createMachine({
	id: 'internal-transfer-link',
	context: ({ input }) => ({
		request: input,
		tx: undefined,
		records: undefined,
		assessment: undefined,
		transferId: undefined,
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
					initial: 'opening',
					states: {
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
								if (required(context.assessment).outcome !== 'eligible') {
									return {
										target: 'rollingBack',
										context: {
											result: (({ context }): InternalTransferLinkResult => {
												const assessment = required(context.assessment)
												return assessment.outcome === 'eligible'
													? { outcome: 'unavailable', settlement: 'notStarted' }
													: { outcome: assessment.outcome, settlement: 'notStarted' }
											})(args)
										}
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
									assessment: eligibleAssessment(context.assessment)
								}),
								onDone: (args) => {
									return {
										target: 'checkingAfterStage',
										context: { transferId: args.event.output }
									}
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
						checkingAfterStage: {
							always: (args) => {
								if (matchesState({ running: { control: 'closing' } }, args.value)) {
									return { target: 'rollingBack' }
								}
								if (matchesState({ running: { control: 'cancelling' } }, args.value)) {
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
									return { target: 'checkingAfterCommit', context: { write: args.event.output } }
								},
								onError: (args) => {
									return {
										target: 'finishing',
										context: {
											result: {
												outcome: 'unavailable',
												settlement: 'unresolved',
												phase: 'commit',
												error: args.event.error
											}
										}
									}
								}
							}
						},
						checkingAfterCommit: {
							always: () => {
								return {
									target: 'identifyingWrite',
									context: {
										result: {
											outcome: 'unavailable',
											settlement: 'unresolved',
											error: undefined
										}
									}
								}
							}
						},
						identifyingWrite: {
							invoke: {
								src: 'identifyTransferWrite',
								input: ({ context }) => required(context.write),
								onDone: (args, enq) => {
									const { context } = args
									enq(() =>
										context.request.trackWrite({
											transactionId: args.event.output,
											operation: 'link',
											transferId: required(context.transferId)
										})
									)
									return { target: 'settling' }
								},
								onError: (args) => {
									return {
										target: 'finishing',
										context: {
											result: {
												outcome: 'unavailable',
												settlement: 'unresolved',
												phase: 'commit',
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
									return {
										target: 'finishing',
										context: {
											result: {
												outcome: 'succeeded',
												transferId: required(args.context.transferId),
												settlement: 'locallyPersisted'
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
												settlement: 'unresolved',
												phase: 'localSettlement',
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
									const { context } = args
									if (matchesState({ running: { control: 'closing' } }, args.value)) {
										return {
											target: 'finishing',
											context: {
												result: context.result ?? { outcome: 'closed', settlement: 'notStarted' }
											}
										}
									}
									if (matchesState({ running: { control: 'cancelling' } }, args.value)) {
										return {
											target: 'finishing',
											context: {
												result: context.result ?? { outcome: 'cancelled', settlement: 'notStarted' }
											}
										}
									}
									return {
										target: 'finishing',
										context: {
											result: context.result ?? { outcome: 'unavailable', settlement: 'notStarted' }
										}
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
						finishing: { always: { target: '#internal-transfer-link.terminal' } }
					}
				}
			}
		},
		terminal: { type: 'final' }
	}
})
