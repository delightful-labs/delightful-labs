import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
	InitializationRequest,
	InitializationStatusEvent,
	InitializationRecipient
} from '../../contracts/workspace-orchestration-contract.js'
import type {
	IntegrityRequest,
	IntegrityRecipient,
	IntegrityStatus,
	IntegrityReport
} from '../../contracts/workspace-integrity-contract.js'
import type { CreationBinding } from '../workspaces/workspace-creation-operation.js'
import {
	createWorkspaceReadinessMachine,
	selectWorkspaceView,
	type ReadinessObservation,
	type WorkspaceAttachment,
	workspaceBankActor
} from './readiness.js'
import type {
	WorkspaceLease,
	WorkspaceDrainRequest,
	WorkspaceSelectionReport,
	WorkspaceSelectionRequest
} from 'delightful-local-first/workspace/contracts'
import { createWorkspaceSelectionMachine } from 'delightful-local-first/workspace/workflow'
import {
	workspaceSelectionTarget,
	workspaceSelectionObservation
} from './workspace-selection-observation.js'
import type { SelectedResourceOutput } from '../../contracts/workspace-selected-resources.js'
import type { WorkspaceResourceRelease } from '../../contracts/workspace-resource-release.js'
import type { BankEvent } from '../bank-sync/types.js'
import { scope, membership, records } from '../workspaces/workspace-integrity.fixture.js'
import { createActor, createMachine, createCallbackLogic, setup, waitFor, types } from 'xstate'
import type { InspectionEvent, ActorRefFrom } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'

type ControlEvent = { type: 'HOLD' | 'FINISH' | 'SHUTDOWN' | 'RESET' | 'CRASH' }
type ResourceControl = {
	actor: object
	send: (event: ControlEvent) => void
	getSnapshot: () => { status: string; matches: (value: string) => boolean }
}
type IdentityControl = {
	actor: object
	send: (event: { type: 'HOLD' | 'FINISH' | 'SHUTDOWN' | 'FAIL' }) => void
	getSnapshot: () => { status: string; matches: (state: string) => boolean }
}
const { bankControls, integrityControls, resourceResults, startupControls, creationControls } =
	vi.hoisted(() => ({
		bankControls: new WeakMap<object, ResourceControl>(),
		startupControls: new WeakMap<object, IdentityControl>(),
		creationControls: new WeakMap<
			object,
			Omit<IdentityControl, 'send'> & {
				send: (event: { type: 'HOLD' | 'FINISH' | 'SHUTDOWN' }) => void
			}
		>(),
		integrityControls: new WeakMap<object, ResourceControl>(),
		resourceResults: new WeakMap<object, WorkspaceResourceRelease>()
	}))
