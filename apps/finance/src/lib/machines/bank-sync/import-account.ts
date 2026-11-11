import type { schema } from 'jazz-tools'
import { app } from '#lib/schema.js'
import { providerAccountIdentity, providerBalanceSnapshot } from '#lib/integrations/simplefin.js'
import { createTransactionImportMachine, type TransactionResult } from './import-transaction.js'
import { required } from './identity.js'
import {
	emptyCounts,
	type Dependencies,
	type ImportCounts,
	type ImportSettlement,
	type ImportResult,
	type ImportOutcome,
	type OperationWork,
	type ProgressEvent,
	type ProviderResponse
} from './types.js'
import { createCallbackLogic, setup, types, createAsyncLogic, matchesState } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'

type Link = schema.RowOf<typeof app.simplefinAccountLinks>
type Input = {
	work: OperationWork
	provider: ProviderResponse['accounts'][number]
	links: Link[]
	categories: schema.RowOf<typeof app.categories>[]
}
type Context = Input & {
	matches: Link[]
	account: schema.RowOf<typeof app.accounts> | undefined
	existingIds: ReadonlySet<string>
	index: number
	counts: ImportCounts
	error: unknown
	settlement: ImportSettlement
	result: ImportOutcome | undefined
}
export type AccountImportResult = ImportResult

// Child-owned acceptance outcomes map to counters without making new acceptance decisions.
function transactionReport(context: Context, result: TransactionResult) {
	const imported =
		result.kind === 'imported' ||
		(result.kind === 'cancelled' && result.settlement === 'locallyPersisted')
	const unresolved =
		result.kind === 'unresolved' ||
		(result.kind === 'cancelled' && result.settlement === 'unresolved')
	return {
		counts: {
			imported: context.counts.imported + (imported ? 1 : 0),
			existing: context.counts.existing + (result.kind === 'existing' ? 1 : 0),
			omitted: context.counts.omitted + (result.kind === 'omitted' ? 1 : 0)
		},
		error: 'error' in result ? result.error : undefined,
		settlement: unresolved ? 'unresolved' : context.settlement
	} satisfies Pick<Context, 'counts' | 'error' | 'settlement'>
}

