import type { AccountFormValues } from '#lib/validation/accounts.js'
import { ORGANIZATION_ROLE } from '#lib/domain/organization-role.js'
import { normalizedName } from '#lib/domain/names.js'
import type {
	FormCapability,
	FormChildEvent,
	FormObservation
} from '#lib/contracts/form-contract.js'
import type {
	AccountCreationObservation,
	AccountCreationReason,
	AccountCreationScope
} from '#lib/contracts/account-creation-contract.js'
import { accountFormSchema } from '#lib/validation/accounts.js'
import type { Account } from '#lib/schema.js'
import { createSingleWriteFormOptions } from '../forms/scoped-form-policy.js'
import type { OrganizationMember } from '#lib/schema.js'
import { setup, types } from 'xstate'
import type { SnapshotFrom } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'

type Observation = {
	revision?: number
	organizationId: string | null
	userId: string | undefined
	sessionReady: boolean
	membership: OrganizationMember | null | undefined
	loading: boolean
	error: unknown
}
const events1 = {
	OBSERVE: types<EventPayload<{ type: 'OBSERVE'; source: Observation }, 'OBSERVE'>>()
}
type NativeEvent1 =
	| import('xstate').InferEvents<typeof events1>
	| import('xstate').DoneActorEvent<never>
	| import('xstate').ErrorActorEvent
	| import('xstate').AfterEvent
	| import('xstate').DoneStateEvent
	| import('xstate').SnapshotEvent
	| import('xstate').TimeoutEvent
	| import('xstate').ActorTimeoutEvent
	| import('xstate').ErrorPlatformEvent

const access = setup({
	schemas: {
		context: types<Observation>(),
		events: events1,
		input: types<Observation | undefined>()
	}
})

export const accountCreationAccessMachine = access.createMachine({
	id: 'account-creation-access',
	initial: 'checking',
	context: ({ input }) =>
		input ?? {
			organizationId: null,
			userId: undefined,
			sessionReady: false,
			membership: undefined,
			loading: true,
			error: null
		},
	on: {
		OBSERVE: (args) => {
			return { target: '.checking', context: args.event.source }
		}
	},
	states: {
		checking: {
			always: (args) => {
				const { context } = args
				if (!context.sessionReady || !context.organizationId || !context.userId) {
					return { target: 'waiting' }
				}
				if (context.error != null) {
					return { target: 'error' }
				}
				if (context.loading) {
					return { target: 'waiting' }
				}
				if (
					!context.membership ||
					context.membership.organizationId !== context.organizationId ||
					context.membership.userId !== context.userId
				) {
					return { target: 'denied' }
				}
				if (
					context.membership?.role === ORGANIZATION_ROLE.OWNER ||
					context.membership?.role === ORGANIZATION_ROLE.ADMIN
				) {
					return { target: 'allowed' }
				}
				return { target: 'denied' }
			}
		},
		waiting: {},
		error: {},
		denied: {},
		allowed: { tags: ['can-create'] }
	}
})

export function accountCreationScope(facts: AccountCreationObservation): AccountCreationScope {
	return {
		identityId: facts.identityId,
		organizationId: facts.organizationId,
		binding: facts.binding
	}
}
export function sameAccountCreationScope(left: AccountCreationScope, right: AccountCreationScope) {
	return (
		left.identityId === right.identityId &&
		left.organizationId === right.organizationId &&
		left.binding === right.binding
	)
}

