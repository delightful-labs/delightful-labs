import { ORGANIZATION_ROLE } from '#lib/domain/organization-role.js'
import type { Account, AccountMembership, OrganizationMember } from '#lib/queries.js'
import { setup, types, createAsyncLogic, matchesState } from 'xstate'
import type { SnapshotFrom } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'

export type DeleteGrantObservation = {
	identityId: string | null
	organizationId: string | null
	binding: object | null
	sessionReady: boolean
	loading: boolean
	failed: boolean
	membership: OrganizationMember | null | undefined
	accounts: readonly Account[]
	members: readonly OrganizationMember[]
	grants: readonly AccountMembership[]
}

export type GrantWrite =
	| { kind: 'update'; grantId: string; canDelete: boolean }
	| {
			kind: 'insert'
			organizationId: string
			accountId: string
			userId: string
			canDelete: boolean
	  }
type Request = {
	identityId: string
	organizationId: string
	binding: object
	accountId: string
	userId: string
	canDelete: boolean
}
type Result =
	| { outcome: 'succeeded'; request: Request }
	| { outcome: 'denied'; request: Request | undefined }
	| { outcome: 'failed'; request: Request }
type Context = {
	observation: DeleteGrantObservation
	request: Request | undefined
	write: GrantWrite | undefined
	result: Result | undefined
}
type Event =
	| { type: 'OBSERVE'; observation: DeleteGrantObservation }
	| { type: 'SET_DELETE'; accountId: string; userId: string; canDelete: boolean }
	| { type: 'SHUTDOWN' }

function canManage(observation: DeleteGrantObservation, request: Request) {
	const role = observation.membership?.role
	return (
		observation.sessionReady &&
		observation.identityId === request.identityId &&
		observation.organizationId === request.organizationId &&
		observation.binding === request.binding &&
		!observation.loading &&
		!observation.failed &&
		observation.membership?.userId === request.identityId &&
		observation.membership.organizationId === request.organizationId &&
		(role === ORGANIZATION_ROLE.OWNER || role === ORGANIZATION_ROLE.ADMIN) &&
		observation.accounts.some(
			(account) =>
				account.id === request.accountId && account.organizationId === request.organizationId
		) &&
		observation.members.some(
			(member) =>
				member.userId === request.userId && member.organizationId === request.organizationId
		)
	)
}

