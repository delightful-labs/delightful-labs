import type {
	WorkspaceDrainRequest,
	WorkspaceLease
} from 'delightful-local-first/workspace/contracts'
import {
	sameWorkspaceLease,
	type SelectedResourceCommand,
	type SelectedResourceOutput,
	type SelectedResourceRecipient,
	type SelectedResourceReport
} from '../../contracts/workspace-selected-resources.js'
import {
	retainResourceRelease,
	type WorkspaceResourceRelease
} from '../../contracts/workspace-resource-release.js'
import {
	sameIntegrityRequest,
	type IntegrityRequest,
	type IntegrityStatusEvent
} from '../../contracts/workspace-integrity-contract.js'
import { createBankSyncMachine } from '../bank-sync/index.js'
import type { BankSource, BankSyncDependencies } from '../bank-sync/types.js'
import { required } from '../bank-sync/identity.js'
import { createWorkspaceIntegrityOwner } from '../workspaces/workspace-integrity-owner.js'
import { setup, types, matchesState } from 'xstate'
import type { SnapshotFrom } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'

type Input = { recipient: SelectedResourceRecipient }
type Context = Input & {
	drain: WorkspaceDrainRequest | undefined
	bankResult: WorkspaceResourceRelease | undefined
	integrityResult: WorkspaceResourceRelease | undefined
	integrityRequest: IntegrityRequest | undefined
	unexpectedStop: 'bank' | 'integrity' | undefined
	result: WorkspaceResourceRelease | undefined
}
type Event =
	| SelectedResourceCommand
	| IntegrityStatusEvent
	| {
			type: 'RESOURCE_STOPPED'
			resource: 'bank' | 'integrity'
	  }

function captureLease(lease: WorkspaceLease): WorkspaceLease {
	return Object.freeze({
		...lease,
		scope: Object.freeze({ ...lease.scope }),
		request: Object.freeze({ ...lease.request })
	})
}

