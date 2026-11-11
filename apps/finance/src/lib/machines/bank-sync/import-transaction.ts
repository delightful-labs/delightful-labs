import { TRANSACTION_SOURCE } from '#lib/domain/transaction-source.js'
import { INCOME, EXPENSE, type TransactionKind } from '#lib/domain/transaction-kind.js'
import type { schema } from 'jazz-tools'
import { app } from '#lib/schema.js'
import { stableUuid } from '#lib/data.js'
import { parseAmountMinor } from '#lib/domain/money.js'
import { appTransactionSchema } from '#lib/validation/transactions.js'
import { providerTransactionSchema } from '#lib/validation/integrations.js'
import { providerAccountIdentity } from '#lib/integrations/simplefin.js'
import { createAuthorizationMachine } from './authorization.js'
import { required } from './identity.js'
import {
	credentialAuthorization,
	type Dependencies,
	type OperationWork,
	type ProviderResponse
} from './types.js'
import { setup, types, createAsyncLogic, matchesState } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'

type Category = schema.RowOf<typeof app.categories>
type Input = {
	work: OperationWork
	provider: ProviderResponse['accounts'][number]
	account: schema.RowOf<typeof app.accounts>
	categories: Category[]
	// Positive knowledge only; a miss always retains the normal lookup/write checks.
	existingIds?: ReadonlySet<string>
	raw: unknown
}
type Transaction = ReturnType<typeof providerTransactionSchema.parse>
type Values = {
	organizationId: string
	accountId: string
	categoryId: string
	kind: TransactionKind
	bookedOn: string
	amountMinor: number
	currency: string
	description: string
	source: typeof TRANSACTION_SOURCE.SIMPLEFIN
	externalId: string
}
export type TransactionPersistInput = { id: string; values: Values }
type Omission =
	| 'invalidSchema'
	| 'pending'
	| 'unsupportedCurrency'
	| 'currencyMismatch'
	| 'invalidAmount'
	| 'invalidDate'
	| 'invalidTransaction'
export type TransactionResult =
	| { kind: 'omitted'; reason: Omission }
	| { kind: 'existing' }
	| { kind: 'imported' }
	| { kind: 'failed'; error: unknown }
	| { kind: 'unresolved'; error: unknown }
	| {
			kind: 'cancelled'
			settlement: 'notStarted' | 'locallyPersisted' | 'unresolved'
			error: unknown
	  }
type Context = Input & {
	parsed: ReturnType<typeof providerTransactionSchema.safeParse>
	transaction: Transaction | undefined
	amount: ReturnType<typeof parseAmountMinor> | undefined
	kind: TransactionKind
	category: Category | undefined
	date: Date | undefined
	validated: ReturnType<typeof appTransactionSchema.safeParse> | undefined
	values: Values | undefined
	id: string | undefined
	error: unknown
	result: TransactionResult | undefined
	settlement: 'notStarted' | 'locallyPersisted' | 'unresolved'
}
function externalId(context: Context) {
	return JSON.stringify([
		providerAccountIdentity(context.provider),
		required(context.transaction).id
	])
}

