import { m } from '#lib/paraglide/messages.js'
import type { BankPresentation } from '#lib/contracts/bank-presentation-contract.js'
import {
	bankAvailabilityMachine,
	selectedBankConnection,
	type AvailabilityEvent,
	type AvailabilityReport
} from './availability.js'
import { accountOptionsMachine, type ProviderAccountView } from './account-options.js'
import { bankHistoryMachine, type HistoryEvent } from './history.js'
import { required } from './identity.js'
import { bankFailureStatuses } from './status.js'
import { createBankSetupMachine } from './setup.js'
import { createBankOperationMachine, type OperationResult } from './operation.js'
import { createLoggedBankOperationMachine, type LoggedOperationResult } from './logged-operation.js'
import { createSyncLogRetentionCoordinator } from './log-retention-coordinator.js'
import type { SyncLogOutput } from '#lib/contracts/bank-sync-log.js'
import {
	retainResourceRelease,
	type WorkspaceResourceRelease
} from '../../contracts/workspace-resource-release.js'
import {
	bankCredentialFingerprint,
	bankObservation,
	bankViewMetadata,
	bankSetupSteps,
	type BankSyncDependencies,
	type BankAccess,
	type BankCredential,
	type BankObservationEvent,
	type LastSync,
	type BankData,
	bankErrorCode,
	emptyCounts,
	type BankCommand,
	type BankEvent,
	type BankViewMeta,
	type Dependencies,
	type ImportCounts,
	type ProgressEvent,
	type ProviderSummary
} from './types.js'
import { types, matchesState, setup, matchesState as matchesState1 } from 'xstate'
import type { ActorRefFrom, EventObject, SnapshotFrom, OutputFrom } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'

export type { BankEvent, BankCommand } from './types.js'
type Event =
	| BankEvent
	| AvailabilityEvent
	| HistoryEvent
	| ProgressEvent
	| BankObservationEvent
	| { type: 'SHUTDOWN' }
	| { type: 'NETWORK_CHANGED'; offline: boolean }
	| { type: 'RETENTION_STOPPED' }
	| import('xstate').ErrorActorEvent
type Context = BankData & {
	release: WorkspaceResourceRelease
	browserOffline: boolean
	logging: SyncLogOutput | undefined
	operationConnectionId: string | undefined
	access: BankAccess
	revision: number
	connection: BankCredential | undefined
	generation: number
	lastSync: LastSync | undefined
	mappingActors: ReadonlyMap<string, ActorRefFrom<typeof accountOptionsMachine>>
	availability: AvailabilityReport | undefined
	command: BankCommand | undefined
	setupToken: string | undefined
	error: unknown
	discovered: ProviderSummary[]
	counts: ImportCounts
	retentionRelease: WorkspaceResourceRelease | undefined
}

function operationCompletion(context: Context, result: LoggedOperationResult | OperationResult) {
	return {
		counts: result.counts,
		logging:
			context.operationConnectionId === context.connection?.id && 'logging' in result
				? result.logging
				: undefined
	}
}

function setupRelease(
	result: OutputFrom<ReturnType<typeof createBankSetupMachine>>
): WorkspaceResourceRelease {
	if (result.kind === 'complete') return { outcome: 'released' }
	if (result.settlement === 'unresolved') return { outcome: 'unresolved' }
	return {
		outcome:
			result.kind === 'failed' || result.settlement === 'locallyPersisted'
				? 'releasedWithFailure'
				: 'released'
	}
}
function operationRelease(
	result: LoggedOperationResult | OperationResult
): WorkspaceResourceRelease {
	// A cancelled import may have confirmed writes. Counts describe retained business progress;
	// they do not turn successful resource release into a cleanup failure.
	// Log write failures do not carry settlement proof in the current logging contract.
	const logging = 'logging' in result ? result.logging : undefined
	if (
		result.settlement === 'unresolved' ||
		(logging?.kind === 'notStarted' && logging.reason === 'startWriteFailed') ||
		(logging?.kind === 'resultUnrecorded' && logging.reason !== 'invalidResult')
	)
		return { outcome: 'unresolved' }
	return {
		outcome:
			result.kind === 'failed' || result.kind === 'partial' || logging?.kind === 'resultUnrecorded'
				? 'releasedWithFailure'
				: 'released'
	}
}

