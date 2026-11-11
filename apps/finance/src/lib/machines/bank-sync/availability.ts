import { canManageBankCredentials } from '#lib/domain/organization-permissions.js'
import { type BankSource, type BankAccess, type BankCredential, type Observation } from './types.js'
import { setup, types, matchesState, initialTransition } from 'xstate'
import type { ActorRef, Snapshot, SnapshotFrom } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'

export type AvailabilityReport = {
	generation: number
	mode: 'restricted' | 'setup' | 'connected'
	canConnect: boolean
	canOperate: boolean
}
export type AvailabilityEvent = { type: 'AVAILABILITY_REPORTED'; report: AvailabilityReport }
type AvailabilitySource = Pick<
	BankSource,
	'organizationId' | 'userId' | 'sessionReady' | 'membership' | 'connections'
>
type Input = AvailabilitySource & {
	generation?: number
	recipient?: ActorRef<Snapshot<unknown>, AvailabilityEvent>
}
type Context = {
	source: AvailabilitySource
	connection: BankCredential | undefined
	published: AvailabilityReport | undefined
	generation: number
	recipient: ActorRef<Snapshot<unknown>, AvailabilityEvent> | undefined
}
type Event =
	| { type: 'ACCESS_CHANGED'; access: BankAccess; generation: number }
	| { type: 'CONNECTION_CHANGED'; connection: BankCredential | undefined; generation: number }
	| { type: 'CHECK_CONTROLS' }
	| { type: 'SETUP_STARTED' }
	| { type: 'SETUP_ENDED' }
export function selectedBankConnection<Credential extends BankCredential>(
	source: Pick<BankSource, 'organizationId' | 'userId'> & { connections: readonly Credential[] }
) {
	const connections = source.connections.filter(
		(row) => row.organizationId === source.organizationId && row.ownerId === source.userId
	)
	return connections.find((row) => row.status === 'active') ?? connections[0]
}
const patchAcceptAccess = ({ event }: { event: Event }): Partial<Context> =>
	event.type === 'ACCESS_CHANGED'
		? {
				source: {
					organizationId: event.access.organizationId,
					userId: event.access.userId,
					sessionReady: event.access.kind === 'allowed',
					membership: undefined,
					connections: []
				},
				generation: event.generation,
				connection: undefined
			}
		: {}
const events0 = {
	ACCESS_CHANGED: types<EventPayload<Event, 'ACCESS_CHANGED'>>(),
	CONNECTION_CHANGED: types<EventPayload<Event, 'CONNECTION_CHANGED'>>(),
	CHECK_CONTROLS: types<EventPayload<Event, 'CHECK_CONTROLS'>>(),
	SETUP_STARTED: types<EventPayload<Event, 'SETUP_STARTED'>>(),
	SETUP_ENDED: types<EventPayload<Event, 'SETUP_ENDED'>>()
}
type NativeEvent0 =
	| import('xstate').InferEvents<typeof events0>
	| import('xstate').DoneActorEvent<never>
	| import('xstate').ErrorActorEvent
	| import('xstate').AfterEvent
	| import('xstate').DoneStateEvent
	| import('xstate').SnapshotEvent
	| import('xstate').TimeoutEvent
	| import('xstate').ActorTimeoutEvent
	| import('xstate').ErrorPlatformEvent

