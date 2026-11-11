import { TRANSACTION_SOURCE } from '#lib/domain/transaction-source.js'
import { PAYMENT_METHOD } from '#lib/domain/payment-method.js'
import { ReadTier } from 'jazz-tools'
import type { getDb } from 'jazz-tools/svelte'
import { app, type Check } from '#lib/schema.js'
import { normalizedName } from '#lib/domain/names.js'
import { canWriteAccount } from '#lib/domain/organization-permissions.js'
import {
	desiredCheck,
	ledgerValues,
	parseSaveRequest,
	sameSaveScope,
	transferEditRequiresUnlink,
	type TransactionCheckpoint
} from '#lib/contracts/transaction-save-contract.js'
import type { TransactionSaveValues } from '#lib/validation/transactions.js'
import type {
	FormChildEvent,
	FormOperationInput,
	FormOperationResult,
	FormSettlement
} from '#lib/contracts/form-contract.js'
import type {
	TransactionEntryObservation,
	TransactionEntryScope,
	TransactionEntryReason
} from '#lib/contracts/transaction-entry-contract.js'
import { createCheckCreationMachine } from './check-create-persistence.js'
import { createIndependentTransactionPersistenceMachine } from './independent-transaction-persistence.js'
import { setup, types, createAsyncLogic, matchesState } from 'xstate'
import type { OutputFrom } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'

export type TransactionSaveDb = Pick<ReturnType<typeof getDb>, 'beginTransaction' | 'all'>
type Input = FormOperationInput<
	TransactionSaveValues,
	TransactionEntryScope,
	TransactionEntryObservation