export function createBankSyncMachine(
	inputs: BankSyncDependencies,
	operation?:
		| ReturnType<typeof createBankOperationMachine>
		| ReturnType<typeof createLoggedBankOperationMachine>
) {
	const dependencies: Dependencies = {
		db: inputs.db,
		passkeyName: inputs.passkeyName,
		observe: () => bankObservation(inputs.read())
	}
	const actors = {
		history: bankHistoryMachine,
		retention: createSyncLogRetentionCoordinator(dependencies),
		mappingRow: accountOptionsMachine,
		availability: bankAvailabilityMachine,
		setupConnection: createBankSetupMachine(dependencies),
		operation: operation ?? createLoggedBankOperationMachine(dependencies)
	}
	const patchMarkFailure = ({ context }: { context: Context }): Partial<Context> => ({
		release: retainResourceRelease(context.release, { outcome: 'releasedWithFailure' })
	})
	const patchMarkUnresolved = (): Partial<Context> => ({ release: { outcome: 'unresolved' } })
	const patchRetainRelease = (
		{ context }: { context: Context },
		params: { result: WorkspaceResourceRelease }
	): Partial<Context> => ({
		release: retainResourceRelease(context.release, params.result)
	})
	const events0 = {
		DISCOVER: types<EventPayload<Event, 'DISCOVER'>>(),
		SYNC: types<EventPayload<Event, 'SYNC'>>(),
		MAP: types<EventPayload<Event, 'MAP'>>(),
		RECONNECT: types<EventPayload<Event, 'RECONNECT'>>(),
		CREATE_ACCOUNT: types<EventPayload<Event, 'CREATE_ACCOUNT'>>(),
		DISCONNECT: types<EventPayload<Event, 'DISCONNECT'>>(),
		CONNECT: types<EventPayload<Event, 'CONNECT'>>(),
		TEST_ENCRYPTION: types<EventPayload<Event, 'TEST_ENCRYPTION'>>(),
		VERIFY_DECRYPTION: types<EventPayload<Event, 'VERIFY_DECRYPTION'>>(),
		SAVE_CONNECTION: types<EventPayload<Event, 'SAVE_CONNECTION'>>(),
		CANCEL: types<EventPayload<Event, 'CANCEL'>>(),
		RESET: types<EventPayload<Event, 'RESET'>>(),
		AVAILABILITY_REPORTED: types<EventPayload<Event, 'AVAILABILITY_REPORTED'>>(),
		HISTORY_REPORTED: types<EventPayload<Event, 'HISTORY_REPORTED'>>(),
		IMPORT_PROGRESS: types<EventPayload<Event, 'IMPORT_PROGRESS'>>(),
		WORKSPACE_ACCESS_CHANGED: types<EventPayload<Event, 'WORKSPACE_ACCESS_CHANGED'>>(),
		CONNECTIONS_CHANGED: types<EventPayload<Event, 'CONNECTIONS_CHANGED'>>(),
		MAPPING_DATA_CHANGED: types<EventPayload<Event, 'MAPPING_DATA_CHANGED'>>(),
		HISTORY_CHANGED: types<EventPayload<Event, 'HISTORY_CHANGED'>>(),
		SHUTDOWN: types<EventPayload<Event, 'SHUTDOWN'>>(),
		NETWORK_CHANGED: types<EventPayload<Event, 'NETWORK_CHANGED'>>(),
		RETENTION_STOPPED: types<EventPayload<Event, 'RETENTION_STOPPED'>>()
	}
	type NativeEvent0 =
		| import('xstate').InferEvents<typeof events0>
		| import('xstate').DoneActorEvent<
				| import('xstate').OutputFrom<(typeof actors)['history']>
				| import('xstate').OutputFrom<(typeof actors)['retention']>
				| import('xstate').OutputFrom<(typeof actors)['mappingRow']>
				| import('xstate').OutputFrom<(typeof actors)['availability']>
				| import('xstate').OutputFrom<(typeof actors)['setupConnection']>
				| import('xstate').OutputFrom<(typeof actors)['operation']>
				| import('xstate').OutputFrom<(typeof actors)['setupConnection']>
		  >
		| import('xstate').ErrorActorEvent
	const workflow = setup({
		schemas: {
			context: types<Context>(),
			events: events0,
			input: types<undefined>(),
			output: types<WorkspaceResourceRelease>(),
			children: {
				history: types<import('xstate').ActorRefFrom<(typeof actors)['history']>>(),
				retention: types<import('xstate').ActorRefFrom<(typeof actors)['retention']>>(),
				mappingRow: types<import('xstate').ActorRefFrom<(typeof actors)['mappingRow']>>(),
				availability: types<import('xstate').ActorRefFrom<(typeof actors)['availability']>>(),
				setupConnection: types<import('xstate').ActorRefFrom<(typeof actors)['setupConnection']>>(),
				operation: types<import('xstate').ActorRefFrom<(typeof actors)['operation']>>(),
				setup: types<import('xstate').ActorRefFrom<(typeof actors)['setupConnection']>>()
			},
			meta: types<BankViewMeta>()
		},
		actors,
		actions: {},
		guards: {
			acceptObservations: (args: { value: import('xstate').StateValue }) =>
				!(
					matchesState({ setup: 'shuttingDown' }, args.value) ||
					matchesState({ running: 'shuttingDown' }, args.value) ||
					matchesState('drainingRetention', args.value)
				),
			isNeutral: (args: { value: import('xstate').StateValue }) =>
				matchesState({ ready: 'neutral' }, args.value),
			newAccess: (args: {
				context: Context
				event: NativeEvent0
				value: import('xstate').StateValue
			}) =>
				!(
					matchesState({ setup: 'shuttingDown' }, args.value) ||
					matchesState({ running: 'shuttingDown' }, args.value) ||
					matchesState('drainingRetention', args.value)
				) &&
				(({ context, event }) =>
					event.type === 'WORKSPACE_ACCESS_CHANGED' && event.revision > context.revision)(args),
			newCredentials: (args: {
				context: Context
				event: NativeEvent0
				value: import('xstate').StateValue
			}) =>
				!(
					matchesState({ setup: 'shuttingDown' }, args.value) ||
					matchesState({ running: 'shuttingDown' }, args.value) ||
					matchesState('drainingRetention', args.value)
				) &&
				(({ context, event }) =>
					event.type === 'CONNECTIONS_CHANGED' &&
					event.revision === context.revision &&
					bankCredentialFingerprint(context.connection) !==
						bankCredentialFingerprint(
							selectedBankConnection({ ...context.access, connections: event.connections })
						))(args),
			canConnect: ({ context }: { context: Context }) => context.availability?.canConnect === true,
			canOperate: ({ context }: { context: Context }) => context.availability?.canOperate === true
		}
	})
	const stopRetention = workflow.createStateConfig({
		entry: (
			{
				context,
				children
			}: { context: Context; children: { retention?: ActorRefFrom<typeof actors.retention> } },
			enq
		) => {
			if (context.retentionRelease) {
				enq.raise({ type: 'RETENTION_STOPPED' })
				return
			}
			const child = children.retention
			if (child?.getSnapshot().status === 'active') {
				enq.sendTo('retention', { type: 'SHUTDOWN' })
				return
			}
			// A completed child can be removed before its queued receipt is processed.
			// Root onDone/onError owns that receipt; retain custody until it arrives.
		}
	}).entry
	return workflow.createMachine({
		id: 'bank',
		initial: 'ready',
		meta: { setupStep: 0 },
		invoke: [
			{
				id: 'retention',
				src: 'retention',
				onDone: ({ context, event }, enq) => {
					enq.raise({ type: 'RETENTION_STOPPED' })
					return {
						context: {
							retentionRelease: event.output,
							release: retainResourceRelease(context.release, event.output)
						}
					}
				},
				onError: (_, enq) => {
					enq.raise({ type: 'RETENTION_STOPPED' })
					return {
						context: {
							retentionRelease: { outcome: 'unresolved' },
							release: { outcome: 'unresolved' }
						}
					}
				}
			},
			{
				id: 'availability',
				src: 'availability',
				input: ({ context, self }) => ({
					organizationId: null,
					userId: undefined,
					sessionReady: false,
					membership: undefined,
					connections: [],
					generation: context.generation,
					recipient: self
				}),
				onError: (args, enq) => {
					enq.raise({ type: 'SHUTDOWN' })
					return { context: patchMarkFailure(args) }
				}
			},
			{
				id: 'history',
				src: 'history',
				input: ({ context, self }) => ({
					revision: context.revision,
					recipient: self
				}),
				onError: (args, enq) => {
					enq.raise({ type: 'SHUTDOWN' })
					return { context: patchMarkFailure(args) }
				}
			}
		],
		output: ({ context }) => context.release,
		context: () => {
			return {
				release: { outcome: 'released' },
				browserOffline: true,
				accounts: [],
				mappings: new Map(),
				access: { kind: 'waiting', organizationId: null, userId: undefined },
				revision: -1,
				connection: undefined,
				generation: 0,
				lastSync: undefined,
				logging: undefined,
				operationConnectionId: undefined,
				mappingActors: new Map<string, ActorRefFrom<typeof accountOptionsMachine>>(),
				availability: undefined,
				command: undefined,
				setupToken: undefined,
				error: undefined,
				discovered: [],
				counts: emptyCounts(),
				retentionRelease: undefined
			}
		},
		on: {
			// Mapping children are pure; active resource owners still settle via SHUTDOWN.
			'xstate.error.actor': (args, enq) => {
				if (!args.event.actorId.startsWith('mapping:')) return
				return ((args, enq) => {
					enq.raise({ type: 'SHUTDOWN' })
					return { context: patchMarkFailure(args) }
				})(args, enq)
			},
			SHUTDOWN: { target: '.drainingRetention' },
			NETWORK_CHANGED: (args, enq) => {
				let context = args.context
				let patch = {}
				patch = {
					...patch,
					...((args) => ({ browserOffline: (({ event }) => event.offline)(args) }))(args)
				}
				context = { ...args.context, ...patch }
				{
					const contextBefore = context
					if (contextBefore.revision < 0) {
					} else {
						const child = args.children.retention
						if (child?.getSnapshot().status !== 'active') {
						} else {
							enq.sendTo(child, {
								type: 'CHECK',
								scope:
									context.access.kind === 'allowed' && !context.browserOffline && context.connection
										? {
												organizationId: context.access.organizationId,
												userId: context.access.userId,
												connectionId: context.connection.id
											}
										: undefined,
								completion: context.logging?.attemptId
							})
						}
					}
				}
				return { context: patch }
			},
			RETENTION_STOPPED: {},
			WORKSPACE_ACCESS_CHANGED: (args, enq) => {
				let context = args.context
				if (!args.guards.newAccess(args)) return
				const { event } = args
				let patch = {}
				{
					const contextBefore = args.context
					if (event.type !== 'WORKSPACE_ACCESS_CHANGED') {
					} else {
						patch = {
							...patch,
							...((assignedArgs) => ({
								access: event.access,
								revision: event.revision,
								generation: contextBefore.generation + 1,
								connection: undefined,
								accounts: [],
								mappings: new Map(),
								lastSync: undefined,
								logging: undefined,
								availability: undefined
							}))({ ...args, context })
						}
						context = { ...args.context, ...patch }
						patch = {
							...patch,
							...((assignedArgs) => ({
								discovered: [],
								error: undefined,
								counts: emptyCounts(),
								logging: undefined
							}))({ ...args, context })
						}
						context = { ...args.context, ...patch }
						{
							const contextBefore = context
							for (const actor of contextBefore.mappingActors.values()) enq.stop(actor)
							patch = {
								...patch,
								...(({ context, spawn }) => ({
									mappingActors: new Map(
										context.discovered.map((provider) => [
											provider.id,
											spawn('mappingRow', {
												id: `mapping:${provider.id}`,
												input: { provider, accounts: context.accounts, mappings: context.mappings }
											})
										])
									)
								}))({ ...args, context, spawn: enq.spawn })
							}
							context = { ...args.context, ...patch }
						}
						enq.sendTo('availability', {
							type: 'ACCESS_CHANGED',
							access: context.access,
							generation: context.generation
						})
						enq.sendTo('history', { type: 'BINDING_CHANGED', revision: event.revision })
						{
							const contextBefore = context
							if (contextBefore.revision < 0) {
							} else {
								const child = args.children.retention
								if (child?.getSnapshot().status !== 'active') {
								} else {
									enq.sendTo(child, {
										type: 'CHECK',
										scope:
											context.access.kind === 'allowed' &&
											!context.browserOffline &&
											context.connection
												? {
														organizationId: context.access.organizationId,
														userId: context.access.userId,
														connectionId: context.connection.id
													}
												: undefined,
										completion: context.logging?.attemptId
									})
								}
							}
						}
					}
				}
				return { target: '.ready.neutral', context: patch }
			},
			CONNECTIONS_CHANGED: (args, enq) => {
				let context = args.context
				if (!args.guards.newCredentials(args)) return
				const { event } = args
				let patch = {}
				{
					const contextBefore = args.context
					if (event.type !== 'CONNECTIONS_CHANGED') {
					} else {
						const connection = selectedBankConnection({
							...contextBefore.access,
							connections: event.connections
						})
						patch = {
							...patch,
							...((assignedArgs) => ({
								connection: connection,
								generation: contextBefore.generation + 1,
								availability: undefined,
								discovered: []
							}))({ ...args, context })
						}
						context = { ...args.context, ...patch }
						{
							const contextBefore = context
							for (const actor of contextBefore.mappingActors.values()) enq.stop(actor)
							patch = {
								...patch,
								...(({ context, spawn }) => ({
									mappingActors: new Map(
										context.discovered.map((provider) => [
											provider.id,
											spawn('mappingRow', {
												id: `mapping:${provider.id}`,
												input: { provider, accounts: context.accounts, mappings: context.mappings }
											})
										])
									)
								}))({ ...args, context, spawn: enq.spawn })
							}
							context = { ...args.context, ...patch }
						}
						enq.sendTo('availability', {
							type: 'CONNECTION_CHANGED',
							connection: context.connection,
							generation: context.generation
						})
						if (connection?.id !== contextBefore.connection?.id) {
							patch = {
								...patch,
								...((assignedArgs) => ({ lastSync: undefined }))({ ...args, context })
							}
							context = { ...args.context, ...patch }
							enq.sendTo('history', {
								type: 'CONNECTION_SELECTED',
								revision: contextBefore.revision,
								connectionId: connection?.id
							})
						}
						{
							const contextBefore = context
							if (contextBefore.revision < 0) {
							} else {
								const child = args.children.retention
								if (child?.getSnapshot().status !== 'active') {
								} else {
									enq.sendTo(child, {
										type: 'CHECK',
										scope:
											context.access.kind === 'allowed' &&
											!context.browserOffline &&
											context.connection
												? {
														organizationId: context.access.organizationId,
														userId: context.access.userId,
														connectionId: context.connection.id
													}
												: undefined,
										completion: context.logging?.attemptId
									})
								}
							}
						}
					}
				}
				return { context: patch }
			},
			MAPPING_DATA_CHANGED: (args, enq) => {
				let context = args.context
				const { event } = args
				if (!(args.guards.acceptObservations(args) && event.revision === context.revision)) return
				let patch = {}
				patch = { ...patch, ...event.data }
				context = { ...args.context, ...patch }
				{
					const contextBefore = context
					for (const actor of contextBefore.mappingActors.values()) enq.stop(actor)
					patch = {
						...patch,
						...(({ context, spawn }) => ({
							mappingActors: new Map(
								context.discovered.map((provider) => [
									provider.id,
									spawn('mappingRow', {
										id: `mapping:${provider.id}`,
										input: { provider, accounts: context.accounts, mappings: context.mappings }
									})
								])
							)
						}))({ ...args, context, spawn: enq.spawn })
					}
					context = { ...args.context, ...patch }
				}
				return { context: patch }
			},
			HISTORY_CHANGED: (args, enq) => {
				const { event } = args
				if (!(
					!(
						matchesState({ setup: 'shuttingDown' }, args.value) ||
						matchesState({ running: 'shuttingDown' }, args.value) ||
						matchesState('drainingRetention', args.value)
					) && event.revision === args.context.revision
				))
					return
				enq.sendTo('history', event)
			},
			HISTORY_REPORTED: (args) => {
				const { context, event } = args
				if (!(
					!(
						matchesState({ setup: 'shuttingDown' }, args.value) ||
						matchesState({ running: 'shuttingDown' }, args.value) ||
						matchesState('drainingRetention', args.value)
					) &&
					event.revision === context.revision &&
					event.connectionId === context.connection?.id
				))
					return
				return { context: { lastSync: event.summary } }
			},
			AVAILABILITY_REPORTED: (args) => {
				const { context, event } = args
				if (
					args.guards.acceptObservations(args) &&
					args.guards.isNeutral(args) &&
					event.report.generation === context.generation
				) {
					return {
						target: '.ready.neutral',
						context: {
							availability:
								event.type === 'AVAILABILITY_REPORTED' ? event.report : context.availability
						}
					}
				}
				if (
					args.guards.acceptObservations(args) &&
					event.report.generation === context.generation
				) {
					return {
						context: {
							availability:
								event.type === 'AVAILABILITY_REPORTED' ? event.report : context.availability
						}
					}
				}
			},
			RESET: (args, enq) => {
				let context = args.context
				let patch = {}
				patch = { ...patch, ...((args) => ({ command: undefined, setupToken: undefined }))(args) }
				context = { ...args.context, ...patch }
				patch = {
					...patch,
					...((args) => ({ error: undefined, discovered: [], counts: emptyCounts() }))({
						...args,
						context
					})
				}
				context = { ...args.context, ...patch }
				{
					const contextBefore = context
					for (const actor of contextBefore.mappingActors.values()) enq.stop(actor)
					patch = {
						...patch,
						...(({ context, spawn }) => ({
							mappingActors: new Map(
								context.discovered.map((provider) => [
									provider.id,
									spawn('mappingRow', {
										id: `mapping:${provider.id}`,
										input: { provider, accounts: context.accounts, mappings: context.mappings }
									})
								])
							)
						}))({ ...args, context, spawn: enq.spawn })
					}
					context = { ...args.context, ...patch }
				}
				return { target: '.ready.neutral', context: patch }
			}
		},
		states: {
			ready: {
				initial: 'neutral',
				entry: (args, enq) => {
					let context = args.context
					let patch = {}
					{
						const contextBefore = args.context
						for (const actor of contextBefore.mappingActors.values()) enq.stop(actor)
						patch = {
							...patch,
							...(({ context, spawn }) => ({
								mappingActors: new Map(
									context.discovered.map((provider) => [
										provider.id,
										spawn('mappingRow', {
											id: `mapping:${provider.id}`,
											input: { provider, accounts: context.accounts, mappings: context.mappings }
										})
									])
								)
							}))({ ...args, context, spawn: enq.spawn })
						}
						context = { ...args.context, ...patch }
					}
					{
						const contextBefore = context
						if (contextBefore.revision < 0) {
						} else {
							const child = args.children.retention
							if (child?.getSnapshot().status !== 'active') {
							} else {
								enq.sendTo(child, {
									type: 'CHECK',
									scope:
										context.access.kind === 'allowed' &&
										!context.browserOffline &&
										context.connection
											? {
													organizationId: context.access.organizationId,
													userId: context.access.userId,
													connectionId: context.connection.id
												}
											: undefined,
									completion: context.logging?.attemptId
								})
							}
						}
					}
					return { context: patch }
				},
				on: {
					CONNECT: (args) => {
						if (!args.guards.canConnect(args)) return
						return { target: '#bank.setup', context: { setupToken: args.event.token } }
					},
					DISCOVER: (args) => {
						if (!args.guards.canOperate(args)) return
						const { event } = args
						return { target: '#bank.running', context: { command: event } }
					},
					SYNC: (args) => {
						if (!args.guards.canOperate(args)) return
						const { event } = args
						return { target: '#bank.running', context: { command: event } }
					},
					RECONNECT: (args) => {
						if (!args.guards.canOperate(args)) return
						return { target: '#bank.running', context: { command: args.event } }
					},
					MAP: (args) => {
						if (!args.guards.canOperate(args)) return
						const { event } = args
						return { target: '#bank.running', context: { command: event } }
					},
					CREATE_ACCOUNT: (args) => {
						if (!args.guards.canOperate(args)) return
						const { event } = args
						return { target: '#bank.running', context: { command: event } }
					},
					DISCONNECT: (args) => {
						if (!args.guards.canOperate(args)) return
						const { event } = args
						return { target: '#bank.running', context: { command: event } }
					}
				},
				states: {
					neutral: {
						initial: 'checking',
						states: {
							checking: {
								always: (args) => {
									const { context } = args
									if (context.access.kind !== 'allowed') {
										return { target: 'restricted' }
									}
									if (context.availability?.mode === 'connected') {
										return { target: 'locked' }
									}
									if (context.connection?.status === 'active') {
										return { target: 'waiting' }
									}
									return { target: 'disconnected' }
								}
							},
							disconnected: {
								meta: {
									status: {
										key: 'bank.idle_step',
										label: () => m['bank.idle_step']({ step: bankSetupSteps[0].label() })
									}
								}
							},
							locked: { meta: { status: { key: 'bank.locked', label: () => m['bank.locked']() } } },
							waiting: {
								meta: { status: { key: 'bank.waiting', label: () => m['bank.waiting']() } }
							},
							restricted: {
								meta: { status: { key: 'bank.restricted', label: () => m['bank.restricted']() } }
							}
						}
					},
					success: {
						initial: 'complete',
						states: {
							complete: {
								meta: { status: { key: 'bank.success', label: () => m['bank.success']() } }
							},
							partial: {
								meta: {
									status: { key: 'bank.partial_success', label: () => m['bank.partial_success']() }
								}
							}
						}
					},
					cancelled: {
						meta: { status: { key: 'bank.cancelled', label: () => m['bank.cancelled']() } }
					},
					failure: {
						initial: 'classifying',
						states: {
							classifying: {
								always: (args) => {
									const { context } = args
									if (bankErrorCode(context.error) === 'mode_mismatch') {
										return { target: 'modeMismatch' }
									}
									if (bankErrorCode(context.error) === 'passkey_failure') {
										return { target: 'passkey' }
									}
									if (bankErrorCode(context.error) === 'claim_failure') {
										return { target: 'claim' }
									}
									if (bankErrorCode(context.error) === 'invalid_setup_token') {
										return { target: 'invalidToken' }
									}
									if (bankErrorCode(context.error) === 'account_already_linked') {
										return { target: 'accountConflict' }
									}
									if (bankErrorCode(context.error) === 'save_failure') {
										return { target: 'save' }
									}
									if (bankErrorCode(context.error) === 'other_tab') {
										return { target: 'otherTab' }
									}
									if (bankErrorCode(context.error) === 'locking_unavailable') {
										return { target: 'lockingUnavailable' }
									}
									if (bankErrorCode(context.error) === 'unlock_failure') {
										return { target: 'unlock' }
									}
									if (bankErrorCode(context.error) === 'provider_failure') {
										return { target: 'provider' }
									}
									if (bankErrorCode(context.error) === 'mapping') {
										return { target: 'mapping' }
									}
									return { target: 'unexpected' }
								}
							},
							modeMismatch: {
								meta: {
									status: { key: 'bank.mode_mismatch', label: () => m['bank.mode_mismatch']() }
								}
							},
							passkey: {
								meta: {
									status: { key: 'bank.passkey_failure', label: () => m['bank.passkey_failure']() }
								}
							},
							claim: {
								meta: {
									status: { key: 'bank.claim_failure', label: () => m['bank.claim_failure']() }
								}
							},
							invalidToken: {
								meta: {
									status: {
										key: 'bank.invalid_setup_token',
										label: () => m['bank.invalid_setup_token']()
									}
								}
							},
							accountConflict: {
								meta: {
									status: {
										key: 'bank.account_already_linked',
										label: () => m['bank.account_already_linked']()
									}
								}
							},
							save: {
								meta: {
									status: { key: 'bank.save_failure', label: () => m['bank.save_failure']() }
								}
							},
							otherTab: {
								meta: { status: bankFailureStatuses.interrupted }
							},
							lockingUnavailable: {
								meta: {
									status: {
										key: 'bank.locking_unavailable',
										label: () => m['bank.locking_unavailable']()
									}
								}
							},
							unlock: {
								meta: {
									status: bankFailureStatuses.passkey
								}
							},
							provider: {
								meta: {
									status: bankFailureStatuses.provider
								}
							},
							mapping: {
								meta: {
									status: bankFailureStatuses.mapping
								}
							},
							unexpected: {
								meta: { status: { key: 'bank.failure', label: () => m['bank.failure']() } }
							}
						}
					}
				}
			},
			drainingRetention: {
				entry: stopRetention,
				on: {
					RETENTION_STOPPED: { target: 'closed' },
					SHUTDOWN: {},
					RESET: {},
					CANCEL: {},
					NETWORK_CHANGED: {},
					WORKSPACE_ACCESS_CHANGED: {},
					CONNECTIONS_CHANGED: {}
				}
			},
			closed: {
				type: 'final',
				entry: (args, enq) => {
					let context = args.context
					let patch = {}
					patch = { ...patch, ...((args) => ({ command: undefined, setupToken: undefined }))(args) }
					context = { ...args.context, ...patch }
					patch = {
						...patch,
						...((args) => ({
							discovered: [],
							lastSync: undefined,
							logging: undefined,
							error: undefined,
							counts: emptyCounts()
						}))({ ...args, context })
					}
					context = { ...args.context, ...patch }
					{
						const contextBefore = context
						for (const actor of contextBefore.mappingActors.values()) enq.stop(actor)
						patch = {
							...patch,
							...(({ context, spawn }) => ({
								mappingActors: new Map(
									context.discovered.map((provider) => [
										provider.id,
										spawn('mappingRow', {
											id: `mapping:${provider.id}`,
											input: { provider, accounts: context.accounts, mappings: context.mappings }
										})
									])
								)
							}))({ ...args, context, spawn: enq.spawn })
						}
						context = { ...args.context, ...patch }
					}
					return { context: patch }
				}
			},
			setup: {
				initial: 'working',
				states: {
					working: {},
					cancelling: {},
					resetting: {
						on: {
							CANCEL: {},
							CONNECTIONS_CHANGED: (args, enq) => {
								let context = args.context
								if (!args.guards.newCredentials(args)) return
								const { event } = args
								let patch = {}
								{
									const contextBefore = args.context
									if (event.type !== 'CONNECTIONS_CHANGED') {
									} else {
										const connection = selectedBankConnection({
											...contextBefore.access,
											connections: event.connections
										})
										patch = {
											...patch,
											...((assignedArgs) => ({
												connection: connection,
												generation: contextBefore.generation + 1,
												availability: undefined,
												discovered: []
											}))({ ...args, context })
										}
										context = { ...args.context, ...patch }
										{
											const contextBefore = context
											for (const actor of contextBefore.mappingActors.values()) enq.stop(actor)
											patch = {
												...patch,
												...(({ context, spawn }) => ({
													mappingActors: new Map(
														context.discovered.map((provider) => [
															provider.id,
															spawn('mappingRow', {
																id: `mapping:${provider.id}`,
																input: {
																	provider,
																	accounts: context.accounts,
																	mappings: context.mappings
																}
															})
														])
													)
												}))({ ...args, context, spawn: enq.spawn })
											}
											context = { ...args.context, ...patch }
										}
										enq.sendTo('availability', {
											type: 'CONNECTION_CHANGED',
											connection: context.connection,
											generation: context.generation
										})
										if (connection?.id !== contextBefore.connection?.id) {
											patch = {
												...patch,
												...((assignedArgs) => ({ lastSync: undefined }))({ ...args, context })
											}
											context = { ...args.context, ...patch }
											enq.sendTo('history', {
												type: 'CONNECTION_SELECTED',
												revision: contextBefore.revision,
												connectionId: connection?.id
											})
										}
										{
											const contextBefore = context
											if (contextBefore.revision < 0) {
											} else {
												const child = args.children.retention
												if (child?.getSnapshot().status !== 'active') {
												} else {
													enq.sendTo(child, {
														type: 'CHECK',
														scope:
															context.access.kind === 'allowed' &&
															!context.browserOffline &&
															context.connection
																? {
																		organizationId: context.access.organizationId,
																		userId: context.access.userId,
																		connectionId: context.connection.id
																	}
																: undefined,
														completion: context.logging?.attemptId
													})
												}
											}
										}
									}
								}
								return { context: patch }
							}
						}
					},
					shuttingDown: { on: { CANCEL: {}, RESET: {}, SHUTDOWN: {} } }
				},
				tags: ['setup', 'busy'],
				meta: {
					status: { key: 'bank.working', label: () => m['bank.working']() },
					setupView: 'creating',
					setupStep: 1
				},
				entry: (args, enq) => {
					enq.sendTo('availability', { type: 'SETUP_STARTED' })
					return { context: { error: undefined } }
				},
				exit: (args, enq) => {
					enq.sendTo('availability', { type: 'SETUP_ENDED' })
					return { context: ((args) => ({ command: undefined, setupToken: undefined }))(args) }
				},
				invoke: {
					id: 'setup',
					src: 'setupConnection',
					input: ({ context }) => {
						if (!context.setupToken) throw new Error('missing-token')
						return { token: context.setupToken }
					},
					onSnapshot: () => {
						return { context: { setupToken: undefined } }
					},
					onDone: (args, enq) => {
						const { event } = args
						if (matchesState1({ setup: 'shuttingDown' }, args.value)) {
							const patchRetainReleaseResult20 = patchRetainRelease(args, {
								result: setupRelease(event.output)
							})
							return { target: 'drainingRetention', context: patchRetainReleaseResult20 }
						}
						if (matchesState1({ setup: 'resetting' }, args.value)) {
							const patchRetainReleaseResult19 = patchRetainRelease(args, {
								result: setupRelease(event.output)
							})
							return {
								target: 'ready.neutral',
								context: {
									...patchRetainReleaseResult19,
									...((args) => ({ error: undefined, counts: emptyCounts() }))(args)
								}
							}
						}
						if (matchesState1({ setup: 'cancelling' }, args.value)) {
							const patchRetainReleaseResult18 = patchRetainRelease(args, {
								result: setupRelease(event.output)
							})
							return { target: 'ready.cancelled', context: patchRetainReleaseResult18 }
						}
						if (event.output.kind === 'cancelled') {
							const patchRetainReleaseResult17 = patchRetainRelease(args, {
								result: setupRelease(event.output)
							})
							return { target: 'ready.cancelled', context: patchRetainReleaseResult17 }
						}
						if (event.output.kind === 'failed') {
							const patchRetainReleaseResult16 = patchRetainRelease(args, {
								result: setupRelease(event.output)
							})
							return {
								target: 'ready.failure',
								context: {
									...patchRetainReleaseResult16,
									...((args) => ({
										error: (({ event }) =>
											event.output.kind === 'failed' ? event.output.error : undefined)(args)
									}))(args)
								}
							}
						}
						const patchRetainReleaseResult15 = patchRetainRelease(args, {
							result: setupRelease(event.output)
						})
						return { target: 'ready.success.complete', context: patchRetainReleaseResult15 }
					},
					onError: (args, enq) => {
						if (matchesState1({ setup: 'shuttingDown' }, args.value)) {
							const patchMarkUnresolvedResult14 = patchMarkUnresolved()
							return { target: 'drainingRetention', context: patchMarkUnresolvedResult14 }
						}
						if (matchesState1({ setup: 'resetting' }, args.value)) {
							const patchMarkUnresolvedResult13 = patchMarkUnresolved()
							return {
								target: 'ready.neutral',
								context: {
									...patchMarkUnresolvedResult13,
									...((args) => ({ error: undefined, counts: emptyCounts() }))(args)
								}
							}
						}
						if (matchesState1({ setup: 'cancelling' }, args.value)) {
							const patchMarkUnresolvedResult12 = patchMarkUnresolved()
							return {
								target: 'ready.cancelled',
								context: {
									...patchMarkUnresolvedResult12,
									...((args) => ({ error: undefined }))(args)
								}
							}
						}
						const patchMarkUnresolvedResult11 = patchMarkUnresolved()
						return {
							target: 'ready.failure',
							context: {
								...patchMarkUnresolvedResult11,
								...((args) => ({ error: (({ event }) => event.error)(args) }))(args)
							}
						}
					}
				},
				on: {
					WORKSPACE_ACCESS_CHANGED: (args, enq) => {
						let context = args.context
						if (!args.guards.newAccess(args)) return
						const { event, self } = args
						let patch = {}
						{
							const contextBefore = args.context
							if (event.type !== 'WORKSPACE_ACCESS_CHANGED') {
							} else {
								patch = {
									...patch,
									...((assignedArgs) => ({
										access: event.access,
										revision: event.revision,
										generation: contextBefore.generation + 1,
										connection: undefined,
										accounts: [],
										mappings: new Map(),
										lastSync: undefined,
										logging: undefined,
										availability: undefined
									}))({ ...args, context })
								}
								context = { ...args.context, ...patch }
								patch = {
									...patch,
									...((assignedArgs) => ({
										discovered: [],
										error: undefined,
										counts: emptyCounts(),
										logging: undefined
									}))({ ...args, context })
								}
								context = { ...args.context, ...patch }
								{
									const contextBefore = context
									for (const actor of contextBefore.mappingActors.values()) enq.stop(actor)
									patch = {
										...patch,
										...(({ context, spawn }) => ({
											mappingActors: new Map(
												context.discovered.map((provider) => [
													provider.id,
													spawn('mappingRow', {
														id: `mapping:${provider.id}`,
														input: {
															provider,
															accounts: context.accounts,
															mappings: context.mappings
														}
													})
												])
											)
										}))({ ...args, context, spawn: enq.spawn })
									}
									context = { ...args.context, ...patch }
								}
								enq.sendTo('availability', {
									type: 'ACCESS_CHANGED',
									access: context.access,
									generation: context.generation
								})
								enq.sendTo('history', { type: 'BINDING_CHANGED', revision: event.revision })
								{
									const contextBefore = context
									if (contextBefore.revision < 0) {
									} else {
										const child = self.getSnapshot()?.children.retention
										if (child?.getSnapshot().status !== 'active') {
										} else {
											enq.sendTo(child, {
												type: 'CHECK',
												scope:
													context.access.kind === 'allowed' &&
													!context.browserOffline &&
													context.connection
														? {
																organizationId: context.access.organizationId,
																userId: context.access.userId,
																connectionId: context.connection.id
															}
														: undefined,
												completion: context.logging?.attemptId
											})
										}
									}
								}
							}
						}
						{
							const child = self.getSnapshot().children.setup
							if (child?.getSnapshot().status === 'active') enq.sendTo(child, { type: 'CANCEL' })
						}
						return { target: '.resetting', context: patch }
					},
					SHUTDOWN: (args, enq) => {
						if (args.children.setup?.getSnapshot().status === 'active')
							enq.sendTo('setup', { type: 'CANCEL' })
						return { target: '.shuttingDown', ...(stopRetention(args, enq) ?? {}) }
					},
					RESET: (args, enq) => {
						let context = args.context
						let patch = {}
						patch = { ...patch, ...((args) => ({ discovered: [] }))(args) }
						context = { ...args.context, ...patch }
						{
							const contextBefore = context
							for (const actor of contextBefore.mappingActors.values()) enq.stop(actor)
							patch = {
								...patch,
								...(({ context, spawn }) => ({
									mappingActors: new Map(
										context.discovered.map((provider) => [
											provider.id,
											spawn('mappingRow', {
												id: `mapping:${provider.id}`,
												input: { provider, accounts: context.accounts, mappings: context.mappings }
											})
										])
									)
								}))({ ...args, context, spawn: enq.spawn })
							}
							context = { ...args.context, ...patch }
						}
						{
							const child = args.children.setup
							if (child?.getSnapshot().status === 'active') enq.sendTo(child, { type: 'CANCEL' })
						}
						return { target: '.resetting', context: patch }
					},
					CANCEL: (args, enq) => {
						{
							const child = args.children.setup
							if (child?.getSnapshot().status === 'active') enq.sendTo(child, { type: 'CANCEL' })
						}
						return { target: '.cancelling' }
					},
					CONNECTIONS_CHANGED: (args, enq) => {
						let context = args.context
						if (!args.guards.newCredentials(args)) return
						const { event, self } = args
						let patch = {}
						{
							const contextBefore = args.context
							if (event.type !== 'CONNECTIONS_CHANGED') {
							} else {
								const connection = selectedBankConnection({
									...contextBefore.access,
									connections: event.connections
								})
								patch = {
									...patch,
									...((assignedArgs) => ({
										connection: connection,
										generation: contextBefore.generation + 1,
										availability: undefined,
										discovered: []
									}))({ ...args, context })
								}
								context = { ...args.context, ...patch }
								{
									const contextBefore = context
									for (const actor of contextBefore.mappingActors.values()) enq.stop(actor)
									patch = {
										...patch,
										...(({ context, spawn }) => ({
											mappingActors: new Map(
												context.discovered.map((provider) => [
													provider.id,
													spawn('mappingRow', {
														id: `mapping:${provider.id}`,
														input: {
															provider,
															accounts: context.accounts,
															mappings: context.mappings
														}
													})
												])
											)
										}))({ ...args, context, spawn: enq.spawn })
									}
									context = { ...args.context, ...patch }
								}
								enq.sendTo('availability', {
									type: 'CONNECTION_CHANGED',
									connection: context.connection,
									generation: context.generation
								})
								if (connection?.id !== contextBefore.connection?.id) {
									patch = {
										...patch,
										...((assignedArgs) => ({ lastSync: undefined }))({ ...args, context })
									}
									context = { ...args.context, ...patch }
									enq.sendTo('history', {
										type: 'CONNECTION_SELECTED',
										revision: contextBefore.revision,
										connectionId: connection?.id
									})
								}
								{
									const contextBefore = context
									if (contextBefore.revision < 0) {
									} else {
										const child = self.getSnapshot()?.children.retention
										if (child?.getSnapshot().status !== 'active') {
										} else {
											enq.sendTo(child, {
												type: 'CHECK',
												scope:
													context.access.kind === 'allowed' &&
													!context.browserOffline &&
													context.connection
														? {
																organizationId: context.access.organizationId,
																userId: context.access.userId,
																connectionId: context.connection.id
															}
														: undefined,
												completion: context.logging?.attemptId
											})
										}
									}
								}
							}
						}
						{
							const contextBefore = context
							const child = self.getSnapshot().children.setup
							if (child?.getSnapshot().status === 'active')
								enq.sendTo(child, {
									type: 'CREDENTIAL_CHANGED',
									fingerprint: bankCredentialFingerprint(contextBefore.connection)
								})
						}
						return { context: patch }
					},
					TEST_ENCRYPTION: (args, enq) => {
						enq.sendTo('setup', { type: 'TEST_ENCRYPTION' })
					},
					VERIFY_DECRYPTION: (args, enq) => {
						enq.sendTo('setup', { type: 'VERIFY_DECRYPTION' })
					},
					SAVE_CONNECTION: (args, enq) => {
						enq.sendTo('setup', { type: 'SAVE_CONNECTION' })
					}
				}
			},
			running: {
				initial: 'working',
				states: {
					working: {},
					cancelling: {},
					resetting: {
						on: {
							CANCEL: {},
							IMPORT_PROGRESS: {},
							CONNECTIONS_CHANGED: (args, enq) => {
								let context = args.context
								if (!args.guards.newCredentials(args)) return
								const { event } = args
								let patch = {}
								{
									const contextBefore = args.context
									if (event.type !== 'CONNECTIONS_CHANGED') {
									} else {
										const connection = selectedBankConnection({
											...contextBefore.access,
											connections: event.connections
										})
										patch = {
											...patch,
											...((assignedArgs) => ({
												connection: connection,
												generation: contextBefore.generation + 1,
												availability: undefined,
												discovered: []
											}))({ ...args, context })
										}
										context = { ...args.context, ...patch }
										{
											const contextBefore = context
											for (const actor of contextBefore.mappingActors.values()) enq.stop(actor)
											patch = {
												...patch,
												...(({ context, spawn }) => ({
													mappingActors: new Map(
														context.discovered.map((provider) => [
															provider.id,
															spawn('mappingRow', {
																id: `mapping:${provider.id}`,
																input: {
																	provider,
																	accounts: context.accounts,
																	mappings: context.mappings
																}
															})
														])
													)
												}))({ ...args, context, spawn: enq.spawn })
											}
											context = { ...args.context, ...patch }
										}
										enq.sendTo('availability', {
											type: 'CONNECTION_CHANGED',
											connection: context.connection,
											generation: context.generation
										})
										if (connection?.id !== contextBefore.connection?.id) {
											patch = {
												...patch,
												...((assignedArgs) => ({ lastSync: undefined }))({ ...args, context })
											}
											context = { ...args.context, ...patch }
											enq.sendTo('history', {
												type: 'CONNECTION_SELECTED',
												revision: contextBefore.revision,
												connectionId: connection?.id
											})
										}
										{
											const contextBefore = context
											if (contextBefore.revision < 0) {
											} else {
												const child = args.children.retention
												if (child?.getSnapshot().status !== 'active') {
												} else {
													enq.sendTo(child, {
														type: 'CHECK',
														scope:
															context.access.kind === 'allowed' &&
															!context.browserOffline &&
															context.connection
																? {
																		organizationId: context.access.organizationId,
																		userId: context.access.userId,
																		connectionId: context.connection.id
																	}
																: undefined,
														completion: context.logging?.attemptId
													})
												}
											}
										}
									}
								}
								return { context: patch }
							}
						}
					},
					shuttingDown: {
						on: {
							CANCEL: {},
							RESET: {},
							SHUTDOWN: {},
							IMPORT_PROGRESS: {}
						}
					}
				},
				tags: ['operating', 'busy'],
				meta: { status: { key: 'bank.working', label: () => m['bank.working']() } },
				entry: (args) => {
					return {
						context: ((args) => ({
							error: undefined,
							counts: emptyCounts(),
							logging: undefined,
							operationConnectionId: (({ context }) => context.connection?.id)(args)
						}))(args)
					}
				},
				exit: (args) => {
					return { context: ((args) => ({ command: undefined, setupToken: undefined }))(args) }
				},
				invoke: {
					id: 'operation',
					src: 'operation',
					input: ({ context }) => {
						if (!context.command) throw new Error('missing-command')
						return { command: context.command, discovered: context.discovered }
					},
					// Observe child transitions without mirroring their state into context.
					onSnapshot: {},
					onDone: (args, enq) => {
						const { context, event } = args
						if (matchesState1({ running: 'shuttingDown' }, args.value)) {
							const patchRetainReleaseResult10 = patchRetainRelease(args, {
								result: operationRelease(event.output)
							})
							return { target: 'drainingRetention', context: patchRetainReleaseResult10 }
						}
						if (matchesState1({ running: 'resetting' }, args.value)) {
							const patchRetainReleaseResult9 = patchRetainRelease(args, {
								result: operationRelease(event.output)
							})
							return {
								target: 'ready.neutral',
								context: {
									...patchRetainReleaseResult9,
									...((args) => ({ error: undefined, counts: emptyCounts() }))(args)
								}
							}
						}
						if (matchesState1({ running: 'cancelling' }, args.value)) {
							const patchRetainReleaseResult8 = patchRetainRelease(args, {
								result: operationRelease(event.output)
							})
							return {
								target: 'ready.cancelled',
								context: {
									...patchRetainReleaseResult8,
									...operationCompletion(context, event.output)
								}
							}
						}
						if (event.output.kind === 'cancelled') {
							const patchRetainReleaseResult7 = patchRetainRelease(args, {
								result: operationRelease(event.output)
							})
							return {
								target: 'ready.cancelled',
								context: {
									...patchRetainReleaseResult7,
									...{
										...operationCompletion(context, event.output),
										error: event.output.kind === 'cancelled' ? event.output.error : undefined
									}
								}
							}
						}
						if (event.output.kind === 'failed') {
							const patchRetainReleaseResult6 = patchRetainRelease(args, {
								result: operationRelease(event.output)
							})
							return {
								target: 'ready.failure',
								context: {
									...patchRetainReleaseResult6,
									...{
										...operationCompletion(context, event.output),
										error: event.output.kind === 'failed' ? event.output.error : undefined
									}
								}
							}
						}
						if (event.output.kind === 'partial') {
							const patchRetainReleaseResult5 = patchRetainRelease(args, {
								result: operationRelease(event.output)
							})
							return {
								target: 'ready.success.partial',
								context: {
									...patchRetainReleaseResult5,
									...{
										...operationCompletion(context, event.output),
										discovered: event.output.discovered ?? context.discovered
									}
								}
							}
						}
						const patchRetainReleaseResult4 = patchRetainRelease(args, {
							result: operationRelease(event.output)
						})
						return {
							target: 'ready.success.complete',
							context: {
								...patchRetainReleaseResult4,
								...{
									...operationCompletion(context, event.output),
									discovered: event.output.discovered ?? context.discovered
								}
							}
						}
					},
					onError: (args, enq) => {
						if (matchesState1({ running: 'shuttingDown' }, args.value)) {
							const patchMarkUnresolvedResult3 = patchMarkUnresolved()
							return { target: 'drainingRetention', context: patchMarkUnresolvedResult3 }
						}
						if (matchesState1({ running: 'resetting' }, args.value)) {
							const patchMarkUnresolvedResult2 = patchMarkUnresolved()
							return {
								target: 'ready.neutral',
								context: {
									...patchMarkUnresolvedResult2,
									...((args) => ({ error: undefined, counts: emptyCounts() }))(args)
								}
							}
						}
						if (matchesState1({ running: 'cancelling' }, args.value)) {
							const patchMarkUnresolvedResult1 = patchMarkUnresolved()
							return {
								target: 'ready.cancelled',
								context: {
									...patchMarkUnresolvedResult1,
									...((args) => ({ error: undefined }))(args)
								}
							}
						}
						const patchMarkUnresolvedResult0 = patchMarkUnresolved()
						return {
							target: 'ready.failure',
							context: {
								...patchMarkUnresolvedResult0,
								...((args) => ({ error: (({ event }) => event.error)(args) }))(args)
							}
						}
					}
				},
				on: {
					WORKSPACE_ACCESS_CHANGED: (args, enq) => {
						let context = args.context
						if (!args.guards.newAccess(args)) return
						const { event, self } = args
						let patch = {}
						{
							const contextBefore = args.context
							if (event.type !== 'WORKSPACE_ACCESS_CHANGED') {
							} else {
								patch = {
									...patch,
									...((assignedArgs) => ({
										access: event.access,
										revision: event.revision,
										generation: contextBefore.generation + 1,
										connection: undefined,
										accounts: [],
										mappings: new Map(),
										lastSync: undefined,
										logging: undefined,
										availability: undefined
									}))({ ...args, context })
								}
								context = { ...args.context, ...patch }
								patch = {
									...patch,
									...((assignedArgs) => ({
										discovered: [],
										error: undefined,
										counts: emptyCounts(),
										logging: undefined
									}))({ ...args, context })
								}
								context = { ...args.context, ...patch }
								{
									const contextBefore = context
									for (const actor of contextBefore.mappingActors.values()) enq.stop(actor)
									patch = {
										...patch,
										...(({ context, spawn }) => ({
											mappingActors: new Map(
												context.discovered.map((provider) => [
													provider.id,
													spawn('mappingRow', {
														id: `mapping:${provider.id}`,
														input: {
															provider,
															accounts: context.accounts,
															mappings: context.mappings
														}
													})
												])
											)
										}))({ ...args, context, spawn: enq.spawn })
									}
									context = { ...args.context, ...patch }
								}
								enq.sendTo('availability', {
									type: 'ACCESS_CHANGED',
									access: context.access,
									generation: context.generation
								})
								enq.sendTo('history', { type: 'BINDING_CHANGED', revision: event.revision })
								{
									const contextBefore = context
									if (contextBefore.revision < 0) {
									} else {
										const child = self.getSnapshot()?.children.retention
										if (child?.getSnapshot().status !== 'active') {
										} else {
											enq.sendTo(child, {
												type: 'CHECK',
												scope:
													context.access.kind === 'allowed' &&
													!context.browserOffline &&
													context.connection
														? {
																organizationId: context.access.organizationId,
																userId: context.access.userId,
																connectionId: context.connection.id
															}
														: undefined,
												completion: context.logging?.attemptId
											})
										}
									}
								}
							}
						}
						{
							const child = self.getSnapshot().children.operation
							if (child?.getSnapshot().status === 'active') enq.sendTo(child, { type: 'CANCEL' })
						}
						return { target: '.resetting', context: patch }
					},
					SHUTDOWN: (args, enq) => {
						if (args.children.operation?.getSnapshot().status === 'active')
							enq.sendTo('operation', { type: 'CANCEL' })
						return { target: '.shuttingDown', ...(stopRetention(args, enq) ?? {}) }
					},
					RESET: (args, enq) => {
						let context = args.context
						let patch = {}
						patch = { ...patch, ...((args) => ({ discovered: [] }))(args) }
						context = { ...args.context, ...patch }
						{
							const contextBefore = context
							for (const actor of contextBefore.mappingActors.values()) enq.stop(actor)
							patch = {
								...patch,
								...(({ context, spawn }) => ({
									mappingActors: new Map(
										context.discovered.map((provider) => [
											provider.id,
											spawn('mappingRow', {
												id: `mapping:${provider.id}`,
												input: { provider, accounts: context.accounts, mappings: context.mappings }
											})
										])
									)
								}))({ ...args, context, spawn: enq.spawn })
							}
							context = { ...args.context, ...patch }
						}
						{
							const child = args.children.operation
							if (child?.getSnapshot().status === 'active') enq.sendTo(child, { type: 'CANCEL' })
						}
						return { target: '.resetting', context: patch }
					},
					CANCEL: (args, enq) => {
						{
							const child = args.children.operation
							if (child?.getSnapshot().status === 'active') enq.sendTo(child, { type: 'CANCEL' })
						}
						return { target: '.cancelling' }
					},
					CONNECTIONS_CHANGED: (args, enq) => {
						const { context, event, self } = args
						if (
							args.guards.newCredentials(args) &&
							(context.command?.type === 'SYNC' || context.command?.type === 'DISCOVER')
						) {
							let context = args.context
							let patch = {}
							{
								const contextBefore = args.context
								if (event.type !== 'CONNECTIONS_CHANGED') {
								} else {
									const connection = selectedBankConnection({
										...contextBefore.access,
										connections: event.connections
									})
									patch = {
										...patch,
										...((assignedArgs) => ({
											connection: connection,
											generation: contextBefore.generation + 1,
											availability: undefined,
											discovered: []
										}))({ ...args, context })
									}
									context = { ...args.context, ...patch }
									{
										const contextBefore = context
										for (const actor of contextBefore.mappingActors.values()) enq.stop(actor)
										patch = {
											...patch,
											...(({ context, spawn }) => ({
												mappingActors: new Map(
													context.discovered.map((provider) => [
														provider.id,
														spawn('mappingRow', {
															id: `mapping:${provider.id}`,
															input: {
																provider,
																accounts: context.accounts,
																mappings: context.mappings
															}
														})
													])
												)
											}))({ ...args, context, spawn: enq.spawn })
										}
										context = { ...args.context, ...patch }
									}
									enq.sendTo('availability', {
										type: 'CONNECTION_CHANGED',
										connection: context.connection,
										generation: context.generation
									})
									if (connection?.id !== contextBefore.connection?.id) {
										patch = {
											...patch,
											...((assignedArgs) => ({ lastSync: undefined }))({ ...args, context })
										}
										context = { ...args.context, ...patch }
										enq.sendTo('history', {
											type: 'CONNECTION_SELECTED',
											revision: contextBefore.revision,
											connectionId: connection?.id
										})
									}
									{
										const contextBefore = context
										if (contextBefore.revision < 0) {
										} else {
											const child = self.getSnapshot()?.children.retention
											if (child?.getSnapshot().status !== 'active') {
											} else {
												enq.sendTo(child, {
													type: 'CHECK',
													scope:
														context.access.kind === 'allowed' &&
														!context.browserOffline &&
														context.connection
															? {
																	organizationId: context.access.organizationId,
																	userId: context.access.userId,
																	connectionId: context.connection.id
																}
															: undefined,
													completion: context.logging?.attemptId
												})
											}
										}
									}
								}
							}
							{
								const child = self.getSnapshot().children.operation
								if (child?.getSnapshot().status === 'active') enq.sendTo(child, { type: 'CANCEL' })
							}
							return { target: '.cancelling', context: patch }
						}
						if (args.guards.newCredentials(args)) {
							let context = args.context
							let patch = {}
							{
								const contextBefore = args.context
								if (event.type !== 'CONNECTIONS_CHANGED') {
								} else {
									const connection = selectedBankConnection({
										...contextBefore.access,
										connections: event.connections
									})
									patch = {
										...patch,
										...((assignedArgs) => ({
											connection: connection,
											generation: contextBefore.generation + 1,
											availability: undefined,
											discovered: []
										}))({ ...args, context })
									}
									context = { ...args.context, ...patch }
									{
										const contextBefore = context
										for (const actor of contextBefore.mappingActors.values()) enq.stop(actor)
										patch = {
											...patch,
											...(({ context, spawn }) => ({
												mappingActors: new Map(
													context.discovered.map((provider) => [
														provider.id,
														spawn('mappingRow', {
															id: `mapping:${provider.id}`,
															input: {
																provider,
																accounts: context.accounts,
																mappings: context.mappings
															}
														})
													])
												)
											}))({ ...args, context, spawn: enq.spawn })
										}
										context = { ...args.context, ...patch }
									}
									enq.sendTo('availability', {
										type: 'CONNECTION_CHANGED',
										connection: context.connection,
										generation: context.generation
									})
									if (connection?.id !== contextBefore.connection?.id) {
										patch = {
											...patch,
											...((assignedArgs) => ({ lastSync: undefined }))({ ...args, context })
										}
										context = { ...args.context, ...patch }
										enq.sendTo('history', {
											type: 'CONNECTION_SELECTED',
											revision: contextBefore.revision,
											connectionId: connection?.id
										})
									}
									{
										const contextBefore = context
										if (contextBefore.revision < 0) {
										} else {
											const child = self.getSnapshot()?.children.retention
											if (child?.getSnapshot().status !== 'active') {
											} else {
												enq.sendTo(child, {
													type: 'CHECK',
													scope:
														context.access.kind === 'allowed' &&
														!context.browserOffline &&
														context.connection
															? {
																	organizationId: context.access.organizationId,
																	userId: context.access.userId,
																	connectionId: context.connection.id
																}
															: undefined,
													completion: context.logging?.attemptId
												})
											}
										}
									}
								}
							}
							return { context: patch }
						}
					},
					IMPORT_PROGRESS: (args) => {
						return { context: { counts: args.event.counts } }
					}
				}
			}
		}
	})
}