function controlFor(self: {
	send: (event: ControlEvent) => void
	getSnapshot: () => { status: string; value: unknown }
}): ResourceControl {
	return {
		actor: self,
		send: (event) => self.send(event),
		getSnapshot: () => ({
			status: self.getSnapshot().status,
			matches: (value) => self.getSnapshot().value === value
		})
	}
}
const ownerFailure = vi.hoisted(() => ({ shutdown: false }))
vi.mock('./workspace-selected-resources.js', async (original) => {
	const actual = await original<typeof import('./workspace-selected-resources.js')>()
	return {
		...actual,
		createWorkspaceSelectedResources: (
			input: Parameters<typeof actual.createWorkspaceSelectedResources>[0]
		) => {
			const logic = actual.createWorkspaceSelectedResources(input)
			return ownerFailure.shutdown
				? logic.provide({
						guards: {
							active: () => {
								throw new Error('controlled owner crash')
							}
						}
					})
				: logic
		}
	}
})
const { bankStart, bankObservation, startupObservation } = vi.hoisted(() => ({
	bankStart: vi.fn(),
	bankObservation: vi.fn(),
	startupObservation: vi.fn()
}))
vi.mock('../workspaces/workspace-startup.js', () => ({
	createWorkspaceStartupMachine: () => {
		type Input = { request: InitializationRequest; recipient: InitializationRecipient }
		const events3 = {
			OBSERVED:
				types<
					EventPayload<
						| { type: 'OBSERVED'; request: InitializationRequest }
						| { type: 'SHUTDOWN' | 'FINISH' | 'FAIL' | 'HOLD' },
						'OBSERVED'
					>
				>(),
			SHUTDOWN:
				types<
					EventPayload<
						| { type: 'OBSERVED'; request: InitializationRequest }
						| { type: 'SHUTDOWN' | 'FINISH' | 'FAIL' | 'HOLD' },
						'SHUTDOWN'
					>
				>(),
			FINISH:
				types<
					EventPayload<
						| { type: 'OBSERVED'; request: InitializationRequest }
						| { type: 'SHUTDOWN' | 'FINISH' | 'FAIL' | 'HOLD' },
						'FINISH'
					>
				>(),
			FAIL: types<
				EventPayload<
					| { type: 'OBSERVED'; request: InitializationRequest }
					| { type: 'SHUTDOWN' | 'FINISH' | 'FAIL' | 'HOLD' },
					'FAIL'
				>
			>(),
			HOLD: types<
				EventPayload<
					| { type: 'OBSERVED'; request: InitializationRequest }
					| { type: 'SHUTDOWN' | 'FINISH' | 'FAIL' | 'HOLD' },
					'HOLD'
				>
			>()
		}
		type NativeEvent3 =
			| import('xstate').InferEvents<typeof events3>
			| import('xstate').DoneActorEvent<never>
			| import('xstate').ErrorActorEvent
		return setup({
			schemas: { context: types<Input>(), events: events3, input: types<Input>() }
		}).createMachine({
			context: ({ input }) => input,
			initial: 'checking',
			entry: ({ self }, enq) => {
				enq(() => {
					startupControls.set(self, {
						actor: self,
						send: (event) => self.send(event),
						getSnapshot: () => ({
							status: self.getSnapshot().status,
							matches: (state) => self.getSnapshot().value === state
						})
					})
				})
			},
			on: {
				OBSERVED: ({ event }, enq) => {
					enq(startupObservation)
					return { target: '.checking', context: { request: event.request } }
				},
				SHUTDOWN: { target: '.closing' }
			},
			states: {
				checking: {
					always: (args) => {
						if (args.context.request.status === 'ready') {
							return { target: 'ready' }
						}
						return { target: 'waiting' }
					}
				},
				ready: {
					entry: (args, enq) => {
						const { context } = args
						enq.sendTo(context.recipient, {
							type: 'INITIALIZATION_STATUS',
							report: {
								request: context.request,
								status: { kind: 'ready', profileId: '22222222-2222-4222-8222-222222222222' }
							}
						})
					},
					on: { FAIL: { target: 'failed' }, HOLD: { target: 'waiting' } }
				},
				waiting: {
					entry: (args, enq) => {
						const { context } = args
						enq.sendTo(context.recipient, {
							type: 'INITIALIZATION_STATUS',
							report: { request: context.request, status: { kind: 'waiting' } }
						})
					}
				},
				failed: {
					entry: (args, enq) => {
						const { context } = args
						enq.sendTo(context.recipient, {
							type: 'INITIALIZATION_STATUS',
							report: { request: context.request, status: { kind: 'failed' } }
						})
					}
				},
				closing: { on: { FINISH: { target: 'closed' }, OBSERVED: {}, SHUTDOWN: {} } },
				closed: { type: 'final' }
			}
		})
	}
}))
vi.mock('../bank-sync/index.js', () => ({
	createBankSyncMachine: () =>
		createMachine({
			initial: 'working',
			entry: (args, enq) => {
				enq(() => {
					const { self } = args
					bankControls.set(self, controlFor(self))
				})
				enq(bankStart)
			},
			output: ({ self }): WorkspaceResourceRelease =>
				resourceResults.get(self) ?? { outcome: 'released' },
			on: {
				WORKSPACE_ACCESS_CHANGED: ({ event }, enq) => {
					enq(bankObservation, event)
				},
				CONNECTIONS_CHANGED: ({ event }, enq) => {
					enq(bankObservation, event)
				},
				MAPPING_DATA_CHANGED: ({ event }, enq) => {
					enq(bankObservation, event)
				},
				HISTORY_CHANGED: ({ event }, enq) => {
					enq(bankObservation, event)
				}
			},
			states: {
				working: {
					on: {
						SHUTDOWN: { target: 'closed' },
						RESET: { target: 'closed' },
						HOLD: { target: 'held' },
						CRASH: (args, enq) => {
							enq(() => {
								throw new Error('controlled bank crash')
							})
						}
					}
				},
				held: {
					on: {
						SHUTDOWN: { target: 'closing' },
						CRASH: (args, enq) => {
							enq(() => {
								throw new Error('controlled bank crash')
							})
						}
					}
				},
				closing: { on: { FINISH: { target: 'closed' }, SHUTDOWN: {} } },
				closed: { type: 'final' }
			}
		})
}))
vi.mock('../workspaces/workspace-integrity-owner.js', () => ({
	createWorkspaceIntegrityOwner: () => {
		type Input = { request: IntegrityRequest; recipient: IntegrityRecipient }
		const events2 = {
			OBSERVED:
				types<
					EventPayload<
						| { type: 'OBSERVED'; request: IntegrityRequest }
						| { type: 'HOLD' | 'FINISH' | 'SHUTDOWN' | 'RESET' | 'CRASH' },
						'OBSERVED'
					>
				>(),
			HOLD: types<
				EventPayload<
					| { type: 'OBSERVED'; request: IntegrityRequest }
					| { type: 'HOLD' | 'FINISH' | 'SHUTDOWN' | 'RESET' | 'CRASH' },
					'HOLD'
				>
			>(),
			FINISH:
				types<
					EventPayload<
						| { type: 'OBSERVED'; request: IntegrityRequest }
						| { type: 'HOLD' | 'FINISH' | 'SHUTDOWN' | 'RESET' | 'CRASH' },
						'FINISH'
					>
				>(),
			SHUTDOWN:
				types<
					EventPayload<
						| { type: 'OBSERVED'; request: IntegrityRequest }
						| { type: 'HOLD' | 'FINISH' | 'SHUTDOWN' | 'RESET' | 'CRASH' },
						'SHUTDOWN'
					>
				>(),
			RESET:
				types<
					EventPayload<
						| { type: 'OBSERVED'; request: IntegrityRequest }
						| { type: 'HOLD' | 'FINISH' | 'SHUTDOWN' | 'RESET' | 'CRASH' },
						'RESET'
					>
				>(),
			CRASH:
				types<
					EventPayload<
						| { type: 'OBSERVED'; request: IntegrityRequest }
						| { type: 'HOLD' | 'FINISH' | 'SHUTDOWN' | 'RESET' | 'CRASH' },
						'CRASH'
					>
				>()
		}
		type NativeEvent2 =
			| import('xstate').InferEvents<typeof events2>
			| import('xstate').DoneActorEvent<never>
			| import('xstate').ErrorActorEvent
		return setup({
			schemas: {
				context: types<Input>(),
				events: events2,
				input: types<Input>(),
				output: types<WorkspaceResourceRelease>()
			}
		}).createMachine({
			context: ({ input }) => input,
			entry: ({ self }, enq) => {
				enq(() => {
					integrityControls.set(self, controlFor(self))
				})
			},
			output: ({ self }) => resourceResults.get(self) ?? { outcome: 'released' },
			initial: 'active',
			on: {
				OBSERVED: (args) => {
					return { context: { request: args.event.request } }
				}
			},
			states: {
				active: {
					on: {
						SHUTDOWN: { target: 'closed' },
						HOLD: { target: 'held' },
						CRASH: (args, enq) => {
							enq(() => {
								throw new Error('controlled integrity crash')
							})
						}
					}
				},
				held: { on: { SHUTDOWN: { target: 'draining' } } },
				draining: { on: { FINISH: { target: 'closed' } } },
				closed: { type: 'final' }
			}
		})
	}
}))
vi.mock('../workspaces/workspace-creation.js', async () => {
	const { types, setup } = await import('xstate')
	const actual = await vi.importActual<typeof import('../workspaces/workspace-creation.js')>(
		'../workspaces/workspace-creation.js'
	)
	const events1 = {
		OBSERVED:
			types<
				EventPayload<
					| { type: 'OBSERVED'; binding: CreationBinding | undefined }
					| { type: 'HOLD' | 'FINISH' | 'SHUTDOWN' },
					'OBSERVED'
				>
			>(),
		HOLD: types<
			EventPayload<
				| { type: 'OBSERVED'; binding: CreationBinding | undefined }
				| { type: 'HOLD' | 'FINISH' | 'SHUTDOWN' },
				'HOLD'
			>
		>(),
		FINISH:
			types<
				EventPayload<
					| { type: 'OBSERVED'; binding: CreationBinding | undefined }
					| { type: 'HOLD' | 'FINISH' | 'SHUTDOWN' },
					'FINISH'
				>
			>(),
		SHUTDOWN:
			types<
				EventPayload<
					| { type: 'OBSERVED'; binding: CreationBinding | undefined }
					| { type: 'HOLD' | 'FINISH' | 'SHUTDOWN' },
					'SHUTDOWN'
				>
			>()
	}
	type NativeEvent1 =
		| import('xstate').InferEvents<typeof events1>
		| import('xstate').DoneActorEvent<never>
		| import('xstate').ErrorActorEvent
	return {
		...actual,
		selectWorkspaceCreationReport: (snapshot: {
			context: { binding: CreationBinding | undefined }
		}) => ({ binding: snapshot.context.binding, view: actual.unavailableWorkspaceCreationView }),
		createWorkspaceCreationMachine: () =>
			setup({
				schemas: {
					context: types<{ binding: CreationBinding | undefined }>(),
					events: events1,
					input: types<{ binding: CreationBinding | undefined }>()
				}
			}).createMachine({
				context: ({ input }) => input,
				initial: 'active',
				entry: ({ self }, enq) => {
					enq(() => {
						creationControls.set(self, {
							actor: self,
							send: (event) => self.send(event),
							getSnapshot: () => ({
								status: self.getSnapshot().status,
								matches: (state) => self.getSnapshot().value === state
							})
						})
					})
				},
				on: {
					OBSERVED: (args) => {
						return { context: { binding: args.event.binding } }
					}
				},
				states: {
					active: { on: { SHUTDOWN: { target: 'closed' }, HOLD: { target: 'held' } } },
					held: { on: { SHUTDOWN: { target: 'draining' } } },
					draining: { on: { FINISH: { target: 'closed' } } },
					closed: { type: 'final' }
				}
			})
	}
})
const cleanup: (() => void)[] = []
afterEach(() => {
	for (const dispose of cleanup.splice(0)) dispose()
})
beforeEach(() => {
	ownerFailure.shutdown = false
	vi.clearAllMocks()
	bankStart.mockImplementation(() => {})
	bankObservation.mockImplementation(() => {})
	startupObservation.mockImplementation(() => {})
})
function start(inspect: (event: InspectionEvent) => void = () => {}) {
	const observation: ReadinessObservation = {
		source: {
			userId: scope.userId,
			organizationId: null,
			membership: undefined
		},
		sessionStatus: 'ready',
		membershipLoading: false,
		membershipError: undefined,
		organizations: [],
		organizationsLoading: false,
		organizationsError: undefined,
		route: { pathname: '/settings/workspace', search: '', hash: '' }
	}
	let current = observation
	const navigate = vi.fn(async () => {})
	const attachment: WorkspaceAttachment = {
		environment: 'test',
		dependencies: {
			db: vi.fn<() => WorkspaceAttachment['dependencies']['db']>()(),
			read: () => ({
				...current.source,
				sessionReady: true,
				connections: [],
				accounts: [],
				links: []
			}),
			passkeyName: () => 'Test'
		},
		read: () => current,
		navigate
	}
	let selection:
		import('xstate').ActorFromLogic<ReturnType<typeof createWorkspaceSelectionMachine>> | undefined
	let pendingDrain: WorkspaceDrainRequest | undefined
	const selectionScope = { binding: {}, attachment: {} }
	let request: WorkspaceSelectionRequest | undefined
	let attempt = 0
	let generation = 0
	let suspended = false
	function acknowledge(release: WorkspaceResourceRelease) {
		if (!selection || !pendingDrain) return
		const value = pendingDrain
		pendingDrain = undefined
		selection.send(
			release.outcome === 'released'
				? { type: 'DRAINED', drain: value }
				: {
						type: 'DRAIN_FAILED',
						drain: value,
						outcome: release.outcome === 'unresolved' ? 'unresolved' : 'released'
					}
		)
	}
	type ParentEvent =
		| { type: 'SELECTED_RESOURCES_RELEASED'; result: SelectedResourceOutput }
		| { type: 'SELECTED_RESOURCES_CRASHED'; lease: WorkspaceLease }
	const events0 = {
		SELECTED_RESOURCES_RELEASED: types<EventPayload<ParentEvent, 'SELECTED_RESOURCES_RELEASED'>>(),
		SELECTED_RESOURCES_CRASHED: types<EventPayload<ParentEvent, 'SELECTED_RESOURCES_CRASHED'>>()
	}
	type NativeEvent0 =
		| import('xstate').InferEvents<typeof events0>
		| import('xstate').DoneActorEvent<
				import('xstate').OutputFrom<ReturnType<typeof createWorkspaceReadinessMachine>>
		  >
		| import('xstate').ErrorActorEvent
	const parent = createActor(
		setup({
			schemas: {
				context: types<{}>(),
				events: events0,
				children: {
					workspace:
						types<
							import('xstate').ActorRefFrom<
								{ workspace: ReturnType<typeof createWorkspaceReadinessMachine> }['workspace']
							>
						>()
				}
			},
			actors: { workspace: createWorkspaceReadinessMachine(attachment) }
		}).createMachine({
			context: {},
			invoke: { id: 'workspace', src: 'workspace' },
			on: {
				SELECTED_RESOURCES_RELEASED: (args, enq) => {
					enq(({ event }) => {
						if (pendingDrain && event.result.lease.epoch === pendingDrain.lease.epoch)
							acknowledge(event.result.release)
					}, args)
				},
				SELECTED_RESOURCES_CRASHED: (args, enq) => {
					enq(() => acknowledge({ outcome: 'unresolved' }))
				}
			}
		}),
		{ inspect }
	).start()
	const candidate = parent.getSnapshot().children.workspace
	if (!candidate) throw new Error('Missing coordinator')
	const actor = candidate
	const recipient = createActor(
		createCallbackLogic<WorkspaceSelectionReport>(({ receive }) => {
			receive((report) => {
				if (report.type === 'WORKSPACE_SELECTION') {
					suspended = report.status === 'suspended'
					actor.send({
						type: 'SELECTION',
						status: report.status,
						lease: report.status === 'selected' ? report.lease : undefined
					})
				}
				if (report.type === 'WORKSPACE_SCOPE_INVALIDATED')
					actor.send({ type: 'SELECTION', status: 'waiting', lease: undefined })
				if (report.type === 'WORKSPACE_DRAIN_REQUESTED') {
					pendingDrain = report.drain
					const owned = actor.getSnapshot().context
					if (!owned.resourceActor)
						acknowledge(owned.resourceResult?.release ?? { outcome: 'released' })
				}
			})
		})
	).start()
	selection = createActor(createWorkspaceSelectionMachine(), {
		input: { reportTo: recipient }
	}).start()
	selection.send({ type: 'BIND', scope: selectionScope })
	const { startup, creation, navigation } = actor.getSnapshot().children
	if (!startup || !creation || !navigation) throw new Error('Missing owned children')
	cleanup.push(
		() => parent.stop(),
		() => selection?.stop(),
		() => recipient.stop()
	)
	function observe(next: ReadinessObservation) {
		current = next
		actor.send({ type: 'OBSERVED', observation: next })
		const target = workspaceSelectionTarget(next)
		if (!target) {
			request = undefined
			selection?.send({ type: 'SUSPEND', scope: selectionScope })
			return
		}
		if (request?.workspaceId !== target) {
			request = { workspaceId: target, attempt: ++attempt }
			selection?.send({ type: 'SELECT', scope: selectionScope, request })
		}
		selection?.send({
			type: suspended ? 'RESUME' : 'OBSERVED',
			observation: workspaceSelectionObservation(next, selectionScope, request, ++generation)
		})
	}
	function retrySelection() {
		if (!request) throw new Error('Missing selection request')
		selection?.send({
			type: 'RETRY',
			observation: workspaceSelectionObservation(current, selectionScope, request, ++generation)
		})
	}

	function selected(
		id = scope.organizationId,
		overrides: Partial<ReadinessObservation> = {}
	): ReadinessObservation {
		return {
			...observation,
			organizations: records().organizations.map((row) => ({ ...row, id })),
			source: {
				...observation.source,
				organizationId: id,
				membership: { ...membership, organizationId: id }
			},
			route: { pathname: '/expenses', search: `?workspace=${id}`, hash: '' },
			...overrides
		}
	}
	function report(
		status: IntegrityStatus,
		request: IntegrityRequest = actor.getSnapshot().context.integrityRequest
	) {
		const lease = actor.getSnapshot().context.resourceLease
		if (!lease) throw new Error('Missing selected lease')
		const report = { request, status, lease }
		actor.send({ type: 'SELECTED_INTEGRITY_STATUS', lease, report })
		return report
	}
	return {
		actor,
		get bank() {
			const child =
				workspaceBankActor(actor.getSnapshot()) ??
				actor.getSnapshot().context.resourceActor?.getSnapshot().children.bank
			const control = child && bankControls.get(child)
			if (!control) throw new Error('Missing selected bank')
			return control
		},
		get startup() {
			const value = startupControls.get(startup)
			if (!value) throw new Error('Missing startup control')
			return value
		},
		get integrity() {
			const child = actor.getSnapshot().context.resourceActor?.getSnapshot().children.integrity
			const control = child && integrityControls.get(child)
			if (!control) throw new Error('Missing selected integrity')
			return control
		},
		navigation,
		canSync: () =>
			actor.getSnapshot().can({
				type: 'BANK',
				lease: actor.getSnapshot().context.resourceLease,
				event: { type: 'SYNC' }
			}),
		sendBank: (event: BankEvent) =>
			actor.send({ type: 'BANK', lease: actor.getSnapshot().context.resourceLease, event }),
		get creation() {
			const value = creationControls.get(creation)
			if (!value) throw new Error('Missing creation control')
			return value
		},
		observation,
		navigate,
		observe,
		retrySelection,
		selected,
		report
	}
}