>
export type TransactionSaveResult = FormOperationResult<void, TransactionEntryReason> & {
	transactionId?: string
}
type Result = TransactionSaveResult
type Context = {
	input: Input | undefined
	values: TransactionSaveValues | undefined
	checkpoint: TransactionCheckpoint | undefined
	facts: TransactionEntryObservation | undefined
	check: Check | undefined
	observed: OutputFrom<ReturnType<typeof makeReadLedger>> | undefined
	transferChangeBlocked: boolean
	result: Result | undefined
}
function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Missing staged-save resource')
	return value
}
function makeReadLedger(db: TransactionSaveDb) {
	return createAsyncLogic({
		run: ({ input }: { input: string }) => {
			return db.all(
				app.transactions.where({ id: input }).include({ tags: { tag: true }, check: true }),
				{
					tier: ReadTier.Remote
				}
			)
		}
	})
}
function matchingLedger(context: Context) {
	const previous = context.checkpoint?.submitted
	const row = context.observed?.[0]
	if (!previous || !row) return false
	const names = (values: readonly string[]) =>
		JSON.stringify([...new Set(values.map(normalizedName))].sort())
	return (
		row.organizationId === previous.organizationId &&
		row.accountId === previous.accountId &&
		row.categoryId === previous.categoryId &&
		row.kind === previous.kind &&
		row.source === previous.source.source &&
		(previous.source.source !== TRANSACTION_SOURCE.SIMPLEFIN ||
			row.externalId === previous.source.externalId) &&
		row.amountMinor === previous.money.amountMinor &&
		row.currency === previous.money.currency &&
		row.bookedOn === previous.bookedOn &&
		(row.description ?? '') === (previous.description ?? '') &&
		(row.memo ?? '') === (previous.memo ?? '') &&
		row.paymentMethod === previous.paymentMethod &&
		row.checkId === previous.checkId &&
		(previous.checkId === null ||
			(row.check?.id === previous.checkId &&
				row.check.accountId === previous.accountId &&
				row.check.organizationId === previous.organizationId)) &&
		row.tags.every(
			(link) =>
				link.organizationId === row.organizationId &&
				link.tag?.organizationId === row.organizationId &&
				link.tag.kind === row.kind
		) &&
		names(row.tags.flatMap((link) => (link.tag ? [link.tag.name] : []))) ===
			names(previous.tags ?? [])
	)
}
function checkCompatible(context: Context) {
	const values = required(context.values)
	return (
		context.check?.id === context.checkpoint?.checkId &&
		context.check?.organizationId === values.organizationId &&
		(context.check.accountId === values.accountId ||
			(context.input?.request.scope.transactionId === context.facts?.transaction?.id &&
				context.facts?.transaction?.checkId === context.check.id &&
				context.facts.transaction.accountId === context.check.accountId))
	)
}
function checkMatches(context: Context, values = context.checkpoint?.checkValues) {
	return (
		checkCompatible(context) &&
		(!values ||
			(context.check?.checkNumber === values.checkNumber &&
				context.check.checkDate === values.checkDate &&
				(context.check.payerName ?? '') === (values.payerName ?? '') &&
				(context.check.bankName ?? '') === (values.bankName ?? '') &&
				(context.check.memoOnCheck ?? '') === (values.memoOnCheck ?? '')))
	)
}
function requestedCheck(context: Context) {
	const desired = desiredCheck(required(context.values))
	if (!desired) return undefined
	return {
		...desired,
		accountId: context.check?.accountId ?? desired.accountId,
		payerName: desired.payerName ?? context.check?.payerName ?? undefined,
		bankName: desired.bankName ?? context.check?.bankName ?? undefined,
		memoOnCheck: desired.memoOnCheck ?? context.check?.memoOnCheck ?? undefined
	}
}
function available(context: Context) {
	const f = context.facts
	const v = context.values
	const scope = context.input?.request.scope
	return (
		f &&
		v &&
		scope &&
		sameSaveScope(scope, f) &&
		f.sessionReady &&
		!f.loading &&
		!f.failed &&
		f.identityId === f.membership?.userId &&
		f.organizationId === v.organizationId &&
		f.kind === v.kind &&
		canWriteAccount(f.membership, v.organizationId, v.accountId, f.grants) &&
		(!scope.transactionId ||
			(f.transaction?.id === scope.transactionId &&
				canWriteAccount(f.membership, v.organizationId, f.transaction.accountId, f.grants))) &&
		f.accounts.some(
			(a) =>
				a.id === v.accountId &&
				a.organizationId === v.organizationId &&
				a.archivedAt === null &&
				a.currency === v.money.currency
		) &&
		f.categories.some(
			(c) =>
				c.id === v.categoryId &&
				c.organizationId === v.organizationId &&
				c.kind === v.kind &&
				c.archivedAt === null
		)
	)
}