export function createAccountDeleteGrantMachine(
	persist: (write: GrantWrite) => Promise<unknown>,
	observe: () => DeleteGrantObservation
) {
	const actors = {
		writer: createAsyncLogic<unknown, GrantWrite>({ run: ({ input }) => persist(input) })
	}
	const events0 = {
		OBSERVE: types<EventPayload<Event, 'OBSERVE'>>(),
		SET_DELETE: types<EventPayload<Event, 'SET_DELETE'>>(),
		SHUTDOWN: types<EventPayload<Event, 'SHUTDOWN'>>()
	}

	const workflow = setup({
		schemas: {
			context: types<Context>(),
			events: events0,
			children: { writer: types<import('xstate').ActorRefFrom<(typeof actors)['writer']>>() }
		},
		actors,
		guards: {
			closing: (args: { value: import('xstate').StateValue }) =>
				matchesState({ operating: 'closing' }, args.value)
		}
	})
	return workflow.createMachine({
		id: 'account-delete-grants',
		initial: 'idle',
		context: () => ({
			observation: observe(),
			request: undefined,
			write: undefined,
			result: undefined
		}),
		on: {
			OBSERVE: (args) => {
				return {
					context: ((args) => ({
						observation: (({ context, event }) =>
							event.type === 'OBSERVE' ? event.observation : context.observation)(args)
					}))(args)
				}
			},
			SHUTDOWN: { target: '.closed' }
		},
		states: {
			idle: {
				on: {
					SET_DELETE: (args) => {
						return {
							target: 'assessing',
							context: ((args) => ({
								request: (({ context, event }) =>
									event.type === 'SET_DELETE'
										? {
												identityId: context.observation.identityId ?? '',
												organizationId: context.observation.organizationId ?? '',
												binding: context.observation.binding ?? {},
												accountId: event.accountId,
												userId: event.userId,
												canDelete: event.canDelete
											}
										: context.request)(args),
								result: undefined,
								write: undefined
							}))(args)
						}
					}
				}
			},
			assessing: {
				always: (args) => {
					const { context } = args
					if (!context.request || !canManage(context.observation, context.request)) {
						return {
							target: 'denied',
							context: {
								result: {
									outcome: 'denied',
									request: context.request
								}
							}
						}
					}
					if (
						!context.request?.canDelete &&
						!context.observation.grants.some(
							(grant) =>
								grant.organizationId === context.request?.organizationId &&
								grant.accountId === context.request?.accountId &&
								grant.userId === context.request?.userId
						)
					) {
						return { target: 'idle', context: { request: undefined } }
					}
					return {
						target: 'operating',
						context: {
							write: (({ context }) => {
								const request = context.request
								if (!request) throw new Error('Missing delete grant request')
								const grant = context.observation.grants.find(
									(candidate) =>
										candidate.organizationId === request.organizationId &&
										candidate.accountId === request.accountId &&
										candidate.userId === request.userId
								)
								return grant
									? { kind: 'update', grantId: grant.id, canDelete: request.canDelete }
									: {
											kind: 'insert',
											organizationId: request.organizationId,
											accountId: request.accountId,
											userId: request.userId,
											canDelete: request.canDelete
										}
							})(args)
						}
					}
				}
			},
			operating: {
				initial: 'writing',
				invoke: {
					src: 'writer',
					input: ({ context }) => required(context.write),
					onDone: (args) => {
						if (matchesState({ operating: 'closing' }, args.value)) {
							return {
								target: '#account-delete-grants.closed',
								context: { request: undefined, write: undefined }
							}
						}
						return {
							target: '#account-delete-grants.succeeded',
							context: {
								result: {
									outcome: 'succeeded',
									request: required(args.context.request)
								},
								request: undefined,
								write: undefined,
								observation: observe()
							}
						}
					},
					onError: (args) => {
						if (matchesState({ operating: 'closing' }, args.value)) {
							return { target: '#account-delete-grants.closed' }
						}
						return {
							target: '#account-delete-grants.failed',
							context: {
								result: {
									outcome: 'failed',
									request: required(args.context.request)
								},
								request: undefined,
								write: undefined,
								observation: observe()
							}
						}
					}
				},
				on: { SHUTDOWN: { target: '.closing' } },
				states: { writing: {}, closing: {} }
			},
			succeeded: {
				on: {
					SET_DELETE: (args) => {
						return {
							target: 'assessing',
							context: ((args) => ({
								request: (({ context, event }) =>
									event.type === 'SET_DELETE'
										? {
												identityId: context.observation.identityId ?? '',
												organizationId: context.observation.organizationId ?? '',
												binding: context.observation.binding ?? {},
												accountId: event.accountId,
												userId: event.userId,
												canDelete: event.canDelete
											}
										: context.request)(args),
								result: undefined,
								write: undefined
							}))(args)
						}
					}
				}
			},
			denied: {
				on: {
					SET_DELETE: (args) => {
						return {
							target: 'assessing',
							context: ((args) => ({
								request: (({ context, event }) =>
									event.type === 'SET_DELETE'
										? {
												identityId: context.observation.identityId ?? '',
												organizationId: context.observation.organizationId ?? '',
												binding: context.observation.binding ?? {},
												accountId: event.accountId,
												userId: event.userId,
												canDelete: event.canDelete
											}
										: context.request)(args),
								result: undefined,
								write: undefined
							}))(args)
						}
					}
				}
			},
			failed: {
				on: {
					SET_DELETE: (args) => {
						return {
							target: 'assessing',
							context: ((args) => ({
								request: (({ context, event }) =>
									event.type === 'SET_DELETE'
										? {
												identityId: context.observation.identityId ?? '',
												organizationId: context.observation.organizationId ?? '',
												binding: context.observation.binding ?? {},
												accountId: event.accountId,
												userId: event.userId,
												canDelete: event.canDelete
											}
										: context.request)(args),
								result: undefined,
								write: undefined
							}))(args)
						}
					}
				}
			},
			closed: { type: 'final' }
		}
	})
}

function required<Value>(value: Value | undefined): Value {
	if (value === undefined) throw new Error('Missing account delete grant operation value')
	return value
}

export type AccountDeleteGrantView =
	import('../../contracts/worker-accounts.js').WorkerAccountAccessView

export function selectAccountDeleteGrantView(
	snapshot: SnapshotFrom<ReturnType<typeof createAccountDeleteGrantMachine>>
): AccountDeleteGrantView {
	const { observation, result } = snapshot.context
	const role = observation.membership?.role
	return {
		busy: typeof snapshot.value === 'object' && 'operating' in snapshot.value,
		canManage:
			observation.sessionReady &&
			!!observation.identityId &&
			!!observation.organizationId &&
			!!observation.binding &&
			!observation.failed &&
			observation.membership?.userId === observation.identityId &&
			observation.membership.organizationId === observation.organizationId &&
			(role === ORGANIZATION_ROLE.OWNER || role === ORGANIZATION_ROLE.ADMIN),
		loading: observation.loading,
		failed: observation.failed,
		members: observation.members.filter((member) => member.role === ORGANIZATION_ROLE.MEMBER),
		grants: [...observation.grants],
		result: result
			? {
					outcome: result.outcome,
					request: result.request ? { accountId: result.request.accountId } : undefined
				}
			: undefined
	}
}

export function selectAccountDeleteGrantReport(
	snapshot: SnapshotFrom<ReturnType<typeof createAccountDeleteGrantMachine>>
) {
	const { binding, identityId, organizationId } = snapshot.context.observation
	return { binding, identityId, organizationId, view: selectAccountDeleteGrantView(snapshot) }
}
