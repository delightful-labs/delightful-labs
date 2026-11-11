import { createWorkspaceStartupMachine } from '../workspaces/workspace-startup.js'
import {
	createWorkspaceCreationMachine,
	selectWorkspaceCreationReport,
	unavailableWorkspaceCreationView,
	type WorkspaceCreationCommand,
	type WorkspaceCreationView
} from '../workspaces/workspace-creation.js'
import { createWorkspaceNavigationMachine } from '../workspaces/workspace-navigation.js'
import {
	sameInitializationRequest,
	type InitializationRequest,
	type InitializationStatusEvent,
	type WorkspaceRoute,
	type WorkspaceNavigate,
	type WorkspaceNavigationFacts,
	type NavigationAccess,
	type NavigationReport,
	type NavigationStatusEvent
} from '../../contracts/workspace-orchestration-contract.js'
import {
	createWorkspaceSelectedResources,
	selectedResourceBankActor
} from './workspace-selected-resources.js'
import {
	sameWorkspaceLease,
	type SelectedResourceOutput,
	type SelectedResourceCommand,
	type SelectedResourceReport
} from '../../contracts/workspace-selected-resources.js'
import {
	retainResourceRelease,
	type WorkspaceResourceRelease
} from '../../contracts/workspace-resource-release.js'
import type {
	WorkspaceLease,
	WorkspaceSelectionReport
} from 'delightful-local-first/workspace/contracts'
import {
	sameIntegrityBinding,
	sameIntegrityRequest,
	selectWorkspaceIntegrityView,
	type IntegrityBinding,
	type IntegrityRequest,
	type IntegrityReport
} from '../../contracts/workspace-integrity-contract.js'

import type { Organization } from '#lib/schema.js'
import { workspaceRoute } from '../../domain/workspace-routes.js'
import { required } from '../bank-sync/identity.js'
import { canManageBankCredentials } from '../../domain/organization-permissions.js'
import type {
	BankAccess,
	BankEvent,
	BankObservationEvent,
	BankSource,
	BankSyncDependencies
} from '../bank-sync/types.js'
import { setup, types, matchesState, matchesState as matchesState1 } from 'xstate'
import type { SnapshotFrom, ActorRefFrom, DoneActorEvent, ErrorActorEvent } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'

export type ReadinessObservation = {
	source: Pick<BankSource, 'organizationId' | 'userId' | 'membership'>
	sessionStatus: 'ready' | 'signed-out' | 'transitioning' | 'error' | 'closed'
	membershipLoading: boolean
	membershipError: unknown
	organizations: readonly Organization[] | undefined
	organizationsLoading: boolean
	organizationsError: unknown
	route: WorkspaceRoute
}
export type WorkspaceAttachment = {
	environment: string
	dependencies: BankSyncDependencies
	read: () => ReadinessObservation
	navigate: WorkspaceNavigate
}
type Context = ReadinessObservation & {
	bankAccess:
		| {
				revision: number
				access: BankAccess
				authority: IntegrityBinding | undefined
		  }
		| undefined
	initializationRequest: InitializationRequest
	navigationFacts: WorkspaceNavigationFacts
	navigationReport: NavigationReport | undefined
	creationView: WorkspaceCreationView
	navigationActor: ActorRefFrom<ReturnType<typeof createWorkspaceNavigationMachine>> | undefined
	integrityRequest: IntegrityRequest
	integrityReport: IntegrityReport | undefined
	creationActor: ActorRefFrom<ReturnType<typeof createWorkspaceCreationMachine>> | undefined
	initialization: { userId: string; profileId: string } | undefined
	resourceActor:
		| import('xstate').ActorRef<
				SnapshotFrom<ReturnType<typeof createWorkspaceSelectedResources>>,
				import('../../contracts/workspace-selected-resources.js').SelectedResourceCommand
		  >
		| undefined
	resourceLease: WorkspaceLease | undefined
	resourceUserId: string | undefined
	selectionLease: WorkspaceLease | undefined
	selectionStatus: Extract<WorkspaceSelectionReport, { type: 'WORKSPACE_SELECTION' }>['status']
	resourceResult: SelectedResourceOutput | undefined
	resourceRelease: WorkspaceResourceRelease
	bankRevision: number
	startupActor: ActorRefFrom<ReturnType<typeof createWorkspaceStartupMachine>> | undefined
}
type Event =
	| { type: 'SELECTION'; lease: WorkspaceLease | undefined; status: Context['selectionStatus'] }
	| SelectedResourceReport
	| DoneActorEvent<SelectedResourceOutput>
	| ErrorActorEvent
	| InitializationStatusEvent
	| NavigationStatusEvent
	| { type: 'INITIALIZATION_PENDING' }
	| { type: 'OBSERVE_STARTUP'; restart?: true }
	| { type: 'STARTUP_REQUESTED'; restart: boolean }
	| { type: 'OBSERVE_NAVIGATION' }
	| { type: 'OBSERVE_BANK' }
	| {
			type: 'BANK_OBSERVED'
			organizationId: string | null
			userId: string | undefined
			event: Exclude<BankObservationEvent, { type: 'WORKSPACE_ACCESS_CHANGED' }>
	  }
	| { type: 'NAVIGATION_REQUESTED'; access: NavigationAccess; ready: boolean }
	| { type: 'SELECT_WORKSPACE'; workspaceId: string }
	| { type: 'RETRY_NAVIGATION' }
	| { type: 'CREATION'; event: WorkspaceCreationCommand }
	| { type: 'NAVIGATION_STOPPED' }
	| { type: 'OBSERVE_INTEGRITY'; restart?: true }
	| { type: 'INTEGRITY_REQUESTED'; binding: IntegrityBinding | undefined; restart: boolean }
	| { type: 'OBSERVED'; observation: ReadinessObservation }
	| { type: 'REEVALUATE' }
	| { type: 'BANK'; lease?: WorkspaceLease | undefined; event: BankEvent }
	| { type: 'BANK_NETWORK'; lease: WorkspaceLease; offline: boolean }
	| { type: 'SHUTDOWN' }
	| { type: 'RETRY' }
	| { type: 'STARTUP_STOPPED' }
	| { type: 'RESOURCES_STOPPED' }
	| {
			type: 'RETRY_INTEGRITY' | 'CREATION_STOPPED' | 'OBSERVE_CREATION'
	  }

