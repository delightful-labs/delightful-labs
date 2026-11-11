import type { schema } from 'jazz-tools'
import { app } from '#lib/schema.js'
import { createAccountImportMachine } from './import-account.js'
import { required } from './identity.js'
import {
	emptyCounts,
	type Dependencies,
	type ImportCounts,
	type AccountImportReport,
	type ImportResult,
	type ImportOutcome,
	type ImportSettlement,
	type OperationWork,
	type ProgressEvent,
	type ProviderResponse
} from './types.js'
import { setup, types, createAsyncLogic, matchesState } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'

type Input = { work: OperationWork; response: ProviderResponse }
type Link = schema.RowOf<typeof app.simplefinAccountLinks>
type Category = schema.RowOf<typeof app.categories>
type Context = Input & {
	links: Link[]
	categories: Category[]
	index: number
	counts: ImportCounts
	accountCounts: ImportCounts
	accountResults: readonly AccountImportReport[]
	error: unknown
	settlement: ImportSettlement
	result: ImportOutcome | undefined
}
type Output = ImportResult
function combinedCounts(previous: ImportCounts, current: ImportCounts): ImportCounts {
	return {
		imported: previous.imported + current.imported,
		existing: previous.existing + current.existing,
		omitted: previous.omitted + current.omitted
	}
}

// Replace transient child progress with its final totals exactly once.
function accountReport(context: Context, result: ImportResult) {
	return {
		counts: combinedCounts(context.counts, result.counts),
		accountResults: [...context.accountResults, ...result.accountResults],
		accountCounts: emptyCounts(),
		error: result.error,
		settlement: result.settlement
	}
}