export function createAccountImportMachine(dependencies: Dependencies) {
	const actors = {
		existing: createAsyncLogic({
			run: ({ input }: { input: { organizationId: string; accountId: string } }) =>
				dependencies.db.all(
					app.transactions
						.where({
							organizationId: input.organizationId,
							accountId: input.accountId,
							source: 'simplefin'
						})
						.orderBy('bookedOn', 'desc')
						.orderBy('id', 'desc')
						.select('id')
						.limit(500),
					{ tier: 'local-first' }
				)
		}),
		yieldControl: createCallbackLogic<{ type: 'CONTINUE' }>(({ sendBack }) => {
			const channel = new MessageChannel()
			channel.port1.onmessage = () => sendBack({ type: 'CONTINUE' })
			channel.port2.postMessage(undefined)
			return () => {
				channel.port1.onmessage = null
				channel.port1.close()
				channel.port2.close()
			}
		}),
		account: createAsyncLogic({
			run: ({ input }: { input: { accountId: string; organizationId: string } }) =>
				dependencies.db.all(
					app.accounts.where({
						id: input.accountId,
						organizationId: input.organizationId,
						archivedAt: { isNull: true }
					})
				)
		}),
		saveBalanceSnapshot: createAsyncLogic({
			run: async ({
				input
			}: {
				input: { linkId: string; availableBalance: string; balanceDate: Date }
			}) =>
				dependencies.db
					.update(app.simplefinAccountLinks, input.linkId, {
						availableBalance: input.availableBalance,
						balanceDate: input.balanceDate
					})
					.wait({ tier: 'local' })
		}),
		transaction: createTransactionImportMachine(dependencies)
	}
	const events0 = {
		IMPORT_PROGRESS:
			types<
				EventPayload<ProgressEvent | { type: 'CANCEL' } | { type: 'CONTINUE' }, 'IMPORT_PROGRESS'>
			>(),
		CANCEL:
			types<EventPayload<ProgressEvent | { type: 'CANCEL' } | { type: 'CONTINUE' }, 'CANCEL'>>(),
		CONTINUE:
			types<EventPayload<ProgressEvent | { type: 'CANCEL' } | { type: 'CONTINUE' }, 'CONTINUE'>>()
	}
	type NativeEvent0 =
		| import('xstate').InferEvents<typeof events0>
		| import('xstate').DoneActorEvent<
				| import('xstate').OutputFrom<(typeof actors)['existing']>
				| import('xstate').OutputFrom<(typeof actors)['yieldControl']>
				| import('xstate').OutputFrom<(typeof actors)['account']>
				| import('xstate').OutputFrom<(typeof actors)['saveBalanceSnapshot']>
				| import('xstate').OutputFrom<(typeof actors)['transaction']>
		  >
		| import('xstate').ErrorActorEvent
	return setup({
		schemas: {
			context: types<Context>(),
			events: events0,
			input: types<Input>(),
			output: types<AccountImportResult>(),
			children: {
				existing: types<import('xstate').ActorRefFrom<(typeof actors)['existing']>>(),
				yieldControl: types<import('xstate').ActorRefFrom<(typeof actors)['yieldControl']>>(),
				account: types<import('xstate').ActorRefFrom<(typeof actors)['account']>>(),
				saveBalanceSnapshot:
					types<import('xstate').ActorRefFrom<(typeof actors)['saveBalanceSnapshot']>>(),
				transaction: types<import('xstate').ActorRefFrom<(typeof actors)['transaction']>>()
			}
		},
		actors,
		guards: {},
		delays: { existingReadDeadline: 5000 }
	}).createMachine({
		id: 'bank-import-account',
		context: ({ input }) => ({
			...input,
			matches: input.links.filter(
				(link) => link.simplefinAccountId === providerAccountIdentity(input.provider)
			),
			account: undefined,
			existingIds: new Set(),
			index: 0,
			counts: emptyCounts(),
			error: undefined,
			settlement: 'settled',
			result: undefined
		}),
		initial: 'checkingMapping',
		output: ({ context }) => {
			const result = required(context.result)
			return {
				...result,
				accountResults: [
					{
						account: context.account
							? { id: context.account.id, name: context.account.name }
							: undefined,
						kind: result.kind,
						counts: result.counts,
						settlement: result.settlement
					}
				]
			}
		},
		on: { CANCEL: { target: '.cancelled' } },
		states: {
			checkingMapping: {
				always: (args) => {
					const { context } = args
					if (context.matches.length === 0) {
						return { target: 'unmapped' }
					}
					if (context.matches.length > 1) {
						return { target: 'invalidMapping' }
					}
					return { target: 'loadingAccount' }
				}
			},
			unmapped: {
				always: { target: 'complete' },
				entry: (args) => {
					const { context } = args
					return {
						context: {
							counts: {
								...context.counts,
								omitted: context.provider.transactions?.length ?? 0
							}
						}
					}
				}
			},
			loadingAccount: {
				invoke: {
					src: 'account',
					input: ({ context }) => ({
						accountId: required(context.matches[0]).accountId,
						organizationId: context.work.scope.organizationId
					}),
					onDone: (args) => {
						return { target: 'checkingAccount', context: { account: args.event.output[0] } }
					},
					onError: (args) => {
						return { target: 'failed', context: { error: args.event.error } }
					}
				}
			},
			checkingAccount: {
				always: (args) => {
					const { context } = args
					if (!context.account) {
						return { target: 'invalidMapping' }
					}
					if (!context.provider.transactions?.length) {
						return { target: 'checkingBalanceSnapshot' }
					}
					return { target: 'loadingExisting' }
				}
			},
			loadingExisting: {
				// This snapshot is intentionally partial: only presence enables the fast path.
				entry: ({ context }, enq) => {
					enq(() => context.work.trace.log('import.existing-snapshot:start'))
				},
				after: {
					existingReadDeadline: (args, enq) => {
						enq(() => args.context.work.trace.log('import.existing-snapshot.timeout'))
						return { target: 'checkingBalanceSnapshot' }
					}
				},
				invoke: {
					src: 'existing',
					input: ({ context }) => ({
						organizationId: context.work.scope.organizationId,
						accountId: required(context.account).id
					}),
					onDone: (args, enq) => {
						enq(({ context }) => context.work.trace.log('import.existing-snapshot:done'), args)
						return {
							target: 'checkingBalanceSnapshot',
							context: { existingIds: new Set(args.event.output.map((row) => row.id)) }
						}
					},
					onError: (args, enq) => {
						enq(() =>
							args.context.work.trace.failed('import.existing-snapshot.failed', args.event.error)
						)
						return { target: 'checkingBalanceSnapshot' }
					}
				}
			},
			checkingBalanceSnapshot: {
				always: (args) => {
					if (providerBalanceSnapshot(args.context.provider) === undefined) {
						return { target: 'nextTransaction' }
					}
					return { target: 'savingBalanceSnapshot' }
				}
			},
			savingBalanceSnapshot: {
				initial: 'working',
				states: {
					working: {},
					cancelling: { on: { CANCEL: {} } }
				},
				on: { CANCEL: { target: '.cancelling' } },
				invoke: {
					src: 'saveBalanceSnapshot',
					input: ({ context }) => {
						const snapshot = providerBalanceSnapshot(context.provider)
						if (!snapshot) throw new Error('missing-provider-balance')
						return { linkId: required(context.matches[0]).id, ...snapshot }
					},
					onDone: (args) => {
						if (matchesState({ savingBalanceSnapshot: 'cancelling' }, args.value)) {
							return { target: 'cancelled' }
						}
						return { target: 'nextTransaction' }
					},
					onError: (args) => {
						const { event } = args
						if (matchesState({ savingBalanceSnapshot: 'cancelling' }, args.value)) {
							return {
								target: 'cancelled',
								context: { error: event.error, settlement: 'unresolved' }
							}
						}
						return { target: 'failed', context: { error: event.error, settlement: 'unresolved' } }
					}
				}
			},
			nextTransaction: {
				always: (args) => {
					const { context } = args
					if (context.index >= (context.provider.transactions?.length ?? 0)) {
						return { target: 'complete' }
					}
					return { target: 'processingTransaction' }
				}
			},
			processingTransaction: {
				initial: 'working',
				states: { working: {}, cancelling: { on: { CANCEL: {} } } },
				on: {
					CANCEL: (args, enq) => {
						{
							const child = args.children.transaction
							if (child?.getSnapshot().status === 'active') enq.sendTo(child, { type: 'CANCEL' })
						}
						return { target: '.cancelling' }
					}
				},
				invoke: {
					id: 'transaction',
					src: 'transaction',
					input: ({ context }) => ({
						work: context.work,
						provider: context.provider,
						account: required(context.account),
						categories: context.categories,
						existingIds: context.existingIds,
						raw: context.provider.transactions?.[context.index]
					}),
					onDone: (args) => {
						const { context, event } = args
						if (matchesState({ processingTransaction: 'cancelling' }, args.value)) {
							return { target: 'cancelled', context: transactionReport(context, event.output) }
						}
						if (event.output.kind === 'cancelled') {
							return { target: 'cancelled', context: transactionReport(context, event.output) }
						}
						if (event.output.kind === 'failed' || event.output.kind === 'unresolved') {
							return { target: 'failed', context: transactionReport(context, event.output) }
						}
						return {
							target: 'advanceTransaction',
							context: transactionReport(context, event.output)
						}
					},
					onError: (args) => {
						const { event } = args
						if (matchesState({ processingTransaction: 'cancelling' }, args.value)) {
							return {
								target: 'cancelled',
								context: { error: event.error, settlement: 'unresolved' }
							}
						}
						return { target: 'failed', context: { error: event.error, settlement: 'unresolved' } }
					}
				}
			},
			advanceTransaction: {
				entry: (args, enq) => {
					const { context } = args
					enq.sendTo(args.parent, { type: 'IMPORT_PROGRESS', counts: context.counts })
					return { context: { index: context.index + 1 } }
				},
				always: (args) => {
					const { context } = args
					if (
						context.index % 25 === 0 &&
						context.index < (context.provider.transactions?.length ?? 0)
					) {
						return { target: 'yielding' }
					}
					return { target: 'nextTransaction' }
				}
			},
			yielding: {
				invoke: {
					src: 'yieldControl',
					onError: (args) => {
						return { target: 'failed', context: { error: args.event.error } }
					}
				},
				on: { CONTINUE: { target: 'nextTransaction' } }
			},
			complete: {
				type: 'final',
				entry: (args) => {
					return {
						context: {
							result: {
								kind: 'complete',
								counts: args.context.counts,
								error: undefined,
								settlement: 'settled'
							}
						}
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
								counts: context.counts,
								error: context.error,
								settlement: context.settlement
							}
						}
					}
				}
			},
			invalidMapping: {
				entry: () => {
					return { context: { error: new Error('mapping') } }
				},
				always: { target: 'failed' }
			},
			failed: {
				type: 'final',
				entry: (args, enq) => {
					const { context } = args
					enq(
						({ context }) => context.work.trace.failed('import.account.failed', context.error),
						args
					)
					return {
						context: {
							result: {
								kind: 'failed',
								counts: context.counts,
								error: context.error,
								settlement: context.settlement
							}
						}
					}
				}
			}
		}
	})
}