// Select presentation data from the current machine and its active child states.
export function selectBankView(
	snapshot: SnapshotFrom<ReturnType<typeof createBankSyncMachine>> | undefined
) {
	if (!snapshot)
		return {
			mode: { kind: 'restricted' },
			activity: { kind: 'idle' },
			status: undefined,
			history: undefined,
			logging: undefined,
			providerAccounts: []
		} satisfies BankPresentation
	const operation = snapshot.children.operation?.getSnapshot()
	const nestedOperation =
		operation && 'operation' in operation.children
			? operation.children.operation?.getSnapshot()
			: undefined
	const metadata = bankViewMetadata(
		snapshot,
		snapshot.children.setup?.getSnapshot(),
		operation,
		nestedOperation && 'getMeta' in nestedOperation ? nestedOperation : undefined
	)
	const mappingActors: Context['mappingActors'] = snapshot.context.mappingActors
	return {
		mode:
			!snapshot.context.availability || snapshot.context.availability.mode === 'restricted'
				? { kind: 'restricted' }
				: snapshot.context.availability.mode === 'setup'
					? {
							kind: 'setup',
							step: metadata.setupStep ?? 0,
							stage: snapshot.matches('setup') ? (metadata.setupView ?? null) : null
						}
					: { kind: 'connected', recovery: 'available' },
		activity: snapshot.hasTag('busy')
			? { kind: 'working', indicator: metadata.loadingProvider ? 'provider' : 'general' }
			: { kind: 'idle' },
		status: snapshot.hasTag('setup') ? undefined : metadata.status,
		history: snapshot.context.lastSync,
		logging: snapshot.context.logging,

		providerAccounts: Array.from(
			mappingActors.values(),
			(actor: ActorRefFrom<typeof accountOptionsMachine>): ProviderAccountView => {
				const row = actor.getSnapshot()
				return {
					...row.context.provider,
					mapping: required(row.context.mapping),
					selectedAccountId: row.context.selectedAccountId,
					availableAccounts: row.context.eligibleAccounts,
					showExisting: row.hasTag('show-existing')
				}
			}
		)
	} satisfies BankPresentation
}