describe('workspace readiness supervision', () => {
	it('drains resource owners and navigation before completing shutdown', () => {
		const f = start()
		f.observe(f.selected())
		f.bank.send({ type: 'HOLD' })
		f.creation.send({ type: 'HOLD' })
		f.integrity.send({ type: 'HOLD' })
		f.actor.send({ type: 'SHUTDOWN' })
		f.bank.send({ type: 'FINISH' })
		f.startup.send({ type: 'FINISH' })
		expect(f.actor.getSnapshot().status).toBe('active')
		f.creation.send({ type: 'FINISH' })
		expect(f.actor.getSnapshot().status).toBe('active')
		f.integrity.send({ type: 'FINISH' })
		expect(f.actor.getSnapshot().status).toBe('done')
	})
	it('does not wait for acknowledgement from a bank that failed at startup', () => {
		bankStart.mockImplementationOnce(() => {
			throw new Error('private')
		})
		const f = start()
		f.observe(f.selected())
		expect(f.actor.getSnapshot().matches({ active: { resources: 'unresolved' } })).toBe(true)
		expect(f.actor.getSnapshot().children.startup).toBe(f.startup.actor)
		f.actor.send({ type: 'SHUTDOWN' })
		f.startup.send({ type: 'FINISH' })
		expect(f.actor.getSnapshot().status).toBe('done')
	})
	it('drains remaining live children when the bank observer fails', () => {
		const f = start()
		bankObservation.mockImplementationOnce(() => {
			throw new Error('private')
		})
		bankObservation.mockClear()
		f.observe(f.selected())
		expect(f.actor.getSnapshot().matches({ active: { resources: 'unresolved' } })).toBe(true)
		f.observe(f.observation)
		expect(bankObservation).toHaveBeenCalledTimes(1)
	})
	it('treats unexpected bank completion as failure', () => {
		const f = start()
		f.observe(f.selected())
		f.sendBank({ type: 'RESET' })
		expect(f.actor.getSnapshot().matches({ active: { resources: 'failed' } })).toBe(true)
		expect(selectWorkspaceView(f.actor.getSnapshot()).ready).toBe(true)
		expect(f.actor.getSnapshot().children.creation).toBe(f.creation.actor)
	})
	it('ignores observations and domain status while shutdown drains', () => {
		const f = start()
		f.observe(f.selected())
		const stale = f.report({ kind: 'complete', settlement: 'notStarted' })
		f.actor.send({ type: 'SHUTDOWN' })
		f.observe(f.observation)
		f.actor.send({ type: 'SELECTED_INTEGRITY_STATUS', lease: stale.lease, report: stale })
		expect(selectWorkspaceView(f.actor.getSnapshot()).canSync).toBe(false)
		f.startup.send({ type: 'FINISH' })
		expect(f.actor.getSnapshot().status).toBe('done')
	})
	it('does not wait for an already failed startup owner', () => {
		const f = start()
		startupObservation.mockImplementation(() => {
			throw new Error('startup owner failed')
		})
		f.observe({ ...f.observation, sessionStatus: 'transitioning' })
		expect(startupObservation).toHaveBeenCalled()
		expect(f.startup.getSnapshot().status).toBe('error')
		expect(f.actor.getSnapshot().value).toBe('failed')
		f.actor.send({ type: 'SHUTDOWN' })
		expect(f.actor.getSnapshot().status).toBe('done')
	})
})
describe('workspace public capability and report currency', () => {
	it.each([
		{ kind: 'waiting' },
		{ kind: 'checking' },
		{ kind: 'complete', settlement: 'notStarted' },
		{ kind: 'partial', settlement: 'notStarted', issues: ['profileLink'], access: 'usable' },
		{ kind: 'unavailable', settlement: 'notStarted' },
		{ kind: 'conflict', settlement: 'notStarted' },
		{ kind: 'failed', settlement: 'notStarted' },
		{ kind: 'unresolved', settlement: 'unresolved' },
		{ kind: 'closed', settlement: 'notStarted' }
	] satisfies IntegrityStatus[])(
		'keeps sync eligibility independent of $kind repair status',
		(status) => {
			const f = start()
			f.observe(f.selected())
			expect(f.canSync()).toBe(true)
			const revision = selectWorkspaceView(f.actor.getSnapshot()).bankRevision
			bankObservation.mockClear()
			f.report(status)
			expect(f.canSync()).toBe(true)
			expect(f.actor.getSnapshot().context.integrityReport?.status).toEqual(status)
			expect(selectWorkspaceView(f.actor.getSnapshot()).bankRevision).toBe(revision)
			expect(bankObservation).not.toHaveBeenCalled()
		}
	)
	it.each([
		{ role: 'owner', allowed: true },
		{ role: 'admin', allowed: true },
		{ role: 'member', allowed: false },
		{ role: 'viewer', allowed: false }
	] satisfies { role: typeof membership.role; allowed: boolean }[])(
		'requires bank-management role $role regardless of repair completion',
		({ role, allowed }) => {
			const f = start()
			const selected = f.selected()
			f.observe({
				...selected,
				source: { ...selected.source, membership: { ...membership, role } }
			})
			f.report({ kind: 'complete', settlement: 'notStarted' })
			expect(f.canSync()).toBe(allowed)
		}
	)
	it('rejects prior-visit reports after A → B → A', () => {
		const f = start()
		f.observe(f.selected())
		const old = f.report({ kind: 'complete', settlement: 'notStarted' })
		f.observe(f.selected(scope.profileId))
		f.observe(f.selected())
		f.actor.send({ type: 'SELECTED_INTEGRITY_STATUS', lease: old.lease, report: old })
		expect(f.actor.getSnapshot().context.integrityReport).toBeUndefined()
		expect(f.canSync()).toBe(true)
		f.report({ kind: 'complete', settlement: 'notStarted' })
		expect(f.canSync()).toBe(true)
	})
	it.each(['loading', 'error', 'role'])(
		'invalidates %s authority and never restores old status',
		(reason) => {
			const f = start()
			const selected = f.selected()
			f.observe(selected)
			const old = f.report({ kind: 'complete', settlement: 'notStarted' })
			const changed: ReadinessObservation =
				reason === 'loading'
					? { ...selected, membershipLoading: true }
					: reason === 'error'
						? { ...selected, membershipError: new Error('observer failed') }
						: {
								...selected,
								source: { ...selected.source, membership: { ...membership, role: 'member' } }
							}
			f.observe(changed)
			expect(f.canSync()).toBe(false)
			f.observe(selected)
			f.actor.send({ type: 'SELECTED_INTEGRITY_STATUS', lease: old.lease, report: old })
			expect(f.actor.getSnapshot().context.integrityReport).toBeUndefined()
			expect(f.canSync()).toBe(true)
			f.report({ kind: 'complete', settlement: 'notStarted' })
			expect(f.canSync()).toBe(true)
		}
	)
	it('does not restart equivalent observations but assigns a fresh generation to explicit retry', () => {
		const f = start()
		const selected = f.selected()
		f.observe(selected)
		const before: IntegrityRequest = f.actor.getSnapshot().context.integrityRequest
		const owner = f.actor.getSnapshot().context.resourceActor
		f.observe(selected)
		expect(f.actor.getSnapshot().context.integrityRequest).toEqual(before)
		expect(f.actor.getSnapshot().context.resourceActor).toBe(owner)
		f.report({ kind: 'failed', settlement: 'notStarted' })
		f.actor.send({ type: 'RETRY_INTEGRITY' })
		expect(f.actor.getSnapshot().context.integrityRequest.generation).toBe(before.generation + 1)
		expect(f.actor.getSnapshot().context.integrityReport).toBeUndefined()
		expect(f.canSync()).toBe(true)
	})
	it('rejects a report for another binding even if its generation matches', () => {
		const f = start()
		f.observe(f.selected())
		const request: IntegrityRequest = f.actor.getSnapshot().context.integrityRequest
		if (!request.binding) throw new Error('Missing binding')
		f.report(
			{ kind: 'complete', settlement: 'notStarted' },
			{ ...request, binding: { ...request.binding, organizationId: scope.profileId } }
		)
		expect(f.actor.getSnapshot().context.integrityReport).toBeUndefined()
		expect(f.canSync()).toBe(true)
	})
	it.each([
		'?workspace=invalid',
		'?workspace=',
		`?workspace=${scope.organizationId}&workspace=${scope.organizationId}`
	])('denies explicit malformed scope %s without navigation fallback', async (search) => {
		const f = start()
		f.observe({
			...f.selected(),
			route: { pathname: '/expenses', search, hash: '' },
			source: { ...f.observation.source, organizationId: null }
		})
		await waitFor(f.actor, (s) => selectWorkspaceView(s).navigation === 'unavailable')
		expect(f.navigate).not.toHaveBeenCalled()
	})
	it('denies retained workspace rows after membership disappears', async () => {
		const f = start()
		const selected = f.selected()
		f.observe(selected)
		f.observe({ ...selected, source: { ...selected.source, membership: undefined } })
		await waitFor(f.actor, (s) => selectWorkspaceView(s).navigation === 'unavailable')
		expect(f.canSync()).toBe(false)
		expect(f.navigate).not.toHaveBeenCalled()
	})
	it('retries initialization while preserving identity-bound owners and ignores old reports', async () => {
		const f = start()
		const oldRequest: InitializationRequest = f.actor.getSnapshot().context.initializationRequest
		f.startup.send({ type: 'FAIL' })
		f.actor.send({ type: 'RETRY' })
		await waitFor(f.actor, (s) => selectWorkspaceView(s).ready)
		expect(f.actor.getSnapshot().children.startup).toBe(f.startup.actor)
		expect(f.actor.getSnapshot().children.creation).toBe(f.creation.actor)
		f.actor.send({
			type: 'INITIALIZATION_STATUS',
			report: { request: oldRequest, status: { kind: 'failed' } }
		})
		expect(selectWorkspaceView(f.actor.getSnapshot()).ready).toBe(true)
	})
	it('keeps creation alive when only the selected workspace changes', () => {
		const f = start()
		f.observe(f.selected())
		f.creation.send({ type: 'HOLD' })
		f.observe(f.selected(scope.profileId))
		expect(f.actor.getSnapshot().children.creation).toBe(f.creation.actor)
		expect(f.creation.getSnapshot().matches('held')).toBe(true)
	})
	it('waits for initial discovery before redirecting an empty unscoped finance route', async () => {
		const f = start()
		f.startup.send({ type: 'HOLD' })
		f.observe({ ...f.observation, route: { pathname: '/accounts', search: '', hash: '' } })
		expect(selectWorkspaceView(f.actor.getSnapshot()).ready).toBe(true)
		expect(selectWorkspaceView(f.actor.getSnapshot()).navigation).toBe('waiting')
		expect(f.navigate).not.toHaveBeenCalled()
		f.observe({
			...f.observation,
			organizations: records().organizations,
			route: { pathname: '/accounts', search: '', hash: '' }
		})
		await waitFor(f.actor, () => f.navigate.mock.calls.length > 0)
		expect(f.navigate).toHaveBeenCalled()
	})
	it('reports workspace query failure instead of hiding it behind pending initialization', async () => {
		const f = start()
		f.startup.send({ type: 'HOLD' })
		f.observe({
			...f.observation,
			organizationsError: new Error('Workspace query failed'),
			route: { pathname: '/accounts', search: '', hash: '' }
		})
		await waitFor(f.actor, (snapshot) => selectWorkspaceView(snapshot).navigation === 'failed')
		expect(f.actor.getSnapshot().matches({ active: { workspace: 'waiting' } })).toBe(true)
		expect(selectWorkspaceView(f.actor.getSnapshot()).ready).toBe(true)
		expect(f.navigate).not.toHaveBeenCalled()
	})
	it('keeps local navigation available while provenance initialization waits', async () => {
		const f = start()
		f.startup.send({ type: 'HOLD' })
		f.observe(f.selected())
		await waitFor(f.actor, (snapshot) => selectWorkspaceView(snapshot).navigation === 'scoped')
		expect(f.actor.getSnapshot().matches({ active: { workspace: 'waiting' } })).toBe(true)
		expect(selectWorkspaceView(f.actor.getSnapshot()).ready).toBe(true)
		expect(f.canSync()).toBe(false)
		expect(f.navigate).not.toHaveBeenCalled()
	})
	it('keeps local navigation available when provenance initialization fails', async () => {
		const f = start()
		f.startup.send({ type: 'FAIL' })
		f.observe(f.selected())
		await waitFor(f.actor, (snapshot) => selectWorkspaceView(snapshot).navigation === 'scoped')
		expect(selectWorkspaceView(f.actor.getSnapshot()).ready).toBe(true)
		expect(selectWorkspaceView(f.actor.getSnapshot()).failed).toBe(true)
		expect(f.navigate).not.toHaveBeenCalled()
		expect(f.canSync()).toBe(false)
	})
	it('supports workspace management without a selected workspace or bank setup', () => {
		const f = start()
		expect(selectWorkspaceView(f.actor.getSnapshot()).ready).toBe(true)
		expect(selectWorkspaceView(f.actor.getSnapshot()).navigation).toBe('directory')
		expect(f.navigate).not.toHaveBeenCalled()
	})
})