export function createWorkspaceReadinessMachine({
	dependencies,
	read,
	environment,
	navigate
}: WorkspaceAttachment) {
	const actors = {
		navigation: createWorkspaceNavigationMachine(dependencies.db, navigate),
		startup: createWorkspaceStartupMachine(dependencies.db),
		creation: createWorkspaceCreationMachine(dependencies.db)
	}
	const events0 = {
		SELECTION: types<EventPayload<Event, 'SELECTION'>>(),
		SELECTED_RESOURCES_STOPPING: types<EventPayload<Event, 'SELECTED_RESOURCES_STOPPING'>>(),
		SELECTED_INTEGRITY_STATUS: types<EventPayload<Event, 'SELECTED_INTEGRITY_STATUS'>>(),
		SELECTED_RESOURCE_DRAIN_REJECTED:
			types<EventPayload<Event, 'SELECTED_RESOURCE_DRAIN_REJECTED'>>(),
		INITIALIZATION_STATUS: types<EventPayload<Event, 'INITIALIZATION_STATUS'>>(),
		NAVIGATION_STATUS: types<EventPayload<Event, 'NAVIGATION_STATUS'>>(),
		INITIALIZATION_PENDING: types<EventPayload<Event, 'INITIALIZATION_PENDING'>>(),
		OBSERVE_STARTUP: types<EventPayload<Event, 'OBSERVE_STARTUP'>>(),
		STARTUP_REQUESTED: types<EventPayload<Event, 'STARTUP_REQUESTED'>>(),
		OBSERVE_NAVIGATION: types<EventPayload<Event, 'OBSERVE_NAVIGATION'>>(),
		OBSERVE_BANK: types<EventPayload<Event, 'OBSERVE_BANK'>>(),
		BANK_OBSERVED: types<EventPayload<Event, 'BANK_OBSERVED'>>(),
		NAVIGATION_REQUESTED: types<EventPayload<Event, 'NAVIGATION_REQUESTED'>>(),
		SELECT_WORKSPACE: types<EventPayload<Event, 'SELECT_WORKSPACE'>>(),
		RETRY_NAVIGATION: types<EventPayload<Event, 'RETRY_NAVIGATION'>>(),
		CREATION: types<EventPayload<Event, 'CREATION'>>(),
		NAVIGATION_STOPPED: types<EventPayload<Event, 'NAVIGATION_STOPPED'>>(),
		OBSERVE_INTEGRITY: types<EventPayload<Event, 'OBSERVE_INTEGRITY'>>(),
		INTEGRITY_REQUESTED: types<EventPayload<Event, 'INTEGRITY_REQUESTED'>>(),
		OBSERVED: types<EventPayload<Event, 'OBSERVED'>>(),
		REEVALUATE: types<EventPayload<Event, 'REEVALUATE'>>(),
		BANK: types<EventPayload<Event, 'BANK'>>(),
		BANK_NETWORK: types<EventPayload<Event, 'BANK_NETWORK'>>(),
		SHUTDOWN: types<EventPayload<Event, 'SHUTDOWN'>>(),
		RETRY: types<EventPayload<Event, 'RETRY'>>(),
		STARTUP_STOPPED: types<EventPayload<Event, 'STARTUP_STOPPED'>>(),
		RESOURCES_STOPPED: types<EventPayload<Event, 'RESOURCES_STOPPED'>>(),
		RETRY_INTEGRITY: types<EventPayload<Event, 'RETRY_INTEGRITY'>>(),
		CREATION_STOPPED: types<EventPayload<Event, 'CREATION_STOPPED'>>(),
		OBSERVE_CREATION: types<EventPayload<Event, 'OBSERVE_CREATION'>>()
	}
	type NativeEvent0 =
		| import('xstate').InferEvents<typeof events0>
		| import('xstate').DoneActorEvent<
				| import('xstate').OutputFrom<(typeof actors)['navigation']>
				| import('xstate').OutputFrom<(typeof actors)['startup']>
				| import('xstate').OutputFrom<(typeof actors)['creation']>
		  >
		| import('xstate').ErrorActorEvent
	return setup({
		schemas: {
			context: types<Context>(),
			events: events0,
			input: types<undefined>(),
			output: types<{ selectedResources: WorkspaceResourceRelease }>(),
			children: {
				navigation: types<import('xstate').ActorRefFrom<(typeof actors)['navigation']>>(),
				startup: types<import('xstate').ActorRefFrom<(typeof actors)['startup']>>(),
				creation: types<import('xstate').ActorRefFrom<(typeof actors)['creation']>>(),
				selectedResources:
					types<
						import('xstate').ActorRefFrom<ReturnType<typeof createWorkspaceSelectedResources>>
					>()
			}
		},
		actors,
		actions: {},
		guards: {
			bankAccessAllowed: (args: {
				context: Context
				event: NativeEvent0
				value: import('xstate').StateValue
			}) =>
				matchesState(
					{
						active: {
							workspace: 'ready',
							session: 'ready',
							organization: 'ready',
							selection: 'selected'
						}
					},
					args.value
				) &&
				matchesState({ active: { resources: 'bound' } }, args.value) &&
				(({ context }) =>
					context.resourceActor?.getSnapshot().status === 'active' &&
					context.selectionLease !== undefined &&
					context.resourceLease !== undefined &&
					sameWorkspaceLease(context.selectionLease, context.resourceLease))(args) &&
				(({ context }) =>
					canManageBankCredentials(context.source.membership, context.source.organizationId ?? ''))(
					args
				),
			navigationAlive: ({ context }: { context: Context }) =>
				context.navigationActor?.getSnapshot().status === 'active',
			navigationReady: ({ context }: { context: Context }) =>
				context.sessionStatus === 'ready' && Boolean(context.source.userId),
			invalidSelection: ({ context }: { context: Context }) => {
				const scope = workspaceRoute(context.route.search)
				return (
					scope.scoped &&
					(scope.workspaceId === null || scope.workspaceId !== context.source.organizationId)
				)
			},
			navigationDenied: (args: { value: import('xstate').StateValue }) =>
				matchesState({ active: { selection: 'unavailableSelection' } }, args.value) ||
				matchesState({ active: { organization: 'denied' } }, args.value),
			canUseWorkspace: (args: { value: import('xstate').StateValue }) =>
				matchesState(
					{
						active: {
							workspace: 'ready',
							session: 'ready',
							organization: 'ready',
							selection: 'selected'
						}
					},
					args.value
				),
			workspaceReady: (args: { value: import('xstate').StateValue }) =>
				matchesState({ active: { workspace: 'ready' } }, args.value),
			resourceBound: (args: {
				context: Context
				event: NativeEvent0
				value: import('xstate').StateValue
			}) =>
				matchesState({ active: { resources: 'bound' } }, args.value) &&
				(({ context }) =>
					context.resourceActor?.getSnapshot().status === 'active' &&
					context.selectionLease !== undefined &&
					context.resourceLease !== undefined &&
					sameWorkspaceLease(context.selectionLease, context.resourceLease))(args),
			startupAlive: ({ context }: { context: Context }) =>
				context.startupActor?.getSnapshot().status === 'active',
			creationAlive: ({ context }: { context: Context }) =>
				context.creationActor?.getSnapshot().status === 'active',
			canObserveCreation: (args: {
				context: Context
				event: NativeEvent0
				value: import('xstate').StateValue
			}) =>
				matchesState({ active: { session: 'ready', workspace: 'ready' } }, args.value) &&
				(({ context }) =>
					context.initialization !== undefined &&
					context.initialization.userId === context.source.userId)(args)
		}
	}).createMachine({
		id: 'workspace-readiness',
		output: ({ context }) => ({ selectedResources: context.resourceRelease }),
		initial: 'active',
		context: () => {
			const observation = read()
			return {
				...observation,
				bankAccess: undefined,
				initialization: undefined,
				initializationRequest: {
					generation: 0,
					userId: observation.source.userId,
					status: observation.sessionStatus
				},
				navigationFacts: {
					...observation.route,
					generation: 0,
					userId: observation.source.userId,
					ready: false,
					loading: true,
					error: undefined,
					organizations: [],
					access: 'waiting'
				},
				navigationReport: undefined,
				creationView: unavailableWorkspaceCreationView,
				integrityRequest: { generation: 0, binding: undefined },
				integrityReport: undefined,
				resourceActor: undefined,
				resourceLease: undefined,
				resourceUserId: undefined,
				selectionLease: undefined,
				selectionStatus: 'waiting',
				resourceResult: undefined,
				resourceRelease: { outcome: 'released' },
				bankRevision: -1,
				startupActor: undefined,
				creationActor: undefined,
				navigationActor: undefined
			}
		},
		invoke: [
			{
				id: 'startup',
				src: 'startup',
				input: ({ context, self }) => ({ request: context.initializationRequest, recipient: self }),
				onDone: (args, enq) => {
					enq.raise({ type: 'STARTUP_STOPPED' })
				},
				onError: (args, enq) => {
					enq.raise({ type: 'STARTUP_STOPPED' })
				}
			},
			{
				id: 'navigation',
				src: 'navigation',
				input: ({ context, self }) => ({ facts: context.navigationFacts, recipient: self }),
				onDone: (args, enq) => {
					enq.raise({ type: 'NAVIGATION_STOPPED' })
				},
				onError: (args, enq) => {
					enq.raise({ type: 'NAVIGATION_STOPPED' })
				}
			},

			{
				id: 'creation',
				src: 'creation',
				onSnapshot: (args) => {
					if (!matchesState1('active', args.value)) {
						return {}
					}
					if (
						(({ context, event }) => {
							const { binding } = selectWorkspaceCreationReport(event.snapshot)
							return (
								binding !== undefined &&
								binding.userId === context.source.userId &&
								binding.profileId === context.initialization?.profileId
							)
						})(args)
					) {
						return {
							context: ((args) => ({
								creationView: (({ event }) => selectWorkspaceCreationReport(event.snapshot).view)(
									args
								)
							}))(args)
						}
					}
					return { context: ((args) => ({ creationView: unavailableWorkspaceCreationView }))(args) }
				},
				input: { binding: undefined },
				onDone: (args, enq) => {
					enq.raise({ type: 'CREATION_STOPPED' })
				},
				onError: (args, enq) => {
					enq.raise({ type: 'CREATION_STOPPED' })
				}
			}
		],
		on: {
			'xstate.done.actor': (args, enq) => {
				return ((args, enq) => {
					let context = args.context
					const { event } = args
					if (!(
						event.actorId === 'selectedResources' &&
						context.resourceLease !== undefined &&
						sameWorkspaceLease(event.output.lease, context.resourceLease)
					))
						return
					let patch = {}
					{
						const contextBefore = args.context
						if (!('output' in event)) throw new Error('Missing resource completion')
						enq.sendTo(args.parent, { type: 'SELECTED_RESOURCES_RELEASED', result: event.output })
						enq.stop(required(contextBefore.resourceActor))
						patch = {
							...patch,
							...((assignedArgs) => ({
								resourceActor: undefined,
								resourceResult: event.output,
								resourceRelease: retainResourceRelease(
									contextBefore.resourceRelease,
									event.output.release
								),
								bankAccess: undefined,
								integrityReport: undefined
							}))({ ...args, context })
						}
						context = { ...args.context, ...patch }
						enq.raise({ type: 'RESOURCES_STOPPED' })
					}
					return { context: patch }
				})(args, enq)
			},
			'xstate.error.actor': (args, enq) => {
				return ((args, enq) => {
					const { context } = args
					if (args.event.actorId === 'selectedResources') {
						let context = args.context
						let patch = {}
						{
							const contextBefore = args.context
							enq.sendTo(args.parent, {
								type: 'SELECTED_RESOURCES_CRASHED',
								lease: required(contextBefore.resourceLease)
							})
							enq.stop(required(contextBefore.resourceActor))
							patch = {
								...patch,
								resourceActor: undefined,
								resourceResult: {
									lease: required(contextBefore.resourceLease),
									drain: undefined,
									release: { outcome: 'unresolved' }
								},
								resourceRelease: { outcome: 'unresolved' },
								bankAccess: undefined,
								integrityReport: undefined
							}
							context = { ...args.context, ...patch }
							enq.raise({ type: 'RESOURCES_STOPPED' })
						}
						return { context: patch }
					}
					return undefined
				})(args, enq)
			},
			SELECTED_RESOURCE_DRAIN_REJECTED: {},
			BANK_NETWORK: (args, enq) => {
				const { context, event } = args
				if (!(
					matchesState({ active: { resources: 'bound' } }, args.value) &&
					context.resourceActor?.getSnapshot().status === 'active' &&
					context.selectionLease !== undefined &&
					context.resourceLease !== undefined &&
					sameWorkspaceLease(context.selectionLease, context.resourceLease) &&
					context.resourceLease !== undefined &&
					sameWorkspaceLease(event.lease, context.resourceLease)
				))
					return
				enq.sendTo(required(context.resourceActor), {
					type: 'BANK',
					lease: event.lease,
					event: { type: 'NETWORK_CHANGED', offline: event.offline }
				})
			},
			OBSERVE_BANK: (args, enq) => {
				let context = args.context
				if (!args.guards.resourceBound(args)) return
				let patch = {}
				{
					const contextBefore = args.context
					const access: BankAccess = args.guards.bankAccessAllowed({
						...args,
						context: contextBefore
					})
						? {
								kind: 'allowed',
								organizationId: required(contextBefore.source.organizationId ?? undefined),
								userId: required(contextBefore.source.userId)
							}
						: {
								kind:
									args.guards.canUseWorkspace({ ...args }) ||
									args.guards.navigationDenied({ ...args })
										? 'restricted'
										: 'waiting',
								organizationId: contextBefore.source.organizationId,
								userId: contextBefore.source.userId
							}
					const previous = contextBefore.bankAccess
					const authority = contextBefore.integrityRequest.binding
					if (
						previous &&
						previous.access.kind === access.kind &&
						previous.access.organizationId === access.organizationId &&
						previous.access.userId === access.userId &&
						sameIntegrityBinding(previous.authority, authority)
					) {
					} else {
						const revision = contextBefore.bankRevision + 1
						patch = {
							...patch,
							...((assignedArgs) => ({
								bankAccess: { revision, access, authority },
								bankRevision: revision
							}))({ ...args, context })
						}
						context = { ...args.context, ...patch }
						if (
							contextBefore.resourceActor?.getSnapshot().status === 'active' &&
							contextBefore.resourceLease
						)
							enq.sendTo(contextBefore.resourceActor, {
								type: 'BANK',
								lease: contextBefore.resourceLease,
								event: { type: 'WORKSPACE_ACCESS_CHANGED', revision, access }
							})
					}
				}
				return { context: patch }
			},
			BANK_OBSERVED: (args, enq) => {
				const { context, event } = args
				if (!(
					matchesState({ active: { resources: 'bound' } }, args.value) &&
					context.resourceActor?.getSnapshot().status === 'active' &&
					context.selectionLease !== undefined &&
					context.resourceLease !== undefined &&
					sameWorkspaceLease(context.selectionLease, context.resourceLease) &&
					context.bankAccess !== undefined &&
					event.event.revision === context.bankAccess.revision &&
					event.organizationId === context.bankAccess.access.organizationId &&
					event.userId === context.bankAccess.access.userId
				))
					return
				enq.sendTo(required(context.resourceActor), {
					type: 'BANK',
					lease: required(context.resourceLease),
					event: event.event
				})
			},
			SHUTDOWN: { target: '.closing.intent.shutdown' },
			RETRY: (args, enq) => {
				if (!matchesState({ active: { workspace: 'failed' } }, args.value)) return
				enq.raise({ type: 'OBSERVE_STARTUP', restart: true })
			},
			CREATION: (args, enq) => {
				const { context } = args
				if (!(
					matchesState({ active: { session: 'ready', workspace: 'ready' } }, args.value) &&
					context.initialization !== undefined &&
					context.initialization.userId === context.source.userId
				))
					return
				enq.sendTo('creation', args.event.event)
			},
			SELECT_WORKSPACE: (args, enq) => {
				enq.sendTo('navigation', {
					type: 'SELECT',
					workspaceId: args.event.workspaceId
				})
			},
			RETRY_NAVIGATION: (args, enq) => {
				enq.sendTo('navigation', { type: 'RETRY' })
			},
			OBSERVE_STARTUP: (args, enq) => {
				enq.raise({
					type: 'STARTUP_REQUESTED',
					restart: args.event.restart === true
				})
			},
			STARTUP_REQUESTED: (args, enq) => {
				let context = args.context
				if (!(
					args.event.restart ||
					context.initializationRequest.userId !== context.source.userId ||
					context.initializationRequest.status !== context.sessionStatus
				))
					return
				let patch = {}
				patch = {
					...patch,
					...((args) => ({
						initializationRequest: (({ context }) => ({
							generation: context.initializationRequest.generation + 1,
							userId: context.source.userId,
							status: context.sessionStatus
						}))(args),
						initialization: undefined,
						creationView: unavailableWorkspaceCreationView
					}))(args)
				}
				context = { ...args.context, ...patch }
				enq.raise({ type: 'INITIALIZATION_PENDING' })
				enq.sendTo('startup', {
					type: 'OBSERVED',
					request: context.initializationRequest
				})
				return { context: patch }
			},
			OBSERVE_NAVIGATION: (args, enq) => {
				const { context } = args
				if (
					!args.guards.navigationReady(args) ||
					(matchesState({ active: { workspace: 'waiting' } }, args.value) &&
						context.organizations?.length === 0 &&
						context.organizationsError == null &&
						!workspaceRoute(context.route.search).scoped &&
						!['/settings/workspace', '/account', '/login'].includes(context.route.pathname))
				) {
					enq.raise({ type: 'NAVIGATION_REQUESTED', ready: false, access: 'waiting' })
					return {}
				}
				if (args.guards.invalidSelection(args)) {
					enq.raise({ type: 'NAVIGATION_REQUESTED', ready: true, access: 'denied' })
					return {}
				}
				if (
					matchesState(
						{
							active: { session: 'ready', organization: 'ready', selection: 'selected' }
						},
						args.value
					)
				) {
					enq.raise({ type: 'NAVIGATION_REQUESTED', ready: true, access: 'ready' })
					return {}
				}
				if (
					matchesState({ active: { selection: 'failed' } }, args.value) ||
					matchesState({ active: { organization: 'failed' } }, args.value)
				) {
					enq.raise({ type: 'NAVIGATION_REQUESTED', ready: true, access: 'failed' })
					return {}
				}
				if (
					matchesState({ active: { selection: 'unavailableSelection' } }, args.value) ||
					matchesState({ active: { organization: 'denied' } }, args.value)
				) {
					enq.raise({ type: 'NAVIGATION_REQUESTED', ready: true, access: 'denied' })
					return {}
				}
				enq.raise({ type: 'NAVIGATION_REQUESTED', ready: true, access: 'waiting' })
				return {}
			},
			NAVIGATION_REQUESTED: (args, enq) => {
				let context = args.context
				const { event } = args
				let patch = {}
				patch = {
					...patch,
					navigationFacts: {
						...context.route,
						generation: context.navigationFacts.generation + 1,
						userId: context.source.userId,
						ready: event.ready,
						loading:
							!workspaceRoute(context.route.search).scoped &&
							(context.organizationsLoading || context.organizations === undefined),
						error: workspaceRoute(context.route.search).scoped
							? undefined
							: context.organizationsError,
						organizations: context.organizations ?? [],
						access: event.access
					},
					navigationReport: undefined
				}
				context = { ...args.context, ...patch }
				enq.sendTo('navigation', {
					type: 'OBSERVED',
					facts: context.navigationFacts
				})
				return { context: patch }
			},
			RETRY_INTEGRITY: (args, enq) => {
				if (!selectWorkspaceIntegrityView(args.context.integrityReport).canRetry) return
				enq.raise({ type: 'OBSERVE_INTEGRITY', restart: true })
			},
			OBSERVE_CREATION: (args, enq) => {
				if (args.guards.canObserveCreation(args)) {
					enq.sendTo(
						'creation',
						(({ context }): import('xstate').SendableEventFromLogic<typeof actors.creation> => {
							const initialized = required(context.initialization)
							return {
								type: 'OBSERVED',
								binding: {
									...initialized,
									key: JSON.stringify([environment, initialized.userId])
								}
							}
						})(args)
					)
					return {}
				}
				enq.sendTo('creation', { type: 'OBSERVED', binding: undefined })
				return { context: ((args) => ({ creationView: unavailableWorkspaceCreationView }))(args) }
			},
			OBSERVE_INTEGRITY: (args, enq) => {
				const { context } = args
				if (
					matchesState(
						{
							active: {
								workspace: 'ready',
								session: 'ready',
								organization: 'ready',
								selection: 'selected'
							}
						},
						args.value
					) &&
					matchesState({ active: { resources: 'bound' } }, args.value) &&
					context.resourceActor?.getSnapshot().status === 'active' &&
					context.selectionLease !== undefined &&
					context.resourceLease !== undefined &&
					sameWorkspaceLease(context.selectionLease, context.resourceLease) &&
					context.initialization !== undefined &&
					context.initialization.userId === context.source.userId
				) {
					enq.raise(
						(({ context, event }) => {
							const initialization = required(context.initialization)
							const membership = required(context.source.membership)
							return {
								type: 'INTEGRITY_REQUESTED',
								restart: event.restart === true,
								binding: {
									userId: initialization.userId,
									profileId: initialization.profileId,
									organizationId: required(context.source.organizationId ?? undefined),
									membershipId: membership.id,
									role: membership.role,
									accountAccessMode: membership.accountAccessMode
								}
							}
						})(args)
					)
					return {}
				}
				enq.raise({ type: 'INTEGRITY_REQUESTED', binding: undefined, restart: false })
				return {}
			},
			INTEGRITY_REQUESTED: (args, enq) => {
				const { context, event } = args
				if (
					event.restart ||
					!sameIntegrityBinding(context.integrityRequest.binding, event.binding)
				) {
					let context = args.context
					let patch = {}
					patch = {
						...patch,
						integrityRequest: {
							generation: context.integrityRequest.generation + 1,
							binding: event.binding
						},
						integrityReport: undefined
					}
					context = { ...args.context, ...patch }
					{
						const contextBefore = context
						if (
							matchesState({ active: { resources: 'bound' } }, args.value) &&
							(({ context }) =>
								context.resourceActor?.getSnapshot().status === 'active' &&
								context.selectionLease !== undefined &&
								context.resourceLease !== undefined &&
								sameWorkspaceLease(context.selectionLease, context.resourceLease))({
								...args,
								context: contextBefore
							}) &&
							contextBefore.resourceActor &&
							contextBefore.resourceLease
						)
							enq.sendTo(contextBefore.resourceActor, {
								type: 'INTEGRITY',
								lease: contextBefore.resourceLease,
								request: contextBefore.integrityRequest
							})
					}
					enq.raise({ type: 'OBSERVE_BANK' })
					return { context: patch }
				}
				enq.raise({ type: 'OBSERVE_BANK' })
				return {}
			},
			BANK: (args, enq) => {
				const { context, event } = args
				if (
					matchesState({ active: { resources: 'bound' } }, args.value) &&
					context.resourceActor?.getSnapshot().status === 'active' &&
					context.selectionLease !== undefined &&
					context.resourceLease !== undefined &&
					sameWorkspaceLease(context.selectionLease, context.resourceLease) &&
					event.lease !== undefined &&
					context.resourceLease !== undefined &&
					sameWorkspaceLease(event.lease, context.resourceLease) &&
					(event.event.type === 'CANCEL' || event.event.type === 'RESET')
				) {
					enq.sendTo(required(context.resourceActor), {
						type: 'BANK',
						lease: required(context.resourceLease),
						event: event.event
					})
					return {}
				}
				if (
					matchesState(
						{
							active: {
								workspace: 'ready',
								session: 'ready',
								organization: 'ready',
								selection: 'selected'
							}
						},
						args.value
					) &&
					matchesState({ active: { resources: 'bound' } }, args.value) &&
					context.resourceActor?.getSnapshot().status === 'active' &&
					context.selectionLease !== undefined &&
					context.resourceLease !== undefined &&
					sameWorkspaceLease(context.selectionLease, context.resourceLease) &&
					canManageBankCredentials(
						context.source.membership,
						context.source.organizationId ?? ''
					) &&
					event.lease !== undefined &&
					context.resourceLease !== undefined &&
					sameWorkspaceLease(event.lease, context.resourceLease) &&
					event.event.type === 'SYNC'
				) {
					enq.sendTo(required(context.resourceActor), {
						type: 'BANK',
						lease: required(context.resourceLease),
						event: event.event
					})
					return {}
				}
				if (
					matchesState(
						{
							active: {
								workspace: 'ready',
								session: 'ready',
								organization: 'ready',
								selection: 'selected'
							}
						},
						args.value
					) &&
					matchesState({ active: { resources: 'bound' } }, args.value) &&
					context.resourceActor?.getSnapshot().status === 'active' &&
					context.selectionLease !== undefined &&
					context.resourceLease !== undefined &&
					sameWorkspaceLease(context.selectionLease, context.resourceLease) &&
					event.lease !== undefined &&
					context.resourceLease !== undefined &&
					sameWorkspaceLease(event.lease, context.resourceLease) &&
					event.event.type !== 'SYNC'
				) {
					enq.sendTo(required(context.resourceActor), {
						type: 'BANK',
						lease: required(context.resourceLease),
						event: event.event
					})
					return {}
				}
			},
			OBSERVED: (args, enq) => {
				enq.raise({ type: 'OBSERVE_STARTUP' })
				enq.raise({ type: 'REEVALUATE' })
				enq.raise({ type: 'OBSERVE_INTEGRITY' })
				enq.raise({ type: 'OBSERVE_CREATION' })
				enq.raise({ type: 'OBSERVE_NAVIGATION' })
				return { context: args.event.observation }
			}
		},
		states: {
			active: {
				type: 'parallel',
				on: {
					SELECTION: (args, enq) => {
						const { event } = args
						enq.raise({ type: 'REEVALUATE' })
						enq.raise({ type: 'OBSERVE_NAVIGATION' })
						enq.raise({ type: 'OBSERVE_BANK' })
						return { context: { selectionLease: event.lease, selectionStatus: event.status } }
					},
					NAVIGATION_STATUS: (args) => {
						const { event } = args
						if (!(args.context.navigationFacts.generation === event.report.generation)) return
						return { context: { navigationReport: event.report } }
					},
					SELECTED_INTEGRITY_STATUS: (args) => {
						const { context, event } = args
						if (!(
							context.resourceLease !== undefined &&
							sameWorkspaceLease(event.lease, context.resourceLease) &&
							sameIntegrityRequest(context.integrityRequest, event.report.request)
						))
							return
						return { context: { integrityReport: event.report } }
					},
					NAVIGATION_STOPPED: { target: '#workspace-readiness.closing.intent.failed' },
					STARTUP_STOPPED: { target: '#workspace-readiness.closing.intent.failed' },
					CREATION_STOPPED: { target: '#workspace-readiness.closing.intent.failed' }
				},
				states: {
					resources: {
						initial: 'unbound',
						states: {
							unbound: {
								always: (args, enq) => {
									if (!(
										matchesState(
											{
												active: {
													workspace: 'ready',
													session: 'ready',
													organization: 'ready',
													selection: 'selected'
												}
											},
											args.value
										) && args.context.selectionLease !== undefined
									))
										return
									return {
										target: 'bound',
										context: (({ context, self, spawn }) => {
											const resourceLease = required(context.selectionLease)
											return {
												resourceLease,
												resourceUserId: context.source.userId,
												resourceResult: undefined,
												bankAccess: undefined,
												integrityReport: undefined,
												resourceActor: spawn(
													createWorkspaceSelectedResources({
														dependencies,
														lease: resourceLease,
														userId: required(context.source.userId)
													}),
													{
														input: { recipient: self },
														id: 'selectedResources'
													}
												)
											}
										})({ ...args, spawn: enq.spawn })
									}
								}
							},
							bound: {
								entry: (args, enq) => {
									enq.raise({ type: 'OBSERVE_INTEGRITY', restart: true })
								},
								always: (args) => {
									const { context } = args
									if (!(
										!(
											matchesState({ active: { session: 'checking' } }, args.value) ||
											matchesState({ active: { selection: 'checking' } }, args.value) ||
											matchesState({ active: { selection: 'checkingQuery' } }, args.value) ||
											matchesState({ active: { selection: 'choosingOrganization' } }, args.value) ||
											matchesState({ active: { organization: 'checking' } }, args.value) ||
											matchesState({ active: { organization: 'checkingMembership' } }, args.value)
										) &&
										!(
											matchesState(
												{
													active: {
														workspace: 'ready',
														session: 'ready',
														organization: 'ready',
														selection: 'selected'
													}
												},
												args.value
											) &&
											context.resourceLease !== undefined &&
											context.selectionLease !== undefined &&
											sameWorkspaceLease(context.resourceLease, context.selectionLease) &&
											context.resourceLease.request.workspaceId === context.source.organizationId &&
											context.resourceUserId === context.source.userId
										)
									))
										return
									return { target: 'draining' }
								},
								on: {
									SELECTED_RESOURCES_STOPPING: (args) => {
										const { context } = args
										if (!(
											context.resourceLease !== undefined &&
											sameWorkspaceLease(args.event.lease, context.resourceLease)
										))
											return
										return { target: 'failing' }
									},
									RESOURCES_STOPPED: { target: 'unresolved' }
								}
							},
							draining: {
								entry: (args, enq) => {
									let context = args.context
									let patch = {}
									patch = { ...patch, bankAccess: undefined, integrityReport: undefined }
									context = { ...args.context, ...patch }
									{
										const contextBefore = context
										if (contextBefore.resourceActor?.getSnapshot().status === 'active')
											enq.sendTo(contextBefore.resourceActor, { type: 'SHUTDOWN' })
									}
									return { context: patch }
								},
								on: {
									RESOURCES_STOPPED: (args) => {
										if (args.context.resourceResult?.release.outcome === 'unresolved') {
											return { target: 'unresolved' }
										}
										return { target: 'unbound' }
									}
								}
							},
							failing: {
								entry: (args, enq) => {
									let context = args.context
									let patch = {}
									patch = { ...patch, bankAccess: undefined, integrityReport: undefined }
									context = { ...args.context, ...patch }
									{
										const contextBefore = context
										if (contextBefore.resourceActor?.getSnapshot().status === 'active')
											enq.sendTo(contextBefore.resourceActor, { type: 'SHUTDOWN' })
									}
									return { context: patch }
								},
								on: {
									RESOURCES_STOPPED: (args) => {
										if (args.context.resourceResult?.release.outcome === 'unresolved') {
											return { target: 'unresolved' }
										}
										return { target: 'failed' }
									}
								}
							},
							failed: { tags: ['workspace-error'] },
							unresolved: { tags: ['workspace-error'] }
						}
					},
					session: {
						initial: 'checking',
						on: { REEVALUATE: { target: '.checking' } },
						states: {
							checking: {
								always: (args) => {
									const { context } = args
									if (context.sessionStatus === 'error') {
										return { target: 'failed' }
									}
									if (context.sessionStatus === 'closed') {
										return { target: 'closed' }
									}
									if (context.sessionStatus === 'signed-out') {
										return { target: 'signedOut' }
									}
									if (context.sessionStatus === 'transitioning') {
										return { target: 'transitioning' }
									}
									if (args.guards.navigationReady(args)) {
										return { target: 'ready' }
									}
									return { target: 'signedOut' }
								}
							},
							ready: {},
							transitioning: {},
							signedOut: {},
							failed: {},
							closed: {}
						}
					},
					workspace: {
						initial: 'waiting',
						on: {
							INITIALIZATION_PENDING: { target: '.waiting' },
							INITIALIZATION_STATUS: (args) => {
								const { context, event } = args
								if (
									sameInitializationRequest(context.initializationRequest, event.report.request) &&
									event.report.status.kind === 'ready'
								) {
									return {
										target: '.ready',
										context: {
											initialization: (({ event }) => {
												if (event.report.status.kind !== 'ready' || !event.report.request.userId)
													throw new Error('Expected ready initialization report')
												return {
													userId: event.report.request.userId,
													profileId: event.report.status.profileId
												}
											})(args)
										}
									}
								}
								if (
									sameInitializationRequest(context.initializationRequest, event.report.request) &&
									event.report.status.kind === 'failed'
								) {
									return { target: '.failed' }
								}
								if (
									sameInitializationRequest(context.initializationRequest, event.report.request)
								) {
									return { target: '.waiting' }
								}
							}
						},
						states: {
							waiting: {
								entry: (args, enq) => {
									enq.raise({ type: 'OBSERVE_INTEGRITY' })
									enq.raise({ type: 'OBSERVE_CREATION' })
									enq.raise({ type: 'OBSERVE_NAVIGATION' })
									return { context: { initialization: undefined } }
								}
							},
							ready: {
								tags: ['workspace-ready'],
								entry: (args, enq) => {
									enq.raise({ type: 'REEVALUATE' })
									enq.raise({ type: 'OBSERVE_INTEGRITY' })
									enq.raise({ type: 'OBSERVE_CREATION' })
									enq.raise({ type: 'OBSERVE_NAVIGATION' })
								}
							},
							failed: {
								tags: ['workspace-error', 'workspace-retryable'],
								entry: (args, enq) => {
									enq.raise({ type: 'OBSERVE_INTEGRITY' })
									enq.raise({ type: 'OBSERVE_CREATION' })
									enq.raise({ type: 'OBSERVE_NAVIGATION' })
									return { context: { initialization: undefined } }
								}
							}
						}
					},
					selection: {
						initial: 'checking',
						on: { REEVALUATE: { target: '.checking' } },
						states: {
							checking: {
								always: (args) => {
									if (args.guards.navigationReady(args)) {
										return { target: 'checkingQuery' }
									}
									return { target: 'waiting' }
								}
							},
							checkingQuery: { always: { target: 'choosingOrganization' } },
							choosingOrganization: {
								always: (args) => {
									const { context } = args
									if (
										context.selectionStatus === 'selected' &&
										context.selectionLease?.request.workspaceId === context.source.organizationId
									) {
										return { target: 'selected' }
									}
									if (
										context.selectionStatus === 'failed' ||
										context.selectionStatus === 'drainFailed'
									) {
										return { target: 'failed' }
									}
									if (
										context.selectionStatus === 'denied' ||
										context.selectionStatus === 'unavailable'
									) {
										return { target: 'unavailableSelection' }
									}
									if (context.source.organizationId == null) {
										return { target: 'unselected' }
									}
									return { target: 'waiting' }
								}
							},
							unselected: {},
							unavailableSelection: {},
							selected: {},
							waiting: {},
							failed: {}
						}
					},
					organization: {
						initial: 'checking',
						on: { REEVALUATE: { target: '.checking' } },
						states: {
							checking: {
								always: (args) => {
									const { context } = args
									if (context.sessionStatus !== 'ready') {
										return { target: 'unavailable' }
									}
									if (!context.source.organizationId) {
										return { target: 'unselected' }
									}
									if (context.membershipError != null) {
										return { target: 'failed' }
									}
									if (context.membershipLoading) {
										return { target: 'loadingMembership' }
									}
									return { target: 'checkingMembership' }
								}
							},
							checkingMembership: {
								always: (args) => {
									const { context } = args
									if (!context.source.membership) {
										return { target: 'denied' }
									}
									if (context.source.membership?.userId !== context.source.userId) {
										return { target: 'denied' }
									}
									if (context.source.membership?.organizationId !== context.source.organizationId) {
										return { target: 'denied' }
									}
									return { target: 'ready' }
								}
							},
							unavailable: {},
							unselected: {},
							loadingMembership: {},
							denied: {},
							failed: {},
							ready: {}
						}
					}
				}
			},
			closing: {
				type: 'parallel',
				entry: (args) => {
					return {
						context: ((args) => ({
							integrityReport: undefined,
							navigationReport: undefined,
							creationView: unavailableWorkspaceCreationView,
							navigationActor: args.children.navigation,
							startupActor: args.children.startup,
							creationActor: args.children.creation
						}))(args)
					}
				},
				on: {
					CREATION: {},
					SELECT_WORKSPACE: {},
					RETRY_NAVIGATION: {},
					OBSERVE_STARTUP: {},
					STARTUP_REQUESTED: {},
					OBSERVE_NAVIGATION: {},
					NAVIGATION_REQUESTED: {},
					INITIALIZATION_STATUS: {},
					INITIALIZATION_PENDING: {},
					BANK: {},
					OBSERVED: {},
					REEVALUATE: {},
					RETRY: {},
					RETRY_INTEGRITY: {},
					OBSERVE_INTEGRITY: {},
					INTEGRITY_REQUESTED: {},
					OBSERVE_CREATION: {},

					SHUTDOWN: { target: '.intent.shutdown' }
				},
				states: {
					intent: {
						initial: 'failed',
						states: { failed: { type: 'final' }, shutdown: { type: 'final' } }
					},
					navigation: {
						initial: 'checking',
						states: {
							checking: {
								always: (args) => {
									if (args.guards.navigationAlive(args)) {
										return { target: 'stopping' }
									}
									return { target: 'stopped' }
								}
							},
							stopping: {
								entry: (args, enq) => {
									enq.sendTo('navigation', { type: 'SHUTDOWN' })
								},
								on: { NAVIGATION_STOPPED: { target: 'stopped' } }
							},
							stopped: { type: 'final' }
						}
					},
					resources: {
						initial: 'checking',
						states: {
							checking: {
								always: (args) => {
									if (args.context.resourceActor !== undefined) {
										return { target: 'stopping' }
									}
									return { target: 'stopped' }
								}
							},
							stopping: {
								entry: (args, enq) => {
									const { context } = args
									if (context.resourceActor?.getSnapshot().status === 'active')
										enq.sendTo(context.resourceActor, { type: 'SHUTDOWN' })
								},
								on: { RESOURCES_STOPPED: { target: 'stopped' } }
							},
							stopped: { type: 'final' }
						}
					},
					creation: {
						initial: 'checking',
						states: {
							checking: {
								always: (args) => {
									if (args.guards.creationAlive(args)) {
										return { target: 'stopping' }
									}
									return { target: 'stopped' }
								}
							},
							stopping: {
								entry: (args, enq) => {
									enq.sendTo('creation', { type: 'SHUTDOWN' })
								},
								on: { CREATION_STOPPED: { target: 'stopped' } }
							},
							stopped: { type: 'final' }
						}
					},

					startup: {
						initial: 'checking',
						states: {
							checking: {
								always: (args) => {
									if (args.guards.startupAlive(args)) {
										return { target: 'stopping' }
									}
									return { target: 'stopped' }
								}
							},
							stopping: {
								entry: (args, enq) => {
									enq.sendTo('startup', { type: 'SHUTDOWN' })
								},
								on: { STARTUP_STOPPED: { target: 'stopped' } }
							},
							stopped: { type: 'final' }
						}
					}
				},
				onDone: (args) => {
					if (matchesState({ closing: { intent: 'shutdown' } }, args.value)) {
						return { target: 'closed' }
					}
					return { target: 'failed' }
				}
			},
			failed: {
				tags: ['workspace-error'],
				on: {
					CREATION: {},
					SELECT_WORKSPACE: {},
					RETRY_NAVIGATION: {},
					OBSERVE_STARTUP: {},
					STARTUP_REQUESTED: {},
					OBSERVE_NAVIGATION: {},
					NAVIGATION_REQUESTED: {},
					INITIALIZATION_STATUS: {},
					INITIALIZATION_PENDING: {},
					SHUTDOWN: { target: 'closed' },
					BANK: {},
					OBSERVED: {},
					REEVALUATE: {},
					RETRY: {},
					OBSERVE_INTEGRITY: {},
					INTEGRITY_REQUESTED: {},
					OBSERVE_CREATION: {},
					RETRY_INTEGRITY: {}
				}
			},
			closed: {
				type: 'final',
				entry: (args, enq) => {
					const { self } = args
					enq.sendTo(args.parent, { type: 'WORKSPACE_CLOSED', actor: self })
				}
			}
		}
	})
}