/** Reuses the existing policy actor for display and pre-write authorization. */
export function createAccountCreationAvailability(binding: object) {
	type Context = {
		observation: FormObservation<AccountCreationObservation>
		capability: FormCapability<AccountCreationScope, AccountCreationReason>
	}
	const actors = { access: accountCreationAccessMachine }
	const events0 = {
		INVALIDATE: types<EventPayload<FormChildEvent<AccountCreationObservation>, 'INVALIDATE'>>(),
		CANCEL: types<EventPayload<FormChildEvent<AccountCreationObservation>, 'CANCEL'>>(),
		SHUTDOWN: types<EventPayload<FormChildEvent<AccountCreationObservation>, 'SHUTDOWN'>>(),
		OBSERVE: types<EventPayload<FormChildEvent<AccountCreationObservation>, 'OBSERVE'>>()
	}
	type NativeEvent0 =
		| import('xstate').InferEvents<typeof events0>
		| import('xstate').DoneActorEvent<import('xstate').OutputFrom<(typeof actors)['access']>>
		| import('xstate').ErrorActorEvent
	const machine = setup({
		schemas: {
			context: types<Context>(),
			events: events0,
			input: types<FormObservation<AccountCreationObservation>>(),
			children: { access: types<import('xstate').ActorRefFrom<(typeof actors)['access']>>() }
		},
		actors
	})
	return machine.createMachine({
		id: 'account-creation-availability',
		initial: 'assessing',
		context: ({ input }) => ({
			observation: input,
			capability: {
				revision: -1,
				scope: accountCreationScope(input.facts),
				readiness: { kind: 'blocked', reason: 'loading' }
			}
		}),
		on: {
			OBSERVE: (args) => {
				return { target: '.assessing', context: { observation: args.event.observation } }
			}
		},
		states: {
			assessing: {
				always: (args) => {
					if (
						(({
							context: {
								observation: { facts }
							}
						}) => !facts.sessionReady || !facts.identityId || facts.binding !== binding)(args)
					) {
						return { target: 'sessionUnavailable' }
					}
					if (
						(({
							context: {
								observation: { facts }
							}
						}) => !facts.organizationId)(args)
					) {
						return { target: 'selectWorkspace' }
					}
					if (
						(({
							context: {
								observation: { facts }
							}
						}) => facts.error != null)(args)
					) {
						return { target: 'loadFailed' }
					}
					if (
						(({
							context: {
								observation: { facts }
							}
						}) => facts.loading)(args)
					) {
						return { target: 'loading' }
					}
					return { target: 'authorizing' }
				}
			},
			authorizing: {
				invoke: {
					id: 'access',
					src: 'access',
					input: ({
						context: {
							observation: { revision, facts }
						}
					}) => ({
						revision,
						organizationId: facts.organizationId,
						userId: facts.identityId ?? undefined,
						sessionReady: facts.sessionReady,
						membership: facts.membership,
						loading: facts.loading,
						error: facts.error
					}),
					onSnapshot: (args) => {
						const { context, event } = args
						if (
							event.snapshot.context.revision === context.observation.revision &&
							event.snapshot.hasTag('can-create')
						) {
							return { target: 'checkingName' }
						}
						if (
							event.snapshot.context.revision === context.observation.revision &&
							event.snapshot.matches('denied')
						) {
							return { target: 'readOnly' }
						}
						if (
							event.snapshot.context.revision === context.observation.revision &&
							event.snapshot.matches('error')
						) {
							return { target: 'loadFailed' }
						}
					},
					onError: { target: 'loadFailed' }
				}
			},
			checkingName: {
				always: (args) => {
					if (
						(({
							context: {
								observation: { facts }
							}
						}) =>
							facts.submittedName !== undefined &&
							facts.accounts.some(
								(account) =>
									account.organizationId === facts.organizationId &&
									account.archivedAt === null &&
									normalizedName(account.name) === normalizedName(facts.submittedName ?? '')
							))(args)
					) {
						return { target: 'duplicateName' }
					}
					return { target: 'ready' }
				}
			},
			duplicateName: {
				entry: (args) => {
					return {
						context: ((args) => ({
							capability: (({ context }) => ({
								revision: context.observation.revision,
								scope: accountCreationScope(context.observation.facts),
								readiness: { kind: 'blocked', reason: 'duplicateName' }
							}))(args)
						}))(args)
					}
				}
			},
			sessionUnavailable: {
				entry: (args) => {
					return {
						context: ((args) => ({
							capability: (({ context }) => ({
								revision: context.observation.revision,
								scope: accountCreationScope(context.observation.facts),
								readiness: { kind: 'blocked', reason: 'sessionUnavailable' }
							}))(args)
						}))(args)
					}
				}
			},
			selectWorkspace: {
				entry: (args) => {
					return {
						context: ((args) => ({
							capability: (({ context }) => ({
								revision: context.observation.revision,
								scope: accountCreationScope(context.observation.facts),
								readiness: { kind: 'blocked', reason: 'selectWorkspace' }
							}))(args)
						}))(args)
					}
				}
			},
			loadFailed: {
				entry: (args) => {
					return {
						context: ((args) => ({
							capability: (({ context }) => ({
								revision: context.observation.revision,
								scope: accountCreationScope(context.observation.facts),
								readiness: { kind: 'blocked', reason: 'loadFailed' }
							}))(args)
						}))(args)
					}
				}
			},
			loading: {
				entry: (args) => {
					return {
						context: ((args) => ({
							capability: (({ context }) => ({
								revision: context.observation.revision,
								scope: accountCreationScope(context.observation.facts),
								readiness: { kind: 'blocked', reason: 'loading' }
							}))(args)
						}))(args)
					}
				}
			},
			readOnly: {
				entry: (args) => {
					return {
						context: ((args) => ({
							capability: (({ context }) => ({
								revision: context.observation.revision,
								scope: accountCreationScope(context.observation.facts),
								readiness: { kind: 'blocked', reason: 'readOnly' }
							}))(args)
						}))(args)
					}
				}
			},
			ready: {
				entry: (args) => {
					const { context } = args
					return {
						context: {
							capability: {
								revision: context.observation.revision,
								scope: accountCreationScope(context.observation.facts),
								readiness: { kind: 'ready' }
							}
						}
					}
				}
			}
		}
	})
}
export function selectAccountCreationAvailability(
	snapshot: SnapshotFrom<ReturnType<typeof createAccountCreationAvailability>>
) {
	return snapshot.context.capability
}

type Values = AccountFormValues
export function createAccountCreationFormOptions(dependencies: {
	binding: object
	observe: () => AccountCreationObservation
	create: (organizationId: string, values: Values) => Promise<Account>
}) {
	const availability = createAccountCreationAvailability(dependencies.binding)
	return createSingleWriteFormOptions<
		Values,
		Account,
		AccountCreationReason,
		AccountCreationScope,
		AccountCreationObservation,
		SnapshotFrom<typeof availability>
	>({
		schema: accountFormSchema,
		mode: 'create',
		availability,
		selectAvailability: selectAccountCreationAvailability,
		scopeOf: accountCreationScope,
		sameScope: sameAccountCreationScope,
		observe: dependencies.observe,
		classifyBlocked: (reason) => (reason === 'readOnly' ? 'denied' : 'unavailable'),
		successContent: 'replace',
		assessmentObservation: ({ request, observation }) => ({
			...observation.facts,
			submittedName: request.values.name
		}),
		write: async ({ request }) => {
			const id = request.scope.organizationId
			if (id === null) throw new Error('Missing authorized workspace')
			return dependencies.create(id, request.values)
		}
	})
}