describe('scoped bank observations', () => {
	it('does not republish access for route changes or equivalent workspace observations', () => {
		const f = start()
		const selected = f.selected()
		f.observe(selected)
		const revision = selectWorkspaceView(f.actor.getSnapshot()).bankRevision
		bankObservation.mockClear()
		f.observe({ ...selected, route: { ...selected.route, hash: '#details' } })
		f.observe(selected)
		expect(bankObservation).not.toHaveBeenCalled()
		expect(selectWorkspaceView(f.actor.getSnapshot()).bankRevision).toBe(revision)
	})
	it('forwards only the current binding’s data and ignores it during shutdown', () => {
		const f = start()
		const selected = f.selected()
		f.observe(selected)
		const revision = selectWorkspaceView(f.actor.getSnapshot()).bankRevision
		if (revision === undefined) throw new Error('Expected published bank access')
		bankObservation.mockClear()
		for (const invalid of [
			{ revision: revision - 1, organizationId: scope.organizationId, userId: scope.userId },
			{ revision, organizationId: scope.profileId, userId: scope.userId },
			{ revision, organizationId: scope.organizationId, userId: scope.profileId }
		])
			f.actor.send({
				type: 'BANK_OBSERVED',
				organizationId: invalid.organizationId,
				userId: invalid.userId,
				event: { type: 'HISTORY_CHANGED', revision: invalid.revision, records: [] }
			})
		expect(bankObservation).not.toHaveBeenCalled()
		const event = {
			type: 'HISTORY_CHANGED',
			revision,
			records: []
		} satisfies import('../bank-sync/types.js').BankObservationEvent
		f.actor.send({
			type: 'BANK_OBSERVED',
			organizationId: scope.organizationId,
			userId: scope.userId,
			event
		})
		expect(bankObservation).toHaveBeenCalledOnce()
		expect(bankObservation).toHaveBeenLastCalledWith(event)
		f.actor.send({ type: 'SHUTDOWN' })
		f.actor.send({
			type: 'BANK_OBSERVED',
			organizationId: scope.organizationId,
			userId: scope.userId,
			event
		})
		expect(bankObservation).toHaveBeenCalledOnce()
	})
	it('advances access revisions for authority replacement and revisits, but not integrity retry', () => {
		const f = start()
		const selected = f.selected()
		f.observe(selected)
		const first = selectWorkspaceView(f.actor.getSnapshot()).bankRevision
		if (first === undefined) throw new Error('Expected published bank access')
		f.observe({
			...selected,
			source: { ...selected.source, membership: { ...membership, role: 'admin' } }
		})
		expect(selectWorkspaceView(f.actor.getSnapshot()).bankRevision).toBe(first + 1)
		f.observe(f.selected(scope.profileId))
		const second = selectWorkspaceView(f.actor.getSnapshot()).bankRevision
		if (second === undefined) throw new Error('Missing second access revision')
		expect(second).toBeGreaterThan(first + 1)
		f.observe(selected)
		const returned = selectWorkspaceView(f.actor.getSnapshot()).bankRevision
		expect(returned).toBeGreaterThan(second)
		f.report({ kind: 'failed', settlement: 'notStarted' })
		f.actor.send({ type: 'RETRY_INTEGRITY' })
		expect(selectWorkspaceView(f.actor.getSnapshot()).bankRevision).toBe(returned)
	})
})