export function createTransactionImportMachine(dependencies: Dependencies) {
	const { db } = dependencies
	const actors = {
		identity: createAsyncLogic({
			run: ({ input }: { input: { organizationId: string; externalId: string } }) =>
				stableUuid(input.organizationId, `simplefin-transaction:${input.externalId}`)
		}),
		authorize: createAuthorizationMachine(dependencies),
		existing: createAsyncLogic({
			run: ({ input }: { input: string }) => db.all(app.transactions.where({ id: input }))
		}),
		persist: createAsyncLogic<void, TransactionPersistInput>({
			run: async ({ input, signal }) => {
				signal.throwIfAborted()
				await db.insert(app.transactions, input.values, { id: input.id }).wait({ tier: 'local' })
			}
		})
	}
	const patchReadTimedOut = (
		{ context }: { context: Context },
		enqueue: (effect: () => void) => void
	): Partial<Context> => {
		enqueue(() => context.work.trace.log('import.transaction.read.timeout'))
		return { error: new Error('import-read-timeout') }
	}
	const events0 = {
		PROCESS: types<EventPayload<{ type: 'PROCESS' } | { type: 'CANCEL' }, 'PROCESS'>>(),
		CANCEL: types<EventPayload<{ type: 'PROCESS' } | { type: 'CANCEL' }, 'CANCEL'>>()
	}
	type NativeEvent0 =
		| import('xstate').InferEvents<typeof events0>
		| import('xstate').DoneActorEvent<
				| import('xstate').OutputFrom<(typeof actors)['identity']>
				| import('xstate').OutputFrom<(typeof actors)['authorize']>
				| import('xstate').OutputFrom<(typeof actors)['existing']>
				| import('xstate').OutputFrom<(typeof actors)['persist']>
		  >
		| import('xstate').ErrorActorEvent
	return setup({
		schemas: {
			context: types<Context>(),
			events: events0,
			input: types<Input>(),
			output: types<TransactionResult>(),
			children: {
				identity: types<import('xstate').ActorRefFrom<(typeof actors)['identity']>>(),
				authorize: types<import('xstate').ActorRefFrom<(typeof actors)['authorize']>>(),
				existing: types<import('xstate').ActorRefFrom<(typeof actors)['existing']>>(),
				persist: types<import('xstate').ActorRefFrom<(typeof actors)['persist']>>()
			}
		},
		actors,
		guards: {},
		delays: { readDeadline: 20000 },
		actions: {}
	}).createMachine({
		id: 'bank-import-transaction',
		context: ({ input }) => ({
			...input,
			parsed: providerTransactionSchema.safeParse(input.raw),
			transaction: undefined,
			amount: undefined,
			kind: INCOME,
			category: undefined,
			date: undefined,
			validated: undefined,
			values: undefined,
			id: undefined,
			error: undefined,
			settlement: 'notStarted',
			result: undefined
		}),
		initial: 'checkingSchema',
		output: ({ context }) => required(context.result),
		on: { CANCEL: { target: '.cancelled' } },
		states: {
			checkingSchema: {
				always: (args) => {
					const { context } = args
					if (!context.parsed.success) {
						return { target: 'invalidSchema' }
					}
					return {
						target: 'checkingPending',
						context: {
							transaction: required(context.parsed.success ? context.parsed.data : undefined)
						}
					}
				}
			},
			checkingPending: {
				always: (args) => {
					if (Boolean(args.context.transaction?.pending)) {
						return { target: 'pending' }
					}
					return { target: 'checkingSupportedCurrency' }
				}
			},
			checkingSupportedCurrency: {
				always: (args) => {
					if (args.context.provider.currency !== 'USD') {
						return { target: 'unsupportedCurrency' }
					}
					return { target: 'checkingAccountCurrency' }
				}
			},
			checkingAccountCurrency: {
				always: (args) => {
					const { context } = args
					if (context.account.currency !== context.provider.currency) {
						return { target: 'currencyMismatch' }
					}
					return { target: 'parsingAmount' }
				}
			},
			parsingAmount: {
				entry: (args) => {
					return {
						context: {
							amount: parseAmountMinor(required(args.context.transaction).amount.replace(/^-/, ''))
						}
					}
				},
				always: { target: 'checkingAmount' }
			},
			checkingAmount: {
				always: (args) => {
					if (args.context.amount?.kind !== 'valid') {
						return { target: 'invalidAmount' }
					}
					return { target: 'choosingKind' }
				}
			},
			choosingKind: {
				always: (args) => {
					if (required(args.context.transaction).amount.startsWith('-')) {
						return { target: 'expense' }
					}
					return { target: 'income' }
				}
			},
			expense: {
				entry: (args) => {
					return { context: ((args) => ({ kind: EXPENSE }))(args) }
				},
				always: { target: 'selectingCategory' }
			},
			income: {
				entry: (args) => {
					return { context: ((args) => ({ kind: INCOME }))(args) }
				},
				always: { target: 'selectingCategory' }
			},
			selectingCategory: {
				entry: (args) => {
					const { context } = args
					return {
						context: { category: context.categories.find((row) => row.kind === context.kind) }
					}
				},
				always: (args) => {
					if (!args.context.category) {
						return { target: 'missingCategory' }
					}
					return { target: 'parsingDate' }
				}
			},
			parsingDate: {
				entry: (args) => {
					return { context: { date: new Date(required(args.context.transaction).posted * 1000) } }
				},
				always: (args) => {
					if (!Number.isFinite(required(args.context.date).getTime())) {
						return { target: 'invalidDate' }
					}
					return { target: 'validatingTransaction' }
				}
			},
			validatingTransaction: {
				entry: (args) => {
					const { context } = args
					return {
						context: {
							validated: appTransactionSchema.safeParse({
								organizationId: context.work.scope.organizationId,
								accountId: context.account.id,
								categoryId: required(context.category).id,
								kind: context.kind,
								bookedOn: required(context.date).toISOString().slice(0, 10),
								money: {
									amountMinor: required(
										context.amount?.kind === 'valid' ? context.amount.amountMinor : undefined
									),
									currency: context.provider.currency
								},
								description: required(context.transaction).description,
								source: { source: TRANSACTION_SOURCE.SIMPLEFIN, externalId: externalId(context) }
							})
						}
					}
				},
				always: (args) => {
					if (!args.context.validated?.success) {
						return { target: 'invalidTransaction' }
					}
					return { target: 'preparingValues' }
				}
			},
			preparingValues: {
				entry: (args) => {
					const { context } = args
					return {
						context: {
							values: {
								organizationId: context.work.scope.organizationId,
								accountId: context.account.id,
								categoryId: required(context.category).id,
								kind: context.kind,
								bookedOn: required(context.validated?.success ? context.validated.data : undefined)
									.bookedOn,
								amountMinor: required(
									context.amount?.kind === 'valid' ? context.amount.amountMinor : undefined
								),
								currency: context.provider.currency,
								description: required(context.transaction).description,
								source: TRANSACTION_SOURCE.SIMPLEFIN,
								externalId: externalId(context)
							}
						}
					}
				},
				always: { target: 'generatingIdentity' }
			},
			generatingIdentity: {
				invoke: {
					src: 'identity',
					input: ({ context }) => ({
						organizationId: context.work.scope.organizationId,
						externalId: externalId(context)
					}),
					onDone: (args) => {
						const { event } = args
						if (args.context.existingIds?.has(event.output) === true) {
							return { target: 'existing', context: { id: event.output } }
						}
						return { target: 'authorizingLookup', context: { id: event.output } }
					},
					onError: (args) => {
						return { target: 'failed', context: { error: args.event.error } }
					}
				}
			},
			authorizingLookup: {
				after: {
					readDeadline: (args, enq) => {
						return { target: 'failed', context: patchReadTimedOut(args, enq) }
					}
				},
				invoke: {
					src: 'authorize',
					input: ({ context }) => credentialAuthorization(context.work),
					onDone: (args) => {
						const { event } = args
						if (event.output.error !== undefined) {
							return { target: 'failed', context: { error: event.output.error } }
						}
						return { target: 'findingExisting' }
					},
					onError: (args) => {
						return { target: 'failed', context: { error: args.event.error } }
					}
				}
			},
			findingExisting: {
				after: {
					readDeadline: (args, enq) => {
						return { target: 'failed', context: patchReadTimedOut(args, enq) }
					}
				},
				invoke: {
					src: 'existing',
					input: ({ context }) => required(context.id),
					onDone: (args) => {
						if (args.event.output.length > 0) {
							return { target: 'existing' }
						}
						return { target: 'authorizingWrite' }
					},
					onError: (args) => {
						return { target: 'failed', context: { error: args.event.error } }
					}
				}
			},
			authorizingWrite: {
				after: {
					readDeadline: (args, enq) => {
						return { target: 'failed', context: patchReadTimedOut(args, enq) }
					}
				},
				invoke: {
					src: 'authorize',
					input: ({ context }) => credentialAuthorization(context.work),
					onDone: (args) => {
						const { event } = args
						if (event.output.error !== undefined) {
							return { target: 'failed', context: { error: event.output.error } }
						}
						return { target: 'persisting' }
					},
					onError: (args) => {
						return { target: 'failed', context: { error: args.event.error } }
					}
				}
			},
			persisting: {
				initial: 'working',
				entry: () => {
					return { context: { settlement: 'unresolved' } }
				},
				states: {
					working: {},
					cancelling: { on: { CANCEL: {} } }
				},
				on: { CANCEL: { target: '.cancelling' } },
				invoke: {
					src: 'persist',
					input: ({ context }) => ({ id: required(context.id), values: required(context.values) }),
					onDone: (args) => {
						if (matchesState({ persisting: 'cancelling' }, args.value)) {
							return { target: 'cancelled', context: { settlement: 'locallyPersisted' } }
						}
						return { target: 'imported', context: { settlement: 'locallyPersisted' } }
					},
					onError: (args) => {
						const { event } = args
						if (matchesState({ persisting: 'cancelling' }, args.value)) {
							return { target: 'cancelled', context: { error: event.error } }
						}
						return { target: 'unresolved', context: { error: event.error } }
					}
				}
			},
			cancelled: {
				type: 'final',
				entry: (args) => {
					const { context } = args
					return {
						context: {
							result: {
								kind: 'cancelled',
								settlement: context.settlement,
								error: context.error
							}
						}
					}
				}
			},
			unresolved: {
				type: 'final',
				entry: (args) => {
					return { context: { result: { kind: 'unresolved', error: args.context.error } } }
				}
			},
			invalidSchema: {
				type: 'final',
				entry: () => {
					return { context: { result: { kind: 'omitted', reason: 'invalidSchema' } } }
				}
			},
			pending: {
				type: 'final',
				entry: () => {
					return { context: { result: { kind: 'omitted', reason: 'pending' } } }
				}
			},
			unsupportedCurrency: {
				type: 'final',
				entry: () => {
					return { context: { result: { kind: 'omitted', reason: 'unsupportedCurrency' } } }
				}
			},
			currencyMismatch: {
				type: 'final',
				entry: () => {
					return { context: { result: { kind: 'omitted', reason: 'currencyMismatch' } } }
				}
			},
			invalidAmount: {
				type: 'final',
				entry: () => {
					return { context: { result: { kind: 'omitted', reason: 'invalidAmount' } } }
				}
			},
			invalidDate: {
				type: 'final',
				entry: () => {
					return { context: { result: { kind: 'omitted', reason: 'invalidDate' } } }
				}
			},
			invalidTransaction: {
				type: 'final',
				entry: () => {
					return { context: { result: { kind: 'omitted', reason: 'invalidTransaction' } } }
				}
			},
			existing: {
				type: 'final',
				entry: () => {
					return { context: { result: { kind: 'existing' } } }
				}
			},
			imported: {
				type: 'final',
				entry: () => {
					return { context: { result: { kind: 'imported' } } }
				}
			},
			missingCategory: {
				type: 'final',
				entry: () => {
					return { context: { result: { kind: 'failed', error: new Error('mapping') } } }
				}
			},
			failed: {
				type: 'final',
				entry: (args) => {
					return { context: { result: { kind: 'failed', error: args.context.error } } }
				}
			}
		}
	})
}