/** Finite attempt; the form owner retains its validated checkpoint between attempts. */
export function createTransactionSaveMachine(
	db: TransactionSaveDb,
	observe: () => TransactionEntryObservation
) {
	const actors = {
		validate: createAsyncLogic({
			run: ({ input }: { input: Input }) =>
				Promise.resolve(
					parseSaveRequest(input.request.values, input.request.checkpoint, input.request.scope)
				)
		}),
		allocate: createAsyncLogic({
			run: ({
				input
			}: {
				input: { values: TransactionSaveValues; scope: TransactionEntryScope }
			}): Promise<TransactionCheckpoint> =>
				Promise.resolve({
					version: 1,
					scope: { ...input.scope, binding: required(input.scope.binding ?? undefined) },
					accountId: input.values.accountId,
					transactionId: input.scope.transactionId ?? crypto.randomUUID(),
					checkId:
						input.values.paymentMethod === PAYMENT_METHOD.CHECK
							? input.values.check.kind === 'existing'
								? input.values.check.id
								: crypto.randomUUID()
							: null,
					checkIntent:
						input.values.paymentMethod === PAYMENT_METHOD.CHECK ? input.values.check.kind : 'none',
					checkSettlement: 'notStarted',
					transactionSettlement: 'notStarted'
				})
		}),
		observe: createAsyncLogic({ run: () => Promise.resolve(observe()) }),
		readLedger: makeReadLedger(db),
		readCheck: createAsyncLogic({
			run: ({ input }: { input: { id: string; uncertain: boolean } }) => {
				return db.all(app.checks.where({ id: input.id }), {
					tier: input.uncertain ? ReadTier.Remote : ReadTier.LocalFirst
				})
			}
		}),
		checkWrite: createCheckCreationMachine(db),
		ledgerWrite: createIndependentTransactionPersistenceMachine(db)
	}
	const events0 = {
		INVALIDATE: types<EventPayload<FormChildEvent<TransactionEntryObservation>, 'INVALIDATE'>>(),
		CANCEL: types<EventPayload<FormChildEvent<TransactionEntryObservation>, 'CANCEL'>>(),
		SHUTDOWN: types<EventPayload<FormChildEvent<TransactionEntryObservation>, 'SHUTDOWN'>>(),
		OBSERVE: types<EventPayload<FormChildEvent<TransactionEntryObservation>, 'OBSERVE'>>()
	}
	type NativeEvent0 =
		| import('xstate').InferEvents<typeof events0>
		| import('xstate').DoneActorEvent<
				| import('xstate').OutputFrom<(typeof actors)['validate']>
				| import('xstate').OutputFrom<(typeof actors)['allocate']>
				| import('xstate').OutputFrom<(typeof actors)['observe']>
				| import('xstate').OutputFrom<(typeof actors)['readLedger']>
				| import('xstate').OutputFrom<(typeof actors)['readCheck']>
				| import('xstate').OutputFrom<(typeof actors)['checkWrite']>
				| import('xstate').OutputFrom<(typeof actors)['ledgerWrite']>
		  >
		| import('xstate').ErrorActorEvent
	const model = setup({
		schemas: {
			context: types<Context>(),
			events: events0,
			input: types<Input>(),
			output: types<Result>(),
			children: {
				validate: types<import('xstate').ActorRefFrom<(typeof actors)['validate']>>(),
				allocate: types<import('xstate').ActorRefFrom<(typeof actors)['allocate']>>(),
				observe: types<import('xstate').ActorRefFrom<(typeof actors)['observe']>>(),
				readLedger: types<import('xstate').ActorRefFrom<(typeof actors)['readLedger']>>(),
				readCheck: types<import('xstate').ActorRefFrom<(typeof actors)['readCheck']>>(),
				checkWrite: types<import('xstate').ActorRefFrom<(typeof actors)['checkWrite']>>(),
				ledgerWrite: types<import('xstate').ActorRefFrom<(typeof actors)['ledgerWrite']>>()
			}
		},
		actors,
		actions: {},
		guards: {
			interrupted: (args: { value: import('xstate').StateValue }) =>
				matchesState({ running: { control: 'interrupted' } }, args.value),
			transferChangeRequiresUnlink: ({ context }: { context: Context }) =>
				context.facts !== undefined &&
				context.values !== undefined &&
				transferEditRequiresUnlink(context.facts.transaction, context.values)
		}
	})
	const terminal = (
		outcome:
			| 'succeeded'
			| 'failed'
			| 'partial'
			| 'unresolved'
			| 'cancelled'
			| 'scopeChanged'
			| 'closed'
			| 'transferChangeRequiresUnlink'
	) =>
		model.createStateConfig({
			type: 'final',
			entry: (args: { context: Context }) => {
				return {
					context: {
						result: (({ context }): Result => {
							const checkpoint = context.checkpoint
							const recovery = checkpoint ? { checkpoint } : {}
							const settlement = checkpoint?.transactionSettlement ?? 'notStarted'
							let result: FormOperationResult<void, TransactionEntryReason>
							if (outcome === 'transferChangeRequiresUnlink')
								result = {
									outcome: 'unavailable',
									reason: 'linkedTransferRequiresUnlink',
									settlement: 'notStarted',
									...recovery
								}
							else if (outcome === 'succeeded')
								result = {
									outcome,
									value: undefined,
									settlement: settlement === 'confirmed' ? 'confirmed' : 'locallyPersisted',
									...recovery
								}
							else if (outcome === 'partial')
								result = {
									outcome,
									value: undefined,
									reason: 'checkRetained',
									settlement:
										checkpoint?.checkSettlement === 'locallyPersisted'
											? 'locallyPersisted'
											: 'unknown',
									...recovery
								}
							else if (outcome === 'unresolved')
								result = {
									outcome: 'partial',
									value: undefined,
									reason: 'saveUnresolved',
									settlement: 'unknown',
									...recovery
								}
							else if (outcome === 'failed')
								result = { outcome, code: 'operationFailed', settlement, ...recovery }
							else result = { outcome, settlement, ...recovery }
							return checkpoint ? { ...result, transactionId: checkpoint.transactionId } : result
						})(args),
						input: undefined,
						values: undefined,
						facts: undefined,
						check: undefined,
						observed: undefined
					}
				}
			}
		})
	return model.createMachine({
		id: 'transaction-save',
		initial: 'running',
		context: ({ input }) => ({
			input,
			values: undefined,
			checkpoint: undefined,
			facts: undefined,
			check: undefined,
			observed: undefined,
			transferChangeBlocked: false,
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
							CANCEL: (args, enq) => {
								const { event } = args
								for (const child of [args.children.checkWrite, args.children.ledgerWrite]) {
									if (child?.getSnapshot().status === 'active') enq.sendTo(child, event)
								}
								return { target: '.interrupted.cancelled' }
							},
							INVALIDATE: (args, enq) => {
								const { event } = args
								for (const child of [args.children.checkWrite, args.children.ledgerWrite]) {
									if (child?.getSnapshot().status === 'active') enq.sendTo(child, event)
								}
								return { target: '.interrupted.scopeChanged' }
							},
							SHUTDOWN: (args, enq) => {
								const { event } = args
								for (const child of [args.children.checkWrite, args.children.ledgerWrite]) {
									if (child?.getSnapshot().status === 'active') enq.sendTo(child, event)
								}
								return { target: '.interrupted.closed' }
							}
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
										return {
											target: 'checkingCheckpoint',
											context: { values: event.output.values, checkpoint: event.output.checkpoint }
										}
									},
									onError: { target: 'finishing' }
								}
							},
							checkingCheckpoint: {
								always: (args) => {
									if (matchesState({ running: { control: 'interrupted' } }, args.value)) {
										return { target: 'finishing' }
									}
									if (args.context.checkpoint !== undefined) {
										return { target: 'observing' }
									}
									return { target: 'allocating' }
								}
							},
							allocating: {
								invoke: {
									src: 'allocate',
									input: ({ context }) => ({
										values: required(context.values),
										scope: required(context.input).request.scope
									}),
									onDone: (args) => {
										const { event } = args
										if (matchesState({ running: { control: 'interrupted' } }, args.value)) {
											return { target: 'finishing', context: { checkpoint: event.output } }
										}
										return { target: 'observing', context: { checkpoint: event.output } }
									},
									onError: { target: 'finishing' }
								}
							},
							observing: {
								on: {
									CANCEL: { target: 'finishing' },
									INVALIDATE: { target: 'finishing' },
									SHUTDOWN: { target: 'finishing' }
								},
								invoke: {
									src: 'observe',
									onDone: (args) => {
										return { target: 'assessing', context: { facts: args.event.output } }
									},
									onError: { target: 'finishing' }
								}
							},
							assessing: {
								always: (args) => {
									const { context } = args
									if (matchesState({ running: { control: 'interrupted' } }, args.value)) {
										return { target: 'finishing' }
									}
									if (
										['locallyPersisted', 'confirmed'].includes(
											context.checkpoint?.transactionSettlement ?? ''
										)
									) {
										return { target: 'finishing' }
									}
									if (!available(context)) {
										return { target: 'finishing' }
									}
									if (args.guards.transferChangeRequiresUnlink(args)) {
										return { target: '#transaction-save.transferChangeRequiresUnlink' }
									}
									if (context.checkpoint?.transactionSettlement === 'unknown') {
										return { target: 'reconcilingLedger' }
									}
									return { target: 'assessingCheck' }
								}
							},
							reconcilingLedger: {
								on: {
									CANCEL: { target: 'finishing' },
									INVALIDATE: { target: 'finishing' },
									SHUTDOWN: { target: 'finishing' }
								},
								invoke: {
									src: 'readLedger',
									input: ({ context }) => required(context.checkpoint).transactionId,
									onDone: (args) => {
										return { target: 'checkingLedger', context: { observed: args.event.output } }
									},
									onError: { target: 'finishing' }
								}
							},
							checkingLedger: {
								always: (args) => {
									const { context } = args
									if (args.guards.interrupted(args)) {
										return { target: 'finishing' }
									}
									if (matchingLedger(context)) {
										return {
											target: 'finishing',
											context: ((args) => ({
												checkpoint: (({ context }) => ({
													...required(context.checkpoint),
													['transactionSettlement']: 'confirmed'
												}))(args)
											}))(args)
										}
									}
									return { target: 'finishing' }
								}
							},
							assessingCheck: {
								always: (args) => {
									const { context } = args
									if (matchesState({ running: { control: 'interrupted' } }, args.value)) {
										return { target: 'finishing' }
									}
									if (required(context.values).paymentMethod !== PAYMENT_METHOD.CHECK) {
										return { target: 'reobserving' }
									}
									if (required(context.checkpoint).checkId === null) {
										return { target: 'allocatingCheck' }
									}
									if (
										(({ context }) => {
											const v = required(context.values)
											return (
												v.paymentMethod === PAYMENT_METHOD.CHECK &&
												v.check.kind === 'new' &&
												['notStarted', 'rejected'].includes(
													required(context.checkpoint).checkSettlement
												)
											)
										})(args)
									) {
										return { target: 'creatingCheck' }
									}
									return { target: 'readingCheck' }
								}
							},
							allocatingCheck: {
								invoke: {
									src: 'allocate',
									input: ({ context }) => ({
										values: required(context.values),
										scope: required(context.input).request.scope
									}),
									onDone: (args) => {
										const { event } = args
										return {
											target: 'assessingCheck',
											context: {
												checkpoint: {
													...required(args.context.checkpoint),
													checkId: event.output.checkId,
													checkIntent: event.output.checkIntent
												}
											}
										}
									},
									onError: { target: 'finishing' }
								}
							},
							readingCheck: {
								on: {
									CANCEL: { target: 'finishing' },
									INVALIDATE: { target: 'finishing' },
									SHUTDOWN: { target: 'finishing' }
								},
								invoke: {
									src: 'readCheck',
									input: ({ context }) => ({
										id: required(required(context.checkpoint).checkId ?? undefined),
										uncertain: context.checkpoint?.checkSettlement === 'unknown'
									}),
									onDone: (args) => {
										return { target: 'checkingCheck', context: { check: args.event.output[0] } }
									},
									onError: { target: 'finishing' }
								}
							},
							checkingCheck: {
								always: (args) => {
									const { context } = args
									if (args.guards.interrupted(args)) {
										return { target: 'finishing' }
									}
									if (!checkCompatible(context)) {
										return { target: 'finishing' }
									}
									if (
										required(context.checkpoint).checkSettlement === 'unknown' &&
										!checkMatches(context)
									) {
										return { target: 'finishing' }
									}
									return {
										target: 'assessingMetadata',
										context: ((args) => ({
											checkpoint: (({ context }) => ({
												...required(context.checkpoint),
												['checkSettlement']: 'locallyPersisted'
											}))(args)
										}))(args)
									}
								}
							},
							assessingMetadata: {
								always: (args) => {
									if (matchesState({ running: { control: 'interrupted' } }, args.value)) {
										return { target: 'finishing' }
									}
									if (
										(({ context }) => {
											const desired = requestedCheck(context)
											return desired !== undefined && !checkMatches(context, desired)
										})(args)
									) {
										return { target: 'updatingCheck' }
									}
									return { target: 'reobserving' }
								}
							},
							creatingCheck: {
								entry: (args) => {
									let context = args.context
									let patch = {}
									patch = {
										...patch,
										...((args) => ({
											checkpoint: (({ context }) => ({
												...required(context.checkpoint),
												checkValues: requestedCheck(context)
											}))(args)
										}))(args)
									}
									context = { ...args.context, ...patch }
									patch = {
										...patch,
										...((args) => ({
											checkpoint: (({ context }) => ({
												...required(context.checkpoint),
												['checkSettlement']: 'unknown'
											}))(args)
										}))({ ...args, context })
									}
									context = { ...args.context, ...patch }
									return { context: patch }
								},
								invoke: {
									id: 'checkWrite',
									src: 'checkWrite',
									input: ({ context }) => ({
										id: required(required(context.checkpoint).checkId ?? undefined),
										values: required(requestedCheck(context)),
										mode: 'create'
									}),
									onDone: (args) => {
										return {
											target: 'afterCheckWrite',
											context: {
												checkpoint: {
													...required(args.context.checkpoint),
													checkSettlement: args.event.output.settlement
												}
											}
										}
									},
									onError: { target: 'finishing' }
								}
							},
							updatingCheck: {
								entry: (args) => {
									let context = args.context
									let patch = {}
									patch = {
										...patch,
										...((args) => ({
											checkpoint: (({ context }) => ({
												...required(context.checkpoint),
												checkValues: requestedCheck(context)
											}))(args)
										}))(args)
									}
									context = { ...args.context, ...patch }
									patch = {
										...patch,
										...((args) => ({
											checkpoint: (({ context }) => ({
												...required(context.checkpoint),
												['checkSettlement']: 'unknown'
											}))(args)
										}))({ ...args, context })
									}
									context = { ...args.context, ...patch }
									return { context: patch }
								},
								invoke: {
									id: 'checkWrite',
									src: 'checkWrite',
									input: ({ context }) => ({
										id: required(required(context.checkpoint).checkId ?? undefined),
										values: required(requestedCheck(context)),
										mode: 'edit'
									}),
									onDone: (args) => {
										return {
											target: 'afterCheckWrite',
											context: {
												checkpoint: {
													...required(args.context.checkpoint),
													checkSettlement: args.event.output.settlement
												}
											}
										}
									},
									onError: { target: 'finishing' }
								}
							},
							afterCheckWrite: {
								always: (args) => {
									if (matchesState({ running: { control: 'interrupted' } }, args.value)) {
										return { target: 'finishing' }
									}
									if (required(args.context.checkpoint).checkSettlement === 'locallyPersisted') {
										return { target: 'verifyingCheck' }
									}
									return { target: 'finishing' }
								}
							},
							verifyingCheck: {
								on: {
									CANCEL: { target: 'finishing' },
									INVALIDATE: { target: 'finishing' },
									SHUTDOWN: { target: 'finishing' }
								},
								invoke: {
									src: 'readCheck',
									input: ({ context }) => ({
										id: required(required(context.checkpoint).checkId ?? undefined),
										uncertain: false
									}),
									onDone: (args) => {
										return {
											target: 'checkingSavedCheck',
											context: { check: args.event.output[0] }
										}
									},
									onError: { target: 'finishing' }
								}
							},
							checkingSavedCheck: {
								always: (args) => {
									const { context } = args
									if (matchesState({ running: { control: 'interrupted' } }, args.value)) {
										return { target: 'finishing' }
									}
									if (checkMatches(context)) {
										return { target: 'reobserving' }
									}
									return { target: 'finishing' }
								}
							},
							reobserving: {
								on: {
									CANCEL: { target: 'finishing' },
									INVALIDATE: { target: 'finishing' },
									SHUTDOWN: { target: 'finishing' }
								},
								invoke: {
									src: 'observe',
									onDone: (args) => {
										return { target: 'reassessing', context: { facts: args.event.output } }
									},
									onError: { target: 'finishing' }
								}
							},
							reassessing: {
								always: (args) => {
									const { context } = args
									if (matchesState({ running: { control: 'interrupted' } }, args.value)) {
										return { target: 'finishing' }
									}
									if (!available(context)) {
										return { target: 'finishing' }
									}
									if (args.guards.transferChangeRequiresUnlink(args)) {
										return { target: '#transaction-save.transferChangeRequiresUnlink' }
									}
									return { target: 'savingLedger' }
								}
							},
							savingLedger: {
								entry: (args) => {
									let context = args.context
									let patch = {}
									patch = {
										...patch,
										...((args) => ({
											checkpoint: (({ context }) => ({
												...required(context.checkpoint),
												submitted: ledgerValues(
													required(context.values),
													required(context.checkpoint).checkId
												)
											}))(args)
										}))(args)
									}
									context = { ...args.context, ...patch }
									patch = {
										...patch,
										...((args) => ({
											checkpoint: (({ context }) => ({
												...required(context.checkpoint),
												['transactionSettlement']: 'unknown'
											}))(args)
										}))({ ...args, context })
									}
									context = { ...args.context, ...patch }
									return { context: patch }
								},
								invoke: {
									id: 'ledgerWrite',
									src: 'ledgerWrite',
									input: ({ context }) => ({
										transactionId: required(context.checkpoint).transactionId,
										values: ledgerValues(
											required(context.values),
											required(context.checkpoint).checkId
										),
										mode: context.input?.request.scope.transactionId ? 'edit' : 'create',
										...(context.values?.paymentMethod === PAYMENT_METHOD.CHECK &&
										context.check &&
										context.check.accountId !== context.values.accountId
											? { moveCheckFromAccountId: context.check.accountId }
											: {})
									}),
									onDone: (args) => {
										const { event } = args
										return {
											target: 'finishing',
											context: {
												checkpoint: {
													...required(args.context.checkpoint),
													transactionSettlement: event.output.settlement
												},
												transferChangeBlocked:
													event.output.outcome === 'failed' &&
													event.output.reason === 'linkedTransferRequiresUnlink'
											}
										}
									},
									onError: { target: 'finishing' }
								}
							},
							finishing: {
								always: (args) => {
									const { context } = args
									if (
										matchesState({ running: { control: { interrupted: 'closed' } } }, args.value)
									) {
										return { target: '#transaction-save.closed' }
									}
									if (
										matchesState(
											{ running: { control: { interrupted: 'scopeChanged' } } },
											args.value
										)
									) {
										return { target: '#transaction-save.scopeChanged' }
									}
									if (
										matchesState({ running: { control: { interrupted: 'cancelled' } } }, args.value)
									) {
										return { target: '#transaction-save.cancelled' }
									}
									if (context.transferChangeBlocked) {
										return { target: '#transaction-save.transferChangeRequiresUnlink' }
									}
									if (
										['locallyPersisted', 'confirmed'].includes(
											context.checkpoint?.transactionSettlement ?? ''
										)
									) {
										return { target: '#transaction-save.succeeded' }
									}
									if (
										context.checkpoint?.transactionSettlement === 'unknown' ||
										context.checkpoint?.checkSettlement === 'unknown'
									) {
										return { target: '#transaction-save.unresolved' }
									}
									if (context.checkpoint?.checkSettlement === 'locallyPersisted') {
										return { target: '#transaction-save.partial' }
									}
									return { target: '#transaction-save.failed' }
								}
							}
						}
					}
				}
			},
			succeeded: terminal('succeeded'),
			failed: terminal('failed'),
			partial: terminal('partial'),
			unresolved: terminal('unresolved'),
			transferChangeRequiresUnlink: terminal('transferChangeRequiresUnlink'),
			cancelled: terminal('cancelled'),
			scopeChanged: terminal('scopeChanged'),
			closed: terminal('closed')
		}
	})
}
