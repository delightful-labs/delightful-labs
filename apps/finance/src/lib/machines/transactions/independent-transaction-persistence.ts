import type { PaymentMethod } from '#lib/domain/payment-method.js'
import { TRANSACTION_SOURCE, type TransactionSource } from '#lib/domain/transaction-source.js'
import type { TransactionKind } from '#lib/domain/transaction-kind.js'
import { PersistedWriteRejectedError } from 'jazz-tools'
import type { getDb } from 'jazz-tools/svelte'
import { z } from 'zod'
import { app, type Tag, type TransactionRow, type Check } from '#lib/schema.js'
import { normalizedName } from '#lib/domain/names.js'
import { appTagSchema } from '#lib/validation/tags.js'
import { independentTransactionSchema } from '#lib/validation/transactions.js'
import type { IndependentTransaction } from '#lib/domain/transaction.js'
import type { FormInterruption, FormSettlement } from '#lib/contracts/form-contract.js'
import { transferEditRequiresUnlink } from '#lib/contracts/transaction-save-contract.js'
import { setup, types, createAsyncLogic, matchesState } from 'xstate'
import type { OutputFrom } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'

type TransactionDb = Pick<ReturnType<typeof getDb>, 'beginTransaction'>
type Transaction = ReturnType<TransactionDb['beginTransaction']>
const inputSchema = z.strictObject({
	transactionId: z.uuid(),
	values: independentTransactionSchema,
	mode: z.enum(['create', 'edit']).optional(),
	moveCheckFromAccountId: z.uuid().optional()
})
export type IndependentTransactionInput = z.output<typeof inputSchema>
export type IndependentTransactionEvent = { type: 'CANCEL' | 'INVALIDATE' | 'SHUTDOWN' }
export type IndependentTransactionResult =
	| { outcome: 'succeeded' | FormInterruption; transactionId: string; settlement: FormSettlement }
	| {
			outcome: 'failed'
			transactionId: string
			settlement: FormSettlement
			reason?: 'linkedTransferRequiresUnlink'
	  }
