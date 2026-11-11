import type { ActorFromLogic } from 'xstate'
import type { JazzClient, JazzSession } from 'jazz-tools/svelte'
import type { MutationErrorEvent } from 'jazz-tools'
import type { TransferWriteTracking } from '../transfers/internal-transfer.js'
import {
	createInternalTransferMutationOwner,
	rejectedTransferMutation,
	type TransferMutationRequest
} from '../transfers/internal-transfer-mutation-owner.js'
import {
	createSessionStartupMachine,
	createSessionReadinessMachine
} from 'delightful-local-first/session/workflow'
import type {
	SessionReadinessBinding,
	SessionReadinessScope,
	SessionReadinessReport,
	SessionObservationFailure,
	SessionStatus,
	SessionStartupReport
} from 'delightful-local-first/session/contracts'
import type { JazzStartupBinding } from '#lib/runtime/jazz-session.js'
import {
	createWorkspaceReadinessMachine,
	type WorkspaceAttachment,
	type ReadinessObservation
} from './readiness.js'
import type {
	WorkspaceLease,
	WorkspaceDrainRequest,
	WorkspaceSelectionRequest
} from 'delightful-local-first/workspace/contracts'
import {
	createWorkspaceSelectionAttachmentMachine,
	type WorkspaceSelectionBinding,
	type WorkspaceSelectionAttachmentReport
} from './workspace-selection-attachment.js'
import {
	createWorkspaceSelectionDrainMachine,
	transferScopeForWorkspaceLease,
	type WorkspaceSelectionDrainOutput
} from './workspace-selection-drain.js'
import {
	sameWorkspaceLease,
	type SelectedResourceOutput
} from '../../contracts/workspace-selected-resources.js'
import {
	retainResourceRelease,
	type WorkspaceResourceRelease
} from '../../contracts/workspace-resource-release.js'
import {
	workspaceSelectionTarget,
	workspaceSelectionObservation
} from './workspace-selection-observation.js'
import type { TransferMutationScope } from '../../contracts/transfer-scope-drain.js'
import type { TransferMutationRequestInput } from '../transfers/internal-transfer-mutation-request.js'
import { required } from '../bank-sync/identity.js'
import {
	sessionRecoveryMachine,
	type RecoveryNotice,
	type RecoveryRequest,
	type RecoveryResult,
	type RecoveryRestorationBinding
} from '../identity/session-recovery.js'

import {
	createWorkspaceRestoreController,
	selectWorkspaceRestoreReport,
	emptyWorkspaceRestoreView,
	bindWorkspaceRestoreFile,
	workspaceRestoreSessionReady,
	workspaceRestoreFileAvailable,
	type WorkspaceRestoreConfiguration,
	type WorkspaceRestoreFile,
	type WorkspaceRestoreCommand,
	type WorkspaceRestoreView
} from '../workspaces/workspace-restore.js'
import { createCallbackLogic, setup, types, createAsyncLogic, matchesState } from 'xstate'
import type { ActorRefFrom, SnapshotFrom, DoneActorEvent } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'

type Session = JazzSession<JazzClient>
type Workspace = ActorFromLogic<ReturnType<typeof createWorkspaceReadinessMachine>>
type Status = SessionStatus
export type MutationNotice =
	| { kind: 'generic'; transactionId: string }
	| {
			kind: 'transfer'
			operation: TransferWriteTracking['operation']
			transactionId: string
			transferId: string
	  }
type StartupAttachment = JazzStartupBinding & {
	replyTo: import('xstate').ActorRefFrom<ReturnType<typeof createSessionStartupMachine<Session>>>
}
type Context = {
	workspaceRestoreView: WorkspaceRestoreView
	workspaceRestoreRequest: WorkspaceRestoreFile | undefined
	restoreConfiguration: WorkspaceRestoreConfiguration | undefined
	startupRetirement: StartupAttachment | undefined
	selectionBinding: WorkspaceSelectionBinding | undefined
	selectionRevision: number
	selectionLease: WorkspaceLease | undefined
	transferScope: TransferMutationScope | undefined
	transferLease: WorkspaceLease | undefined
	transferGeneration: number
	selectionRequest: WorkspaceSelectionRequest | undefined
	selectionAttempt: number
	selectionGeneration: number
	selectionStatus:
		'waiting' | 'selected' | 'denied' | 'unavailable' | 'failed' | 'suspended' | 'drainFailed'
	selectionFacts: ReadinessObservation | undefined
	selectionDrain: WorkspaceDrainRequest | undefined
	handledDrains: WeakSet<object>
	drainActor: ActorFromLogic<ReturnType<typeof createWorkspaceSelectionDrainMachine>> | undefined
	resourceResult: SelectedResourceOutput | undefined
	cleanupRelease: WorkspaceResourceRelease
	attachmentRevision: number
	recoveryDraftRevision: number
	recoveryAttempt: number
	recoveryRequest: RecoveryRequest | undefined
	recoveryResult: RecoveryResult | undefined
	preparingSession: Session | undefined
	session: Session | undefined
	startupBinding: StartupAttachment | undefined
	readinessScope: SessionReadinessScope | undefined
	observation: number
	retryAttempt: number
	observationFailure: SessionObservationFailure | undefined
	status: Status
	workspace: Workspace | undefined
	attachment: WorkspaceAttachment | undefined
	pending: WorkspaceAttachment | undefined
	trackedTransferWrites: TransferWriteTracking[]
	mutationNotice: MutationNotice | undefined
	transferMutationOwnerClosed: boolean
}
type Event =
	| { type: 'WORKSPACE_RESTORE'; request: WorkspaceRestoreFile }
	| { type: 'WORKSPACE_RESTORE_COMMAND'; command: WorkspaceRestoreCommand }
	| WorkspaceSelectionAttachmentReport
	| DoneActorEvent<WorkspaceSelectionDrainOutput | { selectedResources: WorkspaceResourceRelease }>
	| {
			type: 'WORKSPACE_SELECTION_OBSERVED'
			attachment: WorkspaceAttachment
			observation: ReadinessObservation
	  }
	| { type: 'SELECTED_RESOURCES_RELEASED'; result: SelectedResourceOutput }
	| { type: 'SELECTED_RESOURCES_CRASHED'; lease: WorkspaceLease }
	| { type: 'CLEANUP_FAILED' }
	| { type: 'RESOURCE_OWNER_FAILED' }
	| RecoveryNotice
	| SessionStartupReport<Session>
	| SessionReadinessReport
	| { type: 'RECOVER'; phrase: string; origin: string; destination: string }
	| { type: 'RETRY_NAVIGATION' }
	| { type: 'START'; startup: JazzStartupBinding }
	| { type: 'STARTUP_RELEASED' }
	| { type: 'READINESS_RELEASED' }
	| { type: 'STARTUP_UNAVAILABLE' }
	| { type: 'RETRY' }
	| { type: 'RELOAD' | 'RELOAD_REQUIRED' }
	| { type: 'ACQUIRED_STATUS'; status: Status; afterRetry: number | undefined }
	| { type: 'OBSERVATION_UNAVAILABLE' }
	| { type: 'MUTATION_REJECTED'; transactionId: string }
	| { type: 'TRANSFER_WRITE_TRACKED'; write: TransferWriteTracking }
	| { type: 'TRANSFER_MUTATION_REQUEST'; request: TransferMutationRequest }
	| { type: 'CANCEL_TRANSFER_MUTATION'; requestId: string }
	| { type: 'WORKSPACE_SCOPE_OBSERVED'; workspaceId: string | undefined }
	| { type: 'TRANSFER_MUTATION_OWNER_CLOSED' }
	| { type: 'DISMISS_MUTATION_REJECTION' }
	| { type: 'ATTACH_WORKSPACE'; attachment: WorkspaceAttachment }
	| { type: 'DETACH_WORKSPACE'; attachment: WorkspaceAttachment }
	| { type: 'WORKSPACE_CLOSED'; actor: unknown }
	| { type: 'ATTACH_PENDING' }
	| { type: 'SHUTDOWN' }
	| import('xstate').ErrorActorEvent

function workspaceReleased(context: Context) {
	return (
		!context.workspace &&
		!context.selectionBinding &&
		!context.drainActor &&
		context.cleanupRelease.outcome !== 'unresolved'
	)
}
function applicationResourcesReleased(context: Context) {
	return workspaceReleased(context) && !context.workspaceRestoreView.busy
}

function currentSelectionScope(context: Context, scope: WorkspaceLease['scope']) {
	return (
		context.selectionBinding?.scope.binding === scope.binding &&
		context.selectionBinding.scope.attachment === scope.attachment
	)
}