/** One selected lease's resource lifetime; identity-bound startup/creation/navigation stay outside. */
export function createWorkspaceSelectedResources({
	dependencies,
	lease: issuedLease,
	userId
}: {
	dependencies: BankSyncDependencies
	lease: WorkspaceLease
	userId: string
}) {
	const lease = captureLease(issuedLease)
	const { db, passkeyName, read } = dependencies
	const readBoundSource = (): BankSource => {
		const source = read()
		return source.organizationId === lease.request.workspaceId && source.userId === userId
			? source
			: {
					organizationId: null,
					userId: undefined,
					sessionReady: false,
					membership: undefined,
					connections: [],
					accounts: [],
					links: []
				}
	}
	const actors = {
		bank: createBankSyncMachine({ db, passkeyName, read: readBoundSource }),
		integrity: createWorkspaceIntegrityOwner(db)
	}
	const events0 = {
		BANK: types<EventPayload<Event, 'BANK'>>(),
		INTEGRITY: types<EventPayload<Event, 'INTEGRITY'>>(),
		DRAIN: types<EventPayload<Event, 'DRAIN'>>(),
		SHUTDOWN: types<EventPayload<Event, 'SHUTDOWN'>>(),
		INTEGRITY_STATUS: types<EventPayload<Event, 'INTEGRITY_STATUS'>>(),
		RESOURCE_STOPPED: types<EventPayload<Event, 'RESOURCE_STOPPED'>>()
	}
	type NativeEvent0 =
		| import('xstate').InferEvents<typeof events0>
		| import('xstate').DoneActorEvent<
				| import('xstate').OutputFrom<(typeof actors)['bank']>
				| import('xstate').OutputFrom<(typeof actors)['integrity']>
		  >
		| import('xstate').ErrorActorEvent
	const model = setup({
		schemas: {
			context: types<Context>(),
			events: events0,
			input: types<Input>(),
			output: types<SelectedResourceOutput>(),
			children: {
				bank: types<import('xstate').ActorRefFrom<(typeof actors)['bank']>>(),
				integrity: types<import('xstate').ActorRefFrom<(typeof actors)['integrity']>>()
			}
		},
		actors,
		actions: {},
		guards: {
			currentDrain: ({ event }: { event: NativeEvent0 }) =>
				event.type === 'DRAIN' && sameWorkspaceLease(event.drain.lease, lease),
			active: (args: { value: import('xstate').StateValue }) =>
				matchesState({ owning: { control: 'active' } }, args.value)
		}
	})
	return model.createMachine({
		id: 'workspace-selected-resources',
		initial: 'owning',
		context: ({ input }) => ({
			...input,
			drain: undefined,
			bankResult: undefined,
			integrityResult: undefined,
			integrityRequest: undefined,
			unexpectedStop: undefined,
			result: undefined
		}),
		output: ({ context }) => ({ lease, drain: context.drain, release: required(context.result) }),
		on: {
			INTEGRITY_STATUS: (args, enq) => {
				const { context, event } = args
				if (!(
					matchesState({ owning: { control: 'active' } }, args.value) &&
					context.integrityRequest !== undefined &&
					sameIntegrityRequest(context.integrityRequest, event.report.request)
				))
					return
				enq.sendTo(context.recipient, {
					type: 'SELECTED_INTEGRITY_STATUS',
					lease,
					report: event.report
				})
			}
		},
		states: {
			owning: {
				type: 'parallel',
				states: {
					control: {
						initial: 'active',
						states: {
							active: {
								on: {
									BANK: (args, enq) => {
										const { event } = args
										if (!(
											sameWorkspaceLease(event.lease, lease) &&
											(event.event.type !== 'WORKSPACE_ACCESS_CHANGED' ||
												(event.event.access.organizationId === lease.request.workspaceId &&
													event.event.access.userId === userId))
										))
											return
										{
											const child = args.children.bank
											if (child?.getSnapshot().status === 'active') enq.sendTo(child, event.event)
										}
									},
									INTEGRITY: (args, enq) => {
										let context = args.context
										const { event } = args
										if (!(
											sameWorkspaceLease(event.lease, lease) &&
											Number.isSafeInteger(event.request.generation) &&
											event.request.generation >= 0 &&
											event.request.generation > (context.integrityRequest?.generation ?? -1) &&
											(event.request.binding === undefined ||
												(event.request.binding.organizationId === lease.request.workspaceId &&
													event.request.binding.userId === userId))
										))
											return
										let patch = {}
										patch = {
											...patch,
											...((args) => ({
												integrityRequest: (({ event }) => ({
													...event.request,
													binding: event.request.binding ? { ...event.request.binding } : undefined
												}))(args)
											}))(args)
										}
										context = { ...args.context, ...patch }
										{
											const contextBefore = context
											const child = args.children.integrity
											if (child?.getSnapshot().status === 'active')
												enq.sendTo(child, {
													type: 'OBSERVED',
													request: required(contextBefore.integrityRequest)
												})
										}
										return { context: patch }
									},
									DRAIN: (args, enq) => {
										if (args.guards.currentDrain(args)) {
											return {
												target: 'draining',
												context: (({ event }) => {
													if (event.type !== 'DRAIN')
														throw new Error('Missing selected-resource drain')
													return { drain: Object.freeze({ token: event.drain.token, lease }) }
												})(args)
											}
										}
										enq.sendTo(
											args.context.recipient,
											(({ event }): SelectedResourceReport => {
												if (event.type !== 'DRAIN')
													throw new Error('Missing rejected resource drain')
												return {
													type: 'SELECTED_RESOURCE_DRAIN_REJECTED',
													lease,
													drain: event.drain,
													reason: 'scopeMismatch'
												}
											})(args)
										)
										return {}
									},
									SHUTDOWN: (args) => {
										if (args.guards.active(args)) return { target: 'draining' }
									},
									RESOURCE_STOPPED: (args, enq) => {
										let context = args.context
										const { event } = args
										let patch = {}
										patch = { ...patch, unexpectedStop: event.resource }
										context = { ...args.context, ...patch }
										enq.sendTo(context.recipient, {
											type: 'SELECTED_RESOURCES_STOPPING',
											lease,
											resource: event.resource
										})
										return { target: 'draining', context: patch }
									}
								}
							},
							draining: {
								entry: (args, enq) => {
									{
										const children = args.children
										for (const child of [children.bank, children.integrity])
											if (child?.getSnapshot().status === 'active')
												enq.sendTo(child, { type: 'SHUTDOWN' })
									}
								},
								always: (args) => {
									const { context } = args
									if (!(context.bankResult !== undefined && context.integrityResult !== undefined))
										return
									return { target: 'stopped' }
								},
								on: {
									DRAIN: (args, enq) => {
										const { context, event } = args
										if (args.guards.currentDrain(args) && context.drain === undefined) {
											return {
												context: (({ event }) => {
													if (event.type !== 'DRAIN')
														throw new Error('Missing selected-resource drain')
													return { drain: Object.freeze({ token: event.drain.token, lease }) }
												})(args)
											}
										}
										if (
											args.guards.currentDrain(args) &&
											context.drain?.token === event.drain.token
										) {
											return {}
										}
										if (args.guards.currentDrain(args)) {
											enq.sendTo(
												context.recipient,
												(({ event }): SelectedResourceReport => {
													if (event.type !== 'DRAIN')
														throw new Error('Missing rejected resource drain')
													return {
														type: 'SELECTED_RESOURCE_DRAIN_REJECTED',
														lease,
														drain: event.drain,
														reason: 'busy'
													}
												})(args)
											)
											return {}
										}
										enq.sendTo(
											context.recipient,
											(({ event }): SelectedResourceReport => {
												if (event.type !== 'DRAIN')
													throw new Error('Missing rejected resource drain')
												return {
													type: 'SELECTED_RESOURCE_DRAIN_REJECTED',
													lease,
													drain: event.drain,
													reason: 'scopeMismatch'
												}
											})(args)
										)
										return {}
									}
								}
							},
							stopped: { type: 'final' }
						}
					},
					bank: {
						initial: 'running',
						states: {
							running: {
								invoke: {
									id: 'bank',
									src: 'bank',
									onDone: (args, enq) => {
										enq.raise({ type: 'RESOURCE_STOPPED', resource: 'bank' })
										return { target: 'stopped', context: { bankResult: args.event.output } }
									},
									onError: (args, enq) => {
										enq.raise({ type: 'RESOURCE_STOPPED', resource: 'bank' })
										return { target: 'stopped', context: { bankResult: { outcome: 'unresolved' } } }
									}
								}
							},
							stopped: { type: 'final' }
						}
					},
					integrity: {
						initial: 'running',
						states: {
							running: {
								invoke: {
									id: 'integrity',
									src: 'integrity',
									input: ({ self }) => ({
										request: { generation: 0, binding: undefined },
										recipient: self
									}),
									onDone: (args, enq) => {
										enq.raise({ type: 'RESOURCE_STOPPED', resource: 'integrity' })
										return { target: 'stopped', context: { integrityResult: args.event.output } }
									},
									onError: (args, enq) => {
										enq.raise({ type: 'RESOURCE_STOPPED', resource: 'integrity' })
										return {
											target: 'stopped',
											context: { integrityResult: { outcome: 'unresolved' } }
										}
									}
								}
							},
							stopped: { type: 'final' }
						}
					}
				},
				onDone: { target: 'classifying' }
			},
			classifying: {
				entry: (args) => {
					const { context } = args
					return {
						context: {
							result: retainResourceRelease(
								retainResourceRelease(
									required(context.bankResult),
									required(context.integrityResult)
								),
								{ outcome: context.unexpectedStop ? 'releasedWithFailure' : 'released' }
							)
						}
					}
				},
				always: (args) => {
					const { context } = args
					if (context.result?.outcome === 'unresolved') {
						return { target: 'unresolved' }
					}
					if (context.result?.outcome === 'releasedWithFailure') {
						return { target: 'releasedWithFailure' }
					}
					return { target: 'released' }
				}
			},
			released: { type: 'final' },
			releasedWithFailure: { type: 'final' },
			unresolved: { type: 'final' }
		}
	})
}

/** Public bank reference for integration subscriptions; cleanup never exposes a usable replacement. */
export function selectedResourceBankActor(
	snapshot: SnapshotFrom<ReturnType<typeof createWorkspaceSelectedResources>> | undefined
) {
	return snapshot?.status === 'active' && snapshot.matches({ owning: { control: 'active' } })
		? snapshot.children.bank
		: undefined
}
