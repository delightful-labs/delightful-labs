import type { schema } from 'jazz-tools'
import { app } from '#lib/schema.js'
import type { appAccountSchema } from '#lib/validation/accounts.js'
import { createAuthorizationMachine } from './authorization.js'
import { required } from './identity.js'
import { accountWriteTransaction, type MappingInterruption } from './account-write-transaction.js'
import {
	credentialAuthorization,
	type Dependencies,
	type OperationWork,
	type ProviderSummary,
	type Result
} from './types.js'
import { setup, types, createAsyncLogic } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'

type Link = schema.RowOf<typeof app.simplefinAccountLinks>
type Account = schema.RowOf<typeof app.accounts>
export type AccountWrite = { work: OperationWork; provider: ProviderSummary; accountId: string } & (
	{ kind: 'create'; values: ReturnType<typeof appAccountSchema.parse> } | { kind: 'map' }
)
type Context = {
	request: AccountWrite
	links: Link[]
	destination: Link[]
	account: Account | undefined
	linkId: string | undefined
	error: unknown
}

export function createAccountWriteMachine(dependencies: Dependencies) {
	const { db } = dependencies
	const actors = {
		providerLinks: createAsyncLogic({
			run: ({ input }: { input: AccountWrite }) =>
				db.all(
					app.simplefinAccountLinks.where({
						organizationId: input.work.scope.organizationId,
						simplefinAccountId: input.provider.id
					})
				)
		}),
		account: createAsyncLogic({
			run: ({ input }: { input: AccountWrite }) =>
				db.all(app.accounts.where({ id: input.accountId }))
		}),
		destinationLinks: createAsyncLogic({
			run: ({ input }: { input: AccountWrite }) =>
				db.all(
					app.simplefinAccountLinks.where({
						organizationId: input.work.scope.organizationId,
						accountId: input.accountId
					})
				)
		}),
		linkId: createAsyncLogic({
			// Deleted Jazz rows cannot be reinserted under their old IDs.
			run: async (_: { input: AccountWrite }): Promise<string> => crypto.randomUUID()
		}),
		authorize: createAuthorizationMachine(dependencies),
		transaction: accountWriteTransaction
	}
	const events0 = {
		WRITE: types<EventPayload<{ type: 'WRITE' } | MappingInterruption, 'WRITE'>>(),
		CANCEL: types<EventPayload<{ type: 'WRITE' } | MappingInterruption, 'CANCEL'>>(),
		SHUTDOWN: types<EventPayload<{ type: 'WRITE' } | MappingInterruption, 'SHUTDOWN'>>()
	}
	type NativeEvent0 =
		| import('xstate').InferEvents<typeof events0>
		| import('xstate').DoneActorEvent<
				| import('xstate').OutputFrom<(typeof actors)['providerLinks']>
				| import('xstate').OutputFrom<(typeof actors)['account']>
				| import('xstate').OutputFrom<(typeof actors)['destinationLinks']>
				| import('xstate').OutputFrom<(typeof actors)['linkId']>
				| import('xstate').OutputFrom<(typeof actors)['authorize']>
				| import('xstate').OutputFrom<(typeof actors)['transaction']>
		  >
		| import('xstate').ErrorActorEvent
	return setup({
		schemas: {
			context: types<Context>(),
			events: events0,
			input: types<AccountWrite>(),
			output: types<Result<undefined>>(),
			children: {
				providerLinks: types<import('xstate').ActorRefFrom<(typeof actors)['providerLinks']>>(),
				account: types<import('xstate').ActorRefFrom<(typeof actors)['account']>>(),
				destinationLinks:
					types<import('xstate').ActorRefFrom<(typeof actors)['destinationLinks']>>(),
				linkId: types<import('xstate').ActorRefFrom<(typeof actors)['linkId']>>(),
				authorize: types<import('xstate').ActorRefFrom<(typeof actors)['authorize']>>(),
				transaction: types<import('xstate').ActorRefFrom<(typeof actors)['transaction']>>()
			}
		},
		actors
	}).createMachine({
		id: 'bank-account-write',
		context: ({ input }) => ({
			request: input,
			links: [],
			destination: [],
			account: undefined,
			linkId: undefined,
			error: undefined
		}),
		initial: 'loadingProviderLinks',
		on: {
			CANCEL: () => {
				return { target: '.failed', context: { error: new Error('disconnected') } }
			},
			SHUTDOWN: () => {
				return { target: '.failed', context: { error: new Error('disconnected') } }
			}
		},
		output: ({ context }) =>
			context.error === undefined
				? { ok: true, value: undefined }
				: { ok: false, error: context.error },
		states: {
			loadingProviderLinks: {
				invoke: {
					src: 'providerLinks',
					input: ({ context }) => context.request,
					onDone: (args) => {
						return { target: 'checkingProviderLinks', context: { links: args.event.output } }
					},
					onError: (args) => {
						return { target: 'failed', context: { error: args.event.error } }
					}
				}
			},
			checkingProviderLinks: {
				always: (args) => {
					const { context } = args
					if (context.links.length > 1) {
						return { target: 'invalidMapping' }
					}
					if (context.request.kind === 'create') {
						return { target: 'checkingExistingCreation' }
					}
					return { target: 'loadingAccount' }
				}
			},
			checkingExistingCreation: {
				always: (args) => {
					if (args.context.links.length === 1) {
						return { target: 'authorizingExistingCreation' }
					}
					return { target: 'loadingAccount' }
				}
			},
			authorizingExistingCreation: {
				invoke: {
					src: 'authorize',
					input: ({ context }) => credentialAuthorization(context.request.work),
					onDone: (args) => {
						const { event } = args
						if (event.output.error !== undefined) {
							return { target: 'failed', context: { error: event.output.error } }
						}
						return { target: 'complete' }
					},
					onError: (args) => {
						return { target: 'failed', context: { error: args.event.error } }
					}
				}
			},
			loadingAccount: {
				invoke: {
					src: 'account',
					input: ({ context }) => context.request,
					onDone: (args) => {
						return { target: 'checkingAccountPresence', context: { account: args.event.output[0] } }
					},
					onError: (args) => {
						return { target: 'failed', context: { error: args.event.error } }
					}
				}
			},
			checkingAccountPresence: {
				always: (args) => {
					const { context } = args
					if (Boolean(context.account)) {
						return { target: 'checkingAccountOrganization' }
					}
					if (context.request.kind === 'map') {
						return { target: 'invalidMapping' }
					}
					return { target: 'loadingDestinationLinks' }
				}
			},
			checkingAccountOrganization: {
				always: (args) => {
					const { context } = args
					if (context.account?.organizationId !== context.request.work.scope.organizationId) {
						return { target: 'invalidMapping' }
					}
					return { target: 'checkingAccountArchive' }
				}
			},
			checkingAccountArchive: {
				always: (args) => {
					const { context } = args
					if (Boolean(context.account?.archivedAt)) {
						return { target: 'invalidMapping' }
					}
					if (context.request.kind === 'create') {
						return { target: 'checkingAccountCurrency' }
					}
					return { target: 'loadingDestinationLinks' }
				}
			},
			checkingAccountCurrency: {
				always: (args) => {
					const { context } = args
					if (context.account?.currency !== context.request.provider.currency) {
						return { target: 'invalidMapping' }
					}
					return { target: 'loadingDestinationLinks' }
				}
			},
			loadingDestinationLinks: {
				invoke: {
					src: 'destinationLinks',
					input: ({ context }) => context.request,
					onDone: (args) => {
						return {
							target: 'checkingDestinationLinks',
							context: { destination: args.event.output }
						}
					},
					onError: (args) => {
						return { target: 'failed', context: { error: args.event.error } }
					}
				}
			},
			checkingDestinationLinks: {
				always: (args) => {
					const { context } = args
					if (
						context.destination.some(
							(link) => link.simplefinAccountId !== context.request.provider.id
						)
					) {
						return { target: 'accountConflict' }
					}
					return { target: 'generatingLinkId' }
				}
			},
			generatingLinkId: {
				invoke: {
					src: 'linkId',
					input: ({ context }) => context.request,
					onDone: (args) => {
						return { target: 'authorizingWrite', context: { linkId: args.event.output } }
					},
					onError: (args) => {
						return { target: 'failed', context: { error: args.event.error } }
					}
				}
			},
			authorizingWrite: {
				invoke: {
					src: 'authorize',
					input: ({ context }) => credentialAuthorization(context.request.work),
					onDone: (args) => {
						const { event } = args
						if (event.output.error !== undefined) {
							return { target: 'failed', context: { error: event.output.error } }
						}
						return { target: 'committing' }
					},
					onError: (args) => {
						return { target: 'failed', context: { error: args.event.error } }
					}
				}
			},
			committing: {
				on: {
					CANCEL: (args, enq) => {
						{
							const child = args.children.transaction
							if (child?.getSnapshot().status === 'active') enq.sendTo(child, { type: 'CANCEL' })
						}
					},
					SHUTDOWN: (args, enq) => {
						{
							const child = args.children.transaction
							if (child?.getSnapshot().status === 'active') enq.sendTo(child, { type: 'SHUTDOWN' })
						}
					}
				},
				invoke: {
					id: 'transaction',
					src: 'transaction',
					input: ({ context }) => ({
						db,
						request: context.request,
						linkId: required(context.linkId)
					}),
					onDone: (args) => {
						const { event } = args
						if (event.output.outcome === 'failed') {
							return {
								target: 'failed',
								context: {
									error: event.output.outcome === 'failed' ? event.output.error : undefined
								}
							}
						}
						if (event.output.outcome === 'cancelled' || event.output.outcome === 'closed') {
							return { target: 'failed', context: { error: new Error('disconnected') } }
						}
						return { target: 'complete' }
					},
					onError: (args) => {
						return { target: 'failed', context: { error: args.event.error } }
					}
				}
			},
			complete: { type: 'final' },
			invalidMapping: {
				type: 'final',
				entry: () => {
					return { context: { error: new Error('mapping') } }
				}
			},
			accountConflict: {
				type: 'final',
				entry: () => {
					return { context: { error: new Error('account_already_linked') } }
				}
			},
			failed: { type: 'final' }
		}
	})
}
