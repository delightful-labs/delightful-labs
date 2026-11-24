import { signOutMachine, signOutInput, type SignOutStage } from './sign-out.js'
import {
	types,
	type SnapshotFrom,
	createCallbackLogic,
	setup,
	createAsyncLogic,
	matchesState
} from 'xstate'
import { createSessionChangeMachine } from 'delightful-local-first/session/runtime'
import type {
	SessionRuntimeView,
	SessionRuntimeChangeInput
} from 'delightful-local-first/session/runtime'
import { restorationMachine } from 'delightful-local-first/restoration/workflow'
import { t, recoveryMessages } from '../../localization/index.js'
import { stateFeedback } from '../../contracts/feedback.js'
import type { NamedState, WorkflowMessage } from '../../contracts/feedback.js'
import { workspaceLibraryMachine, selectWorkspaceLibrary } from './workspace-library.js'
import { rootStartupMachine, type RootInitializationResult } from './root-bootstrap.js'
import type { WorkspaceInitializationReport } from 'delightful-local-first/workspace/startup-contracts'
import { sameAccountBinding } from '../../contracts/account.js'
import type {
	AccountBinding,
	AccountCapabilities,
	AccountInput,
	AccountObservation,
	RootWrite
} from '../../contracts/account.js'
import type { ConnectionEvent, ConnectionObserver } from '../../contracts/connection.js'

function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Account capability unavailable')
	return value
}
/** Missing observations withdraw admission; native session owns status and retry. */
function observation(view: SessionRuntimeView<AccountCapabilities>): AccountObservation {
	return (
		view.observation ?? {
			status:
				view.stage === 'acquiring'
					? 'starting'
					: view.stage === 'active'
						? 'transitioning'
						: view.stage === 'closed' || view.stage === 'closing'
							? 'closed'
							: 'error'
		}
	)
}
type Context = {
	input: AccountInput
	observation: AccountObservation
	adoption: AccountBinding | undefined
	write: RootWrite | undefined
	phrase: string
	attempt: number
	clean: boolean
}
type AccountFeedback = 'identityFailed' | 'restoreFailed' | 'restoreInvalid'
type AccountMeta = NamedState & {
	name: string
	variant: WorkflowMessage['variant']
	status?: MachineStatus
	feedback?: AccountFeedback
}
function accountStatus(status: MachineStatus, name: string): AccountMeta {
	return { status, name, variant: 'info', channel: 'account' }
}
const configuration = accountStatus('working', t('account.status.configuration'))
const starting = accountStatus('starting', t('account.status.starting'))
const working = accountStatus('working', t('account.status.working'))