describe('selected resource migration', () => {
	it('keeps identity owners alive and coalesces A → B → A until both old resources release', () => {
		const f = start()
		f.observe(f.selected())
		const oldOwner = f.actor.getSnapshot().context.resourceActor
		const oldLease = f.actor.getSnapshot().context.resourceLease
		if (!oldOwner || !oldLease) throw new Error('Missing original resource lease')
		const bank = f.bank,
			integrity = f.integrity
		const beforeRevision = f.actor.getSnapshot().context.bankRevision
		bank.send({ type: 'HOLD' })
		integrity.send({ type: 'HOLD' })
		f.creation.send({ type: 'HOLD' })
		f.observe(f.selected(scope.profileId))
		f.observe(f.selected())
		expect(f.actor.getSnapshot().context.resourceActor).toBe(oldOwner)
		expect(bankStart).toHaveBeenCalledOnce()
		expect(f.canSync()).toBe(false)
		expect(f.actor.getSnapshot().children.startup).toBe(f.startup.actor)
		expect(f.actor.getSnapshot().children.creation).toBe(f.creation.actor)
		expect(f.actor.getSnapshot().children.navigation).toBe(f.navigation)
		expect(f.creation.getSnapshot().matches('held')).toBe(true)
		bank.send({ type: 'FINISH' })
		expect(f.actor.getSnapshot().context.resourceActor).toBe(oldOwner)
		integrity.send({ type: 'FINISH' })
		const next = f.actor.getSnapshot().context.resourceActor
		expect(next).not.toBe(oldOwner)
		expect(f.actor.getSnapshot().context.resourceLease?.epoch).toBe(oldLease.epoch + 1)
		expect(f.actor.getSnapshot().context.bankRevision).toBeGreaterThan(beforeRevision)
		expect(bankStart).toHaveBeenCalledTimes(2)
		f.actor.send({ type: 'BANK', lease: oldLease, event: { type: 'RESET' } })
		expect(f.actor.getSnapshot().context.resourceActor).toBe(next)
		expect(f.canSync()).toBe(true)
		expect(f.actor.getSnapshot().context.resourceRelease).toEqual({ outcome: 'released' })
	})
	it.each(['bank', 'integrity'] satisfies ('bank' | 'integrity')[])(
		'blocks replacement after unresolved %s release while preserving creation',
		(resource) => {
			const f = start()
			f.observe(f.selected())
			const held = f[resource]
			held.send({ type: 'HOLD' })
			resourceResults.set(held.actor, { outcome: 'unresolved' })
			f.observe(f.selected(scope.profileId))
			held.send({ type: 'FINISH' })
			expect(f.actor.getSnapshot().matches({ active: { resources: 'unresolved' } })).toBe(true)
			expect(bankStart).toHaveBeenCalledOnce()
			expect(f.actor.getSnapshot().children.creation).toBe(f.creation.actor)
			f.actor.send({ type: 'SHUTDOWN' })
			f.startup.send({ type: 'FINISH' })
			expect(f.actor.getSnapshot().output).toEqual({ selectedResources: { outcome: 'unresolved' } })
		}
	)
	it('retains a known released partial result and requires explicit retry before replacement', () => {
		const f = start()
		f.observe(f.selected())
		resourceResults.set(f.integrity.actor, { outcome: 'releasedWithFailure' })
		f.observe(f.selected(scope.profileId))
		expect(f.canSync()).toBe(false)
		expect(bankStart).toHaveBeenCalledOnce()
		f.retrySelection()
		expect(f.canSync()).toBe(true)
		expect(f.actor.getSnapshot().context.resourceRelease).toEqual({
			outcome: 'releasedWithFailure'
		})
		expect(bankStart).toHaveBeenCalledTimes(2)
	})
	it('does not construct a bank owner on identity/global/workspace management routes', () => {
		const f = start()
		for (const pathname of ['/account', '/settings/workspace', '/login']) {
			f.observe({ ...f.observation, route: { pathname, search: '', hash: '' } })
		}
		expect(bankStart).not.toHaveBeenCalled()
		expect(workspaceBankActor(f.actor.getSnapshot())).toBeUndefined()
		expect(f.actor.getSnapshot().children.creation).toBe(f.creation.actor)
	})
	it('rejects stale data revisions after returning to the same workspace', () => {
		const f = start()
		f.observe(f.selected())
		const oldRevision = f.actor.getSnapshot().context.bankRevision
		f.observe(f.selected(scope.profileId))
		f.observe(f.selected())
		bankObservation.mockClear()
		f.actor.send({
			type: 'BANK_OBSERVED',
			organizationId: scope.organizationId,
			userId: scope.userId,
			event: { type: 'HISTORY_CHANGED', revision: oldRevision, records: [] }
		})
		expect(bankObservation).not.toHaveBeenCalled()
		expect(f.actor.getSnapshot().context.bankRevision).toBeGreaterThan(oldRevision)
	})
})

