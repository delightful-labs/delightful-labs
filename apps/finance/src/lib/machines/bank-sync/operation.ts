import { app } from '#lib/schema.js'
import { createBankTrace } from '#lib/integrations/diagnostics.js'
import { unlockCredential } from '#lib/integrations/passkey.js'
import {
	fetchAccounts,
	providerAccountIdentity,
	providerBalanceSnapshot
} from '#lib/integrations/simplefin.js'
import { createAuthorizationMachine } from './authorization.js'
import { createAccountMappingMachine } from './accounts.js'
import { createImportMachine } from './import.js'
import { createPreparationMachine, type PreparedScope } from './preparation.js'
import { required } from './identity.js'
import { bankLock } from './lock.js'
import {
	credentialAuthorization,
	emptyCounts,
	type BankCommand,
	type Dependencies,
	type ImportCounts,
	type ImportResult,
	type AccountImportReport,
	type ImportSettlement,
	type LockEvent,
	type OperationWork,
	type ProgressEvent,
	type ProviderResponse,
	type RequestIdentity,
	type ProviderSummary,
	type BankViewMeta
} from './types.js'
import { types, matchesState, setup, createAsyncLogic, matchesState as matchesState1 } from 'xstate'
import type { EventObject, ErrorActorEvent } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'

type Input = { command: BankCommand; discovered: ProviderSummary[]; identity?: RequestIdentity }
type Context = Input & {
	identity: RequestIdentity
	work: OperationWork | undefined
	accessUrl: string | undefined
	response: ProviderResponse | undefined
	counts: ImportCounts
	accountResults: readonly AccountImportReport[]
	result: ProviderSummary[] | undefined
	completion: OperationOutcome | undefined
	error: unknown
	importSettlement: ImportSettlement
	writeSettlement: ImportSettlement
	outcome: SyncOutcome | undefined
}
type OperationSummary = {
	counts: ImportCounts
	discovered: ProviderSummary[] | undefined
	settlement: ImportSettlement
}
type OperationOutcome =
	| (OperationSummary & { kind: 'complete' | 'partial' })
	| (OperationSummary & { kind: 'failed' | 'cancelled'; error: unknown })
export type OperationResult = OperationOutcome & { accountResults: readonly AccountImportReport[] }
type SyncOutcome =
	| { lastOutcome: 'succeeded' | 'partial'; lastError: null }
	| { lastOutcome: 'failed'; lastError: 'operation-failed' }

function importCompletion(result: ImportResult) {
	return {
		counts: result.counts,
		accountResults: result.accountResults,
		importSettlement: result.settlement
	}
}

function workFor(context: Context) {
	if (!context.work) throw new Error('missing-command')
	return context.work
}

// Import-data uncertainty survives an independently settled outcome-history write.
function operationSettlement(context: Context): ImportSettlement {
	return context.importSettlement === 'unresolved' ? 'unresolved' : context.writeSettlement
}

