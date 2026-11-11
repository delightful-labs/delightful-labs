import type { Account, OrganizationMember } from '#lib/schema.js'
import { canWriteAccount } from '#lib/domain/organization-permissions.js'
import { accountArchiveSchema } from '#lib/validation/accounts.js'
import { setup, types, createAsyncLogic, matchesState } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'

export type ArchiveObservation = {
	identityId: string | null
	organizationId: string | null
	binding: object | null
	sessionReady: boolean
	loading: boolean
	failed: boolean
	accounts: readonly Account[]
	membership: OrganizationMember | null | undefined
	grants: readonly {
		organizationId: string
		userId: string
		accountId: string
		access: 'read' | 'write'
	}[]
}
export type ArchiveRequest = {
	identityId: string
	organizationId: string
	binding: object
	accountId: string
	name: string
}
export type ArchiveResult =
	| { outcome: 'succeeded'; request: ArchiveRequest; settlement: 'locallyPersisted' }
	| {
			outcome: 'invalid' | 'denied' | 'unavailable'
			request: ArchiveRequest
			settlement: 'notStarted'
	  }
	| { outcome: 'failed'; request: ArchiveRequest; settlement: 'rejected' | 'unknown' }
	| {
			outcome: 'scopeChanged' | 'cancelled' | 'closed'
			request: ArchiveRequest
			settlement: 'notStarted' | 'locallyPersisted' | 'rejected'
	  }

type Input = { request: ArchiveRequest; observation: ArchiveObservation }
type Context = Input & { result: ArchiveResult | undefined }
type Event = { type: 'OBSERVE'; observation: ArchiveObservation } | { type: 'CANCEL' | 'SHUTDOWN' }

export function archiveScopeMatches(request: ArchiveRequest, observation: ArchiveObservation) {
	return (
		request.identityId === observation.identityId &&
		request.organizationId === observation.organizationId &&
		request.binding === observation.binding &&
		observation.sessionReady
	)
}
export function archiveAllowed(observation: ArchiveObservation, accountId: string) {
	return (
		observation.sessionReady &&
		!!observation.identityId &&
		!!observation.organizationId &&
		!!observation.binding &&
		!observation.loading &&
		!observation.failed &&
		observation.membership?.userId === observation.identityId &&
		observation.accounts.some(
			(account) =>
				account.id === accountId &&
				account.organizationId === observation.organizationId &&
				!account.archivedAt
		) &&
		canWriteAccount(
			observation.membership,
			observation.organizationId,
			accountId,
			observation.grants.filter(
				(grant) =>
					grant.userId === observation.identityId &&
					grant.organizationId === observation.organizationId
			)
		)
	)
}