export type WorkspaceCoordinatorSnapshot = SnapshotFrom<
	ReturnType<typeof createWorkspaceReadinessMachine>
>
export type WorkspaceCoordinatorActor = ActorRefFrom<
	ReturnType<typeof createWorkspaceReadinessMachine>
>
export function selectWorkspaceView(snapshot: WorkspaceCoordinatorSnapshot | undefined) {
	return {
		bankRevision: snapshot?.context.bankAccess?.revision,
		ready: snapshot?.matches({ active: { session: 'ready' } }) === true,
		failed: snapshot?.hasTag('workspace-error') ?? false,
		canRetry: snapshot?.hasTag('workspace-retryable') ?? false,
		canSync:
			snapshot?.can({
				type: 'BANK',
				lease: snapshot.context.resourceLease,
				event: { type: 'SYNC' }
			}) ?? false,
		resourceLease: snapshot?.matches({ active: { resources: 'bound' } })
			? snapshot.context.resourceLease
			: undefined,
		navigation: snapshot?.context.navigationReport?.status ?? 'waiting',
		creation: snapshot?.context.creationView ?? unavailableWorkspaceCreationView,
		integrity: selectWorkspaceIntegrityView(snapshot?.context.integrityReport)
	}
}
/** Public actor reference for integration subscriptions; bank workflow internals stay encapsulated. */
export function workspaceBankActor(snapshot: WorkspaceCoordinatorSnapshot) {
	return snapshot.matches({ active: { resources: 'bound' } })
		? selectedResourceBankActor(snapshot.context.resourceActor?.getSnapshot())
		: undefined
}