export type OperationOutcomeInput = {
	work: OperationWork
	counts: ImportCounts
	outcome: SyncOutcome
}
export function createBankOperationMachine(dependencies: Dependencies) {
	const { db, observe } = dependencies
	const disconnect = createAsyncLogic<void, OperationWork>({
		run: async ({ input, signal }) => {
			signal.throwIfAborted()
			await db
				.update(app.simplefinConnections, input.current.id, {
					status: 'revoked',
					ciphertext: null,
					credentialId: null,
					prfSalt: null,
					iv: null,
					credentialVersion: null,
					accessUrl: ''
				})
				.wait({ tier: 'local' })
		}
	})
	const unlock = createAsyncLogic<string, OperationWork>({
		run: ({ input, signal }) => {
			const { current, scope, trace } = input
			return unlockCredential(
				{
					version: current.credentialVersion,
					ownerId: current.ownerId,
					organizationId: current.organizationId,
					connectionId: current.id,
					credentialId: current.credentialId,
					prfSalt: current.prfSalt,
					iv: current.iv,
					ciphertext: current.ciphertext
				},
				scope,
				signal,
				trace
			)
		}
	})
	const fetchProvider = createAsyncLogic<
		ProviderResponse,
		{ work: OperationWork; accessUrl: string }
	>({
		run: ({ input, signal }) =>
			fetchAccounts(
				input.accessUrl,
				input.work.command.type === 'DISCOVER',
				signal,
				input.work.trace
			)
	})
	const persistOutcome = createAsyncLogic<void, OperationOutcomeInput>({
		run: async ({ input, signal }) => {
			signal.throwIfAborted()
			await db
				.update(app.simplefinConnections, input.work.current.id, {
					lastSyncAt: input.work.attemptAt,
					...input.outcome,
					importedCount: input.counts.imported,
					existingCount: input.counts.existing,
					omittedCount: input.counts.omitted
				})
				.wait({ tier: 'local' })
		}
	})
	const actors = {
		lock: bankLock,
		prepare: createPreparationMachine(dependencies),
		startWork: createAsyncLogic<OperationWork, { command: BankCommand; prepared: PreparedScope }>({
			run: async ({ input }) => ({
				command: input.command,
				current: required(input.prepared.connection),
				scope: input.prepared.scope,
				trace: createBankTrace(input.command.type),
				attemptAt: new Date()
			})
		}),
		authorize: createAuthorizationMachine(dependencies),
		disconnect,
		unlock,
		fetchProvider,
		mapAccounts: createAccountMappingMachine(dependencies),
		importTransactions: createImportMachine(dependencies),
		persistOutcome
	}
	const events0 = {
		LOCK_ACQUIRED:
			types<
				EventPayload<
					LockEvent | ProgressEvent | ErrorActorEvent | { type: 'CANCEL' },
					'LOCK_ACQUIRED'
				>
			>(),
		LOCK_FAILED:
			types<
				EventPayload<
					LockEvent | ProgressEvent | ErrorActorEvent | { type: 'CANCEL' },
					'LOCK_FAILED'
				>
			>(),
		IMPORT_PROGRESS:
			types<
				EventPayload<
					LockEvent | ProgressEvent | ErrorActorEvent | { type: 'CANCEL' },
					'IMPORT_PROGRESS'
				>
			>(),
		CANCEL:
			types<
				EventPayload<LockEvent | ProgressEvent | ErrorActorEvent | { type: 'CANCEL' }, 'CANCEL'>
			>()
	}
	type NativeEvent0 =
		| import('xstate').InferEvents<typeof events0>
		| import('xstate').DoneActorEvent<
				| import('xstate').OutputFrom<(typeof actors)['lock']>
				| import('xstate').OutputFrom<(typeof actors)['prepare']>
				| import('xstate').OutputFrom<(typeof actors)['authorize']>
				| import('xstate').OutputFrom<(typeof actors)['disconnect']>
				| import('xstate').OutputFrom<(typeof actors)['unlock']>
				| import('xstate').OutputFrom<(typeof actors)['fetchProvider']>
				| import('xstate').OutputFrom<(typeof actors)['mapAccounts']>
				| import('xstate').OutputFrom<(typeof actors)['importTransactions']>
				| import('xstate').OutputFrom<(typeof actors)['persistOutcome']>
				| import('xstate').OutputFrom<(typeof actors)['mapAccounts']>
				| import('xstate').OutputFrom<(typeof actors)['importTransactions']>
		  >
		| import('xstate').ErrorActorEvent
	const workflow = setup({
		schemas: {
			context: types<Context>(),
			events: events0,
			input: types<Input>(),
			output: types<OperationResult>(),
			children: {
				lock: types<import('xstate').ActorRefFrom<(typeof actors)['lock']>>(),
				prepare: types<import('xstate').ActorRefFrom<(typeof actors)['prepare']>>(),
				startWork: types<import('xstate').ActorRefFrom<(typeof actors)['startWork']>>(),
				authorize: types<import('xstate').ActorRefFrom<(typeof actors)['authorize']>>(),
				disconnect: types<import('xstate').ActorRefFrom<(typeof actors)['disconnect']>>(),
				unlock: types<import('xstate').ActorRefFrom<(typeof actors)['unlock']>>(),
				fetchProvider: types<import('xstate').ActorRefFrom<(typeof actors)['fetchProvider']>>(),
				mapAccounts: types<import('xstate').ActorRefFrom<(typeof actors)['mapAccounts']>>(),
				importTransactions:
					types<import('xstate').ActorRefFrom<(typeof actors)['importTransactions']>>(),
				persistOutcome: types<import('xstate').ActorRefFrom<(typeof actors)['persistOutcome']>>(),
				mapping: types<import('xstate').ActorRefFrom<(typeof actors)['mapAccounts']>>(),
				import: types<import('xstate').ActorRefFrom<(typeof actors)['importTransactions']>>()
			},
			meta: types<BankViewMeta>()
		},
		states: {
			locking: {},
			preparing: {},
			allocatingWork: {
				schemas: { input: types<{ command: BankCommand; prepared: PreparedScope }>() }
			},
			choosingOperation: {},
			disconnecting: { states: { working: {}, cancelling: {}, failing: {} } },
			mapping: { states: { working: {}, cancelling: {}, failing: {} } },
			authorizingDisconnect: {},
			authorizingMapping: {},
			unlocking: {},
			authorizingFetch: {},
			fetching: {},
			authorizingResponse: {},
			checkingDiscovery: {},
			discovering: {},
			importing: { states: { working: {}, cancelling: {}, failing: {} } },
			classifyingSuccess: {},
			recordingComplete: {},
			recordingPartial: {},
			preparingFailure: {},
			recordingFailure: {},
			persistingOutcome: { states: { working: {}, cancelling: {}, failing: {} } },
			settlingFailure: {},
			complete: { type: 'final' },
			partial: { type: 'final' },
			cancelled: { type: 'final' },
			failed: { type: 'final' }
		},
		actors,
		guards: {
			mappingCancelling: (args: { value: import('xstate').StateValue }) =>
				matchesState({ mapping: 'cancelling' }, args.value),
			mappingFailing: (args: { value: import('xstate').StateValue }) =>
				matchesState({ mapping: 'failing' }, args.value)
		}
	})
	const failure = (context: Context, error: unknown, enqueue: (effect: () => void) => void) => {
		enqueue(() => context.work?.trace.failed('operation.failed', error))
		return { error, accessUrl: undefined }
	}
	return workflow.createMachine({
		id: 'bank-operation',
		initial: 'locking',
		context: ({ input }) => {
			const observation = observe()
			return {
				...input,
				identity: input.identity ?? {
					userId: observation.userId,
					organizationId: observation.organizationId
				},
				work: undefined,
				accessUrl: undefined,
				response: undefined,
				counts: emptyCounts(),
				accountResults: [],
				result: undefined,
				completion: undefined,
				error: undefined,
				importSettlement: 'settled',
				writeSettlement: 'settled',
				outcome: undefined
			}
		},
		output: ({ context }) => ({
			...required(context.completion),
			accountResults: context.accountResults
		}),
		invoke: {
			src: 'lock',
			input: ({ context }) => ({
				ownerId: context.identity.userId,
				organizationId: context.identity.organizationId
			}),
			onError: (args, enq) => {
				const { context, event } = args
				return {
					target: '.settlingFailure',
					context: failure(context, 'error' in event ? event.error : new Error('failure'), enq)
				}
			}
		},
		on: {
			CANCEL: { target: '.cancelled' },
			LOCK_FAILED: (args, enq) => {
				const { context, event } = args
				return {
					target: '.settlingFailure',
					context: failure(context, 'error' in event ? event.error : new Error('failure'), enq)
				}
			},
			IMPORT_PROGRESS: (args, enq) => {
				const { event } = args
				enq.sendTo(args.parent, event)
				return { context: { counts: event.counts } }
			}
		},
		states: {
			locking: {
				on: { LOCK_ACQUIRED: { target: 'preparing' } }
			},
			preparing: {
				invoke: {
					src: 'prepare',
					input: ({ context }) => ({ identity: context.identity, requireConnection: true }),
					onDone: (args) => {
						const { event } = args
						if (!event.output.ok) {
							return {
								target: 'settlingFailure',
								context: { error: event.output.ok ? undefined : event.output.error }
							}
						}
						return {
							target: 'allocatingWork',
							input: { command: args.context.command, prepared: event.output.value }
						}
					},
					onError: (args, enq) => {
						const { context, event } = args
						return {
							target: 'settlingFailure',
							context: failure(context, 'error' in event ? event.error : new Error('failure'), enq)
						}
					}
				}
			},
			allocatingWork: {
				invoke: {
					id: 'startWork',
					src: 'startWork',
					input: ({ input }) => input,
					onDone: ({ event }) => ({ target: 'choosingOperation', context: { work: event.output } }),
					onError: ({ context, event }, enq) => ({
						target: 'settlingFailure',
						context: failure(context, event.error, enq)
					})
				}
			},
			choosingOperation: {
				always: (args) => {
					const { context } = args
					if (context.command.type === 'DISCONNECT') {
						return { target: 'authorizingDisconnect' }
					}
					if (
						context.command.type === 'MAP' ||
						context.command.type === 'CREATE_ACCOUNT' ||
						context.command.type === 'RECONNECT'
					) {
						return { target: 'authorizingMapping' }
					}
					return { target: 'unlocking' }
				}
			},
			disconnecting: {
				initial: 'working',
				entry: () => {
					return {
						context: { writeSettlement: 'unresolved', response: undefined, accessUrl: undefined }
					}
				},
				states: {
					working: {},
					cancelling: { on: { CANCEL: {}, LOCK_FAILED: {} } },
					failing: { on: { LOCK_FAILED: {} } }
				},
				on: {
					CANCEL: { target: '.cancelling' },
					LOCK_FAILED: (args, enq) => {
						const { context, event } = args
						return {
							target: '.failing',
							context: failure(context, 'error' in event ? event.error : new Error('failure'), enq)
						}
					}
				},
				invoke: {
					src: 'disconnect',
					input: ({ context }) => workFor(context),
					onDone: (args) => {
						if (matchesState({ disconnecting: 'cancelling' }, args.value)) {
							return { target: 'cancelled', context: { writeSettlement: 'settled' } }
						}
						if (matchesState({ disconnecting: 'failing' }, args.value)) {
							return { target: 'settlingFailure', context: { writeSettlement: 'settled' } }
						}
						return { target: 'complete', context: { writeSettlement: 'settled', result: [] } }
					},
					onError: (args, enq) => {
						const { context, event } = args
						if (matchesState1({ disconnecting: 'cancelling' }, args.value)) {
							return {
								target: 'cancelled',
								context: ((args) => ({ writeSettlement: 'unresolved' }))(args)
							}
						}
						if (matchesState1({ disconnecting: 'failing' }, args.value)) {
							return {
								target: 'settlingFailure',
								context: ((args) => ({ writeSettlement: 'unresolved' }))(args)
							}
						}
						{
							let context = args.context
							let patch = {}
							patch = { ...patch, ...((args) => ({ writeSettlement: 'unresolved' }))(args) }
							context = { ...args.context, ...patch }
							patch = {
								...patch,
								...failure(context, 'error' in event ? event.error : new Error('failure'), enq)
							}
							context = { ...args.context, ...patch }
							return { target: 'settlingFailure', context: patch }
						}
					}
				}
			},
			mapping: {
				entry: () => {
					return { context: { writeSettlement: 'unresolved' } }
				},
				initial: 'working',
				states: {
					working: {},
					cancelling: { on: { CANCEL: {}, LOCK_FAILED: {} } },
					failing: { on: { LOCK_FAILED: {} } }
				},
				on: {
					CANCEL: (args, enq) => {
						{
							const child = args.children.mapping
							if (child?.getSnapshot().status === 'active') enq.sendTo(child, { type: 'CANCEL' })
						}
						return { target: '.cancelling' }
					},
					LOCK_FAILED: (args, enq) => {
						const { context, event } = args
						{
							const child = args.children.mapping
							if (child?.getSnapshot().status === 'active') enq.sendTo(child, { type: 'CANCEL' })
						}
						return {
							target: '.failing',
							context: failure(context, 'error' in event ? event.error : new Error('failure'), enq)
						}
					}
				},
				invoke: {
					id: 'mapping',
					src: 'mapAccounts',
					input: ({ context }) => ({ work: workFor(context), discovered: context.discovered }),
					onDone: (args) => {
						const { event } = args
						if (matchesState({ mapping: 'cancelling' }, args.value)) {
							return {
								target: 'cancelled',
								context: { writeSettlement: event.output.ok ? 'settled' : 'unresolved' }
							}
						}
						if (matchesState({ mapping: 'failing' }, args.value)) {
							return {
								target: 'settlingFailure',
								context: { writeSettlement: event.output.ok ? 'settled' : 'unresolved' }
							}
						}
						if (!event.output.ok) {
							return {
								target: 'settlingFailure',
								context: { error: event.output.ok ? undefined : event.output.error }
							}
						}
						return { target: 'complete', context: { writeSettlement: 'settled' } }
					},
					onError: (args, enq) => {
						const { context, event } = args
						if (args.guards.mappingCancelling(args)) {
							return { target: 'cancelled' }
						}
						if (args.guards.mappingFailing(args)) {
							return { target: 'settlingFailure' }
						}
						return {
							target: 'settlingFailure',
							context: failure(context, 'error' in event ? event.error : new Error('failure'), enq)
						}
					}
				}
			},
			authorizingDisconnect: {
				invoke: {
					src: 'authorize',
					input: ({ context }) => credentialAuthorization(workFor(context)),
					onDone: (args) => {
						const { event } = args
						if (event.output.error !== undefined) {
							return { target: 'settlingFailure', context: { error: event.output.error } }
						}
						return { target: 'disconnecting' }
					},
					onError: (args, enq) => {
						const { context, event } = args
						return {
							target: 'settlingFailure',
							context: failure(context, 'error' in event ? event.error : new Error('failure'), enq)
						}
					}
				}
			},
			authorizingMapping: {
				invoke: {
					src: 'authorize',
					input: ({ context }) => credentialAuthorization(workFor(context)),
					onDone: (args) => {
						const { event } = args
						if (event.output.error !== undefined) {
							return { target: 'settlingFailure', context: { error: event.output.error } }
						}
						return { target: 'mapping' }
					},
					onError: (args, enq) => {
						const { context, event } = args
						return {
							target: 'settlingFailure',
							context: failure(context, 'error' in event ? event.error : new Error('failure'), enq)
						}
					}
				}
			},
			unlocking: {
				meta: { loadingProvider: true },
				invoke: {
					src: 'unlock',
					input: ({ context }) => workFor(context),
					onDone: (args) => {
						return { target: 'authorizingFetch', context: { accessUrl: args.event.output } }
					},
					onError: (args, enq) => {
						const { context } = args
						enq(
							({ context, event }) =>
								context.work?.trace.failed('credential.unlock.failed', event.error),
							args
						)
						return {
							target: 'preparingFailure',
							context: failure(context, new Error('unlock_failure'), enq)
						}
					}
				}
			},
			authorizingFetch: {
				invoke: {
					src: 'authorize',
					input: ({ context }) => credentialAuthorization(workFor(context)),
					onDone: (args) => {
						const { event } = args
						if (event.output.error !== undefined) {
							return {
								target: 'settlingFailure',
								context: { error: event.output.error, accessUrl: undefined }
							}
						}
						return { target: 'fetching' }
					},
					onError: (args, enq) => {
						const { context, event } = args
						return {
							target: 'settlingFailure',
							context: failure(context, 'error' in event ? event.error : new Error('failure'), enq)
						}
					}
				}
			},
			fetching: {
				meta: { loadingProvider: true },
				invoke: {
					src: 'fetchProvider',
					input: ({ context }) => {
						if (!context.accessUrl) throw new Error('invalid-credential')
						return { work: workFor(context), accessUrl: context.accessUrl }
					},
					onDone: (args) => {
						return {
							target: 'authorizingResponse',
							context: { response: args.event.output, accessUrl: undefined }
						}
					},
					onError: (args, enq) => {
						const { context } = args
						enq(
							({ context, event }) =>
								context.work?.trace.failed('provider.fetch.failed', event.error),
							args
						)
						return {
							target: 'preparingFailure',
							context: failure(context, new Error('provider_failure'), enq)
						}
					}
				}
			},
			authorizingResponse: {
				invoke: {
					src: 'authorize',
					input: ({ context }) => credentialAuthorization(workFor(context)),
					onDone: (args) => {
						const { event } = args
						if (event.output.error !== undefined) {
							return { target: 'settlingFailure', context: { error: event.output.error } }
						}
						if (args.context.command.type === 'DISCOVER') {
							return { target: 'checkingDiscovery' }
						}
						return { target: 'importing' }
					},
					onError: (args, enq) => {
						const { context, event } = args
						return {
							target: 'settlingFailure',
							context: failure(context, 'error' in event ? event.error : new Error('failure'), enq)
						}
					}
				}
			},
			checkingDiscovery: {
				always: (args) => {
					if (
						required(args.context.response).errors.length > 0 &&
						required(args.context.response).accounts.length === 0
					) {
						return { target: 'settlingFailure', context: { error: new Error('provider_failure') } }
					}
					return { target: 'discovering' }
				}
			},
			discovering: {
				entry: (args) => {
					return {
						context: {
							result: required(args.context.response).accounts.map((account) => ({
								id: providerAccountIdentity(account),
								name: account.name,
								currency: account.currency,
								...providerBalanceSnapshot(account)
							}))
						}
					}
				},
				always: ({ context }) => ({
					target: required(context.response).errors.length > 0 ? 'partial' : 'complete'
				})
			},
			importing: {
				initial: 'working',
				meta: { loadingProvider: true },
				states: {
					working: {},
					cancelling: { on: { CANCEL: {}, LOCK_FAILED: {} } },
					failing: { on: { LOCK_FAILED: {} } }
				},
				on: {
					CANCEL: (args, enq) => {
						{
							const child = args.children.import
							if (child?.getSnapshot().status === 'active') enq.sendTo(child, { type: 'CANCEL' })
						}
						return {
							target: '.cancelling',
							context: ((args) => ({ accessUrl: undefined, response: undefined }))(args)
						}
					},
					LOCK_FAILED: (args, enq) => {
						let context = args.context
						const { event } = args
						let patch = {}
						patch = {
							...patch,
							...failure(context, 'error' in event ? event.error : new Error('failure'), enq)
						}
						context = { ...args.context, ...patch }
						patch = { ...patch, ...((args) => ({ response: undefined }))({ ...args, context }) }
						context = { ...args.context, ...patch }
						{
							const child = args.children.import
							if (child?.getSnapshot().status === 'active') enq.sendTo(child, { type: 'CANCEL' })
						}
						return { target: '.failing', context: patch }
					}
				},
				invoke: {
					id: 'import',
					src: 'importTransactions',
					input: ({ context }) => ({
						work: workFor(context),
						response: required(context.response)
					}),
					onDone: (args) => {
						const { event } = args
						if (matchesState({ importing: 'cancelling' }, args.value)) {
							return { target: 'cancelled', context: importCompletion(event.output) }
						}
						if (matchesState({ importing: 'failing' }, args.value)) {
							return { target: 'settlingFailure', context: importCompletion(event.output) }
						}
						if (event.output.kind === 'cancelled') {
							return {
								target: 'cancelled',
								context: { ...importCompletion(event.output), error: event.output.error }
							}
						}
						if (event.output.kind === 'failed') {
							return {
								target: 'preparingFailure',
								context: { ...importCompletion(event.output), error: event.output.error }
							}
						}
						return { target: 'classifyingSuccess', context: importCompletion(event.output) }
					},
					onError: (args, enq) => {
						const { context, event } = args
						if (matchesState1({ importing: 'cancelling' }, args.value)) {
							return {
								target: 'cancelled',
								context: ((args) => ({ importSettlement: 'unresolved' }))(args)
							}
						}
						if (matchesState1({ importing: 'failing' }, args.value)) {
							return {
								target: 'settlingFailure',
								context: ((args) => ({ importSettlement: 'unresolved' }))(args)
							}
						}
						{
							let context = args.context
							let patch = {}
							patch = { ...patch, ...((args) => ({ importSettlement: 'unresolved' }))(args) }
							context = { ...args.context, ...patch }
							patch = {
								...patch,
								...failure(context, 'error' in event ? event.error : new Error('failure'), enq)
							}
							context = { ...args.context, ...patch }
							return { target: 'recordingFailure', context: patch }
						}
					}
				}
			},
			classifyingSuccess: {
				always: (args) => {
					const { context } = args
					if (context.counts.omitted > 0) {
						return { target: 'recordingPartial' }
					}
					if ((context.response?.errors.length ?? 0) > 0) {
						return { target: 'recordingPartial' }
					}
					return { target: 'recordingComplete' }
				}
			},
			recordingComplete: {
				entry: () => {
					return { context: { outcome: { lastOutcome: 'succeeded', lastError: null } } }
				},
				always: { target: 'persistingOutcome' }
			},
			recordingPartial: {
				entry: () => {
					return { context: { outcome: { lastOutcome: 'partial', lastError: null } } }
				},
				always: { target: 'persistingOutcome' }
			},
			preparingFailure: {
				entry: () => {
					return { context: { accessUrl: undefined } }
				},
				always: (args) => {
					if (args.context.command.type !== 'SYNC') {
						return { target: 'settlingFailure' }
					}
					return { target: 'recordingFailure' }
				}
			},
			recordingFailure: {
				entry: () => {
					return { context: { outcome: { lastOutcome: 'failed', lastError: 'operation-failed' } } }
				},
				always: { target: 'persistingOutcome' }
			},
			persistingOutcome: {
				initial: 'working',
				entry: () => {
					return {
						context: { writeSettlement: 'unresolved', response: undefined, accessUrl: undefined }
					}
				},
				states: {
					working: {},
					cancelling: { on: { CANCEL: {}, LOCK_FAILED: {} } },
					failing: { on: { LOCK_FAILED: {} } }
				},
				on: {
					CANCEL: { target: '.cancelling' },
					LOCK_FAILED: (args, enq) => {
						const { context, event } = args
						return {
							target: '.failing',
							context: failure(context, 'error' in event ? event.error : new Error('failure'), enq)
						}
					}
				},
				invoke: {
					src: 'persistOutcome',
					input: ({ context }) => ({
						work: workFor(context),
						counts: context.counts,
						outcome: required(context.outcome)
					}),
					onDone: (args) => {
						const { context } = args
						if (matchesState({ persistingOutcome: 'cancelling' }, args.value)) {
							return { target: 'cancelled', context: { writeSettlement: 'settled' } }
						}
						if (matchesState({ persistingOutcome: 'failing' }, args.value)) {
							return { target: 'settlingFailure', context: { writeSettlement: 'settled' } }
						}
						if (context.outcome?.lastOutcome === 'succeeded') {
							return { target: 'complete', context: { writeSettlement: 'settled' } }
						}
						if (context.outcome?.lastOutcome === 'partial') {
							return { target: 'partial', context: { writeSettlement: 'settled' } }
						}
						return { target: 'settlingFailure', context: { writeSettlement: 'settled' } }
					},
					onError: (args, enq) => {
						const { context, event } = args
						if (matchesState1({ persistingOutcome: 'cancelling' }, args.value)) {
							return {
								target: 'cancelled',
								context: ((args) => ({ writeSettlement: 'unresolved' }))(args)
							}
						}
						if (matchesState1({ persistingOutcome: 'failing' }, args.value)) {
							return {
								target: 'settlingFailure',
								context: ((args) => ({ writeSettlement: 'unresolved' }))(args)
							}
						}
						if (context.outcome?.lastOutcome === 'failed') {
							return {
								target: 'settlingFailure',
								context: ((args) => ({ writeSettlement: 'unresolved' }))(args)
							}
						}
						{
							let context = args.context
							let patch = {}
							patch = { ...patch, ...((args) => ({ writeSettlement: 'unresolved' }))(args) }
							context = { ...args.context, ...patch }
							patch = {
								...patch,
								...failure(context, 'error' in event ? event.error : new Error('failure'), enq)
							}
							context = { ...args.context, ...patch }
							return { target: 'settlingFailure', context: patch }
						}
					}
				}
			},
			settlingFailure: {
				always: (args) => {
					const { context } = args
					if (context.error instanceof Error && context.error.message === 'disconnected') {
						return { target: 'cancelled' }
					}
					return { target: 'failed' }
				}
			},
			complete: {
				type: 'final',
				entry: (args) => {
					let context = args.context
					let patch = {}
					patch = {
						...patch,
						...((args) => ({
							completion: (({ context }) => ({
								kind: 'complete',
								counts: context.counts,
								discovered: context.result,
								settlement: operationSettlement(context)
							}))(args)
						}))(args)
					}
					context = { ...args.context, ...patch }
					patch = {
						...patch,
						...((args) => ({
							work: undefined,
							accessUrl: undefined,
							response: undefined,
							outcome: undefined
						}))({ ...args, context })
					}
					context = { ...args.context, ...patch }
					return { context: patch }
				}
			},
			partial: {
				type: 'final',
				entry: (args) => {
					let context = args.context
					let patch = {}
					patch = {
						...patch,
						...((args) => ({
							completion: (({ context }) => ({
								kind: 'partial',
								counts: context.counts,
								discovered: context.result,
								settlement: operationSettlement(context)
							}))(args)
						}))(args)
					}
					context = { ...args.context, ...patch }
					patch = {
						...patch,
						...((args) => ({
							work: undefined,
							accessUrl: undefined,
							response: undefined,
							outcome: undefined
						}))({ ...args, context })
					}
					context = { ...args.context, ...patch }
					return { context: patch }
				}
			},
			cancelled: {
				type: 'final',
				entry: (args) => {
					let context = args.context
					let patch = {}
					patch = {
						...patch,
						...((args) => ({
							completion: (({ context }) => ({
								kind: 'cancelled',
								counts: context.counts,
								discovered: context.result,
								settlement: operationSettlement(context),
								error: context.error ?? new Error('disconnected')
							}))(args)
						}))(args)
					}
					context = { ...args.context, ...patch }
					patch = {
						...patch,
						...((args) => ({
							work: undefined,
							accessUrl: undefined,
							response: undefined,
							outcome: undefined
						}))({ ...args, context })
					}
					context = { ...args.context, ...patch }
					return { context: patch }
				}
			},
			failed: {
				type: 'final',
				entry: (args) => {
					let context = args.context
					let patch = {}
					patch = {
						...patch,
						...((args) => ({
							completion: (({ context }) => ({
								kind: 'failed',
								counts: context.counts,
								discovered: context.result,
								settlement: operationSettlement(context),
								error: context.error
							}))(args)
						}))(args)
					}
					context = { ...args.context, ...patch }
					patch = {
						...patch,
						...((args) => ({
							work: undefined,
							accessUrl: undefined,
							response: undefined,
							outcome: undefined
						}))({ ...args, context })
					}
					context = { ...args.context, ...patch }
					return { context: patch }
				}
			}
		}
	})
}