/** Layout-owned factories bind acquired session capabilities; Finance owns domain coordination. */
export function createApplicationReadinessMachine(
	navigation: {
		readHref: () => string
		navigate: (destination: string) => Promise<void>
		reload?: () => void
	} = {
		readHref: () => '',
		navigate: async () => {
			throw new Error('Navigation unavailable')
		}
	},
	bindRestoration?: (session: Session) => RecoveryRestorationBinding,
	bindReadiness?: (session: Session) => SessionReadinessBinding,
	restoreConfiguration?: WorkspaceRestoreConfiguration,
	prepareSession: (session: Session) => Promise<void> = async () => {}
) {
	const actors = {
		reload: createAsyncLogic<void>({
			run: () => Promise.resolve().then(() => required(navigation.reload)())
		}),
		workspaceRestore: createWorkspaceRestoreController(navigation.navigate),
		recovery: sessionRecoveryMachine,
		selectionAttachment: createWorkspaceSelectionAttachmentMachine(),
		transferMutationOwner: createInternalTransferMutationOwner(),
		startup: createSessionStartupMachine<Session>(),
		sessionReadiness: createSessionReadinessMachine(),
		prepareLocalFirst: createAsyncLogic<void, Session>({
			run: ({ input }) => prepareSession(input)
		}),
		bindSessionReadiness: createAsyncLogic({
			run: ({ input }: { input: Session }) =>
				Promise.resolve({ session: input, readiness: required(bindReadiness)(input) })
		}),
		observeMutationRejections: createCallbackLogic<Event, Session>(({ input, sendBack }) => {
			const db = input.getSnapshot().client?.db
			if (!db) return
			return db.onMutationError((rejection) => {
				sendBack({
					type: 'MUTATION_REJECTED',
					transactionId: rejection.transaction.transactionId
				})
			})
		})
	}
	const patchRefreshAttachment = ({ context }: { context: Context }): Partial<Context> => ({
		attachmentRevision: context.attachmentRevision + 1,
		pending: undefined
	})
	const events0 = {
		WORKSPACE_RESTORE: types<EventPayload<Event, 'WORKSPACE_RESTORE'>>(),
		WORKSPACE_RESTORE_COMMAND: types<EventPayload<Event, 'WORKSPACE_RESTORE_COMMAND'>>(),
		WORKSPACE_SELECTION: types<EventPayload<Event, 'WORKSPACE_SELECTION'>>(),
		WORKSPACE_SCOPE_INVALIDATED: types<EventPayload<Event, 'WORKSPACE_SCOPE_INVALIDATED'>>(),
		WORKSPACE_DRAIN_REQUESTED: types<EventPayload<Event, 'WORKSPACE_DRAIN_REQUESTED'>>(),
		WORKSPACE_DRAIN_FAILED: types<EventPayload<Event, 'WORKSPACE_DRAIN_FAILED'>>(),
		WORKSPACE_SELECTION_ATTACHED: types<EventPayload<Event, 'WORKSPACE_SELECTION_ATTACHED'>>(),
		WORKSPACE_SELECTION_RELEASED: types<EventPayload<Event, 'WORKSPACE_SELECTION_RELEASED'>>(),
		WORKSPACE_SELECTION_ATTACHMENT_FAILED:
			types<EventPayload<Event, 'WORKSPACE_SELECTION_ATTACHMENT_FAILED'>>(),
		WORKSPACE_SELECTION_OBSERVED: types<EventPayload<Event, 'WORKSPACE_SELECTION_OBSERVED'>>(),
		SELECTED_RESOURCES_RELEASED: types<EventPayload<Event, 'SELECTED_RESOURCES_RELEASED'>>(),
		SELECTED_RESOURCES_CRASHED: types<EventPayload<Event, 'SELECTED_RESOURCES_CRASHED'>>(),
		CLEANUP_FAILED: types<EventPayload<Event, 'CLEANUP_FAILED'>>(),
		RESOURCE_OWNER_FAILED: types<EventPayload<Event, 'RESOURCE_OWNER_FAILED'>>(),
		RECOVERY_VALIDATED: types<EventPayload<Event, 'RECOVERY_VALIDATED'>>(),
		RECOVERY_DRAIN_REQUESTED: types<EventPayload<Event, 'RECOVERY_DRAIN_REQUESTED'>>(),
		SESSION_STARTING: types<EventPayload<Event, 'SESSION_STARTING'>>(),
		SESSION_STARTUP_FAILED: types<EventPayload<Event, 'SESSION_STARTUP_FAILED'>>(),
		SESSION_ACQUIRED: types<EventPayload<Event, 'SESSION_ACQUIRED'>>(),
		SESSION_STATUS: types<EventPayload<Event, 'SESSION_STATUS'>>(),
		SESSION_OBSERVATION_FAILED: types<EventPayload<Event, 'SESSION_OBSERVATION_FAILED'>>(),
		SESSION_OBSERVATION_CLEANUP_FAILED:
			types<EventPayload<Event, 'SESSION_OBSERVATION_CLEANUP_FAILED'>>(),
		SESSION_RETRY_STARTED: types<EventPayload<Event, 'SESSION_RETRY_STARTED'>>(),
		SESSION_RETRY_SETTLED: types<EventPayload<Event, 'SESSION_RETRY_SETTLED'>>(),
		RECOVER: types<EventPayload<Event, 'RECOVER'>>(),
		RETRY_NAVIGATION: types<EventPayload<Event, 'RETRY_NAVIGATION'>>(),
		START: types<EventPayload<Event, 'START'>>(),
		STARTUP_RELEASED: types<EventPayload<Event, 'STARTUP_RELEASED'>>(),
		READINESS_RELEASED: types<EventPayload<Event, 'READINESS_RELEASED'>>(),
		STARTUP_UNAVAILABLE: types<EventPayload<Event, 'STARTUP_UNAVAILABLE'>>(),
		RETRY: types<EventPayload<Event, 'RETRY'>>(),
		RELOAD: types<EventPayload<Event, 'RELOAD'>>(),
		RELOAD_REQUIRED: types<EventPayload<Event, 'RELOAD_REQUIRED'>>(),
		ACQUIRED_STATUS: types<EventPayload<Event, 'ACQUIRED_STATUS'>>(),
		OBSERVATION_UNAVAILABLE: types<EventPayload<Event, 'OBSERVATION_UNAVAILABLE'>>(),
		MUTATION_REJECTED: types<EventPayload<Event, 'MUTATION_REJECTED'>>(),
		TRANSFER_WRITE_TRACKED: types<EventPayload<Event, 'TRANSFER_WRITE_TRACKED'>>(),
		TRANSFER_MUTATION_REQUEST: types<EventPayload<Event, 'TRANSFER_MUTATION_REQUEST'>>(),
		CANCEL_TRANSFER_MUTATION: types<EventPayload<Event, 'CANCEL_TRANSFER_MUTATION'>>(),
		WORKSPACE_SCOPE_OBSERVED: types<EventPayload<Event, 'WORKSPACE_SCOPE_OBSERVED'>>(),
		TRANSFER_MUTATION_OWNER_CLOSED: types<EventPayload<Event, 'TRANSFER_MUTATION_OWNER_CLOSED'>>(),
		DISMISS_MUTATION_REJECTION: types<EventPayload<Event, 'DISMISS_MUTATION_REJECTION'>>(),
		ATTACH_WORKSPACE: types<EventPayload<Event, 'ATTACH_WORKSPACE'>>(),
		DETACH_WORKSPACE: types<EventPayload<Event, 'DETACH_WORKSPACE'>>(),
		WORKSPACE_CLOSED: types<EventPayload<Event, 'WORKSPACE_CLOSED'>>(),
		ATTACH_PENDING: types<EventPayload<Event, 'ATTACH_PENDING'>>(),
		SHUTDOWN: types<EventPayload<Event, 'SHUTDOWN'>>()
	}
	type NativeEvent0 =
		| import('xstate').InferEvents<typeof events0>
		| import('xstate').DoneActorEvent<
				| import('xstate').OutputFrom<(typeof actors)['reload']>
				| import('xstate').OutputFrom<(typeof actors)['workspaceRestore']>
				| import('xstate').OutputFrom<(typeof actors)['recovery']>
				| import('xstate').OutputFrom<(typeof actors)['selectionAttachment']>
				| import('xstate').OutputFrom<(typeof actors)['transferMutationOwner']>
				| import('xstate').OutputFrom<(typeof actors)['startup']>
				| import('xstate').OutputFrom<(typeof actors)['sessionReadiness']>
				| import('xstate').OutputFrom<(typeof actors)['prepareLocalFirst']>
				| import('xstate').OutputFrom<(typeof actors)['bindSessionReadiness']>
				| import('xstate').OutputFrom<(typeof actors)['observeMutationRejections']>
				| import('xstate').OutputFrom<(typeof actors)['observeMutationRejections']>
		  >
		| import('xstate').ErrorActorEvent
	const workflow = setup({
		schemas: {
			context: types<Context>(),
			events: events0,
			children: {
				reload: types<import('xstate').ActorFromLogic<(typeof actors)['reload']>>(),
				workspaceRestore:
					types<import('xstate').ActorFromLogic<(typeof actors)['workspaceRestore']>>(),
				recovery: types<import('xstate').ActorFromLogic<(typeof actors)['recovery']>>(),
				selectionAttachment:
					types<import('xstate').ActorFromLogic<(typeof actors)['selectionAttachment']>>(),
				transferMutationOwner:
					types<import('xstate').ActorFromLogic<(typeof actors)['transferMutationOwner']>>(),
				startup: types<import('xstate').ActorFromLogic<(typeof actors)['startup']>>(),
				sessionReadiness:
					types<import('xstate').ActorFromLogic<(typeof actors)['sessionReadiness']>>(),
				prepareLocalFirst:
					types<import('xstate').ActorFromLogic<(typeof actors)['prepareLocalFirst']>>(),
				bindSessionReadiness:
					types<import('xstate').ActorFromLogic<(typeof actors)['bindSessionReadiness']>>(),
				observeMutationRejections:
					types<import('xstate').ActorFromLogic<(typeof actors)['observeMutationRejections']>>(),
				mutationRejectionObserver:
					types<import('xstate').ActorFromLogic<(typeof actors)['observeMutationRejections']>>(),
				workspace:
					types<
						import('xstate').ActorFromLogic<ReturnType<typeof createWorkspaceReadinessMachine>>
					>(),
				workspaceDrain:
					types<
						import('xstate').ActorFromLogic<ReturnType<typeof createWorkspaceSelectionDrainMachine>>
					>()
			}
		},
		actors,
		actions: {},
		guards: {
			cleanupPending: ({ context }: { context: Context }) =>
				context.cleanupRelease.outcome === 'unresolved',
			currentReadiness: ({ context, event }: { context: Context; event: NativeEvent0 }) =>
				'scope' in event &&
				event.scope.binding === context.readinessScope?.binding &&
				event.scope.attachment === context.readinessScope.attachment,
			currentStartup: ({ context, event }: { context: Context; event: NativeEvent0 }) =>
				(event.type === 'SESSION_STARTING' ||
					event.type === 'SESSION_ACQUIRED' ||
					event.type === 'SESSION_STARTUP_FAILED') &&
				event.scope.binding === context.startupBinding?.scope.binding &&
				event.scope.attachment === context.startupBinding.scope.attachment &&
				event.scope.generation === context.startupBinding.scope.generation,
			shuttingDown: (args: { value: import('xstate').StateValue }) =>
				matchesState('closing', args.value) ||
				matchesState('releasingStartup', args.value) ||
				matchesState('releasingReadiness', args.value) ||
				matchesState({ running: { retrying: 'closing' } }, args.value) ||
				matchesState({ running: { recovering: 'closing' } }, args.value)
		}
	})
	// These states retain the parent's issued retry while its observer and workspace drain.
	const retryDrain = workflow.createStateConfig({
		entry: (
			args: {
				context: Context
				children: {
					workspaceRestore?: import('xstate').ActorRefFrom<typeof actors.workspaceRestore>
					recovery?: import('xstate').ActorRefFrom<typeof actors.recovery>
				}
			},
			enq
		) => {
			let context = args.context
			let patch = {}
			{
				const contextBefore = args.context
				{
					const contextBefore = context
					const child = args.children.workspaceRestore
					if (child?.getSnapshot().status === 'active') enq.sendTo(child, { type: 'DRAIN' })
					else if (contextBefore.workspaceRestoreView.busy) enq.raise({ type: 'CLEANUP_FAILED' })
				}
				patch = { ...patch, ...((assignedArgs) => ({ pending: undefined }))({ ...args, context }) }
				context = { ...args.context, ...patch }
				{
					const contextBefore = context
					patch = {
						...patch,
						...((assignedArgs) => ({ selectionLease: undefined, selectionRequest: undefined }))({
							...args,
							context
						})
					}
					context = { ...args.context, ...patch }
					if (contextBefore.selectionBinding)
						enq.sendTo('selectionAttachment', {
							type: 'DETACH',
							binding: contextBefore.selectionBinding
						})
					if (contextBefore.workspace?.getSnapshot().matches('active')) {
						enq.sendTo(contextBefore.workspace, {
							type: 'SELECTION',
							lease: undefined,
							status: 'suspended'
						})
					}
				}
				if (contextBefore.workspace?.getSnapshot().status === 'active')
					enq.sendTo(contextBefore.workspace, { type: 'SHUTDOWN' })
			}
			return { context: patch }
		},
		on: {
			ACQUIRED_STATUS: {},
			OBSERVATION_UNAVAILABLE: {},
			ATTACH_WORKSPACE: {},
			ATTACH_PENDING: {},
			RECOVER: {},
			RETRY_NAVIGATION: {},
			RETRY: {},
			START: {}
		}
	})
	const recoveryDrain = workflow.createStateConfig({
		entry: (
			args: {
				context: Context
				children: {
					workspaceRestore?: import('xstate').ActorRefFrom<typeof actors.workspaceRestore>
					recovery?: import('xstate').ActorRefFrom<typeof actors.recovery>
				}
			},
			enq
		) => {
			let context = args.context
			const { children } = args
			let patch = {}
			{
				const contextBefore = args.context
				{
					const contextBefore = context
					const child = children.workspaceRestore
					if (child?.getSnapshot().status === 'active') enq.sendTo(child, { type: 'DRAIN' })
					else if (contextBefore.workspaceRestoreView.busy) enq.raise({ type: 'CLEANUP_FAILED' })
				}
				patch = { ...patch, ...((assignedArgs) => ({ pending: undefined }))({ ...args, context }) }
				context = { ...args.context, ...patch }
				{
					const contextBefore = context
					patch = {
						...patch,
						...((assignedArgs) => ({ selectionLease: undefined, selectionRequest: undefined }))({
							...args,
							context
						})
					}
					context = { ...args.context, ...patch }
					if (contextBefore.selectionBinding)
						enq.sendTo('selectionAttachment', {
							type: 'DETACH',
							binding: contextBefore.selectionBinding
						})
					if (contextBefore.workspace?.getSnapshot().matches('active')) {
						enq.sendTo(contextBefore.workspace, {
							type: 'SELECTION',
							lease: undefined,
							status: 'suspended'
						})
					}
				}
				if (contextBefore.workspace?.getSnapshot().status === 'active')
					enq.sendTo(contextBefore.workspace, { type: 'SHUTDOWN' })
			}
			{
				const child = children.recovery
				if (child?.getSnapshot().status === 'active') enq.sendTo(child, { type: 'SHUTDOWN' })
			}
			return { context: patch }
		},
		on: {
			ACQUIRED_STATUS: {},
			OBSERVATION_UNAVAILABLE: {},
			ATTACH_WORKSPACE: {},
			ATTACH_PENDING: {},
			RECOVERY_DRAIN_REQUESTED: {},
			RECOVERY_VALIDATED: {},
			START: {},
			RETRY: {},
			RECOVER: {},
			RETRY_NAVIGATION: {}
		}
	})
	return workflow.createMachine({
		id: 'application-readiness',
		initial: 'waitingForStartup',
		context: () => ({
			workspaceRestoreView: { ...emptyWorkspaceRestoreView },
			workspaceRestoreRequest: undefined,
			restoreConfiguration,
			startupRetirement: undefined,
			selectionBinding: undefined,
			selectionRevision: -1,
			selectionLease: undefined,
			transferScope: undefined,
			transferLease: undefined,
			transferGeneration: 0,
			selectionRequest: undefined,
			selectionAttempt: 0,
			selectionGeneration: 0,
			selectionStatus: 'waiting',
			selectionFacts: undefined,
			selectionDrain: undefined,
			handledDrains: new WeakSet(),
			drainActor: undefined,
			resourceResult: undefined,
			cleanupRelease: { outcome: 'released' },
			attachmentRevision: 0,
			recoveryDraftRevision: 0,
			recoveryAttempt: 0,
			recoveryRequest: undefined,
			recoveryResult: undefined,
			preparingSession: undefined,
			session: undefined,
			startupBinding: undefined,
			readinessScope: undefined,
			observation: 0,
			retryAttempt: 0,
			observationFailure: undefined,
			status: 'transitioning',
			workspace: undefined,
			attachment: undefined,
			pending: undefined,
			trackedTransferWrites: [],
			mutationNotice: undefined,
			transferMutationOwnerClosed: false
		}),
		invoke: [
			{
				id: 'workspaceRestore',
				src: 'workspaceRestore',
				onSnapshot: (args, enq) => {
					let context = args.context
					let patch = {}
					{
						const contextBefore = args.context
						const report = selectWorkspaceRestoreReport(args.event.snapshot)
						if (report.request !== contextBefore.workspaceRestoreRequest) {
						} else {
							patch = { ...patch, workspaceRestoreView: report.view }
							context = { ...args.context, ...patch }
							if (!report.view.busy && contextBefore.startupRetirement) {
								enq.sendTo(contextBefore.startupRetirement.owner, {
									type: 'RELEASE',
									scope: contextBefore.startupRetirement.scope,
									replyTo: contextBefore.startupRetirement.replyTo
								})
								patch = { ...patch, startupRetirement: undefined }
								context = { ...args.context, ...patch }
							}
						}
					}
					return { context: patch }
				},
				onError: (args) => {
					return {
						target: '.reloadRecovery',
						context: {
							workspaceRestoreView: {
								...args.context.workspaceRestoreView,
								busy: true,
								editable: false,
								canCancel: false,
								canRetryRelease: false,
								canConfirm: false,
								canOpen: false,
								canReload: true,
								alert: true,
								message: 'failed',
								visibleOutsideSettings: true
							}
						}
					}
				}
			},
			{
				id: 'startup',
				src: 'startup',
				input: ({ self }) => ({ reportTo: self }),
				onDone: (args, enq) => {
					if (args.guards.cleanupPending(args)) {
						enq.raise({ type: 'STARTUP_RELEASED' })
						return {}
					}
					if (
						matchesState('closing', args.value) ||
						matchesState('releasingStartup', args.value) ||
						matchesState('releasingReadiness', args.value) ||
						matchesState({ running: { retrying: 'closing' } }, args.value) ||
						matchesState({ running: { recovering: 'closing' } }, args.value)
					) {
						enq.raise({ type: 'STARTUP_RELEASED' })
						return {}
					}
					return { target: '.settlingStartupFailure' }
				},
				onError: (args, enq) => {
					const { self } = args
					if (args.guards.cleanupPending(args)) {
						let context = args.context
						let patch = {}
						{
							const contextBefore = args.context
							if (contextBefore.workspaceRestoreView.busy && contextBefore.startupBinding) {
								patch = { ...patch, startupRetirement: contextBefore.startupBinding }
								context = { ...args.context, ...patch }
								enq.sendTo('workspaceRestore', { type: 'DRAIN' })
							} else {
								if (contextBefore.startupBinding) {
									enq.sendTo(contextBefore.startupBinding.owner, {
										type: 'RELEASE',
										scope: contextBefore.startupBinding.scope,
										replyTo: contextBefore.startupBinding.replyTo
									})
								}
							}
						}
						enq.raise({ type: 'STARTUP_RELEASED' })
						return { context: patch }
					}
					if (args.guards.shuttingDown(args)) {
						let context = args.context
						let patch = {}
						{
							const contextBefore = args.context
							if (contextBefore.workspaceRestoreView.busy && contextBefore.startupBinding) {
								patch = { ...patch, startupRetirement: contextBefore.startupBinding }
								context = { ...args.context, ...patch }
								enq.sendTo('workspaceRestore', { type: 'DRAIN' })
							} else {
								if (contextBefore.startupBinding) {
									enq.sendTo(contextBefore.startupBinding.owner, {
										type: 'RELEASE',
										scope: contextBefore.startupBinding.scope,
										replyTo: contextBefore.startupBinding.replyTo
									})
								}
							}
						}
						enq.raise({ type: 'STARTUP_RELEASED' })
						return { context: patch }
					}
					{
						let context = args.context
						let patch = {}
						{
							const contextBefore = args.context
							if (contextBefore.workspaceRestoreView.busy && contextBefore.startupBinding) {
								patch = { ...patch, startupRetirement: contextBefore.startupBinding }
								context = { ...args.context, ...patch }
								enq.sendTo('workspaceRestore', { type: 'DRAIN' })
							} else {
								if (contextBefore.startupBinding) {
									enq.sendTo(contextBefore.startupBinding.owner, {
										type: 'RELEASE',
										scope: contextBefore.startupBinding.scope,
										replyTo: contextBefore.startupBinding.replyTo
									})
								}
							}
						}
						return { target: '.settlingStartupFailure', context: patch }
					}
				}
			},
			{
				id: 'sessionReadiness',
				src: 'sessionReadiness',
				input: ({ self }) => ({ reportTo: self }),
				onDone: (args, enq) => {
					if (args.guards.cleanupPending(args)) {
						enq.raise({ type: 'READINESS_RELEASED' })
						return {}
					}
					if (
						matchesState('closing', args.value) ||
						matchesState('releasingReadiness', args.value) ||
						matchesState('releasingStartup', args.value) ||
						matchesState('settlingStartupFailure', args.value) ||
						matchesState('startupActorFailed', args.value) ||
						matchesState({ running: { retrying: 'closing' } }, args.value) ||
						matchesState({ running: { retrying: 'startupFailed' } }, args.value) ||
						matchesState({ running: { recovering: 'closing' } }, args.value) ||
						matchesState({ running: { recovering: 'startupFailed' } }, args.value)
					) {
						enq.raise({ type: 'READINESS_RELEASED' })
						return {}
					}
					return { target: '.settlingReadinessCrash' }
				},
				onError: (args, enq) => {
					if (args.guards.cleanupPending(args)) {
						enq.raise({ type: 'READINESS_RELEASED' })
						return {}
					}
					if (
						matchesState('closing', args.value) ||
						matchesState('releasingStartup', args.value) ||
						matchesState('releasingReadiness', args.value) ||
						matchesState({ running: { retrying: 'closing' } }, args.value) ||
						matchesState({ running: { recovering: 'closing' } }, args.value)
					) {
						enq.raise({ type: 'READINESS_RELEASED' })
						return {}
					}
					return { target: '.settlingReadinessCrash' }
				}
			},
			{
				id: 'selectionAttachment',
				src: 'selectionAttachment',
				input: ({ self }) => ({ reportTo: self }),
				onError: (args, enq) => {
					enq.raise({ type: 'CLEANUP_FAILED' })
				}
			},
			{
				id: 'transferMutationOwner',
				src: 'transferMutationOwner',
				onDone: (args, enq) => {
					if (
						(matchesState('closing', args.value) ||
							matchesState('releasingStartup', args.value) ||
							matchesState('releasingReadiness', args.value) ||
							matchesState({ running: { retrying: 'closing' } }, args.value) ||
							matchesState({ running: { recovering: 'closing' } }, args.value)) &&
						args.event.output.outcome === 'closed'
					) {
						return { context: { transferMutationOwnerClosed: true } }
					}
					enq.raise({ type: 'CLEANUP_FAILED' })
					return {}
				},
				onError: (args, enq) => {
					const { context } = args
					if (context.drainActor?.getSnapshot().status === 'active' && context.selectionDrain)
						enq.sendTo(context.drainActor, {
							type: 'TRANSFER_OWNER_CRASHED',
							drain: context.selectionDrain
						})
					enq.raise({ type: 'CLEANUP_FAILED' })
				}
			}
		],
		on: {
			WORKSPACE_RESTORE: (args, enq) => {
				const { context, event } = args
				if (
					matchesState({ running: 'ready' }, args.value) &&
					context.restoreConfiguration !== undefined &&
					!context.workspaceRestoreView.busy &&
					workspaceRestoreSessionReady(context.session) &&
					workspaceRestoreFileAvailable(event.request)
				) {
					enq(
						({ context, event }) =>
							bindWorkspaceRestoreFile(
								event.request,
								required(context.session),
								required(context.restoreConfiguration)
							),
						args
					)
					enq.sendTo('workspaceRestore', { type: 'SUBMIT', request: event.request })
					return {
						context: {
							workspaceRestoreRequest: event.request,
							workspaceRestoreView: {
								...emptyWorkspaceRestoreView,
								busy: true,
								editable: false,
								canCancel: true,
								message: 'preparing',
								visibleOutsideSettings: true
							}
						}
					}
				}
				enq(({ context, event }) => {
					if (context.workspaceRestoreRequest !== event.request) event.request.release()
				}, args)
				return {}
			},
			WORKSPACE_RESTORE_COMMAND: (args, enq) => {
				const { context, event } = args
				if (
					event.command.type === 'RELOAD' &&
					(matchesState('reloadRecovery', args.value) || context.workspaceRestoreView.canReload)
				) {
					enq.raise({ type: 'RELOAD' })
					return {}
				}
				if (
					matchesState({ running: 'ready' }, args.value) &&
					(event.command.type === 'CONFIRM' || event.command.type === 'OPEN') &&
					context.workspaceRestoreView.identityId === context.session?.getSnapshot().account?.id &&
					workspaceRestoreSessionReady(context.session)
				) {
					enq.sendTo('workspaceRestore', event.command)
					return {}
				}
				if (
					event.command.type !== 'CONFIRM' &&
					event.command.type !== 'OPEN' &&
					event.command.type !== 'RELOAD'
				) {
					enq.sendTo('workspaceRestore', event.command)
					return {}
				}
			},
			RELOAD: { target: '.reloadRecovery.reloading' },
			RELOAD_REQUIRED: { target: '.reloadRecovery' },
			'xstate.error.actor': (args, enq) => {
				return ((args, enq) => {
					const { context, event } = args
					if (context.drainActor?.id === event.actorId) {
						if (context.selectionBinding && context.selectionDrain)
							enq.sendTo('selectionAttachment', {
								type: 'SELECTION_COMMAND',
								binding: context.selectionBinding,
								command: {
									type: 'DRAIN_FAILED',
									drain: context.selectionDrain,
									outcome: 'unresolved'
								}
							})
						enq.raise({ type: 'CLEANUP_FAILED' })
						return {}
					}
					if (event.actorId === 'workspace') {
						let context = args.context
						let patch = {}
						patch = { ...patch, ...((args) => ({ pending: undefined }))(args) }
						context = { ...args.context, ...patch }
						{
							const contextBefore = context
							{
								const contextBefore = context
								patch = {
									...patch,
									...((assignedArgs) => ({
										selectionLease: undefined,
										selectionRequest: undefined
									}))({ ...args, context })
								}
								context = { ...args.context, ...patch }
								if (contextBefore.selectionBinding)
									enq.sendTo('selectionAttachment', {
										type: 'DETACH',
										binding: contextBefore.selectionBinding
									})
								if (contextBefore.workspace?.getSnapshot().matches('active')) {
									enq.sendTo(contextBefore.workspace, {
										type: 'SELECTION',
										lease: undefined,
										status: 'suspended'
									})
								}
							}
							if (event.type === 'xstate.error.actor') {
								patch = {
									...patch,
									...((assignedArgs) => ({ cleanupRelease: { outcome: 'unresolved' } }))({
										...args,
										context
									})
								}
								context = { ...args.context, ...patch }
								if (
									contextBefore.drainActor?.getSnapshot().status === 'active' &&
									contextBefore.selectionDrain
								)
									enq.sendTo(contextBefore.drainActor, {
										type: 'SELECTED_RESOURCES_CRASHED',
										lease: contextBefore.selectionDrain.lease
									})
								enq.raise({ type: 'CLEANUP_FAILED' })
							}
							enq.stop(required(contextBefore.workspace))
							patch = {
								...patch,
								...((assignedArgs) => ({ workspace: undefined, attachment: undefined }))({
									...args,
									context
								})
							}
							context = { ...args.context, ...patch }
							enq.raise({ type: 'ATTACH_PENDING' })
						}
						return { target: '.settlingObserverFailure', context: patch }
					}
					return undefined
				})(args, enq)
			},
			START: {},
			RETRY: {},
			STARTUP_RELEASED: {},
			READINESS_RELEASED: {},
			SESSION_STATUS: (args, enq) => {
				const { event } = args
				if (!(
					args.guards.currentReadiness(args) &&
					(event.type === 'SESSION_STATUS' || event.type === 'SESSION_OBSERVATION_FAILED') &&
					event.observation === args.context.observation
				))
					return
				enq.raise({
					type: 'ACQUIRED_STATUS',
					status: event.status,
					afterRetry: event.afterRetry
				})
			},
			SESSION_OBSERVATION_FAILED: (args, enq) => {
				const { event } = args
				if (!(
					args.guards.currentReadiness(args) &&
					event.type === 'SESSION_OBSERVATION_FAILED' &&
					event.observation === args.context.observation
				))
					return
				enq.raise({ type: 'OBSERVATION_UNAVAILABLE' })
				return { context: { observationFailure: event.reason } }
			},
			SESSION_OBSERVATION_CLEANUP_FAILED: {},
			SESSION_RETRY_STARTED: {},
			SESSION_RETRY_SETTLED: {},
			ACQUIRED_STATUS: (args) => {
				return { context: { status: args.event.status } }
			},
			OBSERVATION_UNAVAILABLE: {},
			SESSION_STARTING: {},
			SESSION_ACQUIRED: {},
			SESSION_STARTUP_FAILED: (args, enq) => {
				if (!args.guards.currentStartup(args)) return
				enq.raise({ type: 'STARTUP_UNAVAILABLE' })
			},
			STARTUP_UNAVAILABLE: { target: '.settlingStartupFailure' },
			TRANSFER_MUTATION_REQUEST: (args, enq) => {
				const { event } = args
				if (
					matchesState({ running: 'ready' }, args.value) &&
					(({ context, event }) => {
						const scope = contextTransferScope(context, event.request)
						return (
							scope !== undefined &&
							event.request.scope !== undefined &&
							scope.binding === event.request.scope.binding &&
							scope.workspaceId === event.request.scope.workspaceId &&
							scope.generation === event.request.scope.generation
						)
					})(args)
				) {
					enq.sendTo('transferMutationOwner', {
						type: 'REQUEST_TRANSFER_MUTATION',
						request: event.request
					})
					return {}
				}
				enq(() =>
					event.request.recipient.send({
						type: 'TRANSFER_MUTATION_RESULT',
						requestId: event.request.requestId,
						result: rejectedTransferMutation(event.request)
					})
				)
				return {}
			},
			CANCEL_TRANSFER_MUTATION: (args, enq) => {
				const { event } = args
				enq.sendTo('transferMutationOwner', event)
			},
			WORKSPACE_SCOPE_OBSERVED: {},
			TRANSFER_MUTATION_OWNER_CLOSED: () => {
				return { context: { transferMutationOwnerClosed: true } }
			},
			SHUTDOWN: () => {
				return { target: '.closing', context: { pending: undefined } }
			},
			ATTACH_WORKSPACE: (args, enq) => {
				const { context, event } = args
				if (context.attachment === event.attachment || context.pending === event.attachment) {
					return {}
				}
				if (Boolean(context.workspace || context.selectionBinding || context.drainActor)) {
					let context = args.context
					let patch = {}
					patch = {
						...patch,
						...((args) => ({ pending: (({ event }) => event.attachment)(args) }))(args)
					}
					context = { ...args.context, ...patch }
					{
						const contextBefore = context
						patch = { ...patch, selectionLease: undefined, selectionRequest: undefined }
						context = { ...args.context, ...patch }
						if (contextBefore.selectionBinding)
							enq.sendTo('selectionAttachment', {
								type: 'DETACH',
								binding: contextBefore.selectionBinding
							})
						if (contextBefore.workspace?.getSnapshot().matches('active')) {
							enq.sendTo(contextBefore.workspace, {
								type: 'SELECTION',
								lease: undefined,
								status: 'suspended'
							})
						}
					}
					{
						const contextBefore = context
						if (contextBefore.workspace?.getSnapshot().status === 'active')
							enq.sendTo(contextBefore.workspace, { type: 'SHUTDOWN' })
					}
					return { context: patch }
				}
				if (context.cleanupRelease.outcome !== 'unresolved') {
					let context = args.context
					let patch = {}
					patch = {
						...patch,
						...((args) => ({ pending: (({ event }) => event.attachment)(args) }))(args)
					}
					context = { ...args.context, ...patch }
					{
						const contextBefore = context
						if (contextBefore.selectionRevision >= Number.MAX_SAFE_INTEGER) {
							enq.raise({ type: 'CLEANUP_FAILED' })
						} else {
							const attachment = required(contextBefore.pending)
							const binding: WorkspaceSelectionBinding = {
								scope: { binding: attachment.dependencies.db, attachment: {} },
								revision: contextBefore.selectionRevision + 1
							}
							patch = {
								...patch,
								...(({ spawn }) => ({
									attachment,
									workspace: spawn(createWorkspaceReadinessMachine(attachment), {
										id: 'workspace'
									}),
									pending: undefined,
									selectionBinding: binding,
									selectionRevision: binding.revision,
									selectionLease: undefined,
									transferScope: undefined,
									transferLease: undefined,
									selectionRequest: undefined,
									selectionAttempt: 0,
									selectionGeneration: 0,
									selectionStatus: 'waiting',
									selectionFacts: undefined,
									cleanupRelease: { outcome: 'released' },
									resourceResult: undefined
								}))({ ...args, context, spawn: enq.spawn })
							}
							context = { ...args.context, ...patch }
							enq.sendTo('selectionAttachment', { type: 'ATTACH', binding })
						}
					}
					return { context: patch }
				}
			},
			DETACH_WORKSPACE: (args, enq) => {
				const { context, event } = args
				if (context.pending === event.attachment) {
					return { context: ((args) => ({ pending: undefined }))(args) }
				}
				if (context.attachment === event.attachment) {
					let context = args.context
					let patch = {}
					{
						const contextBefore = args.context
						patch = { ...patch, selectionLease: undefined, selectionRequest: undefined }
						context = { ...args.context, ...patch }
						if (contextBefore.selectionBinding)
							enq.sendTo('selectionAttachment', {
								type: 'DETACH',
								binding: contextBefore.selectionBinding
							})
						if (contextBefore.workspace?.getSnapshot().matches('active')) {
							enq.sendTo(contextBefore.workspace, {
								type: 'SELECTION',
								lease: undefined,
								status: 'suspended'
							})
						}
					}
					{
						const contextBefore = context
						if (contextBefore.workspace?.getSnapshot().status === 'active')
							enq.sendTo(contextBefore.workspace, { type: 'SHUTDOWN' })
					}
					return { context: patch }
				}
			},
			WORKSPACE_CLOSED: {},
			ATTACH_PENDING: (args, enq) => {
				let context = args.context
				if (!(Boolean(context.pending) && workspaceReleased(context))) return
				let patch = {}
				{
					const contextBefore = args.context
					if (contextBefore.selectionRevision >= Number.MAX_SAFE_INTEGER) {
						enq.raise({ type: 'CLEANUP_FAILED' })
					} else {
						const attachment = required(contextBefore.pending)
						const binding: WorkspaceSelectionBinding = {
							scope: { binding: attachment.dependencies.db, attachment: {} },
							revision: contextBefore.selectionRevision + 1
						}
						patch = {
							...patch,
							...(({ spawn }) => ({
								attachment,
								workspace: spawn(createWorkspaceReadinessMachine(attachment), { id: 'workspace' }),
								pending: undefined,
								selectionBinding: binding,
								selectionRevision: binding.revision,
								selectionLease: undefined,
								transferScope: undefined,
								transferLease: undefined,
								selectionRequest: undefined,
								selectionAttempt: 0,
								selectionGeneration: 0,
								selectionStatus: 'waiting',
								selectionFacts: undefined,
								cleanupRelease: { outcome: 'released' },
								resourceResult: undefined
							}))({ ...args, context, spawn: enq.spawn })
						}
						context = { ...args.context, ...patch }
						enq.sendTo('selectionAttachment', { type: 'ATTACH', binding })
					}
				}
				return { context: patch }
			},
			RESOURCE_OWNER_FAILED: { target: '.settlingResourceFailure' },
			CLEANUP_FAILED: () => {
				return { target: '.cleanupFailed', context: { cleanupRelease: { outcome: 'unresolved' } } }
			},
			WORKSPACE_SELECTION_ATTACHED: (args, enq) => {
				const { context, event } = args
				if (!(
					event.binding.revision === context.selectionBinding?.revision &&
					currentSelectionScope(context, event.binding.scope)
				))
					return
				if (context.attachment)
					enq.raise({
						type: 'WORKSPACE_SELECTION_OBSERVED',
						attachment: context.attachment,
						observation: context.attachment.read()
					})
			},
			WORKSPACE_SELECTION_RELEASED: (args, enq) => {
				const { context, event } = args
				if (!(
					event.binding.revision === context.selectionBinding?.revision &&
					currentSelectionScope(context, event.binding.scope)
				))
					return
				enq.raise({ type: 'ATTACH_PENDING' })
				return { context: { selectionBinding: undefined, selectionLease: undefined } }
			},
			WORKSPACE_SELECTION_ATTACHMENT_FAILED: (args, enq) => {
				const { context, event } = args
				if (!(
					event.binding.revision === context.selectionBinding?.revision &&
					currentSelectionScope(context, event.binding.scope)
				))
					return
				enq.raise({ type: 'CLEANUP_FAILED' })
			},
			WORKSPACE_SELECTION_OBSERVED: (args, enq) => {
				let context = args.context
				const { event, self } = args
				if (!(
					context.attachment === event.attachment &&
					context.workspace?.getSnapshot().matches('active') === true &&
					context.selectionBinding !== undefined &&
					context.cleanupRelease.outcome !== 'unresolved'
				))
					return
				let patch = {}
				{
					const contextBefore = args.context
					if (
						!self
							.getSnapshot()
							.children.selectionAttachment?.getSnapshot()
							.matches({ holding: 'active' })
					) {
					} else {
						if (event.type !== 'WORKSPACE_SELECTION_OBSERVED')
							throw new Error('Unexpected selection event')
						if (
							contextBefore.selectionFacts &&
							contextBefore.selectionFacts.source.userId !== event.observation.source.userId
						) {
							patch = {
								...patch,
								...((assignedArgs) => ({ pending: event.attachment }))({ ...args, context })
							}
							context = { ...args.context, ...patch }
							{
								const contextBefore = context
								patch = {
									...patch,
									...((assignedArgs) => ({
										selectionLease: undefined,
										selectionRequest: undefined
									}))({ ...args, context })
								}
								context = { ...args.context, ...patch }
								if (contextBefore.selectionBinding)
									enq.sendTo('selectionAttachment', {
										type: 'DETACH',
										binding: contextBefore.selectionBinding
									})
								if (contextBefore.workspace?.getSnapshot().matches('active')) {
									enq.sendTo(contextBefore.workspace, {
										type: 'SELECTION',
										lease: undefined,
										status: 'suspended'
									})
								}
							}
							enq.sendTo(required(contextBefore.workspace), { type: 'SHUTDOWN' })
						} else {
							const binding = required(contextBefore.selectionBinding)
							const target = workspaceSelectionTarget(event.observation)
							patch = {
								...patch,
								...((assignedArgs) => ({ selectionFacts: event.observation }))({ ...args, context })
							}
							context = { ...args.context, ...patch }
							enq.sendTo(required(contextBefore.workspace), {
								type: 'OBSERVED',
								observation: event.observation
							})
							if (
								contextBefore.selectionGeneration >= Number.MAX_SAFE_INTEGER ||
								contextBefore.selectionAttempt >= Number.MAX_SAFE_INTEGER
							) {
								enq.raise({ type: 'CLEANUP_FAILED' })
							} else {
								if (!target) {
									patch = {
										...patch,
										...((assignedArgs) => ({
											selectionLease: undefined,
											selectionRequest: undefined
										}))({ ...args, context })
									}
									context = { ...args.context, ...patch }
									enq.sendTo('selectionAttachment', {
										type: 'SELECTION_COMMAND',
										binding,
										command: { type: 'SUSPEND', scope: binding.scope }
									})
								} else {
									const changed = target !== contextBefore.selectionRequest?.workspaceId
									const request = changed
										? { workspaceId: target, attempt: contextBefore.selectionAttempt + 1 }
										: required(contextBefore.selectionRequest)
									const generation = contextBefore.selectionGeneration + 1
									patch = {
										...patch,
										...((assignedArgs) => ({
											selectionRequest: request,
											selectionAttempt: request.attempt,
											selectionGeneration: generation
										}))({ ...args, context })
									}
									context = { ...args.context, ...patch }
									if (changed) {
										patch = {
											...patch,
											...((assignedArgs) => ({ selectionLease: undefined }))({ ...args, context })
										}
										context = { ...args.context, ...patch }
										enq.sendTo('selectionAttachment', {
											type: 'SELECTION_COMMAND',
											binding,
											command: { type: 'SELECT', scope: binding.scope, request }
										})
									}
									enq.sendTo('selectionAttachment', {
										type: 'SELECTION_COMMAND',
										binding,
										command: {
											type: contextBefore.selectionStatus === 'suspended' ? 'RESUME' : 'OBSERVED',
											observation: workspaceSelectionObservation(
												event.observation,
												binding.scope,
												request,
												generation
											)
										}
									})
								}
							}
						}
					}
				}
				return { context: patch }
			},
			WORKSPACE_SELECTION: (args, enq) => {
				let context = args.context
				const { event, self } = args
				if (!(
					currentSelectionScope(
						context,
						event.status === 'selected' ? event.lease.scope : event.scope
					) &&
					(event.status === 'selected' ||
						(event.status === 'suspended' && !context.selectionLease) ||
						(event.request?.workspaceId === context.selectionRequest?.workspaceId &&
							event.request?.attempt === context.selectionRequest?.attempt)) &&
					(event.status !== 'selected' ||
						(event.lease.request.workspaceId === context.selectionRequest?.workspaceId &&
							event.lease.request.attempt === context.selectionRequest.attempt &&
							context.selectionFacts !== undefined &&
							workspaceSelectionTarget(context.selectionFacts) ===
								event.lease.request.workspaceId &&
							workspaceSelectionObservation(
								context.selectionFacts,
								event.lease.scope,
								event.lease.request,
								0
							).access === 'allowed'))
				))
					return
				let patch = {}
				{
					const contextBefore = args.context
					if (
						!self
							.getSnapshot()
							.children.selectionAttachment?.getSnapshot()
							.matches({ holding: 'active' })
					) {
					} else {
						if (event.type !== 'WORKSPACE_SELECTION') throw new Error('Unexpected selection event')
						if (event.status === 'selected') {
							if (
								!contextBefore.workspace?.getSnapshot().matches('active') ||
								contextBefore.pending ||
								contextBefore.cleanupRelease.outcome === 'unresolved'
							) {
							} else {
								if (
									!contextBefore.selectionLease ||
									!sameWorkspaceLease(contextBefore.selectionLease, event.lease)
								) {
									if (contextBefore.transferGeneration >= Number.MAX_SAFE_INTEGER) {
										enq.raise({ type: 'CLEANUP_FAILED' })
									} else {
										const scope = {
											...transferScopeForWorkspaceLease(event.lease),
											generation: contextBefore.transferGeneration + 1
										}
										patch = {
											...patch,
											transferScope: scope,
											transferLease: event.lease,
											transferGeneration: scope.generation
										}
										context = { ...args.context, ...patch }
										enq.sendTo('transferMutationOwner', { type: 'BIND_TRANSFER_SCOPE', scope })
										patch = { ...patch, resourceResult: undefined }
										context = { ...args.context, ...patch }
										patch = { ...patch, selectionLease: event.lease, selectionStatus: event.status }
										context = { ...args.context, ...patch }
										enq.sendTo(contextBefore.workspace, {
											type: 'SELECTION',
											status: event.status,
											lease: event.lease
										})
									}
								} else {
									patch = { ...patch, selectionLease: event.lease, selectionStatus: event.status }
									context = { ...args.context, ...patch }
									enq.sendTo(contextBefore.workspace, {
										type: 'SELECTION',
										status: event.status,
										lease: event.lease
									})
								}
							}
						} else {
							patch = { ...patch, selectionLease: undefined, selectionStatus: event.status }
							context = { ...args.context, ...patch }
							if (contextBefore.workspace?.getSnapshot().status === 'active')
								enq.sendTo(contextBefore.workspace, {
									type: 'SELECTION',
									status: event.status,
									lease: undefined
								})
							if (
								event.status === 'suspended' &&
								contextBefore.attachment &&
								contextBefore.workspace?.getSnapshot().matches('active')
							)
								enq.raise({
									type: 'WORKSPACE_SELECTION_OBSERVED',
									attachment: contextBefore.attachment,
									observation: contextBefore.attachment.read()
								})
						}
					}
				}
				return { context: patch }
			},
			WORKSPACE_SCOPE_INVALIDATED: (args, enq) => {
				let context = args.context
				const { event } = args
				if (!(
					currentSelectionScope(context, event.lease.scope) &&
					context.transferLease !== undefined &&
					sameWorkspaceLease(context.transferLease, event.lease)
				))
					return
				let patch = {}
				patch = { ...patch, selectionLease: undefined }
				context = { ...args.context, ...patch }
				{
					const contextBefore = context
					if (contextBefore.workspace?.getSnapshot().status === 'active')
						enq.sendTo(contextBefore.workspace, {
							type: 'SELECTION',
							lease: undefined,
							status: 'waiting'
						})
				}
				return { context: patch }
			},
			WORKSPACE_DRAIN_REQUESTED: (args, enq) => {
				const { context, event } = args
				if (!(
					currentSelectionScope(context, event.drain.lease.scope) &&
					!context.drainActor &&
					!context.handledDrains.has(event.drain.token) &&
					(!context.transferLease || event.drain.lease.epoch >= context.transferLease.epoch)
				))
					return
				enq(() => {
					context.handledDrains.add(event.drain.token)
				})
				return {
					context: (({ context, event, self, spawn }) => {
						if (event.type !== 'WORKSPACE_DRAIN_REQUESTED')
							throw new Error('Unexpected selection event')
						const workspace = context.workspace?.getSnapshot().context
						const owner =
							workspace?.resourceLease &&
							sameWorkspaceLease(workspace.resourceLease, event.drain.lease)
								? workspace.resourceActor
								: undefined
						const snapshot = owner?.getSnapshot()
						const actual =
							snapshot?.status === 'done'
								? snapshot.output
								: (workspace?.resourceResult ?? context.resourceResult)
						const transfers = required(self.getSnapshot().children.transferMutationOwner)
						const transferOwned =
							context.transferLease !== undefined &&
							sameWorkspaceLease(context.transferLease, event.drain.lease)
						const transferSnapshot = transfers.getSnapshot()
						const transferRelease: WorkspaceResourceRelease = !transferOwned
							? { outcome: 'released' }
							: transferSnapshot.status === 'done' && transferSnapshot.output.outcome === 'closed'
								? { outcome: 'released' }
								: { outcome: 'unresolved' }
						const release =
							actual && sameWorkspaceLease(actual.lease, event.drain.lease)
								? retainResourceRelease(context.cleanupRelease, actual.release)
								: context.cleanupRelease
						return {
							selectionDrain: event.drain,
							cleanupRelease: snapshot?.status === 'error' ? { outcome: 'unresolved' } : release,
							drainActor: spawn(createWorkspaceSelectionDrainMachine(), {
								input: {
									drain: event.drain,
									resources: snapshot?.status === 'active' ? owner : undefined,
									resourceRelease:
										snapshot?.status === 'error'
											? { outcome: 'unresolved' }
											: actual && sameWorkspaceLease(actual.lease, event.drain.lease)
												? actual.release
												: { outcome: 'released' },
									...(context.transferScope ? { transferScope: context.transferScope } : {}),
									transfers:
										transferOwned && transferSnapshot.status === 'active' ? transfers : undefined,
									transferRelease:
										transferOwned && transferSnapshot.status === 'active'
											? { outcome: 'released' }
											: transferRelease
								},
								id: 'workspaceDrain'
							})
						}
					})({ ...args, spawn: enq.spawn })
				}
			},
			SELECTED_RESOURCES_RELEASED: (args, enq) => {
				let context = args.context
				const { event } = args
				if (!(
					currentSelectionScope(context, event.result.lease.scope) &&
					context.transferLease !== undefined &&
					sameWorkspaceLease(context.transferLease, event.result.lease)
				))
					return
				let patch = {}
				{
					const contextBefore = args.context
					if (event.type !== 'SELECTED_RESOURCES_RELEASED')
						throw new Error('Unexpected selection event')
					patch = {
						...patch,
						...((assignedArgs) => ({
							resourceResult: event.result,
							cleanupRelease: retainResourceRelease(
								contextBefore.cleanupRelease,
								event.result.release
							)
						}))({ ...args, context })
					}
					context = { ...args.context, ...patch }
					if (
						contextBefore.drainActor?.getSnapshot().status === 'active' &&
						contextBefore.selectionDrain &&
						sameWorkspaceLease(contextBefore.selectionDrain.lease, event.result.lease)
					)
						enq.sendTo(contextBefore.drainActor, event)
					else if (
						contextBefore.selectionLease &&
						contextBefore.selectionFacts &&
						sameWorkspaceLease(contextBefore.selectionLease, event.result.lease) &&
						workspaceSelectionObservation(
							contextBefore.selectionFacts,
							event.result.lease.scope,
							event.result.lease.request,
							0
						).access === 'allowed'
					) {
						patch = {
							...patch,
							...((assignedArgs) => ({
								selectionLease: undefined,
								cleanupRelease: retainResourceRelease(contextBefore.cleanupRelease, {
									outcome:
										event.result.release.outcome === 'unresolved'
											? 'unresolved'
											: 'releasedWithFailure'
								})
							}))({ ...args, context })
						}
						context = { ...args.context, ...patch }
						enq.raise({ type: 'RESOURCE_OWNER_FAILED' })
					}
					if (event.result.release.outcome === 'unresolved') enq.raise({ type: 'CLEANUP_FAILED' })
				}
				return { context: patch }
			},
			SELECTED_RESOURCES_CRASHED: (args, enq) => {
				let context = args.context
				const { event } = args
				if (!(
					currentSelectionScope(context, event.lease.scope) &&
					context.transferLease !== undefined &&
					sameWorkspaceLease(context.transferLease, event.lease)
				))
					return
				let patch = {}
				{
					const contextBefore = args.context
					if (event.type !== 'SELECTED_RESOURCES_CRASHED')
						throw new Error('Unexpected selection event')
					patch = {
						...patch,
						resourceResult: {
							lease: event.lease,
							drain: undefined,
							release: { outcome: 'unresolved' }
						}
					}
					context = { ...args.context, ...patch }
					if (contextBefore.drainActor?.getSnapshot().status === 'active')
						enq.sendTo(contextBefore.drainActor, event)
					enq.raise({ type: 'CLEANUP_FAILED' })
				}
				return { context: patch }
			},
			'xstate.done.actor': (args, enq) => {
				return ((args, enq) => {
					const { context, event } = args
					if (event.actorId === 'workspace' && 'selectedResources' in event.output) {
						let context = args.context
						let patch = {}
						{
							const contextBefore = args.context
							if (!('output' in event) || !('selectedResources' in event.output))
								throw new Error('Missing workspace completion')
							patch = {
								...patch,
								...((assignedArgs) => ({
									cleanupRelease: retainResourceRelease(
										contextBefore.cleanupRelease,
										event.output.selectedResources
									)
								}))({ ...args, context })
							}
							context = { ...args.context, ...patch }
							{
								const contextBefore = context
								{
									const contextBefore = context
									patch = {
										...patch,
										...((assignedArgs) => ({
											selectionLease: undefined,
											selectionRequest: undefined
										}))({ ...args, context })
									}
									context = { ...args.context, ...patch }
									if (contextBefore.selectionBinding)
										enq.sendTo('selectionAttachment', {
											type: 'DETACH',
											binding: contextBefore.selectionBinding
										})
									if (contextBefore.workspace?.getSnapshot().matches('active')) {
										enq.sendTo(contextBefore.workspace, {
											type: 'SELECTION',
											lease: undefined,
											status: 'suspended'
										})
									}
								}
								enq.stop(required(contextBefore.workspace))
								patch = {
									...patch,
									...((assignedArgs) => ({ workspace: undefined, attachment: undefined }))({
										...args,
										context
									})
								}
								context = { ...args.context, ...patch }
								enq.raise({ type: 'ATTACH_PENDING' })
							}
							if (event.output.selectedResources.outcome === 'unresolved')
								enq.raise({ type: 'CLEANUP_FAILED' })
						}
						return { context: patch }
					}
					if (
						event.actorId === 'workspaceDrain' &&
						'drain' in event.output &&
						context.selectionDrain !== undefined &&
						event.output.drain.token === context.selectionDrain.token &&
						sameWorkspaceLease(event.output.drain.lease, context.selectionDrain.lease)
					) {
						let context = args.context
						let patch = {}
						{
							const contextBefore = args.context
							if (!('output' in event) || !('drain' in event.output))
								throw new Error('Missing drain completion')
							const release = retainResourceRelease(
								contextBefore.cleanupRelease,
								event.output.release
							)
							enq.stop(required(contextBefore.drainActor))
							patch = {
								...patch,
								...((assignedArgs) => ({
									drainActor: undefined,
									selectionDrain: undefined,
									cleanupRelease: release
								}))({ ...args, context })
							}
							context = { ...args.context, ...patch }
							enq.sendTo('selectionAttachment', {
								type: 'SELECTION_COMMAND',
								binding: required(contextBefore.selectionBinding),
								command:
									release.outcome === 'released'
										? { type: 'DRAINED', drain: event.output.drain }
										: {
												type: 'DRAIN_FAILED',
												drain: event.output.drain,
												outcome: release.outcome === 'unresolved' ? 'unresolved' : 'released'
											}
							})
							if (release.outcome === 'unresolved') enq.raise({ type: 'CLEANUP_FAILED' })
						}
						return { context: patch }
					}
				})(args, enq)
			},
			WORKSPACE_DRAIN_FAILED: (args, enq) => {
				const { context, event } = args
				if (!(
					currentSelectionScope(context, event.drain.lease.scope) &&
					event.drain.token === context.selectionDrain?.token &&
					event.outcome === 'unresolved'
				))
					return
				enq.raise({ type: 'CLEANUP_FAILED' })
			}
		},
		states: {
			settlingResourceFailure: {
				entry: (args, enq) => {
					let context = args.context
					let patch = {}
					{
						const contextBefore = args.context
						{
							const contextBefore = context
							const child = args.children.workspaceRestore
							if (child?.getSnapshot().status === 'active') enq.sendTo(child, { type: 'DRAIN' })
							else if (contextBefore.workspaceRestoreView.busy)
								enq.raise({ type: 'CLEANUP_FAILED' })
						}
						patch = {
							...patch,
							...((assignedArgs) => ({ pending: undefined }))({ ...args, context })
						}
						context = { ...args.context, ...patch }
						{
							const contextBefore = context
							patch = {
								...patch,
								...((assignedArgs) => ({ selectionLease: undefined, selectionRequest: undefined }))(
									{ ...args, context }
								)
							}
							context = { ...args.context, ...patch }
							if (contextBefore.selectionBinding)
								enq.sendTo('selectionAttachment', {
									type: 'DETACH',
									binding: contextBefore.selectionBinding
								})
							if (contextBefore.workspace?.getSnapshot().matches('active')) {
								enq.sendTo(contextBefore.workspace, {
									type: 'SELECTION',
									lease: undefined,
									status: 'suspended'
								})
							}
						}
						if (contextBefore.workspace?.getSnapshot().status === 'active')
							enq.sendTo(contextBefore.workspace, { type: 'SHUTDOWN' })
					}
					return { context: patch }
				},
				always: (args) => {
					const { context } = args
					if (!applicationResourcesReleased(context)) return
					return { target: 'resourceFailed' }
				},
				on: {
					ATTACH_WORKSPACE: {},
					ATTACH_PENDING: {},
					START: {},
					RETRY: {},
					RECOVER: {},
					RETRY_NAVIGATION: {},
					RESOURCE_OWNER_FAILED: {}
				}
			},
			resourceFailed: {
				tags: ['startup-error'],
				on: {
					RETRY: { target: 'running.preparingRetry' },
					ATTACH_WORKSPACE: {},
					ATTACH_PENDING: {},
					START: {},
					RECOVER: {},
					RETRY_NAVIGATION: {},
					RESOURCE_OWNER_FAILED: {}
				}
			},
			cleanupFailed: {
				tags: ['startup-error'],
				entry: (args, enq) => {
					let context = args.context
					const { self } = args
					let patch = {}
					{
						const contextBefore = args.context
						{
							const contextBefore = context
							const child = self.getSnapshot().children.workspaceRestore
							if (child?.getSnapshot().status === 'active') enq.sendTo(child, { type: 'DRAIN' })
							else if (contextBefore.workspaceRestoreView.busy)
								enq.raise({ type: 'CLEANUP_FAILED' })
						}
						patch = {
							...patch,
							...((assignedArgs) => ({ pending: undefined }))({ ...args, context })
						}
						context = { ...args.context, ...patch }
						{
							const contextBefore = context
							patch = {
								...patch,
								...((assignedArgs) => ({ selectionLease: undefined, selectionRequest: undefined }))(
									{ ...args, context }
								)
							}
							context = { ...args.context, ...patch }
							if (contextBefore.selectionBinding)
								enq.sendTo('selectionAttachment', {
									type: 'DETACH',
									binding: contextBefore.selectionBinding
								})
							if (contextBefore.workspace?.getSnapshot().matches('active')) {
								enq.sendTo(contextBefore.workspace, {
									type: 'SELECTION',
									lease: undefined,
									status: 'suspended'
								})
							}
						}
						if (contextBefore.workspace?.getSnapshot().status === 'active')
							enq.sendTo(contextBefore.workspace, { type: 'SHUTDOWN' })
					}
					{
						const owner = self.getSnapshot().children.transferMutationOwner
						if (owner?.getSnapshot().status === 'active') enq.sendTo(owner, { type: 'SHUTDOWN' })
					}
					return { context: patch }
				},
				on: {
					START: {},
					RETRY: {},
					RECOVER: {},
					RETRY_NAVIGATION: {},
					ATTACH_WORKSPACE: {},
					ATTACH_PENDING: {},
					CLEANUP_FAILED: {},
					RESOURCE_OWNER_FAILED: {},
					STARTUP_UNAVAILABLE: {},
					OBSERVATION_UNAVAILABLE: {},
					ACQUIRED_STATUS: {}
				}
			},
			reloadRecovery: {
				tags: ['startup-error'],
				initial: 'required',
				on: {
					RELOAD_REQUIRED: {},
					SHUTDOWN: {},
					START: {},
					RECOVER: {},
					ATTACH_WORKSPACE: {},
					ATTACH_PENDING: {},
					CLEANUP_FAILED: {},
					RESOURCE_OWNER_FAILED: {},
					STARTUP_UNAVAILABLE: {},
					OBSERVATION_UNAVAILABLE: {},
					ACQUIRED_STATUS: {},
					'xstate.error.actor': (args, enq) => {
						return {}
					},
					'xstate.done.actor': (args, enq) => {
						return {}
					}
				},
				states: {
					required: { on: { RETRY: { target: 'reloading' } } },
					reloading: {
						invoke: {
							src: 'reload',
							onDone: { target: 'requested' },
							onError: { target: 'required' }
						},
						on: { RELOAD: {}, RETRY: {}, WORKSPACE_RESTORE_COMMAND: {} }
					},
					requested: { on: { RETRY: { target: 'reloading' } } }
				}
			},
			waitingForStartup: {
				on: {
					START: (args, enq) => {
						const { event } = args
						enq.sendTo('startup', { type: 'START', ...event.startup })
						return {
							target: 'opening',
							context: {
								startupBinding: { ...event.startup, replyTo: required(args.children.startup) }
							}
						}
					}
				}
			},
			opening: {
				on: {
					SESSION_ACQUIRED: (args) => {
						if (!args.guards.currentStartup(args)) return
						return {
							target: 'preparingLocalFirst',
							context: { preparingSession: args.event.session }
						}
					},
					SESSION_STARTUP_FAILED: (args) => {
						const { event } = args
						if (
							args.guards.currentStartup(args) &&
							event.type === 'SESSION_STARTUP_FAILED' &&
							event.reason === 'ownerFailed'
						) {
							return { target: 'settlingStartupFailure' }
						}
						if (args.guards.currentStartup(args)) {
							return { target: 'startupFailed' }
						}
					}
				}
			},
			preparingLocalFirst: {
				initial: 'active',
				states: { active: {}, stopping: {} },
				on: { SHUTDOWN: { target: '.stopping' }, ATTACH_WORKSPACE: {}, ATTACH_PENDING: {} },
				invoke: {
					src: 'prepareLocalFirst',
					input: ({ context }) => required(context.preparingSession),
					onDone: (args) => {
						if (matchesState({ preparingLocalFirst: 'stopping' }, args.value)) {
							return { target: 'closing' }
						}
						return { target: 'bindingReadiness' }
					},
					onError: (args) => {
						if (matchesState({ preparingLocalFirst: 'stopping' }, args.value)) {
							return { target: 'closing' }
						}
						return { target: 'settlingReadinessCrash' }
					}
				}
			},
			bindingReadiness: {
				invoke: {
					src: 'bindSessionReadiness',
					input: ({ context }) => required(context.preparingSession),
					onDone: (args, enq) => {
						let context = args.context
						const { event } = args
						let patch = {}
						patch = {
							...patch,
							session: event.output.session,
							preparingSession: undefined,
							readinessScope: { binding: event.output.readiness.binding, attachment: {} },
							observation: 0,
							retryAttempt: 0,
							observationFailure: undefined,
							status: 'transitioning'
						}
						context = { ...args.context, ...patch }
						enq.sendTo('sessionReadiness', {
							type: 'BIND',
							scope: required(context.readinessScope),
							capability: event.output.readiness.capability
						})
						return { target: 'running', context: patch }
					},
					onError: { target: 'settlingReadinessCrash' }
				},
				on: { ATTACH_WORKSPACE: {}, ATTACH_PENDING: {}, RETRY: {} }
			},
			startupFailed: {
				tags: ['startup-error'],
				on: {
					RETRY: (args, enq) => {
						const { context } = args
						if (!(
							context.startupBinding !== undefined &&
							context.startupBinding.scope.generation < Number.MAX_SAFE_INTEGER
						))
							return
						enq.sendTo('startup', { type: 'RETRY' })
						return {
							target: 'opening',
							context: {
								startupBinding: {
									...required(context.startupBinding),
									scope: {
										...required(context.startupBinding).scope,
										generation: required(context.startupBinding).scope.generation + 1
									}
								}
							}
						}
					}
				}
			},
			settlingStartupFailure: {
				entry: (args, enq) => {
					let context = args.context
					const { self } = args
					let patch = {}
					{
						const contextBefore = args.context
						{
							const contextBefore = context
							const child = self.getSnapshot().children.workspaceRestore
							if (child?.getSnapshot().status === 'active') enq.sendTo(child, { type: 'DRAIN' })
							else if (contextBefore.workspaceRestoreView.busy)
								enq.raise({ type: 'CLEANUP_FAILED' })
						}
						patch = {
							...patch,
							...((assignedArgs) => ({ pending: undefined }))({ ...args, context })
						}
						context = { ...args.context, ...patch }
						{
							const contextBefore = context
							patch = {
								...patch,
								...((assignedArgs) => ({ selectionLease: undefined, selectionRequest: undefined }))(
									{ ...args, context }
								)
							}
							context = { ...args.context, ...patch }
							if (contextBefore.selectionBinding)
								enq.sendTo('selectionAttachment', {
									type: 'DETACH',
									binding: contextBefore.selectionBinding
								})
							if (contextBefore.workspace?.getSnapshot().matches('active')) {
								enq.sendTo(contextBefore.workspace, {
									type: 'SELECTION',
									lease: undefined,
									status: 'suspended'
								})
							}
						}
						if (contextBefore.workspace?.getSnapshot().status === 'active')
							enq.sendTo(contextBefore.workspace, { type: 'SHUTDOWN' })
					}
					{
						const child = self.getSnapshot().children.sessionReadiness
						if (child?.getSnapshot().status === 'active') enq.sendTo(child, { type: 'SHUTDOWN' })
						else enq.raise({ type: 'READINESS_RELEASED' })
					}
					return { context: patch }
				},
				initial: 'releasingReadiness',
				states: {
					releasingReadiness: { on: { READINESS_RELEASED: { target: 'workspace' } } },
					workspace: {
						always: (args) => {
							const { context } = args
							if (!applicationResourcesReleased(context)) return
							return { target: '#application-readiness.startupActorFailed' }
						}
					}
				},
				on: { ATTACH_WORKSPACE: {}, ATTACH_PENDING: {}, RETRY: {}, START: {} }
			},
			startupActorFailed: {
				tags: ['startup-error'],
				on: {
					START: (args, enq) => {
						const { event } = args
						enq.raise(event)
						return {
							target: '#application-readiness',
							reenter: true,
							context: { session: undefined }
						}
					},
					RETRY: (args, enq) => {
						let context = args.context
						if (!(context.startupBinding !== undefined)) return
						let patch = {}
						patch = { ...patch, session: undefined }
						context = { ...args.context, ...patch }
						enq.raise({
							type: 'START',
							startup: {
								owner: required(context.startupBinding).owner,
								scope: {
									binding: required(context.startupBinding).scope.binding,
									attachment: {},
									generation: 0
								}
							}
						})
						return { target: '#application-readiness', reenter: true, context: patch }
					}
				}
			},
			settlingReadinessCrash: {
				entry: (args, enq) => {
					let context = args.context
					let patch = {}
					{
						const contextBefore = args.context
						{
							const contextBefore = context
							const child = args.children.workspaceRestore
							if (child?.getSnapshot().status === 'active') enq.sendTo(child, { type: 'DRAIN' })
							else if (contextBefore.workspaceRestoreView.busy)
								enq.raise({ type: 'CLEANUP_FAILED' })
						}
						patch = {
							...patch,
							...((assignedArgs) => ({ pending: undefined }))({ ...args, context })
						}
						context = { ...args.context, ...patch }
						{
							const contextBefore = context
							patch = {
								...patch,
								...((assignedArgs) => ({ selectionLease: undefined, selectionRequest: undefined }))(
									{ ...args, context }
								)
							}
							context = { ...args.context, ...patch }
							if (contextBefore.selectionBinding)
								enq.sendTo('selectionAttachment', {
									type: 'DETACH',
									binding: contextBefore.selectionBinding
								})
							if (contextBefore.workspace?.getSnapshot().matches('active')) {
								enq.sendTo(contextBefore.workspace, {
									type: 'SELECTION',
									lease: undefined,
									status: 'suspended'
								})
							}
						}
						if (contextBefore.workspace?.getSnapshot().status === 'active')
							enq.sendTo(contextBefore.workspace, { type: 'SHUTDOWN' })
					}
					return { context: patch }
				},
				always: (args) => {
					const { context } = args
					if (!applicationResourcesReleased(context)) return
					return { target: 'readinessCrashed' }
				},
				on: {
					ATTACH_WORKSPACE: {},
					ATTACH_PENDING: {},
					RETRY: {},
					START: {},
					OBSERVATION_UNAVAILABLE: {},
					ACQUIRED_STATUS: {},
					STARTUP_UNAVAILABLE: {}
				}
			},
			readinessCrashed: {
				tags: ['startup-error'],
				on: {
					RETRY: {},
					START: {},
					ATTACH_WORKSPACE: {},
					ATTACH_PENDING: {},
					OBSERVATION_UNAVAILABLE: {},
					ACQUIRED_STATUS: {},
					STARTUP_UNAVAILABLE: {}
				}
			},
			settlingObserverFailure: {
				entry: (args, enq) => {
					let context = args.context
					let patch = {}
					{
						const contextBefore = args.context
						{
							const contextBefore = context
							const child = args.children.workspaceRestore
							if (child?.getSnapshot().status === 'active') enq.sendTo(child, { type: 'DRAIN' })
							else if (contextBefore.workspaceRestoreView.busy)
								enq.raise({ type: 'CLEANUP_FAILED' })
						}
						patch = {
							...patch,
							...((assignedArgs) => ({ pending: undefined }))({ ...args, context })
						}
						context = { ...args.context, ...patch }
						{
							const contextBefore = context
							patch = {
								...patch,
								...((assignedArgs) => ({ selectionLease: undefined, selectionRequest: undefined }))(
									{ ...args, context }
								)
							}
							context = { ...args.context, ...patch }
							if (contextBefore.selectionBinding)
								enq.sendTo('selectionAttachment', {
									type: 'DETACH',
									binding: contextBefore.selectionBinding
								})
							if (contextBefore.workspace?.getSnapshot().matches('active')) {
								enq.sendTo(contextBefore.workspace, {
									type: 'SELECTION',
									lease: undefined,
									status: 'suspended'
								})
							}
						}
						if (contextBefore.workspace?.getSnapshot().status === 'active')
							enq.sendTo(contextBefore.workspace, { type: 'SHUTDOWN' })
					}
					return { context: patch }
				},
				always: (args) => {
					const { context } = args
					if (!applicationResourcesReleased(context)) return
					return { target: 'observerFailed' }
				},
				on: { ATTACH_WORKSPACE: {}, ATTACH_PENDING: {}, RETRY: {}, START: {} }
			},
			observerFailed: {
				tags: ['startup-error'],
				on: {
					RETRY: (args, enq) => {
						const { context } = args
						if (
							context.observationFailure !== undefined &&
							context.observation < Number.MAX_SAFE_INTEGER
						) {
							let context = args.context
							let patch = {}
							patch = {
								...patch,
								recoveryResult: undefined,
								observationFailure: undefined,
								observation: context.observation + 1,
								status: 'transitioning'
							}
							context = { ...args.context, ...patch }
							enq.sendTo('sessionReadiness', {
								type: 'REOBSERVE',
								scope: required(context.readinessScope),
								observation: context.observation
							})
							return { target: 'running', context: patch }
						}
						if (context.observationFailure === undefined) {
							return { target: 'running', context: { recoveryResult: undefined } }
						}
					},
					ATTACH_WORKSPACE: {},
					ATTACH_PENDING: {}
				}
			},
			running: {
				initial: 'checking',
				invoke: [
					{
						id: 'mutationRejectionObserver',
						src: 'observeMutationRejections',
						input: ({ context }) => required(context.session)
					}
				],
				on: {
					MUTATION_REJECTED: (args) => {
						return {
							context: (({ context, event }) => {
								const { transactionId } = event
								const tracked = context.trackedTransferWrites.find(
									(write) => write.transactionId === transactionId
								)
								return {
									trackedTransferWrites: context.trackedTransferWrites.filter(
										(write) => write.transactionId !== transactionId
									),
									mutationNotice: tracked
										? { kind: 'transfer', ...tracked }
										: { kind: 'generic', transactionId }
								}
							})(args)
						}
					},
					TRANSFER_WRITE_TRACKED: (args) => {
						return {
							context: (({ context, event }) => {
								const trackedTransferWrites = [
									...context.trackedTransferWrites.filter(
										(write) => write.transactionId !== event.write.transactionId
									),
									event.write
								].slice(-64)
								const notice = context.mutationNotice
								return {
									trackedTransferWrites,
									mutationNotice:
										notice?.kind === 'generic' && notice.transactionId === event.write.transactionId
											? { kind: 'transfer', ...event.write }
											: notice
								}
							})(args)
						}
					},
					DISMISS_MUTATION_REJECTION: () => {
						return { context: { mutationNotice: undefined } }
					},
					OBSERVATION_UNAVAILABLE: { target: '#application-readiness.settlingObserverFailure' },
					ACQUIRED_STATUS: (args) => {
						return { target: '.checking', context: { status: args.event.status } }
					},
					RETRY: () => {
						return { target: '.preparingRetry', context: { recoveryResult: undefined } }
					},
					RECOVER: (args) => {
						const { context, event } = args
						if (!(context.status === 'ready')) return
						return {
							target: '.recovering',
							context: {
								recoveryAttempt: context.recoveryAttempt + 1,
								recoveryResult: undefined,
								recoveryRequest: {
									kind: 'restore',
									phrase: event.phrase,
									origin: event.origin,
									destination: event.destination
								}
							}
						}
					},
					RETRY_NAVIGATION: (args) => {
						const { context } = args
						if (!(
							context.status === 'ready' &&
							context.recoveryResult?.outcome === 'navigationFailed' &&
							context.recoveryResult.navigation !== undefined
						))
							return
						return {
							target: '.recovering',
							context: {
								recoveryAttempt: context.recoveryAttempt + 1,
								recoveryRequest: (({ context }): RecoveryRequest => {
									const result = context.recoveryResult
									if (result?.outcome !== 'navigationFailed')
										throw new Error('Missing navigation retry')
									return { kind: 'navigate', ...required(result.navigation) }
								})(args),
								recoveryResult: undefined
							}
						}
					}
				},
				states: {
					checking: {
						always: (args) => {
							const { context } = args
							if (context.status === 'ready') {
								return { target: 'ready' }
							}
							if (context.status === 'error') {
								return { target: 'failed' }
							}
							if (context.status === 'signed-out') {
								return { target: 'signedOut' }
							}
							if (context.status === 'closed') {
								return { target: 'closed' }
							}
							return { target: 'transitioning' }
						}
					},
					ready: {},
					failed: { tags: ['startup-error'] },
					retryFailed: {
						tags: ['startup-error'],
						on: {
							ACQUIRED_STATUS: (args) => {
								return { context: { status: args.event.status } }
							},
							RECOVER: {},
							RETRY_NAVIGATION: {},
							ATTACH_WORKSPACE: {},
							ATTACH_PENDING: {}
						}
					},
					signedOut: {},
					closed: {},
					transitioning: {},
					preparingRetry: {
						entry: (args, enq) => {
							let context = args.context
							let patch = {}
							{
								const contextBefore = args.context
								{
									const contextBefore = context
									const child = args.children.workspaceRestore
									if (child?.getSnapshot().status === 'active') enq.sendTo(child, { type: 'DRAIN' })
									else if (contextBefore.workspaceRestoreView.busy)
										enq.raise({ type: 'CLEANUP_FAILED' })
								}
								patch = {
									...patch,
									...((assignedArgs) => ({ pending: undefined }))({ ...args, context })
								}
								context = { ...args.context, ...patch }
								{
									const contextBefore = context
									patch = {
										...patch,
										...((assignedArgs) => ({
											selectionLease: undefined,
											selectionRequest: undefined
										}))({ ...args, context })
									}
									context = { ...args.context, ...patch }
									if (contextBefore.selectionBinding)
										enq.sendTo('selectionAttachment', {
											type: 'DETACH',
											binding: contextBefore.selectionBinding
										})
									if (contextBefore.workspace?.getSnapshot().matches('active')) {
										enq.sendTo(contextBefore.workspace, {
											type: 'SELECTION',
											lease: undefined,
											status: 'suspended'
										})
									}
								}
								if (contextBefore.workspace?.getSnapshot().status === 'active')
									enq.sendTo(contextBefore.workspace, { type: 'SHUTDOWN' })
							}
							return { context: patch }
						},
						always: (args) => {
							const { context } = args
							if (!(
								applicationResourcesReleased(context) &&
								context.retryAttempt < Number.MAX_SAFE_INTEGER
							))
								return
							return { target: 'retrying' }
						},
						on: {
							START: {},
							RETRY: {},
							RECOVER: {},
							RETRY_NAVIGATION: {},
							ACQUIRED_STATUS: (args) => {
								return { context: { status: args.event.status } }
							},
							ATTACH_WORKSPACE: (args) => {
								return {
									context: ((args) => ({
										pending: (({ context, event }) =>
											event.type === 'ATTACH_WORKSPACE' ? event.attachment : context.pending)(args)
									}))(args)
								}
							},
							ATTACH_PENDING: {}
						}
					},
					retrying: {
						initial: 'active',
						entry: (args, enq) => {
							let context = args.context
							let patch = {}
							patch = { ...patch, retryAttempt: context.retryAttempt + 1 }
							context = { ...args.context, ...patch }
							enq.sendTo('sessionReadiness', {
								type: 'RETRY',
								scope: required(context.readinessScope),
								attempt: context.retryAttempt
							})
							return { context: patch }
						},
						on: {
							RESOURCE_OWNER_FAILED: { target: '.observerFailed' },
							CLEANUP_FAILED: () => {
								return {
									target: '.cleanupFailed',
									context: { cleanupRelease: { outcome: 'unresolved' } }
								}
							},
							SESSION_RETRY_SETTLED: (args) => {
								const { context, event } = args
								if (
									args.guards.currentReadiness(args) &&
									(event.type === 'SESSION_RETRY_SETTLED' ||
										event.type === 'SESSION_RETRY_STARTED') &&
									event.attempt === context.retryAttempt &&
									matchesState({ running: { retrying: 'cleanupFailed' } }, args.value)
								) {
									return { target: '#application-readiness.cleanupFailed' }
								}
								if (
									args.guards.currentReadiness(args) &&
									(event.type === 'SESSION_RETRY_SETTLED' ||
										event.type === 'SESSION_RETRY_STARTED') &&
									event.attempt === context.retryAttempt &&
									(matchesState('closing', args.value) ||
										matchesState('releasingStartup', args.value) ||
										matchesState('releasingReadiness', args.value) ||
										matchesState({ running: { retrying: 'closing' } }, args.value) ||
										matchesState({ running: { recovering: 'closing' } }, args.value))
								) {
									return {
										target: '#application-readiness.closing',
										context: patchRefreshAttachment(args)
									}
								}
								if (
									args.guards.currentReadiness(args) &&
									(event.type === 'SESSION_RETRY_SETTLED' ||
										event.type === 'SESSION_RETRY_STARTED') &&
									event.attempt === context.retryAttempt &&
									matchesState({ running: { retrying: 'startupFailed' } }, args.value)
								) {
									return {
										target: '#application-readiness.settlingStartupFailure',
										context: patchRefreshAttachment(args)
									}
								}
								if (
									args.guards.currentReadiness(args) &&
									(event.type === 'SESSION_RETRY_SETTLED' ||
										event.type === 'SESSION_RETRY_STARTED') &&
									event.attempt === context.retryAttempt &&
									matchesState({ running: { retrying: 'observerFailed' } }, args.value)
								) {
									return {
										target: '#application-readiness.settlingObserverFailure',
										context: patchRefreshAttachment(args)
									}
								}
								if (
									args.guards.currentReadiness(args) &&
									(event.type === 'SESSION_RETRY_SETTLED' ||
										event.type === 'SESSION_RETRY_STARTED') &&
									event.attempt === context.retryAttempt &&
									event.outcome === 'rejected'
								) {
									return {
										target: '#application-readiness.running.retryFailed',
										context: patchRefreshAttachment(args)
									}
								}
								if (
									args.guards.currentReadiness(args) &&
									(event.type === 'SESSION_RETRY_SETTLED' ||
										event.type === 'SESSION_RETRY_STARTED') &&
									event.attempt === context.retryAttempt
								) {
									return { target: '.awaitingStatus' }
								}
							},
							ATTACH_WORKSPACE: (args) => {
								return {
									context: ((args) => ({
										pending: (({ context, event }) =>
											event.type === 'ATTACH_WORKSPACE' ? event.attachment : context.pending)(args)
									}))(args)
								}
							},
							ATTACH_PENDING: {},
							START: {},
							RECOVER: {},
							RETRY_NAVIGATION: {},
							RETRY: {},
							ACQUIRED_STATUS: (args) => {
								return { context: { status: args.event.status } }
							},
							OBSERVATION_UNAVAILABLE: { target: '.observerFailed' },
							'xstate.error.actor': (args, enq) => {
								if (args.event.actorId === 'sessionReadiness')
									return { target: '#application-readiness.settlingReadinessCrash' }
								if (args.event.actorId === 'startup')
									return ((args, enq) => {
										let context = args.context
										let patch = {}
										{
											const contextBefore = args.context
											if (contextBefore.workspaceRestoreView.busy && contextBefore.startupBinding) {
												patch = { ...patch, startupRetirement: contextBefore.startupBinding }
												context = { ...args.context, ...patch }
												enq.sendTo('workspaceRestore', { type: 'DRAIN' })
											} else {
												if (contextBefore.startupBinding) {
													enq.sendTo(contextBefore.startupBinding.owner, {
														type: 'RELEASE',
														scope: contextBefore.startupBinding.scope,
														replyTo: contextBefore.startupBinding.replyTo
													})
												}
											}
										}
										return { target: '.startupFailed', context: patch }
									})(args, enq)
								return ((args, enq) => {
									let context = args.context
									const { event } = args
									if (!(event.actorId === 'workspace')) return
									let patch = {}
									{
										const contextBefore = args.context
										{
											const contextBefore = context
											patch = {
												...patch,
												...((assignedArgs) => ({
													selectionLease: undefined,
													selectionRequest: undefined
												}))({ ...args, context })
											}
											context = { ...args.context, ...patch }
											if (contextBefore.selectionBinding)
												enq.sendTo('selectionAttachment', {
													type: 'DETACH',
													binding: contextBefore.selectionBinding
												})
											if (contextBefore.workspace?.getSnapshot().matches('active')) {
												enq.sendTo(contextBefore.workspace, {
													type: 'SELECTION',
													lease: undefined,
													status: 'suspended'
												})
											}
										}
										if (event.type === 'xstate.error.actor') {
											patch = {
												...patch,
												...((assignedArgs) => ({ cleanupRelease: { outcome: 'unresolved' } }))({
													...args,
													context
												})
											}
											context = { ...args.context, ...patch }
											if (
												contextBefore.drainActor?.getSnapshot().status === 'active' &&
												contextBefore.selectionDrain
											)
												enq.sendTo(contextBefore.drainActor, {
													type: 'SELECTED_RESOURCES_CRASHED',
													lease: contextBefore.selectionDrain.lease
												})
											enq.raise({ type: 'CLEANUP_FAILED' })
										}
										enq.stop(required(contextBefore.workspace))
										patch = {
											...patch,
											...((assignedArgs) => ({ workspace: undefined, attachment: undefined }))({
												...args,
												context
											})
										}
										context = { ...args.context, ...patch }
										enq.raise({ type: 'ATTACH_PENDING' })
									}
									return { target: '.observerFailed', context: patch }
								})(args, enq)
							},
							STARTUP_UNAVAILABLE: { target: '.startupFailed' },
							SHUTDOWN: { target: '.closing' }
						},
						states: {
							active: {},
							awaitingStatus: {
								on: {
									SESSION_RETRY_SETTLED: {},
									ACQUIRED_STATUS: (args) => {
										let context = args.context
										const { event } = args
										if (!(event.afterRetry === context.retryAttempt)) return
										let patch = {}
										patch = { ...patch, status: event.status }
										context = { ...args.context, ...patch }
										patch = { ...patch, ...patchRefreshAttachment({ ...args, context }) }
										context = { ...args.context, ...patch }
										return { target: '#application-readiness.running.checking', context: patch }
									},
									OBSERVATION_UNAVAILABLE: (args) => {
										return {
											target: '#application-readiness.settlingObserverFailure',
											context: patchRefreshAttachment(args)
										}
									},
									STARTUP_UNAVAILABLE: (args) => {
										return {
											target: '#application-readiness.settlingStartupFailure',
											context: patchRefreshAttachment(args)
										}
									},
									'xstate.error.actor': (args, enq) => {
										if (!(args.event.actorId === 'startup')) return
										let context = args.context
										let patch = {}
										patch = { ...patch, ...((args) => patchRefreshAttachment(args))(args) }
										context = { ...args.context, ...patch }
										{
											const contextBefore = context
											if (contextBefore.workspaceRestoreView.busy && contextBefore.startupBinding) {
												patch = {
													...patch,
													...((assignedArgs) => ({
														startupRetirement: contextBefore.startupBinding
													}))({ ...args, context })
												}
												context = { ...args.context, ...patch }
												enq.sendTo('workspaceRestore', { type: 'DRAIN' })
											} else {
												if (contextBefore.startupBinding) {
													enq.sendTo(contextBefore.startupBinding.owner, {
														type: 'RELEASE',
														scope: contextBefore.startupBinding.scope,
														replyTo: contextBefore.startupBinding.replyTo
													})
												}
											}
										}
										return {
											target: '#application-readiness.settlingStartupFailure',
											context: patch
										}
									},
									SHUTDOWN: (args) => {
										return {
											target: '#application-readiness.closing',
											context: patchRefreshAttachment(args)
										}
									}
								}
							},
							cleanupFailed: {
								...retryDrain,
								on: {
									...retryDrain.on,
									STARTUP_UNAVAILABLE: {},
									OBSERVATION_UNAVAILABLE: {},
									CLEANUP_FAILED: {},
									RESOURCE_OWNER_FAILED: {},
									'xstate.error.actor': (args, enq) => {
										if (args.event.actorId === 'startup')
											return ((args, enq) => {
												let context = args.context
												let patch = {}
												{
													const contextBefore = args.context
													const child = args.children.startup
													if (
														contextBefore.workspaceRestoreView.busy &&
														contextBefore.startupBinding
													) {
														patch = { ...patch, startupRetirement: contextBefore.startupBinding }
														context = { ...args.context, ...patch }
														enq.sendTo('workspaceRestore', { type: 'DRAIN' })
													} else {
														if (contextBefore.startupBinding) {
															enq.sendTo(contextBefore.startupBinding.owner, {
																type: 'RELEASE',
																scope: contextBefore.startupBinding.scope,
																replyTo: contextBefore.startupBinding.replyTo
															})
														}
													}
												}
												return { context: patch }
											})(args, enq)
										if (args.event.actorId === 'sessionReadiness') return {}
									}
								}
							},
							observerFailed: retryDrain,
							startupFailed: {
								...retryDrain,
								entry: (args, enq) => {
									let context = args.context
									const { self } = args
									let patch = {}
									{
										const contextBefore = args.context
										{
											const contextBefore = context
											const child = self.getSnapshot().children.workspaceRestore
											if (child?.getSnapshot().status === 'active')
												enq.sendTo(child, { type: 'DRAIN' })
											else if (contextBefore.workspaceRestoreView.busy)
												enq.raise({ type: 'CLEANUP_FAILED' })
										}
										patch = {
											...patch,
											...((assignedArgs) => ({ pending: undefined }))({ ...args, context })
										}
										context = { ...args.context, ...patch }
										{
											const contextBefore = context
											patch = {
												...patch,
												...((assignedArgs) => ({
													selectionLease: undefined,
													selectionRequest: undefined
												}))({ ...args, context })
											}
											context = { ...args.context, ...patch }
											if (contextBefore.selectionBinding)
												enq.sendTo('selectionAttachment', {
													type: 'DETACH',
													binding: contextBefore.selectionBinding
												})
											if (contextBefore.workspace?.getSnapshot().matches('active')) {
												enq.sendTo(contextBefore.workspace, {
													type: 'SELECTION',
													lease: undefined,
													status: 'suspended'
												})
											}
										}
										if (contextBefore.workspace?.getSnapshot().status === 'active')
											enq.sendTo(contextBefore.workspace, { type: 'SHUTDOWN' })
									}
									{
										const child = self.getSnapshot().children.sessionReadiness
										if (child?.getSnapshot().status === 'active')
											enq.sendTo(child, { type: 'SHUTDOWN' })
										else enq.raise({ type: 'READINESS_RELEASED' })
									}
									return { context: patch }
								},
								on: {
									...retryDrain.on,
									'xstate.error.actor': (args, enq) => {
										return ((args, enq) => {
											if (!(args.event.actorId === 'startup')) return
											let context = args.context
											let patch = {}
											{
												const contextBefore = args.context
												const child = args.children.startup
												if (
													contextBefore.workspaceRestoreView.busy &&
													contextBefore.startupBinding
												) {
													patch = {
														...patch,
														...((assignedArgs) => ({
															startupRetirement: contextBefore.startupBinding
														}))({ ...args, context })
													}
													context = { ...args.context, ...patch }
													enq.sendTo('workspaceRestore', { type: 'DRAIN' })
												} else {
													if (contextBefore.startupBinding) {
														enq.sendTo(contextBefore.startupBinding.owner, {
															type: 'RELEASE',
															scope: contextBefore.startupBinding.scope,
															replyTo: contextBefore.startupBinding.replyTo
														})
													}
												}
											}
											return { context: patch }
										})(args, enq)
									},
									STARTUP_UNAVAILABLE: {}
								}
							},
							closing: {
								...retryDrain,
								entry: (args, enq) => {
									let context = args.context
									const { self } = args
									let patch = {}
									{
										const contextBefore = args.context
										{
											const contextBefore = context
											const child = self.getSnapshot().children.workspaceRestore
											if (child?.getSnapshot().status === 'active')
												enq.sendTo(child, { type: 'DRAIN' })
											else if (contextBefore.workspaceRestoreView.busy)
												enq.raise({ type: 'CLEANUP_FAILED' })
										}
										patch = {
											...patch,
											...((assignedArgs) => ({ pending: undefined }))({ ...args, context })
										}
										context = { ...args.context, ...patch }
										{
											const contextBefore = context
											patch = {
												...patch,
												...((assignedArgs) => ({
													selectionLease: undefined,
													selectionRequest: undefined
												}))({ ...args, context })
											}
											context = { ...args.context, ...patch }
											if (contextBefore.selectionBinding)
												enq.sendTo('selectionAttachment', {
													type: 'DETACH',
													binding: contextBefore.selectionBinding
												})
											if (contextBefore.workspace?.getSnapshot().matches('active')) {
												enq.sendTo(contextBefore.workspace, {
													type: 'SELECTION',
													lease: undefined,
													status: 'suspended'
												})
											}
										}
										if (contextBefore.workspace?.getSnapshot().status === 'active')
											enq.sendTo(contextBefore.workspace, { type: 'SHUTDOWN' })
									}
									{
										const child = self.getSnapshot().children.sessionReadiness
										if (child?.getSnapshot().status === 'active')
											enq.sendTo(child, { type: 'SHUTDOWN' })
										else enq.raise({ type: 'READINESS_RELEASED' })
									}
									return { context: patch }
								},
								on: {
									...retryDrain.on,
									'xstate.error.actor': (args, enq) => {
										if (args.event.actorId === 'sessionReadiness')
											return { target: '#application-readiness.closing' }
										if (args.event.actorId === 'startup')
											return ((args, enq) => {
												let context = args.context
												let patch = {}
												{
													const contextBefore = args.context
													const child = args.children.startup
													if (
														contextBefore.workspaceRestoreView.busy &&
														contextBefore.startupBinding
													) {
														patch = { ...patch, startupRetirement: contextBefore.startupBinding }
														context = { ...args.context, ...patch }
														enq.sendTo('workspaceRestore', { type: 'DRAIN' })
													} else {
														if (contextBefore.startupBinding) {
															enq.sendTo(contextBefore.startupBinding.owner, {
																type: 'RELEASE',
																scope: contextBefore.startupBinding.scope,
																replyTo: contextBefore.startupBinding.replyTo
															})
														}
													}
												}
												return { context: patch }
											})(args, enq)
										return ((args, enq) => {
											let context = args.context
											const { event } = args
											if (!(event.actorId === 'workspace')) return
											let patch = {}
											{
												const contextBefore = args.context
												{
													const contextBefore = context
													patch = {
														...patch,
														...((assignedArgs) => ({
															selectionLease: undefined,
															selectionRequest: undefined
														}))({ ...args, context })
													}
													context = { ...args.context, ...patch }
													if (contextBefore.selectionBinding)
														enq.sendTo('selectionAttachment', {
															type: 'DETACH',
															binding: contextBefore.selectionBinding
														})
													if (contextBefore.workspace?.getSnapshot().matches('active')) {
														enq.sendTo(contextBefore.workspace, {
															type: 'SELECTION',
															lease: undefined,
															status: 'suspended'
														})
													}
												}
												if (event.type === 'xstate.error.actor') {
													patch = {
														...patch,
														...((assignedArgs) => ({ cleanupRelease: { outcome: 'unresolved' } }))({
															...args,
															context
														})
													}
													context = { ...args.context, ...patch }
													if (
														contextBefore.drainActor?.getSnapshot().status === 'active' &&
														contextBefore.selectionDrain
													)
														enq.sendTo(contextBefore.drainActor, {
															type: 'SELECTED_RESOURCES_CRASHED',
															lease: contextBefore.selectionDrain.lease
														})
													enq.raise({ type: 'CLEANUP_FAILED' })
												}
												enq.stop(required(contextBefore.workspace))
												patch = {
													...patch,
													...((assignedArgs) => ({ workspace: undefined, attachment: undefined }))({
														...args,
														context
													})
												}
												context = { ...args.context, ...patch }
												enq.raise({ type: 'ATTACH_PENDING' })
											}
											return { context: patch }
										})(args, enq)
									},
									STARTUP_UNAVAILABLE: {},
									SHUTDOWN: {}
								}
							}
						}
					},
					recovering: {
						initial: 'validating',
						invoke: {
							id: 'recovery',
							src: 'recovery',
							input: ({ context }) => ({
								attempt: context.recoveryAttempt,
								request: required(context.recoveryRequest),
								session: required(context.session),
								restorationBinding:
									context.recoveryRequest?.kind === 'restore'
										? bindRestoration?.(required(context.session))
										: undefined,
								...navigation
							}),
							onDone: (args, enq) => {
								const { context, event } = args
								if (matchesState({ running: { recovering: 'cleanupFailed' } }, args.value)) {
									return {
										target: '#application-readiness.cleanupFailed',
										context: { recoveryRequest: undefined }
									}
								}
								if (matchesState({ running: { recovering: 'closing' } }, args.value)) {
									return {
										target: '#application-readiness.closing',
										context: { recoveryRequest: undefined }
									}
								}
								if (matchesState({ running: { recovering: 'readinessCrashed' } }, args.value)) {
									return {
										target: '#application-readiness.settlingReadinessCrash',
										context: { recoveryRequest: undefined }
									}
								}
								if (matchesState({ running: { recovering: 'startupFailed' } }, args.value)) {
									return {
										target: '#application-readiness.settlingStartupFailure',
										context: { recoveryRequest: undefined }
									}
								}
								if (matchesState({ running: { recovering: 'observerFailed' } }, args.value)) {
									return {
										target: '#application-readiness.settlingObserverFailure',
										context: { recoveryRequest: undefined }
									}
								}
								enq.raise({ type: 'ATTACH_PENDING' })
								return {
									target: 'checking',
									context: {
										recoveryResult: event.output,
										recoveryRequest: undefined,
										attachmentRevision:
											context.attachmentRevision + (event.output.mutation === 'settled' ? 1 : 0),
										pending: event.output.mutation === 'settled' ? undefined : context.pending
									}
								}
							},
							onError: (args) => {
								if (matchesState({ running: { recovering: 'cleanupFailed' } }, args.value)) {
									return {
										target: '#application-readiness.cleanupFailed',
										context: { recoveryRequest: undefined }
									}
								}
								if (matchesState({ running: { recovering: 'closing' } }, args.value)) {
									return {
										target: '#application-readiness.closing',
										context: { recoveryRequest: undefined }
									}
								}
								if (matchesState({ running: { recovering: 'readinessCrashed' } }, args.value)) {
									return {
										target: '#application-readiness.settlingReadinessCrash',
										context: { recoveryRequest: undefined }
									}
								}
								if (matchesState({ running: { recovering: 'startupFailed' } }, args.value)) {
									return {
										target: '#application-readiness.settlingStartupFailure',
										context: { recoveryRequest: undefined }
									}
								}
								return {
									target: '#application-readiness.settlingObserverFailure',
									context: { recoveryRequest: undefined }
								}
							}
						},
						on: {
							START: {},
							RETRY: {},
							RECOVER: {},
							RETRY_NAVIGATION: {},
							ATTACH_WORKSPACE: (args) => {
								return {
									context: ((args) => ({
										pending: (({ context, event }) =>
											event.type === 'ATTACH_WORKSPACE' ? event.attachment : context.pending)(args)
									}))(args)
								}
							},
							ATTACH_PENDING: {},
							ACQUIRED_STATUS: (args) => {
								return { context: { status: args.event.status } }
							},
							RESOURCE_OWNER_FAILED: { target: '.observerFailed' },
							CLEANUP_FAILED: () => {
								return {
									target: '.cleanupFailed',
									context: { cleanupRelease: { outcome: 'unresolved' } }
								}
							},
							RECOVERY_VALIDATED: (args) => {
								const { context } = args
								if (!(args.event.attempt === context.recoveryAttempt)) return
								return {
									context: {
										recoveryRequest: undefined,
										recoveryDraftRevision: context.recoveryDraftRevision + 1
									}
								}
							},
							RECOVERY_DRAIN_REQUESTED: (args) => {
								if (!(args.event.attempt === args.context.recoveryAttempt)) return
								return { target: '.draining' }
							},
							OBSERVATION_UNAVAILABLE: { target: '.observerFailed' },
							'xstate.error.actor': (args, enq) => {
								if (args.event.actorId === 'sessionReadiness')
									return { target: '.readinessCrashed' }
								if (args.event.actorId === 'startup')
									return ((args, enq) => {
										let context = args.context
										let patch = {}
										{
											const contextBefore = args.context
											if (contextBefore.workspaceRestoreView.busy && contextBefore.startupBinding) {
												patch = { ...patch, startupRetirement: contextBefore.startupBinding }
												context = { ...args.context, ...patch }
												enq.sendTo('workspaceRestore', { type: 'DRAIN' })
											} else {
												if (contextBefore.startupBinding) {
													enq.sendTo(contextBefore.startupBinding.owner, {
														type: 'RELEASE',
														scope: contextBefore.startupBinding.scope,
														replyTo: contextBefore.startupBinding.replyTo
													})
												}
											}
										}
										return { target: '.startupFailed', context: patch }
									})(args, enq)
								return ((args, enq) => {
									let context = args.context
									const { event } = args
									if (!(event.actorId === 'workspace')) return
									let patch = {}
									{
										const contextBefore = args.context
										{
											const contextBefore = context
											patch = {
												...patch,
												...((assignedArgs) => ({
													selectionLease: undefined,
													selectionRequest: undefined
												}))({ ...args, context })
											}
											context = { ...args.context, ...patch }
											if (contextBefore.selectionBinding)
												enq.sendTo('selectionAttachment', {
													type: 'DETACH',
													binding: contextBefore.selectionBinding
												})
											if (contextBefore.workspace?.getSnapshot().matches('active')) {
												enq.sendTo(contextBefore.workspace, {
													type: 'SELECTION',
													lease: undefined,
													status: 'suspended'
												})
											}
										}
										if (event.type === 'xstate.error.actor') {
											patch = {
												...patch,
												...((assignedArgs) => ({ cleanupRelease: { outcome: 'unresolved' } }))({
													...args,
													context
												})
											}
											context = { ...args.context, ...patch }
											if (
												contextBefore.drainActor?.getSnapshot().status === 'active' &&
												contextBefore.selectionDrain
											)
												enq.sendTo(contextBefore.drainActor, {
													type: 'SELECTED_RESOURCES_CRASHED',
													lease: contextBefore.selectionDrain.lease
												})
											enq.raise({ type: 'CLEANUP_FAILED' })
										}
										enq.stop(required(contextBefore.workspace))
										patch = {
											...patch,
											...((assignedArgs) => ({ workspace: undefined, attachment: undefined }))({
												...args,
												context
											})
										}
										context = { ...args.context, ...patch }
										enq.raise({ type: 'ATTACH_PENDING' })
									}
									return { target: '.observerFailed', context: patch }
								})(args, enq)
							},
							STARTUP_UNAVAILABLE: { target: '.startupFailed' },
							SHUTDOWN: { target: '.closing' }
						},
						states: {
							validating: {},
							draining: {
								entry: (args, enq) => {
									let context = args.context
									let patch = {}
									{
										const contextBefore = args.context
										{
											const contextBefore = context
											const child = args.children.workspaceRestore
											if (child?.getSnapshot().status === 'active')
												enq.sendTo(child, { type: 'DRAIN' })
											else if (contextBefore.workspaceRestoreView.busy)
												enq.raise({ type: 'CLEANUP_FAILED' })
										}
										patch = {
											...patch,
											...((assignedArgs) => ({ pending: undefined }))({ ...args, context })
										}
										context = { ...args.context, ...patch }
										{
											const contextBefore = context
											patch = {
												...patch,
												...((assignedArgs) => ({
													selectionLease: undefined,
													selectionRequest: undefined
												}))({ ...args, context })
											}
											context = { ...args.context, ...patch }
											if (contextBefore.selectionBinding)
												enq.sendTo('selectionAttachment', {
													type: 'DETACH',
													binding: contextBefore.selectionBinding
												})
											if (contextBefore.workspace?.getSnapshot().matches('active')) {
												enq.sendTo(contextBefore.workspace, {
													type: 'SELECTION',
													lease: undefined,
													status: 'suspended'
												})
											}
										}
										if (contextBefore.workspace?.getSnapshot().status === 'active')
											enq.sendTo(contextBefore.workspace, { type: 'SHUTDOWN' })
									}
									return { context: patch }
								},
								always: (args, enq) => {
									const { context } = args
									if (!applicationResourcesReleased(context)) return
									enq.sendTo('recovery', { type: 'WORKSPACE_DRAINED' })
									return { target: 'operating' }
								}
							},
							operating: {},
							cleanupFailed: {
								...recoveryDrain,
								on: {
									...recoveryDrain.on,
									STARTUP_UNAVAILABLE: {},
									OBSERVATION_UNAVAILABLE: {},
									CLEANUP_FAILED: {},
									RESOURCE_OWNER_FAILED: {},
									'xstate.error.actor': (args, enq) => {
										if (args.event.actorId === 'startup')
											return ((args, enq) => {
												let context = args.context
												let patch = {}
												{
													const contextBefore = args.context
													const child = args.children.startup
													if (
														contextBefore.workspaceRestoreView.busy &&
														contextBefore.startupBinding
													) {
														patch = { ...patch, startupRetirement: contextBefore.startupBinding }
														context = { ...args.context, ...patch }
														enq.sendTo('workspaceRestore', { type: 'DRAIN' })
													} else {
														if (contextBefore.startupBinding) {
															enq.sendTo(contextBefore.startupBinding.owner, {
																type: 'RELEASE',
																scope: contextBefore.startupBinding.scope,
																replyTo: contextBefore.startupBinding.replyTo
															})
														}
													}
												}
												return { context: patch }
											})(args, enq)
										if (args.event.actorId === 'sessionReadiness') return {}
									}
								}
							},
							observerFailed: recoveryDrain,
							readinessCrashed: {
								...recoveryDrain,
								on: {
									...recoveryDrain.on,
									'xstate.error.actor': (args, enq) => {
										if (args.event.actorId === 'sessionReadiness') return {}
										if (args.event.actorId === 'startup')
											return ((args, enq) => {
												let context = args.context
												let patch = {}
												{
													const contextBefore = args.context
													const child = args.children.startup
													if (
														contextBefore.workspaceRestoreView.busy &&
														contextBefore.startupBinding
													) {
														patch = { ...patch, startupRetirement: contextBefore.startupBinding }
														context = { ...args.context, ...patch }
														enq.sendTo('workspaceRestore', { type: 'DRAIN' })
													} else {
														if (contextBefore.startupBinding) {
															enq.sendTo(contextBefore.startupBinding.owner, {
																type: 'RELEASE',
																scope: contextBefore.startupBinding.scope,
																replyTo: contextBefore.startupBinding.replyTo
															})
														}
													}
												}
												return { context: patch }
											})(args, enq)
									},
									STARTUP_UNAVAILABLE: {}
								}
							},
							startupFailed: {
								...recoveryDrain,
								entry: (args, enq) => {
									let context = args.context
									const { self } = args
									let patch = {}
									{
										const contextBefore = args.context
										{
											const contextBefore = context
											const child = self.getSnapshot().children.workspaceRestore
											if (child?.getSnapshot().status === 'active')
												enq.sendTo(child, { type: 'DRAIN' })
											else if (contextBefore.workspaceRestoreView.busy)
												enq.raise({ type: 'CLEANUP_FAILED' })
										}
										patch = {
											...patch,
											...((assignedArgs) => ({ pending: undefined }))({ ...args, context })
										}
										context = { ...args.context, ...patch }
										{
											const contextBefore = context
											patch = {
												...patch,
												...((assignedArgs) => ({
													selectionLease: undefined,
													selectionRequest: undefined
												}))({ ...args, context })
											}
											context = { ...args.context, ...patch }
											if (contextBefore.selectionBinding)
												enq.sendTo('selectionAttachment', {
													type: 'DETACH',
													binding: contextBefore.selectionBinding
												})
											if (contextBefore.workspace?.getSnapshot().matches('active')) {
												enq.sendTo(contextBefore.workspace, {
													type: 'SELECTION',
													lease: undefined,
													status: 'suspended'
												})
											}
										}
										if (contextBefore.workspace?.getSnapshot().status === 'active')
											enq.sendTo(contextBefore.workspace, { type: 'SHUTDOWN' })
									}
									{
										const child = self.getSnapshot().children.recovery
										if (child?.getSnapshot().status === 'active')
											enq.sendTo(child, { type: 'SHUTDOWN' })
									}
									{
										const child = self.getSnapshot().children.sessionReadiness
										if (child?.getSnapshot().status === 'active')
											enq.sendTo(child, { type: 'SHUTDOWN' })
										else enq.raise({ type: 'READINESS_RELEASED' })
									}
									return { context: patch }
								},
								on: {
									...recoveryDrain.on,
									'xstate.error.actor': (args, enq) => {
										return ((args, enq) => {
											if (!(args.event.actorId === 'startup')) return
											let context = args.context
											let patch = {}
											{
												const contextBefore = args.context
												const child = args.children.startup
												if (
													contextBefore.workspaceRestoreView.busy &&
													contextBefore.startupBinding
												) {
													patch = {
														...patch,
														...((assignedArgs) => ({
															startupRetirement: contextBefore.startupBinding
														}))({ ...args, context })
													}
													context = { ...args.context, ...patch }
													enq.sendTo('workspaceRestore', { type: 'DRAIN' })
												} else {
													if (contextBefore.startupBinding) {
														enq.sendTo(contextBefore.startupBinding.owner, {
															type: 'RELEASE',
															scope: contextBefore.startupBinding.scope,
															replyTo: contextBefore.startupBinding.replyTo
														})
													}
												}
											}
											return { context: patch }
										})(args, enq)
									},
									STARTUP_UNAVAILABLE: {}
								}
							},
							closing: {
								...recoveryDrain,
								entry: (args, enq) => {
									let context = args.context
									const { self } = args
									let patch = {}
									{
										const contextBefore = args.context
										{
											const contextBefore = context
											const child = self.getSnapshot().children.workspaceRestore
											if (child?.getSnapshot().status === 'active')
												enq.sendTo(child, { type: 'DRAIN' })
											else if (contextBefore.workspaceRestoreView.busy)
												enq.raise({ type: 'CLEANUP_FAILED' })
										}
										patch = {
											...patch,
											...((assignedArgs) => ({ pending: undefined }))({ ...args, context })
										}
										context = { ...args.context, ...patch }
										{
											const contextBefore = context
											patch = {
												...patch,
												...((assignedArgs) => ({
													selectionLease: undefined,
													selectionRequest: undefined
												}))({ ...args, context })
											}
											context = { ...args.context, ...patch }
											if (contextBefore.selectionBinding)
												enq.sendTo('selectionAttachment', {
													type: 'DETACH',
													binding: contextBefore.selectionBinding
												})
											if (contextBefore.workspace?.getSnapshot().matches('active')) {
												enq.sendTo(contextBefore.workspace, {
													type: 'SELECTION',
													lease: undefined,
													status: 'suspended'
												})
											}
										}
										if (contextBefore.workspace?.getSnapshot().status === 'active')
											enq.sendTo(contextBefore.workspace, { type: 'SHUTDOWN' })
									}
									{
										const child = self.getSnapshot().children.recovery
										if (child?.getSnapshot().status === 'active')
											enq.sendTo(child, { type: 'SHUTDOWN' })
									}
									{
										const child = self.getSnapshot().children.sessionReadiness
										if (child?.getSnapshot().status === 'active')
											enq.sendTo(child, { type: 'SHUTDOWN' })
										else enq.raise({ type: 'READINESS_RELEASED' })
									}
									return { context: patch }
								},
								on: {
									...recoveryDrain.on,
									'xstate.error.actor': (args, enq) => {
										if (args.event.actorId === 'sessionReadiness') return {}
										if (args.event.actorId === 'startup')
											return ((args, enq) => {
												let context = args.context
												let patch = {}
												{
													const contextBefore = args.context
													const child = args.children.startup
													if (
														contextBefore.workspaceRestoreView.busy &&
														contextBefore.startupBinding
													) {
														patch = { ...patch, startupRetirement: contextBefore.startupBinding }
														context = { ...args.context, ...patch }
														enq.sendTo('workspaceRestore', { type: 'DRAIN' })
													} else {
														if (contextBefore.startupBinding) {
															enq.sendTo(contextBefore.startupBinding.owner, {
																type: 'RELEASE',
																scope: contextBefore.startupBinding.scope,
																replyTo: contextBefore.startupBinding.replyTo
															})
														}
													}
												}
												return { context: patch }
											})(args, enq)
										return ((args, enq) => {
											let context = args.context
											const { event } = args
											if (!(event.actorId === 'workspace')) return
											let patch = {}
											{
												const contextBefore = args.context
												{
													const contextBefore = context
													patch = {
														...patch,
														...((assignedArgs) => ({
															selectionLease: undefined,
															selectionRequest: undefined
														}))({ ...args, context })
													}
													context = { ...args.context, ...patch }
													if (contextBefore.selectionBinding)
														enq.sendTo('selectionAttachment', {
															type: 'DETACH',
															binding: contextBefore.selectionBinding
														})
													if (contextBefore.workspace?.getSnapshot().matches('active')) {
														enq.sendTo(contextBefore.workspace, {
															type: 'SELECTION',
															lease: undefined,
															status: 'suspended'
														})
													}
												}
												if (event.type === 'xstate.error.actor') {
													patch = {
														...patch,
														...((assignedArgs) => ({ cleanupRelease: { outcome: 'unresolved' } }))({
															...args,
															context
														})
													}
													context = { ...args.context, ...patch }
													if (
														contextBefore.drainActor?.getSnapshot().status === 'active' &&
														contextBefore.selectionDrain
													)
														enq.sendTo(contextBefore.drainActor, {
															type: 'SELECTED_RESOURCES_CRASHED',
															lease: contextBefore.selectionDrain.lease
														})
													enq.raise({ type: 'CLEANUP_FAILED' })
												}
												enq.stop(required(contextBefore.workspace))
												patch = {
													...patch,
													...((assignedArgs) => ({ workspace: undefined, attachment: undefined }))({
														...args,
														context
													})
												}
												context = { ...args.context, ...patch }
												enq.raise({ type: 'ATTACH_PENDING' })
											}
											return { context: patch }
										})(args, enq)
									},
									SHUTDOWN: {},
									STARTUP_UNAVAILABLE: {}
								}
							}
						}
					}
				}
			},
			closing: {
				initial: 'workspace',
				states: {
					workspace: {
						always: (args) => {
							const { context } = args
							if (context.cleanupRelease.outcome === 'unresolved') {
								return { target: '#application-readiness.cleanupFailed' }
							}
							if (applicationResourcesReleased(context)) {
								return { target: 'transfers' }
							}
						}
					},
					transfers: {
						entry: (args, enq) => {
							{
								const owner = args.children.transferMutationOwner
								if (owner?.getSnapshot().status === 'active')
									enq.sendTo(owner, { type: 'SHUTDOWN' })
							}
						},
						always: (args) => {
							if (!args.context.transferMutationOwnerClosed) return
							return { target: '#application-readiness.releasingReadiness' }
						}
					}
				},
				entry: (args, enq) => {
					let context = args.context
					const { self } = args
					let patch = {}
					{
						const child = self.getSnapshot().children.workspaceRestore
						if (child?.getSnapshot().status === 'active') enq.sendTo(child, { type: 'DRAIN' })
						else if (context.workspaceRestoreView.busy) enq.raise({ type: 'CLEANUP_FAILED' })
					}
					{
						const child = self.getSnapshot().children.sessionReadiness
						if (child?.getSnapshot().status === 'active') enq.sendTo(child, { type: 'SHUTDOWN' })
						else enq.raise({ type: 'READINESS_RELEASED' })
					}
					{
						const contextBefore = args.context
						patch = {
							...patch,
							...((assignedArgs) => ({ selectionLease: undefined, selectionRequest: undefined }))({
								...args,
								context
							})
						}
						context = { ...args.context, ...patch }
						if (contextBefore.selectionBinding)
							enq.sendTo('selectionAttachment', {
								type: 'DETACH',
								binding: contextBefore.selectionBinding
							})
						if (contextBefore.workspace?.getSnapshot().matches('active')) {
							enq.sendTo(contextBefore.workspace, {
								type: 'SELECTION',
								lease: undefined,
								status: 'suspended'
							})
						}
					}
					if (context.workspace?.getSnapshot().status === 'active')
						enq.sendTo(context.workspace, { type: 'SHUTDOWN' })
					return { context: patch }
				},
				on: {
					STARTUP_UNAVAILABLE: {},
					'xstate.error.actor': (args, enq) => {
						return ((args, enq) => {
							const { context, event } = args
							if (event.actorId === 'startup') {
								let context = args.context
								let patch = {}
								{
									const contextBefore = args.context
									if (contextBefore.workspaceRestoreView.busy && contextBefore.startupBinding) {
										patch = {
											...patch,
											...((assignedArgs) => ({ startupRetirement: contextBefore.startupBinding }))({
												...args,
												context
											})
										}
										context = { ...args.context, ...patch }
										enq.sendTo('workspaceRestore', { type: 'DRAIN' })
									} else {
										if (contextBefore.startupBinding) {
											enq.sendTo(contextBefore.startupBinding.owner, {
												type: 'RELEASE',
												scope: contextBefore.startupBinding.scope,
												replyTo: contextBefore.startupBinding.replyTo
											})
										}
									}
								}
								return { context: patch }
							}
							if (event.actorId === 'workspace') {
								let context = args.context
								let patch = {}
								{
									const contextBefore = args.context
									{
										const contextBefore = context
										patch = {
											...patch,
											...((assignedArgs) => ({
												selectionLease: undefined,
												selectionRequest: undefined
											}))({ ...args, context })
										}
										context = { ...args.context, ...patch }
										if (contextBefore.selectionBinding)
											enq.sendTo('selectionAttachment', {
												type: 'DETACH',
												binding: contextBefore.selectionBinding
											})
										if (contextBefore.workspace?.getSnapshot().matches('active')) {
											enq.sendTo(contextBefore.workspace, {
												type: 'SELECTION',
												lease: undefined,
												status: 'suspended'
											})
										}
									}
									if (event.type === 'xstate.error.actor') {
										patch = {
											...patch,
											...((assignedArgs) => ({ cleanupRelease: { outcome: 'unresolved' } }))({
												...args,
												context
											})
										}
										context = { ...args.context, ...patch }
										if (
											contextBefore.drainActor?.getSnapshot().status === 'active' &&
											contextBefore.selectionDrain
										)
											enq.sendTo(contextBefore.drainActor, {
												type: 'SELECTED_RESOURCES_CRASHED',
												lease: contextBefore.selectionDrain.lease
											})
										enq.raise({ type: 'CLEANUP_FAILED' })
									}
									enq.stop(required(contextBefore.workspace))
									patch = {
										...patch,
										...((assignedArgs) => ({ workspace: undefined, attachment: undefined }))({
											...args,
											context
										})
									}
									context = { ...args.context, ...patch }
									enq.raise({ type: 'ATTACH_PENDING' })
								}
								return { context: patch }
							}
						})(args, enq)
					},
					WORKSPACE_CLOSED: {},
					TRANSFER_MUTATION_OWNER_CLOSED: () => {
						return { context: { transferMutationOwnerClosed: true } }
					},
					ATTACH_WORKSPACE: {},
					DETACH_WORKSPACE: {},
					ATTACH_PENDING: {},
					SHUTDOWN: {},
					START: {},
					RETRY: {}
				}
			},
			releasingReadiness: {
				entry: (args, enq) => {
					{
						const child = args.children.sessionReadiness
						if (child?.getSnapshot().status === 'active') enq.sendTo(child, { type: 'SHUTDOWN' })
						else enq.raise({ type: 'READINESS_RELEASED' })
					}
				},
				on: {
					READINESS_RELEASED: { target: 'releasingStartup' },
					SHUTDOWN: {},
					STARTUP_UNAVAILABLE: {},
					OBSERVATION_UNAVAILABLE: {},
					ACQUIRED_STATUS: {},
					ATTACH_WORKSPACE: {},
					ATTACH_PENDING: {}
				}
			},
			releasingStartup: {
				entry: (args, enq) => {
					{
						const child = args.children.startup
						if (child?.getSnapshot().status === 'active') enq.sendTo(child, { type: 'SHUTDOWN' })
						else enq.raise({ type: 'STARTUP_RELEASED' })
					}
				},
				on: {
					STARTUP_RELEASED: { target: 'closed' },
					STARTUP_UNAVAILABLE: {},
					SHUTDOWN: {},
					ATTACH_WORKSPACE: {},
					DETACH_WORKSPACE: {},
					ATTACH_PENDING: {},
					START: {},
					RETRY: {},
					SESSION_ACQUIRED: {},
					SESSION_STARTUP_FAILED: {}
				}
			},
			closed: {
				type: 'final',
				entry: () => {
					return {
						context: {
							workspace: undefined,
							attachment: undefined,
							pending: undefined,
							preparingSession: undefined,
							session: undefined,
							startupBinding: undefined,
							readinessScope: undefined,
							observationFailure: undefined
						}
					}
				}
			}
		}
	})
}