export function createImportMachine(dependencies: Dependencies) {
	const { db } = dependencies
	const actors = {
		mappings: createAsyncLogic({
			run: ({ input }: { input: Input }) =>
				db.all(app.simplefinAccountLinks.where({ organizationId: input.work.scope.organizationId }))
		}),
		categories: createAsyncLogic({
			run: ({ input }: { input: Input }) =>
				db.all(
					app.categories.where({
						organizationId: input.work.scope.organizationId,
						isSystem: true,
						archivedAt: { isNull: true }
					})
				)
		}),
		account: createAccountImportMachine(dependencies)
	}
	const events0 = {
		IMPORT_PROGRESS: types<EventPayload<ProgressEvent | { type: 'CANCEL' }, 'IMPORT_PROGRESS'>>(),
		CANCEL: types<EventPayload<ProgressEvent | { type: 'CANCEL' }, 'CANCEL'>>()
	}
	type NativeEvent0 =
		| import('xstate').InferEvents<typeof events0>
		| import('xstate').DoneActorEvent<
				| import('xstate').OutputFrom<(typeof actors)['mappings']>
				| import('xstate').OutputFrom<(typeof actors)['categories']>
				| import('xstate').OutputFrom<(typeof actors)['account']>
		  >
		| import('xstate').ErrorActorEvent
	return setup({
		schemas: {
			context: types<Context>(),
			events: events0,
			input: types<Input>(),
			output: types<Output>(),
			children: {
				mappings: types<import('xstate').ActorRefFrom<(typeof actors)['mappings']>>(),
				categories: types<import('xstate').ActorRefFrom<(typeof actors)['categories']>>(),
				account: types<import('xstate').ActorRefFrom<(typeof actors)['account']>>()
			}
		},
		actors,
		guards: {}
	}).createMachine({
		id: 'bank-import',
		context: ({ input }) => ({
			...input,
			links: [],
			categories: [],
			index: 0,
			counts: emptyCounts(),
			accountCounts: emptyCounts(),
			accountResults: [],
			error: undefined,
			settlement: 'settled',
			result: undefined
		}),
		initial: 'loadingMappings',
		output: ({ context }) => ({
			...required(context.result),
			accountResults: context.accountResults
		}),
		on: {
			CANCEL: { target: '.cancelled' },
			IMPORT_PROGRESS: (args, enq) => {
				let context = args.context
				const { event } = args
				let patch = {}
				patch = { ...patch, accountCounts: event.counts }
				context = { ...args.context, ...patch }
				enq.sendTo(args.parent, {
					type: 'IMPORT_PROGRESS',
					counts: combinedCounts(context.counts, event.counts)
				})
				return { context: patch }
			}
		},
		states: {
			loadingMappings: {
				invoke: {
					src: 'mappings',
					input: ({ context }) => context,
					onDone: (args) => {
						return { target: 'checkingMappings', context: { links: args.event.output } }
					},
					onError: (args) => {
						return { target: 'failed', context: { error: args.event.error } }
					}
				}
			},
			checkingMappings: {
				always: (args) => {
					const { context } = args
					if (
						context.links.some((link) =>
							context.links.some(
								(other) =>
									other.accountId === link.accountId &&
									other.simplefinAccountId !== link.simplefinAccountId
							)
						)
					) {
						return { target: 'accountConflict' }
					}
					return { target: 'loadingCategories' }
				}
			},
			loadingCategories: {
				invoke: {
					src: 'categories',
					input: ({ context }) => context,
					onDone: (args) => {
						return { target: 'nextAccount', context: { categories: args.event.output } }
					},
					onError: (args) => {
						return { target: 'failed', context: { error: args.event.error } }
					}
				}
			},
			nextAccount: {
				always: (args) => {
					const { context } = args
					if (context.index >= context.response.accounts.length) {
						return { target: 'complete' }
					}
					return { target: 'processingAccount' }
				}
			},
			processingAccount: {
				initial: 'working',
				states: { working: {}, cancelling: { on: { CANCEL: {} } } },
				on: {
					CANCEL: (args, enq) => {
						{
							const child = args.children.account
							if (child?.getSnapshot().status === 'active') enq.sendTo(child, { type: 'CANCEL' })
						}
						return { target: '.cancelling' }
					}
				},
				invoke: {
					id: 'account',
					src: 'account',
					input: ({ context }) => ({
						work: context.work,
						provider: required(context.response.accounts[context.index]),
						links: context.links,
						categories: context.categories
					}),
					onDone: (args) => {
						const { context, event } = args
						if (matchesState({ processingAccount: 'cancelling' }, args.value)) {
							return { target: 'cancelled', context: accountReport(context, event.output) }
						}
						if (event.output.kind === 'cancelled') {
							return { target: 'cancelled', context: accountReport(context, event.output) }
						}
						if (event.output.kind === 'failed') {
							return { target: 'failed', context: accountReport(context, event.output) }
						}
						return { target: 'advanceAccount', context: accountReport(context, event.output) }
					},
					onError: (args) => {
						const { event } = args
						if (matchesState({ processingAccount: 'cancelling' }, args.value)) {
							return {
								target: 'cancelled',
								context: { error: event.error, settlement: 'unresolved' }
							}
						}
						return { target: 'failed', context: { error: event.error, settlement: 'unresolved' } }
					}
				}
			},
			advanceAccount: {
				entry: (args, enq) => {
					const { context } = args
					enq.sendTo(args.parent, { type: 'IMPORT_PROGRESS', counts: context.counts })
					return { context: { index: context.index + 1 } }
				},
				always: { target: 'nextAccount' }
			},
			complete: {
				type: 'final',
				entry: (args) => {
					const { context } = args
					return {
						context: {
							result: {
								kind: 'complete',
								counts: combinedCounts(context.counts, context.accountCounts),
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
								counts: combinedCounts(context.counts, context.accountCounts),
								error: context.error,
								settlement: context.settlement
							}
						}
					}
				}
			},
			accountConflict: {
				always: { target: 'failed' },
				entry: () => {
					return { context: { error: new Error('account_already_linked') } }
				}
			},
			failed: {
				type: 'final',
				entry: (args) => {
					const { context } = args
					return {
						context: {
							result: {
								kind: 'failed',
								counts: combinedCounts(context.counts, context.accountCounts),
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