export function createApplicationReadinessMachine(observeConnection?: ConnectionObserver) {
	const actors = {
		observation: createCallbackLogic<{ type: 'READ' }, AccountInput['session']>(
			({ input, receive, sendBack }) => {
				const publish = (view: SessionRuntimeView<AccountCapabilities>) => {
					if (view.stage === 'failed') sendBack({ type: 'NATIVE_FAILED' })
					sendBack({ type: 'OBSERVED', observation: observation(view), stage: view.stage })
				}
				const read = () => {
					try {
						publish(input.view.get())
					} catch {
						sendBack({ type: 'NATIVE_FAILED' })
					}
				}
				const subscription = input.view.subscribe({
					next: publish,
					error: () => sendBack({ type: 'NATIVE_FAILED' }),
					complete: read
				})
				receive(read)
				read()
				return () => subscription.unsubscribe()
			}
		),
		connection: createCallbackLogic<ConnectionEvent>(({ sendBack }) =>
			observeConnection?.(sendBack)
		),
		change: createSessionChangeMachine((input: SessionRuntimeChangeInput) => input),
		logout: signOutMachine,
		restore: restorationMachine,
		library: workspaceLibraryMachine,
		bootstrap: rootStartupMachine,
		global: createAsyncLogic({ run: ({ input }: { input: RootWrite }) => input.global() })
	}
	const model = setup({
		schemas: {
			context: types<Context>(),
			meta: types<AccountMeta>(),
			input: types<AccountInput>(),
			output: types<{ clean: boolean }>(),
			events: {
				ONLINE: types(),
				OFFLINE: types(),
				CREATE: types(),
				LOGOUT: types(),
				RETRY: types(),
				SHUTDOWN: types(),
				RESTORE: types<{ phrase: string }>(),
				OBSERVED: types<{ observation: AccountObservation; stage: SessionRuntimeView['stage'] }>(),
				NATIVE_FAILED: types(),
				LIBRARY_DISPOSAL_FAILED: types(),
				WORKSPACE_INITIALIZATION_RESULT:
					types<Omit<WorkspaceInitializationReport<RootInitializationResult>, 'type'>>(),
				SIGN_OUT_OVERDUE: types<{ stage: SignOutStage }>(),
				RESTORATION_VALIDATED: types<{ binding: object; attempt: number }>(),
				RESTORATION_PREPARE_REQUESTED: types<{ binding: object; attempt: number }>()
			},
			internalEvents: {
				FEEDBACK_CLEAR: types(),
				IDENTITY_FAILED: types(),
				RESTORE_INVALID: types(),
				RESTORE_FAILED: types()
			},
			children: {
				observation: types<import('xstate').ActorRefFrom<typeof actors.observation>>(),
				connection: types<import('xstate').ActorRefFrom<typeof actors.connection>>(),
				change: types<import('xstate').ActorRefFrom<typeof actors.change>>(),
				logout: types<import('xstate').ActorRefFrom<typeof actors.logout>>(),
				restore: types<import('xstate').ActorRefFrom<typeof actors.restore>>(),
				library: types<import('xstate').ActorRefFrom<typeof workspaceLibraryMachine>>(),
				bootstrap: types<import('xstate').ActorRefFrom<typeof rootStartupMachine>>(),
				global: types<import('xstate').ActorRefFrom<typeof actors.global>>()
			}
		},
		actors,
		guards: {
			sameBinding: ({
				context,
				event
			}: {
				context: Context
				event: { type: string; observation?: AccountObservation }
			}) =>
				!!event.observation &&
				sameAccountBinding(context.observation, event.observation) &&
				context.observation.status === 'ready' &&
				event.observation.status === 'ready' &&
				context.observation.localFirst === event.observation.localFirst,
			libraryStoppingFor: (
				{ value }: { value: import('xstate').StateValue },
				reason: 'restore' | 'logout' | 'replace'
			) =>
				matchesState(
					{ active: { flow: { running: { library: { ready: { stopping: reason } } } } } },
					value
				),
			stoppingBootstrap: ({ value }: { value: import('xstate').StateValue }) =>
				matchesState({ active: { flow: { running: { library: 'stopping' } } } }, value),
			replacingBootstrap: ({ value }: { value: import('xstate').StateValue }) =>
				matchesState({ active: { flow: { running: { library: 'replacing' } } } }, value),
			stoppingChange: ({ value }: { value: import('xstate').StateValue }) =>
				matchesState({ active: { flow: { running: { changing: 'stopping' } } } }, value),
			stoppingRestore: ({ value }: { value: import('xstate').StateValue }) =>
				matchesState({ active: { flow: { running: { restoring: 'stopping' } } } }, value),
			stoppingLogout: ({ value }: { value: import('xstate').StateValue }) =>
				matchesState({ active: { flow: { running: { loggingOut: 'stopping' } } } }, value)
		},
		actions: {
			rememberObservation: ({
				event
			}: {
				event: { type: string; observation?: AccountObservation }
			}) => ({ context: event.observation ? { observation: event.observation } : {} }),
			refreshBinding: ({
				event
			}: {
				event: { type: string; observation?: AccountObservation }
			}) => ({ context: event.observation ? { observation: event.observation } : {} }),
			clearPhrase: () => ({ context: { phrase: '' } })
		}
	})
	return model.createMachine({
		id: 'application-readiness',
		initial: 'active',
		context: ({ input }) => ({
			input,
			observation: { status: 'starting' },
			adoption: undefined,
			write: undefined,
			phrase: '',
			attempt: 0,
			clean: true
		}),
		output: ({ context }) => ({ clean: context.clean }),
		invoke: [
			{
				id: 'observation',
				src: 'observation',
				input: ({ context }) => context.input.session,
				onError: (_args, enq) => enq.raise({ type: 'NATIVE_FAILED' })
			}
		],
		on: {
			LIBRARY_DISPOSAL_FAILED: () => ({ context: { clean: false } }),
			NATIVE_FAILED: (_args, enq) => {
				enq.raise({ type: 'SHUTDOWN' })
				return { context: { clean: false } }
			}
		},
		states: {
			active: {
				type: 'parallel',
				states: {
					connection: {
						initial: 'observing',
						states: {
							observing: {
								initial: 'checking',
								invoke: { id: 'connection', src: 'connection', onError: { target: 'closed' } },
								on: {
									ONLINE: { target: '.online' },
									OFFLINE: { target: '.offline' },
									SHUTDOWN: { target: 'closed' }
								},
								states: {
									checking: {},
									online: {
										meta: { name: t('connection.online'), variant: 'info', channel: 'connection' }
									},
									offline: {
										meta: { name: t('connection.offline'), variant: 'info', channel: 'connection' }
									}
								}
							},
							closed: {}
						}
					},
					feedback: {
						initial: 'none',
						on: {
							FEEDBACK_CLEAR: { target: '.none' },
							IDENTITY_FAILED: { target: '.identityFailed' },
							RESTORE_INVALID: { target: '.restoreInvalid' },
							RESTORE_FAILED: { target: '.restoreFailed' }
						},
						states: {
							none: {},
							identityFailed: {
								meta: {
									channel: 'feedback',
									feedback: 'identityFailed',
									name: t('account.feedback.identityFailed'),
									variant: 'error'
								}
							},
							restoreInvalid: {
								meta: {
									channel: 'feedback',
									feedback: 'restoreInvalid',
									name: t('account.feedback.restoreInvalid'),
									variant: 'error'
								}
							},
							restoreFailed: {
								meta: {
									channel: 'feedback',
									feedback: 'restoreFailed',
									name: t('account.feedback.restoreFailed'),
									variant: 'error'
								}
							}
						}
					},
					flow: {
						initial: 'running',
						on: { SHUTDOWN: { target: '.closing' } },
						states: {
							running: {
								initial: 'route',
								on: {
									OBSERVED: (args) => ({ context: args.actions.rememberObservation(args).context }),
									SHUTDOWN: { target: 'closing' }
								},
								states: {
									route: {
										id: 'application-active-flow-running-route',
										entry: () => ({ context: { write: undefined } }),
										always: ({ context }) => {
											if (
												context.observation.status === 'ready' &&
												context.observation.localFirst
											) {
												return {
													target: 'library',
													context: {
														adoption: {
															observation: context.observation,
															scope: { binding: context.observation.binding, attachment: {} }
														}
													}
												}
											}
											if (context.observation.status === 'signed-out')
												return { target: 'signedOut', context: { adoption: undefined } }
											if (context.observation.status === 'starting')
												return { target: 'opening', context: { adoption: undefined } }
											if (
												context.observation.status === 'transitioning' ||
												context.observation.status === 'ready'
											)
												return { target: 'waiting', context: { adoption: undefined } }
											return { target: 'unavailable', context: { adoption: undefined } }
										}
									},
									opening: {
										meta: starting,
										on: {
											OBSERVED: (args) => ({
												target: 'route',
												context: args.actions.rememberObservation(args).context
											})
										}
									},
									waiting: {
										meta: starting,
										on: {
											OBSERVED: (args) => ({
												target: 'route',
												context: args.actions.rememberObservation(args).context
											})
										}
									},
									unavailable: {
										meta: accountStatus('unavailable', t('account.status.unavailable')),
										on: {
											OBSERVED: (args) => ({
												target: 'route',
												context: args.actions.rememberObservation(args).context
											}),
											RETRY: ({ context }, enq) => {
												enq.sendTo(context.input.session.owner, { type: 'RETRY' })
												return { target: 'refreshing' }
											}
										}
									},
									refreshing: {
										meta: working,
										entry: (_args, enq) => enq.sendTo('observation', { type: 'READ' }),
										on: {
											OBSERVED: (args) => ({
												target: 'route',
												context: args.actions.rememberObservation(args).context
											})
										}
									},
									signedOut: {
										meta: accountStatus('signedOut', t('account.status.signedOut')),
										on: {
											OBSERVED: (args) => ({
												target: 'route',
												context: args.actions.rememberObservation(args).context
											}),
											CREATE: ({ context }, enq) => {
												enq.raise({ type: 'FEEDBACK_CLEAR' })
												return { target: 'changing', context: { attempt: context.attempt + 1 } }
											},
											RESTORE: ({ context, event }) => ({
												target: 'restoring',
												context: { phrase: event.phrase, attempt: context.attempt + 1 }
											})
										}
									},
									retrying: {
										id: 'application-active-flow-running-retrying',
										initial: 'active',
										states: {
											active: {},
											stopping: { meta: accountStatus('closing', t('account.status.closing')) }
										},
										on: { SHUTDOWN: { target: '.stopping' } },
										invoke: {
											id: 'change',
											src: 'change',
											input: ({ context }) => ({
												session: context.input.session,
												scope: { binding: context.input.session.binding, attempt: context.attempt },
												change: { operation: 'retry' }
											}),
											onDone: ({ value }) => ({
												target: matchesState(
													{ active: { flow: { running: { retrying: 'stopping' } } } },
													value
												)
													? 'draining'
													: 'refreshing'
											}),
											onError: ({ value }, enq) => {
												enq.raise({ type: 'IDENTITY_FAILED' })
												return {
													target: matchesState(
														{ active: { flow: { running: { retrying: 'stopping' } } } },
														value
													)
														? 'draining'
														: 'refreshing'
												}
											}
										}
									},
									changing: {
										initial: 'active',
										states: {
											active: {},
											stopping: { meta: accountStatus('closing', t('account.status.closing')) }
										},
										on: { SHUTDOWN: { target: '.stopping' } },
										invoke: {
											id: 'change',
											src: 'change',
											input: ({ context }) => ({
												session: context.input.session,
												scope: { binding: context.input.session.binding, attempt: context.attempt },
												change: {
													operation: 'create',
													before:
														context.observation.status === 'signed-out'
															? context.observation
															: undefined
												}
											}),
											onDone: (args, enq) => {
												if (args.event.output.outcome !== 'completed')
													enq.raise({ type: 'IDENTITY_FAILED' })
												return {
													target: args.guards.stoppingChange(args) ? 'draining' : 'refreshing'
												}
											},
											onError: (args, enq) => {
												enq.raise({ type: 'IDENTITY_FAILED' })
												return {
													target: args.guards.stoppingChange(args) ? 'draining' : 'refreshing'
												}
											}
										}
									},
									restoring: {
										id: 'application-active-flow-running-restoring',
										initial: 'active',
										entry: (_args, enq) => enq.raise({ type: 'FEEDBACK_CLEAR' }),
										states: {
											active: {},
											stopping: { meta: accountStatus('closing', t('account.status.closing')) }
										},
										on: {
											SHUTDOWN: (args, enq) => {
												enq.sendTo('restore', { type: 'SHUTDOWN' })
												return { target: '.stopping', context: args.actions.clearPhrase().context }
											},
											RESTORATION_VALIDATED: ({ context, event }) =>
												event.binding === context.input.session.binding &&
												event.attempt === context.attempt
													? { context: { phrase: '' } }
													: undefined,
											RESTORATION_PREPARE_REQUESTED: ({ context, event }, enq) => {
												if (
													event.binding === context.input.session.binding &&
													event.attempt === context.attempt
												)
													enq.sendTo('restore', {
														type: 'PREPARED',
														binding: event.binding,
														attempt: event.attempt
													})
											}
										},
										invoke: {
											id: 'restore',
											src: 'restore',
											input: ({ context, self }) => ({
												phrase: context.phrase,
												scope: { binding: context.input.session.binding, attempt: context.attempt },
												reportTo: self,
												capability: {
													runtime: context.input.session,
													parsePhrase: context.input.parsePhrase,
													isCurrentBinding: (binding) => binding === context.input.session.binding,
													readIdentity: async () => {
														const current = context.input.session.view.get().observation
														return current?.status === 'ready'
															? { kind: 'ready', identityId: current.identityId }
															: { kind: 'unavailable' }
													}
												}
											}),
											onDone: (args, enq) => {
												if (args.event.output.outcome === 'invalid')
													enq.raise({ type: 'RESTORE_INVALID' })
												else if (args.event.output.outcome !== 'restored')
													enq.raise({ type: 'RESTORE_FAILED' })
												return {
													target: args.guards.stoppingRestore(args) ? 'draining' : 'refreshing',
													context: { phrase: '' }
												}
											},
											onError: (args, enq) => {
												enq.raise({ type: 'RESTORE_FAILED' })
												return {
													target: args.guards.stoppingRestore(args) ? 'draining' : 'refreshing',
													context: { phrase: '' }
												}
											}
										}
									},
									loggingOut: {
										id: 'application-active-flow-running-loggingOut',
										initial: 'active',
										states: {
											active: {
												on: {
													SIGN_OUT_OVERDUE: (_args, enq) => {
														enq.raise({ type: 'IDENTITY_FAILED' })
														return { target: 'overdue' }
													}
												}
											},
											overdue: {
												meta: {
													...accountStatus('working', t('account.feedback.identityFailed')),
													variant: 'error'
												}
											},
											stopping: { meta: accountStatus('closing', t('account.status.closing')) }
										},
										on: {
											SHUTDOWN: { target: '.stopping' },
											SIGN_OUT_OVERDUE: (_args, enq) => enq.raise({ type: 'IDENTITY_FAILED' })
										},
										invoke: {
											id: 'logout',
											src: 'logout',
											input: ({ context, self }) =>
												signOutInput(context.input, context.observation, context.attempt, (stage) =>
													self.send({ type: 'SIGN_OUT_OVERDUE', stage })
												),
											onDone: (args, enq) => {
												if (args.event.output.outcome === 'failed')
													enq.raise({ type: 'IDENTITY_FAILED' })
												return {
													target: args.guards.stoppingLogout(args) ? 'draining' : 'refreshing'
												}
											},
											onError: (args, enq) => {
												enq.raise({ type: 'IDENTITY_FAILED' })
												return {
													target: args.guards.stoppingLogout(args) ? 'draining' : 'refreshing'
												}
											}
										}
									},
									library: {
										id: 'application-active-flow-running-library',
										initial: 'bootstrapping',
										invoke: {
											id: 'bootstrap',
											src: 'bootstrap',
											input: ({ context, self }) => ({
												binding: required(context.adoption),
												recipient: self,
												initialization: {
													db: required(context.adoption).observation.capabilities.root,
													userId: required(context.adoption).observation.identityId
												}
											}),
											onDone: (args) => {
												const result = args.event.output.initialization
												if (args.event.output.outcome === 'unresolved' || result === undefined)
													return {
														target: '#application-active-flow-running-draining',
														context: {
															clean: false,
															write: result && 'write' in result ? result.write : undefined
														}
													}
												if (args.guards.stoppingBootstrap(args)) {
													return { target: '#application-active-flow-running-draining' }
												}
												if (args.guards.replacingBootstrap(args)) {
													return { target: '#application-active-flow-running-route' }
												}
												if (result.outcome === 'ready' && result.persistence === undefined) {
													return { target: '.ready.existing', context: { write: undefined } }
												}
												if (result.outcome === 'ready') {
													return {
														target: '.ready.syncPending',
														context: {
															write:
																result.persistence?.outcome === 'succeeded'
																	? result.persistence.write
																	: undefined
														}
													}
												}
												if (
													result.outcome === 'unavailable' &&
													result.reason === 'canonicalRootConflict'
												) {
													return { target: '.conflict' }
												}
												return { target: '.failed' }
											},
											onError: {
												target: '#application-active-flow-running-draining',
												context: { clean: false }
											}
										},
										on: {
											OBSERVED: (args) => {
												if (args.guards.sameBinding(args)) {
													return args.actions.refreshBinding(args)
												}
												return {
													target: '#application-active-flow-running-route',
													context: args.actions.rememberObservation(args).context
												}
											}
										},
										states: {
											bootstrapping: {
												meta: accountStatus('openingLibrary', t('account.status.openingLibrary')),
												on: {
													WORKSPACE_INITIALIZATION_RESULT: ({ context, event }, enq) => {
														if (event.binding !== context.adoption) return
														enq.sendTo('bootstrap', { type: 'SHUTDOWN' })
														return { target: 'settling' }
													},
													SHUTDOWN: (args, enq) => {
														enq.sendTo('bootstrap', { type: 'SHUTDOWN' })
														return { target: 'stopping' }
													},
													OBSERVED: (args, enq) => {
														if (args.guards.sameBinding(args)) {
															return args.actions.refreshBinding(args)
														}
														enq.sendTo('bootstrap', { type: 'SHUTDOWN' })
														return {
															target: 'replacing',
															context: args.actions.rememberObservation(args).context
														}
													}
												}
											},
											// The report was acknowledged; only the terminal startup receipt may admit work.
											settling: {
												meta: accountStatus('openingLibrary', t('account.status.openingLibrary')),
												on: {
													SHUTDOWN: { target: 'stopping' },
													OBSERVED: (args) => {
														if (args.guards.sameBinding(args))
															return args.actions.refreshBinding(args)
														return {
															target: 'replacing',
															context: args.actions.rememberObservation(args).context
														}
													}
												}
											},
											stopping: {
												meta: accountStatus('closing', t('account.status.closing')),
												on: {
													SHUTDOWN: {},
													OBSERVED: (args) => {
														return { context: args.actions.rememberObservation(args).context }
													}
												}
											},
											replacing: {
												meta: accountStatus('openingLibrary', t('account.status.openingLibrary')),
												on: {
													OBSERVED: (args) => {
														return { context: args.actions.rememberObservation(args).context }
													},
													SHUTDOWN: { target: 'stopping' }
												}
											},
											conflict: {
												meta: accountStatus('conflict', t('account.status.conflict')),
												on: {
													LOGOUT: (args) => ({
														target: '#application-active-flow-running-loggingOut',
														context: { attempt: args.context.attempt + 1 }
													})
												}
											},
											failed: {
												meta: accountStatus('rootFailed', t('account.status.rootFailed')),
												on: {
													RETRY: ({ context }) => ({
														target: '#application-active-flow-running-retrying',
														context: { attempt: context.attempt + 1 }
													}),
													LOGOUT: (args) => ({
														target: '#application-active-flow-running-loggingOut',
														context: { attempt: args.context.attempt + 1 }
													})
												}
											},
											ready: {
												initial: 'syncPending',
												invoke: {
													id: 'library',
													src: 'library',
													input: ({ context, self }) => ({
														account: required(context.adoption).observation,
														scope: required(context.adoption).scope,
														reportDisposalFailure: () =>
															self.send({ type: 'LIBRARY_DISPOSAL_FAILED' })
													}),
													onSnapshot: ({ event }) =>
														selectWorkspaceLibrary(event.snapshot).failed
															? { target: '.unresolved', context: { clean: false } }
															: { context: {} },
													onError: {
														target: '#application-ownerFailed',
														context: { clean: false }
													},
													onDone: (args) => {
														if (!args.context.clean || args.event.output.outcome !== 'released')
															return {
																target: '#application-active-flow-running-draining',
																context: { clean: false }
															}
														if (args.guards.libraryStoppingFor(args, 'restore'))
															return { target: '#application-active-flow-running-restoring' }
														if (args.guards.libraryStoppingFor(args, 'logout'))
															return {
																target: '#application-active-flow-running-loggingOut',
																context: { attempt: args.context.attempt + 1 }
															}
														if (args.guards.libraryStoppingFor(args, 'replace'))
															return { target: '#application-active-flow-running-route' }
														return { target: '#application-active-flow-running-draining' }
													}
												},
												on: {
													RESTORE: (args, enq) => {
														enq.raise({ type: 'FEEDBACK_CLEAR' })
														enq.sendTo('library', { type: 'SHUTDOWN' })
														return {
															target: '.stopping.restore',
															context: {
																phrase: args.event.phrase,
																attempt: args.context.attempt + 1
															}
														}
													},
													LOGOUT: (args, enq) => {
														enq.sendTo('library', { type: 'SHUTDOWN' })
														return { target: '.stopping.logout' }
													},
													SHUTDOWN: (args, enq) => {
														enq.sendTo('library', { type: 'SHUTDOWN' })
														return { target: '.stopping.shutdown' }
													},
													OBSERVED: (args, enq) => {
														if (args.guards.sameBinding(args)) {
															return args.actions.refreshBinding(args)
														}
														enq.sendTo('library', { type: 'SHUTDOWN' })
														return {
															target: '.stopping.replace',
															context: args.actions.rememberObservation(args).context
														}
													}
												},
												states: {
													unresolved: {
														meta: accountStatus('cleanupFailed', t('account.status.ownerFailed')),
														on: {
															SHUTDOWN: {},
															RESTORE: {},
															LOGOUT: {},
															OBSERVED: (args) => args.actions.rememberObservation(args)
														}
													},
													// Existing local data is ready without claiming a new save or remote receipt.
													existing: { meta: accountStatus('ready', '') },
													stopping: {
														initial: 'shutdown',
														states: { shutdown: {}, restore: {}, logout: {}, replace: {} },
														meta: accountStatus('closing', t('account.status.closing')),
														on: {
															LOGOUT: {},
															RESTORE: {},
															SHUTDOWN: { target: '.shutdown' },
															OBSERVED: (args) => {
																return { context: args.actions.rememberObservation(args).context }
															}
														}
													},
													syncPending: {
														meta: accountStatus('localSaved', t('account.status.localSaved')),
														invoke: {
															id: 'global',
															src: 'global',
															input: ({ context }) => required(context.write),
															onDone: { target: 'synced' },
															onError: { target: 'syncFailed' }
														}
													},
													synced: { meta: accountStatus('synced', t('account.status.synced')) },
													syncFailed: {
														meta: accountStatus('syncFailed', t('account.status.syncFailed')),
														on: {
															RETRY: { target: 'syncPending' }
														}
													}
												}
											}
										}
									},
									draining: {
										id: 'application-active-flow-running-draining',
										always: { target: '#application-active-flow-closing' }
									}
								}
							},
							closing: {
								id: 'application-active-flow-closing',
								meta: accountStatus('closing', t('account.status.closing')),
								entry: ({ context }) => {
									return {
										context: {
											adoption: undefined,
											phrase: '',
											write: context.clean ? undefined : context.write
										}
									}
								},
								always: ({ context }) => ({
									target: context.clean ? '#application-closed' : '#application-ownerFailed'
								})
							}
						}
					}
				}
			},
			ownerFailed: {
				id: 'application-ownerFailed',
				type: 'final',
				meta: accountStatus('ownerFailed', t('account.status.ownerFailed')),
				entry: () => ({ context: { observation: { status: 'closed' } } })
			},
			closed: {
				id: 'application-closed',
				meta: accountStatus('closed', t('account.status.closed')),
				type: 'final',
				entry: () => ({ context: { observation: { status: 'closed' } } })
			}
		}
	})
}