type Plan = {
	moveCheck?: { id: string; accountId: string } | undefined
	row: {
		organizationId: string
		accountId: string
		categoryId: string
		amountMinor: number
		currency: string
		kind: TransactionKind
		bookedOn: string
		description: string | null
		memo: string | null
		source: TransactionSource
		externalId?: string
		paymentMethod: PaymentMethod | null
		checkId: string | null
	}
	remove: string[]
	tags: { id: string; values: ReturnType<typeof appTagSchema.parse> | undefined }[]
}
function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Missing transaction resource')
	return value
}
const validate = createAsyncLogic({
	run: ({ input }: { input: IndependentTransactionInput }) =>
		Promise.resolve(inputSchema.safeParse(input))
})
const open = createAsyncLogic({
	run: ({ input }: { input: TransactionDb }) => Promise.resolve(input.beginTransaction())
})
function planTransaction(
	values: IndependentTransaction,
	tags: readonly Tag[],
	retained: readonly Tag[] = []
): Plan {
	const names = values.tags ?? []
	const retainedNames = new Set(retained.map((tag) => normalizedName(tag.name)))
	if (
		names.some(
			(name) =>
				!retainedNames.has(normalizedName(name)) &&
				tags.some(
					(tag) =>
						tag.organizationId === values.organizationId &&
						tag.kind === values.kind &&
						Boolean(tag.archivedAt) &&
						normalizedName(tag.name) === normalizedName(name)
				)
		)
	)
		throw new Error('An archived transaction tag cannot be selected')
	if (
		names.some(
			(name) =>
				!retained.some((tag) => normalizedName(tag.name) === normalizedName(name)) &&
				tags.filter(
					(tag) =>
						tag.organizationId === values.organizationId &&
						tag.kind === values.kind &&
						!tag.archivedAt &&
						normalizedName(tag.name) === normalizedName(name)
				).length > 1
		)
	)
		throw new Error('Ambiguous transaction tag')
	const active = tags.filter(
		(tag) =>
			tag.organizationId === values.organizationId && tag.kind === values.kind && !tag.archivedAt
	)
	const additions = names.map((name) => {
		const tag = [...retained, ...active].find(
			(candidate) => normalizedName(candidate.name) === normalizedName(name)
		)
		return {
			id: tag?.id ?? crypto.randomUUID(),
			values: tag
				? undefined
				: appTagSchema.parse({
						organizationId: values.organizationId,
						kind: values.kind,
						name,
						categoryId: values.categoryId
					})
		}
	})
	const uniqueTags = additions.filter(
		(tag, index) => additions.findIndex((candidate) => candidate.id === tag.id) === index
	)
	const row: Plan['row'] = {
		organizationId: values.organizationId,
		accountId: values.accountId,
		categoryId: values.categoryId,
		amountMinor: values.money.amountMinor,
		currency: values.money.currency,
		kind: values.kind,
		bookedOn: values.bookedOn,
		description: values.description ?? null,
		memo: values.memo ?? null,
		source: values.source.source,
		...(values.source.source === TRANSACTION_SOURCE.SIMPLEFIN
			? { externalId: values.source.externalId }
			: {}),
		paymentMethod: values.paymentMethod,
		checkId: values.checkId
	}
	return { row, tags: uniqueTags, remove: [] }
}
const read = createAsyncLogic({
	run: ({ input }: { input: { tx: Transaction; values: IndependentTransaction } }) =>
		input.tx.all(
			app.tags.where({ organizationId: input.values.organizationId, kind: input.values.kind })
		)
})
const readEdit = createAsyncLogic({
	run: async ({ input }: { input: { tx: Transaction; id: string } }) => {
		const results = await Promise.allSettled([
			Promise.resolve().then(() => input.tx.all(app.transactions.where({ id: input.id }))),
			Promise.resolve().then(() =>
				input.tx.all(app.transactionTags.where({ transactionId: input.id }))
			),
			Promise.resolve().then(() =>
				input.tx.all(app.internalTransfers.where({ expenseTransactionId: input.id }))
			),
			Promise.resolve().then(() =>
				input.tx.all(app.internalTransfers.where({ incomeTransactionId: input.id }))
			)
		])
		const [rows, links, expenseTransfers, incomeTransfers] = results
		if (rows.status === 'rejected') throw rows.reason
		if (links.status === 'rejected') throw links.reason
		if (expenseTransfers.status === 'rejected') throw expenseTransfers.reason
		if (incomeTransfers.status === 'rejected') throw incomeTransfers.reason
		return {
			existing: rows.value[0],
			links: links.value,
			transfers: [...expenseTransfers.value, ...incomeTransfers.value]
		}
	}
})
type EditSnapshot = OutputFrom<typeof readEdit>
function editable(existing: TransactionRow | undefined, values: IndependentTransaction) {
	return (
		existing !== undefined &&
		existing.organizationId === values.organizationId &&
		existing.kind === values.kind &&
		existing.source === values.source.source &&
		(values.source.source !== TRANSACTION_SOURCE.SIMPLEFIN ||
			existing.externalId === values.source.externalId)
	)
}
const readMoveCheck = createAsyncLogic({
	run: ({ input }: { input: { tx: Transaction; id: string } }) =>
		input.tx.all(app.checks.where({ id: input.id }))
})
const prepare = createAsyncLogic({
	run: ({
		input
	}: {
		input: {
			values: IndependentTransaction
			tags: readonly Tag[]
			edit: EditSnapshot | undefined
			moveCheck: Check | undefined
		}
	}) => {
		const retained = input.tags.filter(
			(tag) =>
				tag.organizationId === input.values.organizationId &&
				tag.kind === input.values.kind &&
				input.edit?.links.some((link) => link.tagId === tag.id)
		)
		const plan = planTransaction(input.values, input.tags, retained)
		plan.moveCheck = input.moveCheck
			? { id: input.moveCheck.id, accountId: input.values.accountId }
			: undefined
		const desired = new Set(plan.tags.map((tag) => tag.id))
		plan.remove =
			input.edit?.links.filter((link) => !desired.has(link.tagId)).map((link) => link.id) ?? []
		plan.tags = plan.tags.filter((tag) => !input.edit?.links.some((link) => link.tagId === tag.id))
		return Promise.resolve(plan)
	}
})
type StageInput = {
	tx: Transaction
	plan: Plan
	transactionId: string
	edit?: EditSnapshot | undefined
}
function stageTags({ tx, plan, transactionId }: StageInput) {
	for (const id of plan.remove) tx.delete(app.transactionTags, id)
	for (const tag of plan.tags) {
		if (tag.values) tx.insert(app.tags, tag.values, { id: tag.id })
		tx.insert(app.transactionTags, {
			organizationId: plan.row.organizationId,
			transactionId,
			tagId: tag.id
		})
	}
}
const stage = createAsyncLogic({
	run: ({ input }: { input: StageInput }) => {
		input.tx.insert(app.transactions, input.plan.row, { id: input.transactionId })
		stageTags(input)
		return Promise.resolve()
	}
})
const update = createAsyncLogic({
	run: ({ input }: { input: StageInput }) => {
		if (input.plan.moveCheck)
			input.tx.update(app.checks, input.plan.moveCheck.id, {
				accountId: input.plan.moveCheck.accountId
			})
		input.tx.update(app.transactions, input.transactionId, input.plan.row)
		stageTags(input)
		return Promise.resolve()
	}
})
const commit = createAsyncLogic({
	run: ({ input }: { input: Transaction }) => Promise.resolve(input.commit())
})
const settle = createAsyncLogic({
	run: ({ input }: { input: OutputFrom<typeof commit> }) => input.wait({ tier: 'local' })
})
const rollback = createAsyncLogic({ run: ({ input }: { input: Transaction }) => input.rollback() })
type Context = {
	input: IndependentTransactionInput | undefined
	transactionId: string
	values: IndependentTransaction | undefined
	tx: Transaction | undefined
	tags: readonly Tag[]
	edit: EditSnapshot | undefined
	moveCheck: Check | undefined
	plan: Plan | undefined
	handle: OutputFrom<typeof commit> | undefined
	settlement: FormSettlement
	failureReason: 'linkedTransferRequiresUnlink' | undefined
	result: IndependentTransactionResult | undefined
}
const actors = {
	validate,
	open,
	read,
	prepare,
	stage,
	commit,
	settle,
	rollback,
	readEdit,
	readMoveCheck,
	update
}