/** Match the exact dependency attachment, including while a previous owner drains. */
export function selectAttachedWorkspace(
	snapshot: SnapshotFrom<ReturnType<typeof createApplicationReadinessMachine>>,
	attachment: WorkspaceAttachment
) {
	return snapshot.context.attachment === attachment ? snapshot.context.workspace : undefined
}

export function selectRecoveryView(
	snapshot: SnapshotFrom<ReturnType<typeof createApplicationReadinessMachine>>
) {
	const result = snapshot.context.recoveryResult
	return {
		busy: snapshot.matches({ running: 'recovering' }),
		navigationOnly: snapshot.context.recoveryRequest?.kind === 'navigate',
		invalid: result?.outcome === 'invalid',
		failed: result?.outcome === 'restoreFailed',
		navigationFailed: result?.outcome === 'navigationFailed',
		canRetryNavigation: result?.outcome === 'navigationFailed' && result.navigation !== undefined,
		draftRevision: snapshot.context.recoveryDraftRevision
	}
}

function contextTransferScope(
	context: Context,
	request: TransferMutationRequestInput
): TransferMutationScope | undefined {
	const { selectionLease: lease, attachment, selectionFacts } = context
	if (
		!lease ||
		!context.transferLease ||
		!sameWorkspaceLease(lease, context.transferLease) ||
		!attachment ||
		!selectionFacts ||
		!context.workspace?.getSnapshot().matches('active') ||
		context.cleanupRelease.outcome === 'unresolved' ||
		context.pending ||
		request.input.db !== attachment.dependencies.db ||
		request.input.identityId !== selectionFacts.source.userId ||
		request.workspaceId !== lease.request.workspaceId ||
		request.input.organizationId !== lease.request.workspaceId ||
		workspaceSelectionTarget(selectionFacts) !== lease.request.workspaceId ||
		workspaceSelectionObservation(selectionFacts, lease.scope, lease.request, 0).access !==
			'allowed'
	)
		return undefined
	return context.transferScope
}