export type ApplicationStatus =
	| 'ready'
	| 'configuration'
	| 'starting'
	| 'signedOut'
	| 'synced'
	| 'syncFailed'
	| 'localSaved'
	| 'rootFailed'
	| 'conflict'
	| 'openingLibrary'
	| 'unavailable'
	| 'closing'
	| 'closed'
	| 'working'
	| 'ownerFailed'
	| 'cleanupFailed'
export type ApplicationSnapshot = SnapshotFrom<ReturnType<typeof createApplicationReadinessMachine>>
type MachineStatus = Exclude<ApplicationStatus, 'configuration'>
export function selectApplicationView(
	snapshot: ApplicationSnapshot | undefined,
	configured: boolean
) {
	const metadata = snapshot ? Object.values(snapshot.getMeta()) : [starting]
	const meta = configured
		? (metadata.find((state) => state?.channel === 'account') ?? working)
		: configuration
	const status: ApplicationStatus = configured ? (meta.status ?? 'working') : 'configuration'
	return {
		status,
		message: { text: meta.name, variant: meta.variant },
		feedbackMessage: stateFeedback(metadata, 'feedback'),
		connectionMessage: stateFeedback(metadata, 'connection'),
		feedback: metadata.find((state) => state?.channel === 'feedback')?.feedback,
		showIdentityForm: snapshot?.can({ type: 'CREATE' }) ?? false,
		canLogout:
			snapshot?.context.observation.status === 'ready' &&
			snapshot.context.observation.identityKind === 'backend' &&
			snapshot.can({ type: 'LOGOUT' }),
		canRestore: snapshot?.can({ type: 'RESTORE', phrase: '' }) ?? false,
		canRetry: snapshot?.can({ type: 'RETRY' }) ?? false,
		requiresReload:
			snapshot?.context.clean === false ||
			snapshot?.matches({ active: { flow: { running: { loggingOut: 'overdue' } } } }) ||
			false
	}
}
export function selectRecoveryBinding(snapshot: ApplicationSnapshot | undefined) {
	return snapshot &&
		snapshot.context.observation.status === 'ready' &&
		snapshot.context.observation.localFirst
		? { ...snapshot.context.observation.capabilities.recovery, messages: recoveryMessages() }
		: undefined
}
export function selectLibraryActor(snapshot: ApplicationSnapshot | undefined) {
	return snapshot &&
		matchesState({ active: { flow: { running: { library: 'ready' } } } }, snapshot.value) &&
		!matchesState(
			{ active: { flow: { running: { library: { ready: 'stopping' } } } } },
			snapshot.value
		)
		? snapshot.children.library &&
				selectWorkspaceLibrary(snapshot.children.library.getSnapshot()).library
		: undefined
}

export function selectLibraryCommandBinding(snapshot: ApplicationSnapshot | undefined) {
	const owner = snapshot?.children.library
	if (!owner || !selectLibraryActor(snapshot)) return undefined
	const lease = selectWorkspaceLibrary(owner.getSnapshot()).lease
	return lease ? { owner, lease } : undefined
}