export const bankAvailabilityMachine = setup({
	schemas: { context: types<Context>(), events: events0, input: types<Input>() },
	actions: {
		publish: (recipient: Input['recipient'], report: AvailabilityReport) => {
			recipient?.send({ type: 'AVAILABILITY_REPORTED', report })
		}
	},
	guards: {
		accessAllowed: (args: { value: import('xstate').StateValue }) =>
			matchesState({ access: 'allowed' }, args.value)
	}
}).createMachine({
	id: 'bank-availability',
	type: 'parallel',
	context: ({ input }) => ({
		source: input,
		connection: selectedBankConnection(input),
		published: undefined,
		generation: input.generation ?? 0,
		recipient: input.recipient
	}),
	states: {
		access: {
			initial: 'checkingSession',
			on: {
				ACCESS_CHANGED: (args) => {
					if (args.event.access.kind === 'allowed') {
						return { target: '.allowed', context: patchAcceptAccess(args) }
					}
					return { target: '.denied', context: patchAcceptAccess(args) }
				}
			},
			states: {
				checkingSession: {
					always: (args) => {
						if (!args.context.source.sessionReady) {
							return { target: 'denied' }
						}
						return { target: 'checkingUser' }
					}
				},
				checkingUser: {
					always: (args) => {
						if (!args.context.source.userId) {
							return { target: 'denied' }
						}
						return { target: 'checkingOrganization' }
					}
				},
				checkingOrganization: {
					always: (args) => {
						if (!args.context.source.organizationId) {
							return { target: 'denied' }
						}
						return { target: 'checkingMembership' }
					}
				},
				checkingMembership: {
					always: (args) => {
						if (!args.context.source.membership) {
							return { target: 'denied' }
						}
						return { target: 'checkingMembershipUser' }
					}
				},
				checkingMembershipUser: {
					always: (args) => {
						const { context } = args
						if (context.source.membership?.userId !== context.source.userId) {
							return { target: 'denied' }
						}
						return { target: 'checkingMembershipOrganization' }
					}
				},
				checkingMembershipOrganization: {
					always: (args) => {
						const { context } = args
						if (context.source.membership?.organizationId !== context.source.organizationId) {
							return { target: 'denied' }
						}
						return { target: 'checkingRole' }
					}
				},
				checkingRole: {
					always: (args) => {
						const { context } = args
						if (
							canManageBankCredentials(
								context.source.membership,
								context.source.organizationId ?? ''
							)
						) {
							return { target: 'allowed' }
						}
						return { target: 'denied' }
					}
				},
				allowed: {
					tags: ['allowed'],
					entry: (args, enq) => {
						enq.raise({ type: 'CHECK_CONTROLS' })
					}
				},
				denied: {
					entry: (args, enq) => {
						enq.raise({ type: 'CHECK_CONTROLS' })
					}
				}
			}
		},
		credential: {
			initial: 'checkingConnection',
			on: {
				ACCESS_CHANGED: { target: '.checkingConnection' },
				CONNECTION_CHANGED: (args) => {
					const { event } = args
					return {
						target: '.checkingConnection',
						context: { connection: event.connection, generation: event.generation }
					}
				}
			},
			states: {
				checkingConnection: {
					always: (args) => {
						if (!args.context.connection) {
							return { target: 'missing' }
						}
						return { target: 'checkingStatus' }
					}
				},
				checkingStatus: {
					always: (args) => {
						if (args.context.connection?.status !== 'active') {
							return { target: 'inactive' }
						}
						return { target: 'checkingCiphertext' }
					}
				},
				checkingCiphertext: {
					always: (args) => {
						if (!args.context.connection?.ciphertext) {
							return { target: 'incomplete' }
						}
						return { target: 'checkingCredentialId' }
					}
				},
				checkingCredentialId: {
					always: (args) => {
						if (!args.context.connection?.credentialId) {
							return { target: 'incomplete' }
						}
						return { target: 'checkingSalt' }
					}
				},
				checkingSalt: {
					always: (args) => {
						if (!args.context.connection?.prfSalt) {
							return { target: 'incomplete' }
						}
						return { target: 'checkingIv' }
					}
				},
				checkingIv: {
					always: (args) => {
						if (!args.context.connection?.iv) {
							return { target: 'incomplete' }
						}
						return { target: 'checkingVersion' }
					}
				},
				checkingVersion: {
					always: (args) => {
						if (args.context.connection?.credentialVersion !== 1) {
							return { target: 'incomplete' }
						}
						return { target: 'ready' }
					}
				},
				missing: {
					entry: (args, enq) => {
						enq.raise({ type: 'CHECK_CONTROLS' })
					}
				},
				inactive: {
					entry: (args, enq) => {
						enq.raise({ type: 'CHECK_CONTROLS' })
					}
				},
				incomplete: {
					entry: (args, enq) => {
						enq.raise({ type: 'CHECK_CONTROLS' })
					}
				},
				ready: {
					tags: ['credential-ready'],
					entry: (args, enq) => {
						enq.raise({ type: 'CHECK_CONTROLS' })
					}
				}
			}
		},
		controls: {
			initial: 'checkingAccess',
			on: {
				CHECK_CONTROLS: { target: '.checkingAccess' },
				SETUP_STARTED: { target: '.setup' },
				SETUP_ENDED: { target: '.checkingAccess' }
			},
			states: {
				checkingAccess: {
					always: (args) => {
						if (args.guards.accessAllowed(args)) {
							return { target: 'checkingCredential' }
						}
						return { target: 'restricted' }
					}
				},
				checkingCredential: {
					always: (args) => {
						if (matchesState({ credential: 'ready' }, args.value)) {
							return { target: 'connected' }
						}
						return { target: 'needsSetup' }
					}
				},
				restricted: {
					tags: ['show-restricted'],
					entry: (args, enq) => {
						let context = args.context
						let patch = {}
						{
							const contextBefore = args.context
							const params: { mode: AvailabilityReport['mode'] } = { mode: 'restricted' }
							if (!contextBefore.recipient) {
							} else {
								const allowed = params.mode !== 'restricted'
								const report: AvailabilityReport = {
									generation: contextBefore.generation,
									mode: params.mode,
									canConnect: allowed,
									canOperate: params.mode === 'connected'
								}
								if (
									contextBefore.published?.generation === report.generation &&
									contextBefore.published.mode === report.mode &&
									contextBefore.published.canConnect === report.canConnect &&
									contextBefore.published.canOperate === report.canOperate
								) {
								} else {
									patch = { ...patch, published: report }
									context = { ...args.context, ...patch }
									enq(args.actions.publish, contextBefore.recipient, report)
								}
							}
						}
						return { context: patch }
					}
				},
				connected: {
					tags: ['show-sync', 'show-connected', 'show-recovery'],
					entry: (args, enq) => {
						let context = args.context
						let patch = {}
						{
							const contextBefore = args.context
							const params: { mode: AvailabilityReport['mode'] } = { mode: 'connected' }
							if (!contextBefore.recipient) {
							} else {
								const allowed = params.mode !== 'restricted'
								const report: AvailabilityReport = {
									generation: contextBefore.generation,
									mode: params.mode,
									canConnect: allowed,
									canOperate: params.mode === 'connected'
								}
								if (
									contextBefore.published?.generation === report.generation &&
									contextBefore.published.mode === report.mode &&
									contextBefore.published.canConnect === report.canConnect &&
									contextBefore.published.canOperate === report.canOperate
								) {
								} else {
									patch = { ...patch, published: report }
									context = { ...args.context, ...patch }
									enq(args.actions.publish, contextBefore.recipient, report)
								}
							}
						}
						return { context: patch }
					}
				},
				needsSetup: {
					tags: ['show-setup'],
					entry: (args, enq) => {
						let context = args.context
						let patch = {}
						{
							const contextBefore = args.context
							const params: { mode: AvailabilityReport['mode'] } = { mode: 'setup' }
							if (!contextBefore.recipient) {
							} else {
								const allowed = params.mode !== 'restricted'
								const report: AvailabilityReport = {
									generation: contextBefore.generation,
									mode: params.mode,
									canConnect: allowed,
									canOperate: params.mode === 'connected'
								}
								if (
									contextBefore.published?.generation === report.generation &&
									contextBefore.published.mode === report.mode &&
									contextBefore.published.canConnect === report.canConnect &&
									contextBefore.published.canOperate === report.canOperate
								) {
								} else {
									patch = { ...patch, published: report }
									context = { ...args.context, ...patch }
									enq(args.actions.publish, contextBefore.recipient, report)
								}
							}
						}
						return { context: patch }
					}
				},
				setup: {
					initial: 'checkingAccess',
					on: { CHECK_CONTROLS: { target: '.checkingAccess' } },
					states: {
						checkingAccess: {
							always: (args) => {
								if (args.guards.accessAllowed(args)) {
									return { target: 'active' }
								}
								return { target: 'restricted' }
							}
						},
						active: {
							tags: ['show-setup'],
							entry: (args, enq) => {
								let context = args.context
								let patch = {}
								{
									const contextBefore = args.context
									const params: { mode: AvailabilityReport['mode'] } = { mode: 'setup' }
									if (!contextBefore.recipient) {
									} else {
										const allowed = params.mode !== 'restricted'
										const report: AvailabilityReport = {
											generation: contextBefore.generation,
											mode: params.mode,
											canConnect: allowed,
											canOperate: params.mode === 'connected'
										}
										if (
											contextBefore.published?.generation === report.generation &&
											contextBefore.published.mode === report.mode &&
											contextBefore.published.canConnect === report.canConnect &&
											contextBefore.published.canOperate === report.canOperate
										) {
										} else {
											patch = { ...patch, published: report }
											context = { ...args.context, ...patch }
											enq(args.actions.publish, contextBefore.recipient, report)
										}
									}
								}
								return { context: patch }
							}
						},
						restricted: {
							tags: ['show-restricted'],
							entry: (args, enq) => {
								let context = args.context
								let patch = {}
								{
									const contextBefore = args.context
									const params: { mode: AvailabilityReport['mode'] } = { mode: 'restricted' }
									if (!contextBefore.recipient) {
									} else {
										const allowed = params.mode !== 'restricted'
										const report: AvailabilityReport = {
											generation: contextBefore.generation,
											mode: params.mode,
											canConnect: allowed,
											canOperate: params.mode === 'connected'
										}
										if (
											contextBefore.published?.generation === report.generation &&
											contextBefore.published.mode === report.mode &&
											contextBefore.published.canConnect === report.canConnect &&
											contextBefore.published.canOperate === report.canOperate
										) {
										} else {
											patch = { ...patch, published: report }
											context = { ...args.context, ...patch }
											enq(args.actions.publish, contextBefore.recipient, report)
										}
									}
								}
								return { context: patch }
							}
						}
					}
				}
			}
		}
	}
})

export function availabilityObservation(
	snapshot: SnapshotFrom<typeof bankAvailabilityMachine>
): Omit<Observation, 'connection'> & { connection: BankCredential | undefined } {
	return {
		organizationId: snapshot.context.source.organizationId,
		userId: snapshot.context.source.userId,
		sessionReady: snapshot.context.source.sessionReady,
		allowed: snapshot.hasTag('allowed'),
		connected: snapshot.hasTag('credential-ready'),
		connection: snapshot.context.connection
	}
}

// Reuse guarded states when an operation needs a fresh synchronous authorization observation.
export function bankObservation(source: BankSource): Observation {
	return {
		...availabilityObservation(initialTransition(bankAvailabilityMachine, source)[0]),
		connection: selectedBankConnection(source)
	}
}