/** Capture once at request creation. Submission must validate, never relabel, this scope. */
export function captureTransferMutationScope(
	snapshot: SnapshotFrom<ReturnType<typeof createApplicationReadinessMachine>>,
	request: TransferMutationRequestInput
): TransferMutationScope | undefined {
	return snapshot.matches({ running: 'ready' })
		? contextTransferScope(snapshot.context, request)
		: undefined
}

export function selectApplicationWorkspaceRestore(
	snapshot: SnapshotFrom<ReturnType<typeof createApplicationReadinessMachine>>
) {
	const view = snapshot.context.workspaceRestoreView
	const ready =
		snapshot.matches({ running: 'ready' }) &&
		snapshot.context.restoreConfiguration !== undefined &&
		workspaceRestoreSessionReady(snapshot.context.session)
	const current = ready && view.identityId === snapshot.context.session?.getSnapshot().account?.id
	return {
		...view,
		canReload:
			(view.canReload || snapshot.matches('reloadRecovery')) &&
			!snapshot.matches({ reloadRecovery: 'reloading' }),
		canCancel: view.canCancel && !snapshot.matches('reloadRecovery'),
		canRetryRelease: view.canRetryRelease && !snapshot.matches('reloadRecovery'),
		editable: view.editable && ready,
		canConfirm: view.canConfirm && current,
		canOpen: view.canOpen && current
	}
}