export function createAccountArchiveOperation(
	persist: (request: ArchiveRequest) => Promise<unknown>,
	observe: () => ArchiveObservation
) {
	const actors = {
		persist: createAsyncLogic<unknown, ArchiveRequest>({ run: ({ input }) => persist(input) })
	}
	const events0 = {
		OBSERVE: types<EventPayload<Event, 'OBSERVE'>>(),
		CANCEL: types<EventPayload<Event, 'CANCEL'>>(),
		SHUTDOWN: types<EventPayload<Event, 'SHUTDOWN'>>()
	}
	type NativeEvent0 =
		| import('xstate').InferEvents<typeof events0>
		| import('xstate').DoneActorEvent<import('xstate').OutputFrom<(typeof actors)['persist']>>
		| import('xstate').ErrorActorEvent
	const workflow = setup({
		schemas: {
			context: types<Context>(),
			events: events0,
			input: types<Input>(),
			output: types<ArchiveResult>(),
			children: { persist: types<import('xstate').ActorRefFrom<(typeof actors)['persist']>>() }
		},
		actors,
		guards: {
			shuttingDown: (args: { value: import('xstate').StateValue }) =>
				matchesState({ writing: 'settlingShutdown' }, args.value),
			scopeChanged: (args: { value: import('xstate').StateValue }) =>
				matchesState({ writing: 'settlingScopeChange' }, args.value),
			cancelling: (args: { value: import('xstate').StateValue }) =>
				matchesState({ writing: 'settlingCancellation' }, args.value)
		}
	})
	const finish = (outcome: 'invalid' | 'denied' | 'unavailable') =>
		workflow.createStateConfig({
			type: 'final',
			entry: (args: { context: Context }) => {
				return {
					context: { result: { outcome, request: args.context.request, settlement: 'notStarted' } }
				}
			}
		})
	return workflow.createMachine({
		id: 'account-archive-operation',
		initial: 'validating',
		context: ({ input }) => ({ ...input, result: undefined }),
		output: ({ context }) => {
			if (!context.result) throw new Error('Missing archive result')
			return context.result
		},
		on: {
			CANCEL: { target: '.cancelled' },
			SHUTDOWN: { target: '.closed' },
			OBSERVE: (args) => {
				return {
					context: ((args) => ({
						observation: (({ event }) =>
							event.type === 'OBSERVE' ? event.observation : observe())(args)
					}))(args)
				}
			}
		},
		states: {
			validating: {
				always: (args) => {
					const { context } = args
					if (
						accountArchiveSchema.safeParse({
							accountId: context.request.accountId,
							organizationId: context.request.organizationId
						}).success
					) {
						return { target: 'authorizing' }
					}
					return { target: 'invalid' }
				}
			},
			authorizing: {
				entry: () => {
					return { context: { observation: observe() } }
				},
				always: (args) => {
					const { context } = args
					if (!archiveScopeMatches(context.request, context.observation)) {
						return { target: 'scopeChanged' }
					}
					if (
						context.observation.loading ||
						context.observation.failed ||
						!context.observation.accounts.some(
							(account) => account.id === context.request.accountId
						)
					) {
						return { target: 'unavailable' }
					}
					if (!archiveAllowed(context.observation, context.request.accountId)) {
						return { target: 'denied' }
					}
					return { target: 'writing' }
				}
			},
			writing: {
				initial: 'persisting',
				invoke: {
					src: 'persist',
					input: ({ context }) => context.request,
					onDone: (args) => {
						const { context } = args
						if (matchesState({ writing: 'settlingShutdown' }, args.value)) {
							return {
								target: 'closed',
								context: {
									result: {
										outcome: 'closed',
										request: context.request,
										settlement: 'locallyPersisted'
									}
								}
							}
						}
						if (matchesState({ writing: 'settlingScopeChange' }, args.value)) {
							return {
								target: 'scopeChanged',
								context: {
									result: {
										outcome: 'scopeChanged',
										request: context.request,
										settlement: 'locallyPersisted'
									}
								}
							}
						}
						if (matchesState({ writing: 'settlingCancellation' }, args.value)) {
							return {
								target: 'cancelled',
								context: {
									result: {
										outcome: 'cancelled',
										request: context.request,
										settlement: 'locallyPersisted'
									}
								}
							}
						}
						return {
							target: 'succeeded',
							context: {
								result: {
									outcome: 'succeeded',
									request: context.request,
									settlement: 'locallyPersisted'
								}
							}
						}
					},
					onError: (args) => {
						const { context } = args
						if (matchesState({ writing: 'settlingShutdown' }, args.value)) {
							return {
								target: 'closed',
								context: {
									result: {
										outcome: 'closed',
										request: context.request,
										settlement: 'rejected'
									}
								}
							}
						}
						if (matchesState({ writing: 'settlingScopeChange' }, args.value)) {
							return {
								target: 'scopeChanged',
								context: {
									result: {
										outcome: 'scopeChanged',
										request: context.request,
										settlement: 'rejected'
									}
								}
							}
						}
						if (matchesState({ writing: 'settlingCancellation' }, args.value)) {
							return {
								target: 'cancelled',
								context: {
									result: {
										outcome: 'cancelled',
										request: context.request,
										settlement: 'rejected'
									}
								}
							}
						}
						return {
							target: 'failed',
							context: {
								result: {
									outcome: 'failed',
									request: context.request,
									settlement: 'rejected'
								}
							}
						}
					}
				},
				on: {
					SHUTDOWN: { target: '.settlingShutdown' },
					CANCEL: { target: '.settlingCancellation' }
				},
				states: {
					persisting: {
						on: {
							OBSERVE: (args) => {
								const { context, event } = args
								if (!archiveScopeMatches(context.request, event.observation)) {
									return {
										target: 'settlingScopeChange',
										context: ((args) => ({
											observation: (({ event }) =>
												event.type === 'OBSERVE' ? event.observation : observe())(args)
										}))(args)
									}
								}
								if (
									event.observation.loading ||
									event.observation.failed ||
									event.observation.membership?.userId !== context.request.identityId ||
									!canWriteAccount(
										event.observation.membership,
										context.request.organizationId,
										context.request.accountId,
										event.observation.grants.filter(
											(grant) =>
												grant.organizationId === context.request.organizationId &&
												grant.userId === context.request.identityId
										)
									)
								) {
									return {
										target: 'settlingScopeChange',
										context: ((args) => ({
											observation: (({ event }) =>
												event.type === 'OBSERVE' ? event.observation : observe())(args)
										}))(args)
									}
								}
								return {
									context: ((args) => ({
										observation: (({ event }) =>
											event.type === 'OBSERVE' ? event.observation : observe())(args)
									}))(args)
								}
							}
						}
					},
					settlingCancellation: {
						tags: ['cancelling'],
						on: {
							CANCEL: {},
							OBSERVE: (args) => {
								return {
									context: ((args) => ({
										observation: (({ event }) =>
											event.type === 'OBSERVE' ? event.observation : observe())(args)
									}))(args)
								}
							}
						}
					},
					settlingScopeChange: {
						tags: ['scopeChanged'],
						on: {
							CANCEL: {},
							OBSERVE: (args) => {
								return {
									context: ((args) => ({
										observation: (({ event }) =>
											event.type === 'OBSERVE' ? event.observation : observe())(args)
									}))(args)
								}
							}
						}
					},
					settlingShutdown: {
						tags: ['shuttingDown'],
						on: { CANCEL: {}, SHUTDOWN: {}, OBSERVE: {} }
					}
				}
			},
			succeeded: { type: 'final' },
			failed: { type: 'final' },
			invalid: finish('invalid'),
			denied: finish('denied'),
			unavailable: finish('unavailable'),
			scopeChanged: {
				type: 'final',
				entry: (args: { context: Context }) => {
					const { context } = args
					return {
						context: {
							result: context.result ?? {
								outcome: 'scopeChanged',
								request: context.request,
								settlement: 'notStarted'
							}
						}
					}
				}
			},
			cancelled: {
				type: 'final',
				entry: (args: { context: Context }) => {
					const { context } = args
					return {
						context: {
							result: context.result ?? {
								outcome: 'cancelled',
								request: context.request,
								settlement: 'notStarted'
							}
						}
					}
				}
			},
			closed: {
				type: 'final',
				entry: (args: { context: Context }) => {
					const { context } = args
					return {
						context: {
							result: context.result ?? {
								outcome: 'closed',
								request: context.request,
								settlement: 'notStarted'
							}
						}
					}
				}
			}
		}
	})
}
