import { app } from '#lib/schema.js'
import type { AccountWrite } from './account-write.js'
import type { Dependencies } from './types.js'
import { required } from './identity.js'
import { setup, types, createAsyncLogic, matchesState } from 'xstate'
import type { ErrorActorEvent, OutputFrom } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'

export type MappingInterruption = { type: 'CANCEL' } | { type: 'SHUTDOWN' }
type Settlement = 'notStarted' | 'rolledBack' | 'locallyPersisted' | 'unresolved'
export type MappingTransactionResult =
	| { outcome: 'succeeded' | 'unchanged' | 'cancelled' | 'closed'; settlement: Settlement }
	| { outcome: 'failed'; settlement: Settlement; error: unknown }
type Transaction = ReturnType<Dependencies['db']['beginTransaction']>
type Input = {
	db: Pick<Dependencies['db'], 'beginTransaction'>
	request: AccountWrite
	linkId: string
}
type Resource = { tx: Transaction; request: AccountWrite }

const open = createAsyncLogic({
	run: ({ input }: { input: Input['db'] }) => Promise.resolve(input.beginTransaction())
})
const providerLinks = createAsyncLogic({
	run: ({ input }: { input: Resource }) =>
		input.tx.all(
			app.simplefinAccountLinks.where({
				organizationId: input.request.work.scope.organizationId,
				simplefinAccountId: input.request.provider.id
			})
		)
})
const destination = createAsyncLogic({
	run: async ({ input }: { input: Resource }) => {
		const [links, accounts] = await Promise.all([
			input.tx.all(
				app.simplefinAccountLinks.where({
					organizationId: input.request.work.scope.organizationId,
					accountId: input.request.accountId
				})
			),
			input.tx.all(app.accounts.where({ id: input.request.accountId }))
		])
		return { links, account: accounts[0] }
	}
})
type Creation = { tx: Transaction; request: Extract<AccountWrite, { kind: 'create' }> }
const createAccount = createAsyncLogic({
	run: async ({ input }: { input: Creation }) => {
		input.tx.insert(app.accounts, input.request.values, { id: input.request.accountId })
	}
})
type LinkValues = {
	organizationId: string
	connectionId: string
	simplefinAccountId: string
	accountId: string
	availableBalance?: string
	balanceDate?: Date
}
type LinkWrite = { tx: Transaction; id: string; values: LinkValues }
const insertLink = createAsyncLogic({
	run: async ({ input }: { input: LinkWrite }) => {
		input.tx.insert(app.simplefinAccountLinks, input.values, { id: input.id })
	}
})
const updateLink = createAsyncLogic({
	run: async ({ input }: { input: LinkWrite }) => {
		input.tx.update(app.simplefinAccountLinks, input.id, input.values)
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
	input: Input
	tx: Transaction | undefined
	links: OutputFrom<typeof providerLinks>
	destination: OutputFrom<typeof destination> | undefined
	write: OutputFrom<typeof commit> | undefined
	error: unknown
	settlement: Settlement
	result: MappingTransactionResult | undefined
}
function resource(context: Context): Resource {
	return { tx: required(context.tx), request: context.input.request }
}
function linkWrite(context: Context, id: string): LinkWrite {
	const { work, provider, accountId } = context.input.request
	return {
		tx: required(context.tx),
		id,
		values: {
			organizationId: work.scope.organizationId,
			connectionId: work.current.id,
			simplefinAccountId: provider.id,
			accountId,
			...(provider.availableBalance !== undefined && provider.balanceDate !== undefined
				? {
						availableBalance: provider.availableBalance,
						balanceDate: provider.balanceDate
					}
				: {})
		}
	}
}

/** Owns one transaction; interruption never discards an acquired resource or issued commit. */
const actors = {
	open,
	providerLinks,
	destination,
	createAccount,
	insertLink,
	updateLink,
	commit,
	settle,
	rollback
}
const events0 = {
	CANCEL: types<EventPayload<MappingInterruption | ErrorActorEvent, 'CANCEL'>>(),
	SHUTDOWN: types<EventPayload<MappingInterruption | ErrorActorEvent, 'SHUTDOWN'>>()
}
type NativeEvent0 =
	| import('xstate').InferEvents<typeof events0>
	| import('xstate').DoneActorEvent<
			| import('xstate').OutputFrom<(typeof actors)['open']>
			| import('xstate').OutputFrom<(typeof actors)['providerLinks']>
			| import('xstate').OutputFrom<(typeof actors)['destination']>
			| import('xstate').OutputFrom<(typeof actors)['createAccount']>
			| import('xstate').OutputFrom<(typeof actors)['insertLink']>
			| import('xstate').OutputFrom<(typeof actors)['updateLink']>
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
const workflow = setup({
	schemas: {
		context: types<Context>(),
		events: events0,
		input: types<Input>(),
		output: types<MappingTransactionResult>(),
		children: {
			open: types<import('xstate').ActorRefFrom<(typeof actors)['open']>>(),
			providerLinks: types<import('xstate').ActorRefFrom<(typeof actors)['providerLinks']>>(),
			destination: types<import('xstate').ActorRefFrom<(typeof actors)['destination']>>(),
			createAccount: types<import('xstate').ActorRefFrom<(typeof actors)['createAccount']>>(),
			insertLink: types<import('xstate').ActorRefFrom<(typeof actors)['insertLink']>>(),
			updateLink: types<import('xstate').ActorRefFrom<(typeof actors)['updateLink']>>(),
			commit: types<import('xstate').ActorRefFrom<(typeof actors)['commit']>>(),
			settle: types<import('xstate').ActorRefFrom<(typeof actors)['settle']>>(),
			rollback: types<import('xstate').ActorRefFrom<(typeof actors)['rollback']>>()
		}
	},
	actors,
	guards: {
		cancelling: (args: { value: import('xstate').StateValue }) =>
			matchesState({ running: { control: 'cancelling' } }, args.value),
		closing: (args: { value: import('xstate').StateValue }) =>
			matchesState({ running: { control: 'closing' } }, args.value)
	}
})
const failed = ({ event }: { event: NativeEvent0 }) => ({
	error: 'error' in event ? (event.error ?? new Error('save_failure')) : new Error('save_failure')
})

export const accountWriteTransaction = workflow.createMachine({
	id: 'bank-account-write-transaction',
	context: ({ input }) => ({
		input,
		tx: undefined,
		links: [],
		destination: undefined,
		write: undefined,
		error: undefined,
		settlement: 'notStarted',
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
								input: ({ context }) => context.input.db,
								onDone: (args) => {
									return { target: 'checkingAfterOpen', context: { tx: args.event.output } }
								},
								onError: (args) => {
									return { target: 'finishing', context: failed(args) }
								}
							}
						},
						checkingAfterOpen: {
							always: (args) => {
								if (
									matchesState({ running: { control: 'cancelling' } }, args.value) ||
									matchesState({ running: { control: 'closing' } }, args.value)
								) {
									return { target: 'rollingBack' }
								}
								return { target: 'loadingProviderLinks' }
							}
						},
						loadingProviderLinks: {
							invoke: {
								src: 'providerLinks',
								input: ({ context }) => resource(context),
								onDone: (args) => {
									return { target: 'checkingProviderLinks', context: { links: args.event.output } }
								},
								onError: (args) => {
									return { target: 'rollingBack', context: failed(args) }
								}
							}
						},
						checkingProviderLinks: {
							always: (args) => {
								const { context } = args
								if (
									matchesState({ running: { control: 'cancelling' } }, args.value) ||
									matchesState({ running: { control: 'closing' } }, args.value)
								) {
									return { target: 'rollingBack' }
								}
								if (context.links.length > 1) {
									return { target: 'invalidMapping' }
								}
								if (context.input.request.kind === 'create' && context.links.length === 1) {
									return { target: 'rollingBack' }
								}
								return { target: 'loadingDestination' }
							}
						},
						loadingDestination: {
							invoke: {
								src: 'destination',
								input: ({ context }) => resource(context),
								onDone: (args) => {
									return {
										target: 'checkingDestination',
										context: { destination: args.event.output }
									}
								},
								onError: (args) => {
									return { target: 'rollingBack', context: failed(args) }
								}
							}
						},
						checkingDestination: {
							always: (args) => {
								const { context } = args
								if (
									matchesState({ running: { control: 'cancelling' } }, args.value) ||
									matchesState({ running: { control: 'closing' } }, args.value)
								) {
									return { target: 'rollingBack' }
								}
								if (
									required(context.destination).links.some(
										(link) => link.simplefinAccountId !== context.input.request.provider.id
									)
								) {
									return { target: 'accountConflict' }
								}
								return { target: 'checkingAccount' }
							}
						},
						checkingAccount: {
							always: (args) => {
								const { context } = args
								if (
									(({ context }) => {
										const account = required(context.destination).account
										const request = context.input.request
										return (
											account !== undefined &&
											(account.organizationId !== request.work.scope.organizationId ||
												Boolean(account.archivedAt) ||
												(request.kind === 'create' &&
													account.currency !== request.provider.currency))
										)
									})(args)
								) {
									return { target: 'invalidMapping' }
								}
								if (
									context.input.request.kind === 'map' &&
									!required(context.destination).account
								) {
									return { target: 'invalidMapping' }
								}
								return { target: 'choosingAccountWrite' }
							}
						},
						choosingAccountWrite: {
							always: (args) => {
								const { context } = args
								if (
									context.input.request.kind === 'create' &&
									!required(context.destination).account
								) {
									return { target: 'creatingAccount' }
								}
								return { target: 'choosingLinkWrite' }
							}
						},
						creatingAccount: {
							invoke: {
								src: 'createAccount',
								input: ({ context }) => {
									const request = context.input.request
									if (request.kind !== 'create') throw new Error('invalid-machine-context')
									return { tx: required(context.tx), request }
								},
								onDone: { target: 'choosingLinkWrite' },
								onError: (args) => {
									return { target: 'rollingBack', context: failed(args) }
								}
							}
						},
						choosingLinkWrite: {
							always: (args) => {
								if (
									matchesState({ running: { control: 'cancelling' } }, args.value) ||
									matchesState({ running: { control: 'closing' } }, args.value)
								) {
									return { target: 'rollingBack' }
								}
								if (args.context.links.length === 1) {
									return { target: 'updatingLink' }
								}
								return { target: 'insertingLink' }
							}
						},
						updatingLink: {
							invoke: {
								src: 'updateLink',
								input: ({ context }) => linkWrite(context, required(context.links[0]).id),
								onDone: { target: 'checkingBeforeCommit' },
								onError: (args) => {
									return { target: 'rollingBack', context: failed(args) }
								}
							}
						},
						insertingLink: {
							invoke: {
								src: 'insertLink',
								input: ({ context }) => linkWrite(context, context.input.linkId),
								onDone: { target: 'checkingBeforeCommit' },
								onError: (args) => {
									return { target: 'rollingBack', context: failed(args) }
								}
							}
						},
						checkingBeforeCommit: {
							always: (args) => {
								if (
									matchesState({ running: { control: 'cancelling' } }, args.value) ||
									matchesState({ running: { control: 'closing' } }, args.value)
								) {
									return { target: 'rollingBack' }
								}
								return { target: 'committing' }
							}
						},
						committing: {
							entry: () => {
								return { context: { settlement: 'unresolved' } }
							},
							invoke: {
								src: 'commit',
								input: ({ context }) => required(context.tx),
								onDone: (args) => {
									return { target: 'settling', context: { write: args.event.output } }
								},
								onError: (args) => {
									return { target: 'rollingBack', context: failed(args) }
								}
							}
						},
						settling: {
							invoke: {
								src: 'settle',
								input: ({ context }) => required(context.write),
								onDone: () => {
									return { target: 'finishing', context: { settlement: 'locallyPersisted' } }
								},
								onError: (args) => {
									return { target: 'rollingBack', context: failed(args) }
								}
							}
						},
						invalidMapping: {
							entry: () => {
								return { context: { error: new Error('mapping') } }
							},
							always: { target: 'rollingBack' }
						},
						accountConflict: {
							entry: () => {
								return { context: { error: new Error('account_already_linked') } }
							},
							always: { target: 'rollingBack' }
						},
						rollingBack: {
							invoke: {
								src: 'rollback',
								input: ({ context }) => required(context.tx),
								onDone: (args) => {
									if (args.event.output) {
										return { target: 'finishing', context: { settlement: 'rolledBack' } }
									}
									return {
										target: 'finishing',
										context: {
											settlement: 'unresolved',
											error: args.context.error ?? new Error('save_failure')
										}
									}
								},
								onError: (args) => {
									return {
										target: 'finishing',
										context: {
											settlement: 'unresolved',
											error: args.context.error ?? new Error('save_failure')
										}
									}
								}
							}
						},
						finishing: {
							always: (args) => {
								const { context } = args
								if (matchesState({ running: { control: 'closing' } }, args.value)) {
									return { target: '#bank-account-write-transaction.closed' }
								}
								if (matchesState({ running: { control: 'cancelling' } }, args.value)) {
									return { target: '#bank-account-write-transaction.cancelled' }
								}
								if (context.error !== undefined) {
									return { target: '#bank-account-write-transaction.failed' }
								}
								if (context.settlement === 'locallyPersisted') {
									return { target: '#bank-account-write-transaction.succeeded' }
								}
								return { target: '#bank-account-write-transaction.unchanged' }
							}
						}
					}
				}
			}
		},
		succeeded: {
			type: 'final',
			entry: (args) => {
				return {
					context: {
						result: {
							outcome: 'succeeded',
							settlement: args.context.settlement
						}
					}
				}
			}
		},
		unchanged: {
			type: 'final',
			entry: (args) => {
				return {
					context: {
						result: {
							outcome: 'unchanged',
							settlement: args.context.settlement
						}
					}
				}
			}
		},
		cancelled: {
			type: 'final',
			entry: (args) => {
				return {
					context: {
						result: {
							outcome: 'cancelled',
							settlement: args.context.settlement
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
						result: {
							outcome: 'closed',
							settlement: args.context.settlement
						}
					}
				}
			}
		},
		failed: {
			type: 'final',
			entry: (args) => {
				const { context } = args
				return {
					context: {
						result: {
							outcome: 'failed',
							settlement: context.settlement,
							error: context.error
						}
					}
				}
			}
		}
	}
})