/** Owns the transaction and all tag writes for one caller-identified ledger entry. */
export function createIndependentTransactionPersistenceMachine(db: TransactionDb) {
	const events0 = {
		CANCEL: types<EventPayload<IndependentTransactionEvent, 'CANCEL'>>(),
		INVALIDATE: types<EventPayload<IndependentTransactionEvent, 'INVALIDATE'>>(),
		SHUTDOWN: types<EventPayload<IndependentTransactionEvent, 'SHUTDOWN'>>()
	}
	type NativeEvent0 =
		| import('xstate').InferEvents<typeof events0>
		| import('xstate').DoneActorEvent<
				| import('xstate').OutputFrom<(typeof actors)['validate']>
				| import('xstate').OutputFrom<(typeof actors)['open']>
				| import('xstate').OutputFrom<(typeof actors)['read']>
				| import('xstate').OutputFrom<(typeof actors)['prepare']>
				| import('xstate').OutputFrom<(typeof actors)['stage']>
				| import('xstate').OutputFrom<(typeof actors)['commit']>
				| import('xstate').OutputFrom<(typeof actors)['settle']>
				| import('xstate').OutputFrom<(typeof actors)['rollback']>
				| import('xstate').OutputFrom<(typeof actors)['readEdit']>
				| import('xstate').OutputFrom<(typeof actors)['readMoveCheck']>
				| import('xstate').OutputFrom<(typeof actors)['update']>
		  >
		| import('xstate').ErrorActorEvent
	const model = setup({
		schemas: {
			context: types<Context>(),
			events: events0,
			input: types<IndependentTransactionInput>(),
			output: types<IndependentTransactionResult>(),
			children: {
				validate: types<import('xstate').ActorRefFrom<(typeof actors)['validate']>>(),
				open: types<import('xstate').ActorRefFrom<(typeof actors)['open']>>(),
				read: types<import('xstate').ActorRefFrom<(typeof actors)['read']>>(),
				prepare: types<import('xstate').ActorRefFrom<(typeof actors)['prepare']>>(),
				stage: types<import('xstate').ActorRefFrom<(typeof actors)['stage']>>(),
				commit: types<import('xstate').ActorRefFrom<(typeof actors)['commit']>>(),
				settle: types<import('xstate').ActorRefFrom<(typeof actors)['settle']>>(),
				rollback: types<import('xstate').ActorRefFrom<(typeof actors)['rollback']>>(),
				readEdit: types<import('xstate').ActorRefFrom<(typeof actors)['readEdit']>>(),
				readMoveCheck: types<import('xstate').ActorRefFrom<(typeof actors)['readMoveCheck']>>(),
				update: types<import('xstate').ActorRefFrom<(typeof actors)['update']>>()
			}
		},
		actors,
		guards: {
			interrupted: (args: { value: import('xstate').StateValue }) =>
				matchesState({ running: { control: 'interrupted' } }, args.value)
		}
	})
	const terminal = (outcome: IndependentTransactionResult['outcome']) =>
		model.createStateConfig({
			type: 'final',
			entry: (args: { context: Context }) => {
				const { context } = args
				return {
					context: {
						result: {
							outcome,
							transactionId: context.transactionId,
							settlement: context.settlement,
							...(outcome === 'failed' && context.failureReason
								? { reason: context.failureReason }
								: {})
						},
						input: undefined,
						values: undefined,
						tx: undefined,
						tags: [],
						edit: undefined,
						moveCheck: undefined,
						plan: undefined,
						handle: undefined
					}
				}
			}
		})
	return model.createMachine({
		id: 'independent-transaction-persistence',
		initial: 'running',
		context: ({ input }) => ({
			input,
			transactionId: input.transactionId,
			values: undefined,
			tx: undefined,
			tags: [],
			edit: undefined,
			moveCheck: undefined,
			plan: undefined,
			handle: undefined,
			settlement: 'notStarted',
			failureReason: undefined,
			result: undefined
		}),
		output: ({ context }) => required(context.result),
		states: {
			running: {
				type: 'parallel',
				states: {
					control: {
						initial: 'active',
						on: {
							CANCEL: { target: '.interrupted.cancelled' },
							INVALIDATE: { target: '.interrupted.scopeChanged' },
							SHUTDOWN: { target: '.interrupted.closed' }
						},
						states: {
							active: {},
							interrupted: {
								initial: 'cancelled',
								states: {
									cancelled: { on: { CANCEL: {} } },
									scopeChanged: { on: { CANCEL: {}, INVALIDATE: {} } },
									closed: { on: { CANCEL: {}, INVALIDATE: {}, SHUTDOWN: {} } }
								}
							}
						}
					},
					flow: {
						initial: 'validating',
						states: {
							validating: {
								invoke: {
									src: 'validate',
									input: ({ context }) => required(context.input),
									onDone: (args) => {
										const { event } = args
										if (matchesState({ running: { control: 'interrupted' } }, args.value)) {
											return { target: 'finishingFailure' }
										}
										if (event.output.success) {
											return {
												target: 'opening',
												context: {
													values: event.output.success ? event.output.data.values : undefined
												}
											}
										}
										return { target: 'finishingFailure' }
									},
									onError: { target: 'finishingFailure' }
								}
							},
							opening: {
								invoke: {
									src: 'open',
									input: () => db,
									onDone: (args) => {
										const { context, event } = args
										if (matchesState({ running: { control: 'interrupted' } }, args.value)) {
											return { target: 'rollingBack', context: { tx: event.output } }
										}
										if (context.input?.mode === 'edit') {
											return { target: 'readingEdit', context: { tx: event.output } }
										}
										if (Boolean(context.values?.tags?.length)) {
											return { target: 'reading', context: { tx: event.output } }
										}
										return { target: 'planning', context: { tx: event.output } }
									},
									onError: { target: 'finishingFailure' }
								}
							},
							readingEdit: {
								invoke: {
									src: 'readEdit',
									input: ({ context }) => ({ tx: required(context.tx), id: context.transactionId }),
									onDone: (args) => {
										return { target: 'checkingEdit', context: { edit: args.event.output } }
									},
									onError: { target: 'rollingBack' }
								}
							},
							checkingEdit: {
								always: (args) => {
									const { context } = args
									if (matchesState({ running: { control: 'interrupted' } }, args.value)) {
										return { target: 'rollingBack' }
									}
									if (
										editable(context.edit?.existing, required(context.values)) &&
										transferEditRequiresUnlink(
											context.edit?.existing,
											required(context.values),
											(context.edit?.transfers.length ?? 0) > 0
										)
									) {
										return {
											target: 'rollingBack',
											context: { failureReason: 'linkedTransferRequiresUnlink' }
										}
									}
									if (editable(context.edit?.existing, required(context.values))) {
										return { target: 'assessingMove' }
									}
									return { target: 'rollingBack' }
								}
							},
							assessingMove: {
								always: (args) => {
									if (matchesState({ running: { control: 'interrupted' } }, args.value)) {
										return { target: 'rollingBack' }
									}
									if (args.context.input?.moveCheckFromAccountId !== undefined) {
										return { target: 'readingMoveCheck' }
									}
									return { target: 'reading' }
								}
							},
							readingMoveCheck: {
								invoke: {
									src: 'readMoveCheck',
									input: ({ context }) => ({
										tx: required(context.tx),
										id: required(required(context.values).checkId ?? undefined)
									}),
									onDone: (args) => {
										return { target: 'checkingMove', context: { moveCheck: args.event.output[0] } }
									},
									onError: { target: 'rollingBack' }
								}
							},
							checkingMove: {
								always: (args) => {
									const { context } = args
									if (matchesState({ running: { control: 'interrupted' } }, args.value)) {
										return { target: 'rollingBack' }
									}
									if (
										context.moveCheck !== undefined &&
										context.moveCheck.id === context.edit?.existing?.checkId &&
										context.moveCheck.id === context.values?.checkId &&
										context.moveCheck.organizationId === context.values?.organizationId &&
										context.moveCheck.accountId === context.input?.moveCheckFromAccountId &&
										context.moveCheck.accountId === context.edit?.existing?.accountId
									) {
										return { target: 'reading' }
									}
									return { target: 'rollingBack' }
								}
							},
							reading: {
								invoke: {
									src: 'read',
									input: ({ context }) => ({
										tx: required(context.tx),
										values: required(context.values)
									}),
									onDone: (args) => {
										if (matchesState({ running: { control: 'interrupted' } }, args.value)) {
											return { target: 'rollingBack' }
										}
										return { target: 'planning', context: { tags: args.event.output } }
									},
									onError: { target: 'rollingBack' }
								}
							},
							planning: {
								invoke: {
									src: 'prepare',
									input: ({ context }) => ({
										values: required(context.values),
										tags: context.tags,
										edit: context.edit,
										moveCheck: context.moveCheck
									}),
									onDone: (args) => {
										const { event } = args
										if (matchesState({ running: { control: 'interrupted' } }, args.value)) {
											return { target: 'rollingBack' }
										}
										if (args.context.input?.mode === 'edit') {
											return { target: 'updating', context: { plan: event.output } }
										}
										return { target: 'staging', context: { plan: event.output } }
									},
									onError: { target: 'rollingBack' }
								}
							},
							updating: {
								invoke: {
									src: 'update',
									input: ({ context }) => ({
										tx: required(context.tx),
										plan: required(context.plan),
										transactionId: context.transactionId,
										edit: context.edit
									}),
									onDone: (args) => {
										if (matchesState({ running: { control: 'interrupted' } }, args.value)) {
											return { target: 'rollingBack' }
										}
										return { target: 'committing' }
									},
									onError: { target: 'rollingBack' }
								}
							},
							staging: {
								invoke: {
									src: 'stage',
									input: ({ context }) => ({
										tx: required(context.tx),
										plan: required(context.plan),
										transactionId: context.transactionId
									}),
									onDone: (args) => {
										if (matchesState({ running: { control: 'interrupted' } }, args.value)) {
											return { target: 'rollingBack' }
										}
										return { target: 'committing' }
									},
									onError: { target: 'rollingBack' }
								}
							},
							committing: {
								entry: () => {
									return { context: { settlement: 'unknown' } }
								},
								invoke: {
									src: 'commit',
									input: ({ context }) => required(context.tx),
									onDone: (args) => {
										return { target: 'settling', context: { handle: args.event.output } }
									},
									onError: (args) => {
										if (args.event.error instanceof PersistedWriteRejectedError) {
											return { target: 'rollingBack', context: { settlement: 'rejected' } }
										}
										return { target: 'rollingBack' }
									}
								}
							},
							settling: {
								invoke: {
									src: 'settle',
									input: ({ context }) => required(context.handle),
									onDone: () => {
										return {
											target: 'finishingSuccess',
											context: { settlement: 'locallyPersisted' }
										}
									},
									onError: (args) => {
										if (args.event.error instanceof PersistedWriteRejectedError) {
											return { target: 'rollingBack', context: { settlement: 'rejected' } }
										}
										return { target: 'rollingBack' }
									}
								}
							},
							rollingBack: {
								always: (args) => {
									if (args.context.tx === undefined) {
										return { target: 'finishingFailure' }
									}
									return { target: 'rollbackTransaction' }
								}
							},
							rollbackTransaction: {
								invoke: {
									src: 'rollback',
									input: ({ context }) => required(context.tx),
									onDone: (args) => {
										const { context } = args
										return {
											target: 'finishingFailure',
											context: {
												settlement:
													context.settlement === 'rejected' ||
													(args.event.output && context.settlement === 'notStarted')
														? 'rejected'
														: 'unknown'
											}
										}
									},
									onError: (args) => {
										return {
											target: 'finishingFailure',
											context: {
												settlement: args.context.settlement === 'rejected' ? 'rejected' : 'unknown'
											}
										}
									}
								}
							},
							finishingSuccess: {
								always: (args) => {
									if (
										matchesState({ running: { control: { interrupted: 'closed' } } }, args.value)
									) {
										return { target: '#independent-transaction-persistence.closed' }
									}
									if (
										matchesState(
											{ running: { control: { interrupted: 'scopeChanged' } } },
											args.value
										)
									) {
										return { target: '#independent-transaction-persistence.scopeChanged' }
									}
									if (
										matchesState({ running: { control: { interrupted: 'cancelled' } } }, args.value)
									) {
										return { target: '#independent-transaction-persistence.cancelled' }
									}
									return { target: '#independent-transaction-persistence.succeeded' }
								}
							},
							finishingFailure: {
								always: (args) => {
									if (
										matchesState({ running: { control: { interrupted: 'closed' } } }, args.value)
									) {
										return { target: '#independent-transaction-persistence.closed' }
									}
									if (
										matchesState(
											{ running: { control: { interrupted: 'scopeChanged' } } },
											args.value
										)
									) {
										return { target: '#independent-transaction-persistence.scopeChanged' }
									}
									if (
										matchesState({ running: { control: { interrupted: 'cancelled' } } }, args.value)
									) {
										return { target: '#independent-transaction-persistence.cancelled' }
									}
									return { target: '#independent-transaction-persistence.failed' }
								}
							}
						}
					}
				}
			},
			succeeded: terminal('succeeded'),
			failed: terminal('failed'),
			cancelled: terminal('cancelled'),
			scopeChanged: terminal('scopeChanged'),
			closed: terminal('closed')
		}
	})
}