it('keeps identity owners alive and preserves uncertainty when the selected owner itself crashes', () => {
	const f = start()
	ownerFailure.shutdown = true
	f.observe(f.selected())
	f.observe(f.selected(scope.profileId))
	expect(f.actor.getSnapshot().matches({ active: { resources: 'unresolved' } })).toBe(true)
	expect(f.actor.getSnapshot().context.resourceRelease).toEqual({ outcome: 'unresolved' })
	expect(f.actor.getSnapshot().children.creation).toBe(f.creation.actor)
	expect(f.actor.getSnapshot().children.startup).toBe(f.startup.actor)
	expect(bankStart).toHaveBeenCalledOnce()
})

it('does not forward integrity observations after an old owner has synchronously closed', () => {
	let oldOwner: object | undefined
	const late: string[] = []
	const f = start((event) => {
		if (
			event.type === '@xstate.transition' &&
			event.actorRef === oldOwner &&
			event.event.type === 'INTEGRITY' &&
			event.actorRef.getSnapshot().status !== 'active'
		)
			late.push(event.event.type)
	})
	f.observe(f.selected())
	oldOwner = f.actor.getSnapshot().context.resourceActor
	f.observe(f.selected(scope.profileId))
	expect(late).toEqual([])
	expect(bankStart).toHaveBeenCalledTimes(2)
	expect(f.canSync()).toBe(true)
})
