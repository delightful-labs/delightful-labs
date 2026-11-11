import {
	createSessionStartupMachine,
	createSessionReadinessMachine
} from 'delightful-local-first/session/workflow'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RecoveryPhrase } from 'jazz-tools/passphrase'
import { createJazzSessionReadinessAdapter } from 'delightful-local-first/backend/jazz/session-readiness'
import { createJazzRestorationAdapter } from 'delightful-local-first/backend/jazz/restoration'
import {
	createSessionAcquisitionMachine,
	selectAcquiredSession
} from 'delightful-local-first/session/workflow'
import type { JazzStartupBinding } from '#lib/runtime/jazz-session.js'
import type { SessionOwnerEvent } from 'delightful-local-first/session/workflow'
import { generateAuthSecret } from 'jazz-tools'
import type { JazzClient, JazzSession, getDb } from 'jazz-tools/svelte'
import {
	createApplicationReadinessMachine,
	selectAttachedWorkspace,
	selectRecoveryView,
	selectApplicationWorkspaceRestore,
	captureTransferMutationScope
} from './application-readiness.js'
import type { WorkspaceAttachment, ReadinessObservation } from './readiness.js'
import type {
	SelectedResourceCommand,
	SelectedResourceOutput
} from '../../contracts/workspace-selected-resources.js'
import type { WorkspaceResourceRelease } from '../../contracts/workspace-resource-release.js'
import type { TransferMutationRequest } from '../transfers/internal-transfer-mutation-owner.js'
import type { WorkspaceLease } from 'delightful-local-first/workspace/contracts'
import { membership, scope } from '../workspaces/workspace-integrity.fixture.js'
import {
	Actor,
	createActor,
	setup,
	waitFor,
	createCallbackLogic,
	types,
	createAsyncLogic
} from 'xstate'
import type { ActorFromLogic, InspectionEvent } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'

function heldResources() {
	type Input = { lease: WorkspaceLease; release: WorkspaceResourceRelease }
	type Context = Input & { drain: SelectedResourceOutput['drain'] }
	const events0 = {
		BANK: types<EventPayload<SelectedResourceCommand | { type: 'FINISH' }, 'BANK'>>(),
		INTEGRITY: types<EventPayload<SelectedResourceCommand | { type: 'FINISH' }, 'INTEGRITY'>>(),
		DRAIN: types<EventPayload<SelectedResourceCommand | { type: 'FINISH' }, 'DRAIN'>>(),
		SHUTDOWN: types<EventPayload<SelectedResourceCommand | { type: 'FINISH' }, 'SHUTDOWN'>>(),
		FINISH: types<EventPayload<SelectedResourceCommand | { type: 'FINISH' }, 'FINISH'>>()
	}
	type NativeEvent0 =
		| import('xstate').InferEvents<typeof events0>
		| import('xstate').DoneActorEvent<never>
		| import('xstate').ErrorActorEvent
	return setup({
		schemas: {
			context: types<Context>(),
			events: events0,
			input: types<Input>(),
			output: types<SelectedResourceOutput>()
		}
	}).createMachine({
		context: ({ input }) => ({ ...input, drain: undefined }),
		initial: 'active',
		output: ({ context }) => ({
			lease: context.lease,
			drain: context.drain,
			release: context.release
		}),
		states: {
			active: {
				on: {
					DRAIN: (args) => {
						return { target: 'draining', context: { drain: args.event.drain } }
					},
					SHUTDOWN: { target: 'draining' }
				}
			},
			draining: { on: { FINISH: { target: 'closed' } } },
			closed: { type: 'final' }
		}
	})
}
type HeldResources = import('xstate').ActorRef<
	import('xstate').Snapshot<SelectedResourceOutput>,
	SelectedResourceCommand | { type: 'FINISH' }
>
const heldActors: { stop: () => void }[] = []
const { workspaceStart, workspaceControls } = vi.hoisted(() => ({
	workspaceStart: vi.fn(),
	workspaceControls: new Map<
		object,
		{
			close: () => void
			crash: () => void
			resource: (lease: WorkspaceLease, actor: HeldResources) => void
		}
	>()
}))

// Delay workspace acknowledgement so shutdown races can be exercised deterministically.
vi.mock('./readiness.js', () => ({
	createWorkspaceReadinessMachine: () =>
		setup({
			schemas: {
				context: types<{
					observation: ReadinessObservation | undefined
					lease: WorkspaceLease | undefined
					resourceLease: WorkspaceLease | undefined
					resourceActor: HeldResources | undefined
				}>(),
				events: {
					SHUTDOWN:
						types<
							EventPayload<
								| { type: 'SHUTDOWN' }
								| { type: 'ACK_CLOSE' }
								| { type: 'CRASH' }
								| { type: 'OBSERVED'; observation: ReadinessObservation }
								| { type: 'SELECTION'; status: string; lease: WorkspaceLease | undefined }
								| { type: 'SET_RESOURCES'; lease: WorkspaceLease; actor: HeldResources },
								'SHUTDOWN'
							>
						>(),
					ACK_CLOSE:
						types<
							EventPayload<
								| { type: 'SHUTDOWN' }
								| { type: 'ACK_CLOSE' }
								| { type: 'CRASH' }
								| { type: 'OBSERVED'; observation: ReadinessObservation }
								| { type: 'SELECTION'; status: string; lease: WorkspaceLease | undefined }
								| { type: 'SET_RESOURCES'; lease: WorkspaceLease; actor: HeldResources },
								'ACK_CLOSE'
							>
						>(),
					CRASH:
						types<
							EventPayload<
								| { type: 'SHUTDOWN' }
								| { type: 'ACK_CLOSE' }
								| { type: 'CRASH' }
								| { type: 'OBSERVED'; observation: ReadinessObservation }
								| { type: 'SELECTION'; status: string; lease: WorkspaceLease | undefined }
								| { type: 'SET_RESOURCES'; lease: WorkspaceLease; actor: HeldResources },
								'CRASH'
							>
						>(),
					OBSERVED:
						types<
							EventPayload<
								| { type: 'SHUTDOWN' }
								| { type: 'ACK_CLOSE' }
								| { type: 'CRASH' }
								| { type: 'OBSERVED'; observation: ReadinessObservation }
								| { type: 'SELECTION'; status: string; lease: WorkspaceLease | undefined }
								| { type: 'SET_RESOURCES'; lease: WorkspaceLease; actor: HeldResources },
								'OBSERVED'
							>
						>(),
					SELECTION:
						types<
							EventPayload<
								| { type: 'SHUTDOWN' }
								| { type: 'ACK_CLOSE' }
								| { type: 'CRASH' }
								| { type: 'OBSERVED'; observation: ReadinessObservation }
								| { type: 'SELECTION'; status: string; lease: WorkspaceLease | undefined }
								| { type: 'SET_RESOURCES'; lease: WorkspaceLease; actor: HeldResources },
								'SELECTION'
							>
						>(),
					SET_RESOURCES:
						types<
							EventPayload<
								| { type: 'SHUTDOWN' }
								| { type: 'ACK_CLOSE' }
								| { type: 'CRASH' }
								| { type: 'OBSERVED'; observation: ReadinessObservation }
								| { type: 'SELECTION'; status: string; lease: WorkspaceLease | undefined }
								| { type: 'SET_RESOURCES'; lease: WorkspaceLease; actor: HeldResources },
								'SET_RESOURCES'
							>
						>()
				}
			}
		}).createMachine({
			context: {
				observation: undefined,
				lease: undefined,
				resourceLease: undefined,
				resourceActor: undefined
			},
			initial: 'active',
			output: () => ({ selectedResources: { outcome: 'released' } }),
			entry: (args, enq) => {
				enq(workspaceStart)
				enq(() => {
					const { self } = args
					workspaceControls.set(self, {
						close: () => self.send({ type: 'ACK_CLOSE' }),
						crash: () => self.send({ type: 'CRASH' }),
						resource: (lease, actor) => self.send({ type: 'SET_RESOURCES', lease, actor })
					})
				})
			},
			on: {
				CRASH: (args, enq) => {
					enq(() => {
						throw new Error('private workspace crash')
					})
				}
			},
			states: {
				active: {
					on: {
						SHUTDOWN: { target: 'closing' },
						SET_RESOURCES: (args) => {
							const { event } = args
							return { context: { resourceLease: event.lease, resourceActor: event.actor } }
						},
						OBSERVED: (args) => {
							return { context: { observation: args.event.observation } }
						},
						SELECTION: (args) => {
							return { context: { lease: args.event.lease } }
						}
					}
				},
				closing: { on: { ACK_CLOSE: { target: 'closed' } } },
				closed: {
					type: 'final',
					entry: (args, enq) => {
						const { self } = args
						enq.sendTo(args.parent, { type: 'WORKSPACE_CLOSED', actor: self })
					}
				}
			}
		})
}))

type Session = JazzSession<JazzClient>
type MutationErrorDb = Pick<ReturnType<typeof getDb>, 'onMutationError'>
const actors: ActorFromLogic<ReturnType<typeof createApplicationReadinessMachine>>[] = []
const owners: ActorFromLogic<ReturnType<typeof createSessionAcquisitionMachine<Session>>>[] = []
const startupBindings = new Map<
	ActorFromLogic<ReturnType<typeof createApplicationReadinessMachine>>,
	JazzStartupBinding
>()
function startupOwner(open: () => Promise<Session>, existing?: Session) {
	const binding = {}
	const owner = createActor(createSessionAcquisitionMachine<Session>(), {
		input: { binding, capability: { open }, ...(existing ? { existing } : {}) }
	}).start()
	owners.push(owner)
	return { owner, scope: { binding, attachment: {}, generation: 0 } }
}
function beginStartup(actor: ActorFromLogic<ReturnType<typeof createApplicationReadinessMachine>>) {
	const startup = startupBindings.get(actor)
	if (!startup) throw new Error('Expected startup test binding')
	actor.send({ type: 'START', startup })
}
function readinessScope(
	actor: ActorFromLogic<ReturnType<typeof createApplicationReadinessMachine>>
) {
	const scope = actor.getSnapshot().context.readinessScope
	if (!scope) throw new Error('Expected acquired session readiness binding')
	return scope
}
function failObservation(
	actor: ActorFromLogic<ReturnType<typeof createApplicationReadinessMachine>>
) {
	// Inject a normalized read fault at the real library observer boundary, retaining retry ownership.
	actor.getSnapshot().children.sessionReadiness?.send({
		type: 'OBSERVATION_FAILED',
		scope: readinessScope(actor),
		observation: actor.getSnapshot().context.observation,
		reason: 'readFailed'
	})
}
function reportStatus(
	actor: ActorFromLogic<ReturnType<typeof createApplicationReadinessMachine>>,
	status: ReturnType<Session['getSnapshot']>['status']
) {
	actor.send({
		type: 'SESSION_STATUS',
		scope: readinessScope(actor),
		observation: actor.getSnapshot().context.observation,
		status,
		afterRetry: undefined
	})
}
afterEach(() => {
	for (const actor of actors.splice(0)) actor.stop()
	for (const actor of heldActors.splice(0)) actor.stop()
	for (const owner of owners.splice(0)) owner.stop()
	startupBindings.clear()
	workspaceControls.clear()
})
function control(actor: { id: string }) {
	const value = workspaceControls.get(actor)
	if (!value) throw new Error('Expected workspace test controls')
	return value
}

function session(db?: MutationErrorDb) {
	let notify = () => {}
	const unsubscribe = vi.fn()
	const getSnapshot = vi.fn<Session['getSnapshot']>(() => {
		const snapshot: ReturnType<Session['getSnapshot']> = { status: 'ready' }
		if (db) Object.defineProperty(snapshot, 'client', { value: { db } })
		return snapshot
	})
	const subscribe = vi.fn<Session['subscribe']>((listener) => {
		notify = listener
		return unsubscribe
	})
	const value: Session = new (class {
		getSnapshot = getSnapshot
		subscribe = subscribe
		retry = vi.fn(async () => {})
		close = vi.fn(async () => {})
		createLocalFirst = vi.fn(async () => {})
		restoreLocalFirst = vi.fn(async () => {})
		loginWithBackend = vi.fn(async () => {})
		linkWithBackend = vi.fn(async () => {})
		logout = vi.fn(async () => {})
	})()

	return { value, getSnapshot, subscribe, unsubscribe, notify: () => notify() }
}
const nativeFaults = new WeakMap<object, { startup: () => void; readiness: () => void }>()
function failStartup(actor: object) {
	const fault = nativeFaults.get(actor)
	if (!fault) throw new Error('Missing native startup fault control')
	fault.startup()
}
function failReadiness(actor: object) {
	const fault = nativeFaults.get(actor)
	if (!fault) throw new Error('Missing native readiness fault control')
	fault.readiness()
}

function sessionFaultSources() {
	let startupBroken = false,
		readinessBroken = false
	const startupLogic = createSessionStartupMachine<Session>()
	const readinessLogic = createSessionReadinessMachine()
	const transition = startupLogic.transition.bind(startupLogic)
	vi.spyOn(startupLogic, 'transition').mockImplementation((...args) => {
		if (startupBroken) throw new Error('Controlled startup actor crash')
		return transition(...args)
	})
	const supervisedStartup = startupLogic
	const currentObservation = readinessLogic.sources.guards.currentObservation
	if (typeof currentObservation !== 'function') throw new Error('Missing session guard contract')

	const supervisedReadiness = readinessLogic.provide({
		guards: {
			currentObservation: (args) => {
				if (readinessBroken) {
					throw new Error('Controlled readiness actor crash')
				}
				return currentObservation(args)
			}
		}
	})

	return {
		actors: { startup: supervisedStartup, sessionReadiness: supervisedReadiness },
		bind: (actor: ActorFromLogic<ReturnType<typeof createApplicationReadinessMachine>>) => {
			nativeFaults.set(actor, {
				startup: () => {
					const child = actor.getSnapshot().children.startup
					if (child?.getSnapshot().status !== 'active') return
					startupBroken = true
					try {
						child.send({ type: 'OWNER_FAILED' })
					} finally {
						startupBroken = false
					}
				},
				readiness: () => {
					const child = actor.getSnapshot().children.sessionReadiness
					if (child?.getSnapshot().status !== 'active') return
					readinessBroken = true
					try {
						child.send({
							type: 'OBSERVATION_FAILED',
							scope: readinessScope(actor),
							observation: actor.getSnapshot().context.observation,
							reason: 'readFailed'
						})
					} finally {
						readinessBroken = false
					}
				}
			})
		}
	}
}
async function start(
	open: () => Promise<Session>,
	existing?: Session,
	inspect: (event: InspectionEvent) => void = () => {},
	prepare?: (session: Session) => Promise<void>
) {
	const startup = startupOwner(open, existing)
	const faults = sessionFaultSources()

	const actor = createActor(
		createApplicationReadinessMachine(
			undefined,
			undefined,
			createJazzSessionReadinessAdapter,
			undefined,
			prepare
		).provide({ actors: faults.actors }),
		{ inspect }
	).start()
	faults.bind(actor)

	startupBindings.set(actor, startup)
	actors.push(actor)
	if (existing) {
		beginStartup(actor)
		await waitFor(actor, (state) => state.matches('running') || state.matches('observerFailed'))
	}
	return actor
}
function attach(
	actor: import('xstate').ActorRef<
		import('xstate').SnapshotFrom<ReturnType<typeof createApplicationReadinessMachine>>,
		import('xstate').SendableEventFromLogic<ReturnType<typeof createApplicationReadinessMachine>>
	>,
	observed?: ReadinessObservation
) {
	// The workspace factory above owns no database effects in this test.
	const source = {
		organizationId: null,
		userId: undefined,
		sessionReady: false,
		membership: undefined,
		connections: [],
		accounts: [],
		links: []
	}
	const attachment: WorkspaceAttachment = {
		environment: 'test',
		dependencies: {
			db: vi.fn<() => WorkspaceAttachment['dependencies']['db']>()(),
			read: () => source,
			passkeyName: () => 'Test'
		},
		read: () =>
			observed ?? {
				source,
				sessionStatus: 'ready',
				membershipLoading: false,
				membershipError: undefined,
				organizations: [],
				organizationsLoading: false,
				organizationsError: undefined,
				route: { pathname: '/settings/workspace', search: '', hash: '' }
			},
		navigate: vi.fn(async () => {})
	}
	actor.send({ type: 'ATTACH_WORKSPACE', attachment })
	const workspace = actor.getSnapshot().context.workspace
	if (!workspace) throw new Error('Expected workspace')
	return workspace
}

describe('application readiness supervision', () => {
	it('uses a shared local lease to bind the transfer owner independently of the directory', async () => {
		const current = session()
		const actor = await start(async () => current.value, current.value)
		const observation: ReadinessObservation = {
			source: { organizationId: scope.organizationId, userId: scope.userId, membership },
			sessionStatus: 'ready',
			membershipLoading: false,
			membershipError: undefined,
			organizations: [],
			organizationsLoading: false,
			organizationsError: undefined,
			route: { pathname: '/expenses', search: `?workspace=${scope.organizationId}`, hash: '' }
		}
		const workspace = attach(actor, observation)
		const mutationOwner = actor.getSnapshot().children.transferMutationOwner
		expect(actor.getSnapshot().context.selectionLease?.request.workspaceId).toBe(
			scope.organizationId
		)
		expect(mutationOwner?.getSnapshot().context.workspaceId).toBe(scope.organizationId)
		actor.send({ type: 'SHUTDOWN' })
		control(workspace).close()
		await waitFor(actor, (snapshot) => snapshot.status === 'done')
		expect(current.value.close).not.toHaveBeenCalled()
	})

	it('correlates late transfer rejections and releases the Jazz observer on shutdown', async () => {
		const release = vi.fn()
		const onMutationError = vi.fn<MutationErrorDb['onMutationError']>(() => release)
		const current = session({ onMutationError })
		const actor = await start(async () => current.value, current.value)

		expect(onMutationError).toHaveBeenCalledOnce()
		actor.send({
			type: 'TRANSFER_WRITE_TRACKED',
			write: { transactionId: 'tracked-write', operation: 'link', transferId: 'transfer-id' }
		})
		actor.send({ type: 'MUTATION_REJECTED', transactionId: 'tracked-write' })
		expect(actor.getSnapshot().context.mutationNotice).toEqual({
			kind: 'transfer',
			transactionId: 'tracked-write',
			operation: 'link',
			transferId: 'transfer-id'
		})

		actor.send({ type: 'DISMISS_MUTATION_REJECTION' })
		for (const transactionId of ['delete-clear-write', 'delete-records-write'])
			actor.send({
				type: 'TRANSFER_WRITE_TRACKED',
				write: { transactionId, operation: 'delete', transferId: 'transfer-id' }
			})
		actor.send({ type: 'MUTATION_REJECTED', transactionId: 'delete-clear-write' })
		expect(actor.getSnapshot().context.mutationNotice).toEqual({
			kind: 'transfer',
			transactionId: 'delete-clear-write',
			operation: 'delete',
			transferId: 'transfer-id'
		})
		actor.send({ type: 'DISMISS_MUTATION_REJECTION' })
		actor.send({ type: 'MUTATION_REJECTED', transactionId: 'delete-records-write' })
		expect(actor.getSnapshot().context.mutationNotice).toEqual({
			kind: 'transfer',
			transactionId: 'delete-records-write',
			operation: 'delete',
			transferId: 'transfer-id'
		})

		actor.send({ type: 'DISMISS_MUTATION_REJECTION' })
		actor.send({ type: 'MUTATION_REJECTED', transactionId: 'untracked-write' })
		expect(actor.getSnapshot().context.mutationNotice).toEqual({
			kind: 'generic',
			transactionId: 'untracked-write'
		})
		actor.send({ type: 'SHUTDOWN' })
		expect(release).toHaveBeenCalledOnce()
	})

	it.each([false, true])(
		'handles the registered SDK rejection callback with transfer tracking=%s',
		async (tracked) => {
			const release = vi.fn()
			const onMutationError = vi.fn<MutationErrorDb['onMutationError']>(() => release)
			const current = session({ onMutationError })
			const actor = await start(async () => current.value, current.value)
			const workspace = attach(actor)
			if (tracked)
				actor.send({
					type: 'TRANSFER_WRITE_TRACKED',
					write: {
						transactionId: 'callback-write',
						operation: 'link',
						transferId: 'callback-transfer'
					}
				})
			const listener = onMutationError.mock.calls[0]?.[0]
			if (!listener) throw new Error('Expected SDK mutation rejection subscription')
			// Invoke the native callback with a wire-shaped fixture; SDK transaction IDs are nominal.
			Reflect.apply(listener, undefined, [
				{
					code: 'permission-denied',
					reason: 'Synthetic private server detail',
					transaction: {
						transactionId: 'callback-write',
						kind: 'mergeable',
						sealed: true,
						latestSettlement: {
							kind: 'rejected',
							transactionId: 'callback-write',
							code: 'permission-denied',
							reason: 'Synthetic private server detail'
						}
					}
				}
			])
			expect(actor.getSnapshot().context.mutationNotice).toEqual(
				tracked
					? {
							kind: 'transfer',
							transactionId: 'callback-write',
							operation: 'link',
							transferId: 'callback-transfer'
						}
					: { kind: 'generic', transactionId: 'callback-write' }
			)
			expect(actor.getSnapshot().context.workspace).toBe(workspace)
			expect(actor.getSnapshot().status).toBe('active')
			actor.send({ type: 'DISMISS_MUTATION_REJECTION' })
			expect(actor.getSnapshot().context.mutationNotice).toBeUndefined()
			actor.send({ type: 'SHUTDOWN' })
			control(workspace).close()
			expect(release).toHaveBeenCalledOnce()
			expect(actor.getSnapshot().status).toBe('done')
		}
	)

	it('uses a generic notice for evicted and post-restart transfer rejections', async () => {
		const current = session()
		const actor = await start(async () => current.value, current.value)
		for (let index = 0; index < 65; index++)
			actor.send({
				type: 'TRANSFER_WRITE_TRACKED',
				write: {
					transactionId: `tracked-${index}`,
					operation: 'link',
					transferId: `transfer-${index}`
				}
			})

		actor.send({ type: 'MUTATION_REJECTED', transactionId: 'tracked-0' })
		expect(actor.getSnapshot().context.mutationNotice).toEqual({
			kind: 'generic',
			transactionId: 'tracked-0'
		})

		const restarted = await start(async () => current.value, current.value)
		restarted.send({ type: 'MUTATION_REJECTED', transactionId: 'tracked-64' })
		expect(restarted.getSnapshot().context.mutationNotice).toEqual({
			kind: 'generic',
			transactionId: 'tracked-64'
		})
	})

	it('retries failed opening and reuses the resulting session', async () => {
		const current = session()
		const open = vi
			.fn<() => Promise<Session>>()
			.mockRejectedValueOnce(new Error('private'))
			.mockResolvedValue(current.value)
		const actor = await start(open)
		beginStartup(actor)
		await waitFor(actor, (state) => state.hasTag('startup-error'))
		expect(actor.getSnapshot().context.session).toBeUndefined()
		actor.send({ type: 'RETRY' })
		await waitFor(actor, (state) => state.matches({ running: 'ready' }))
		expect(open).toHaveBeenCalledTimes(2)
		expect(current.subscribe).toHaveBeenCalledTimes(1)
	})

	it('restarts startup after an unexpected child error instead of retrying a failed actor', async () => {
		const current = session()
		const pending = Promise.withResolvers<Session>()
		const open = vi.fn(() => pending.promise)
		const actor = await start(open)
		beginStartup(actor)
		failStartup(actor)
		expect(actor.getSnapshot().value).toBe('startupActorFailed')
		actor.send({ type: 'RETRY' })
		pending.resolve(current.value)
		await waitFor(actor, (state) => state.matches({ running: 'ready' }))
		expect(open).toHaveBeenCalledTimes(1)
		expect(current.subscribe).toHaveBeenCalledTimes(1)
	})

	it('keeps shutdown priority over an unexpected startup error', async () => {
		const current = session()
		const actor = await start(async () => current.value, current.value)
		const workspace = attach(actor)
		actor.send({ type: 'SHUTDOWN' })
		failStartup(actor)
		expect(actor.getSnapshot().matches('closing')).toBe(true)
		control(workspace).close()
		expect(actor.getSnapshot().status).toBe('done')
	})

	it('models observer acquisition failure and retries without reopening the session', async () => {
		const current = session()
		current.subscribe.mockImplementationOnce(() => {
			throw new Error('private')
		})
		const open = vi.fn(async () => current.value)
		const actor = await start(open, current.value)
		expect(actor.getSnapshot().matches('observerFailed')).toBe(true)
		expect(actor.getSnapshot().status).toBe('active')
		actor.send({ type: 'RETRY' })
		expect(actor.getSnapshot().matches({ running: 'ready' })).toBe(true)
		expect(open).not.toHaveBeenCalled()
		expect(current.subscribe).toHaveBeenCalledTimes(2)
		expect(current.value.retry).not.toHaveBeenCalled()
	})

	it('bridges SDK callback failure, unsubscribes, and waits for workspace cleanup before retry', async () => {
		const current = session()
		const actor = await start(async () => current.value, current.value)
		const workspace = attach(actor)
		current.getSnapshot.mockImplementationOnce(() => {
			throw new Error('private')
		})
		expect(() => current.notify()).not.toThrow()
		expect(actor.getSnapshot().matches('settlingObserverFailure')).toBe(true)
		expect(current.unsubscribe).toHaveBeenCalledTimes(1)
		expect(workspace.getSnapshot().matches('closing')).toBe(true)
		actor.send({ type: 'RETRY' })
		expect(current.subscribe).toHaveBeenCalledTimes(1)
		control(workspace).close()
		expect(actor.getSnapshot().matches('observerFailed')).toBe(true)
		expect(actor.getSnapshot().context.workspace).toBeUndefined()
		actor.send({ type: 'RETRY' })
		expect(actor.getSnapshot().matches({ running: 'ready' })).toBe(true)
		expect(current.subscribe).toHaveBeenCalledTimes(2)
		expect(current.value.retry).not.toHaveBeenCalled()
	})

	it('keeps shutdown priority over observer failure and retry', async () => {
		const current = session()
		const actor = await start(async () => current.value, current.value)
		const workspace = attach(actor)
		failObservation(actor)
		actor.send({ type: 'SHUTDOWN' })
		actor.send({ type: 'RETRY' })
		reportStatus(actor, 'ready')
		expect(actor.getSnapshot().matches('closing')).toBe(true)
		control(workspace).close()
		expect(actor.getSnapshot().status).toBe('done')
		expect(workspace.getSnapshot().status).toBe('done')
		expect(current.subscribe).toHaveBeenCalledTimes(1)
	})

	it('ignores startup completion while workspace shutdown is pending', async () => {
		const current = session()
		const pending = Promise.withResolvers<Session>()
		const actor = await start(() => pending.promise)
		beginStartup(actor)
		const workspace = attach(actor)
		actor.send({ type: 'SHUTDOWN' })
		pending.resolve(current.value)
		await pending.promise
		await Promise.resolve()
		expect(actor.getSnapshot().matches('closing')).toBe(true)
		expect(current.subscribe).not.toHaveBeenCalled()
		control(workspace).close()
		expect(actor.getSnapshot().status).toBe('done')
	})

	it('fails cleanup conservatively when a workspace crashes, retaining healthy session observation', async () => {
		const current = session()
		const actor = await start(async () => current.value, current.value)
		workspaceStart.mockImplementationOnce(() => {
			throw new Error('private')
		})
		// Attachment is valid; its child fails during startup.
		const source = {
			organizationId: null,
			userId: undefined,
			sessionReady: false,
			membership: undefined,
			connections: [],
			accounts: [],
			links: []
		}
		actor.send({
			type: 'ATTACH_WORKSPACE',
			attachment: {
				environment: 'test',
				dependencies: {
					db: vi.fn<() => WorkspaceAttachment['dependencies']['db']>()(),
					read: () => source,
					passkeyName: () => 'Test'
				},
				read: () => ({
					source,
					sessionStatus: 'ready',
					membershipLoading: false,
					membershipError: undefined,
					organizations: [],
					organizationsLoading: false,
					organizationsError: undefined,
					route: { pathname: '/settings/workspace', search: '', hash: '' }
				}),
				navigate: vi.fn(async () => {})
			}
		})
		expect(actor.getSnapshot().matches('cleanupFailed')).toBe(true)
		expect(actor.getSnapshot().context.workspace).toBeUndefined()
		expect(current.unsubscribe).not.toHaveBeenCalled()
		actor.send({ type: 'RETRY' })
		expect(actor.getSnapshot().matches('cleanupFailed')).toBe(true)
		expect(current.subscribe).toHaveBeenCalledOnce()
		expect(current.value.retry).not.toHaveBeenCalled()
	})

	it('ignores detach/completion from a replaced workspace', async () => {
		const current = session()
		const actor = await start(async () => current.value, current.value)
		const previous = attach(actor)
		const previousAttachment = actor.getSnapshot().context.attachment
		if (!previousAttachment) throw new Error('Missing attachment')
		attach(actor)
		control(previous).close()
		const replacement = actor.getSnapshot().context.workspace
		expect(replacement).not.toBe(previous)
		actor.send({ type: 'DETACH_WORKSPACE', attachment: previousAttachment })
		actor.send({ type: 'WORKSPACE_CLOSED', actor: previous })
		expect(actor.getSnapshot().context.workspace).toBe(replacement)
		expect(replacement?.getSnapshot().matches('active')).toBe(true)
	})
	it('cancels a pending attachment before it can spawn an orphan owner', async () => {
		const current = session()
		const actor = await start(async () => current.value, current.value)
		const previous = attach(actor)
		attach(actor)
		const pending = actor.getSnapshot().context.pending
		if (!pending) throw new Error('Missing pending attachment')
		expect(selectAttachedWorkspace(actor.getSnapshot(), pending)).toBeUndefined()
		actor.send({ type: 'DETACH_WORKSPACE', attachment: pending })
		control(previous).close()
		expect(actor.getSnapshot().context.pending).toBeUndefined()
		expect(actor.getSnapshot().context.workspace).toBeUndefined()
		expect(actor.getSnapshot().context.attachment).toBeUndefined()
	})
	it('does not replace the owner when the same attachment is submitted twice', async () => {
		const current = session()
		const actor = await start(async () => current.value, current.value)
		const workspace = attach(actor)
		const attachment = actor.getSnapshot().context.attachment
		if (!attachment) throw new Error('Missing attachment')
		actor.send({ type: 'ATTACH_WORKSPACE', attachment })
		expect(selectAttachedWorkspace(actor.getSnapshot(), attachment)).toBe(workspace)
		expect(workspace.getSnapshot().matches('active')).toBe(true)
		expect(actor.getSnapshot().context.pending).toBeUndefined()
	})
})

// Branded SDK account handles are opaque; these tests observe only their public id.
function accountSnapshot(id: string): ReturnType<Session['getSnapshot']> {
	const snapshot: ReturnType<Session['getSnapshot']> = { status: 'ready' }
	Object.defineProperty(snapshot, 'account', { value: { id } })
	return snapshot
}
type RestorationBinding = ReturnType<typeof createJazzRestorationAdapter>
class MutableRestorationFixture implements RestorationBinding {
	readonly binding: RestorationBinding['binding']
	readonly capability: RestorationBinding['capability']
	readonly invalidate: RestorationBinding['invalidate']
	constructor(source: RestorationBinding) {
		this.binding = source.binding
		this.invalidate = () => source.invalidate()
		this.capability = new (class {
			parsePhrase = source.capability.parsePhrase
			isCurrentBinding = source.capability.isCurrentBinding
			restoreIdentity = source.capability.restoreIdentity
			readIdentity = source.capability.readIdentity
		})()
	}
}
async function mutationFixture(observed?: ReadinessObservation) {
	const current = session()
	current.getSnapshot.mockReturnValue(accountSnapshot('restored'))
	const pending = Promise.withResolvers<void>()
	const restore = vi.spyOn(current.value, 'restoreLocalFirst').mockReturnValue(pending.promise)
	const retry = vi.spyOn(current.value, 'retry').mockReturnValue(pending.promise)
	const navigate = vi.fn<(destination: string) => Promise<void>>(async () => {})
	const readHref = vi.fn(() => '/login')
	const open = vi.fn(async () => current.value)
	const bindings: ReturnType<typeof createJazzRestorationAdapter>[] = []
	const bindRestoration = vi.fn((value: Session) => {
		const adapter = new MutableRestorationFixture(
			createJazzRestorationAdapter(value, () => current.value)
		)
		vi.spyOn(adapter, 'invalidate')
		bindings.push(adapter)
		return adapter
	})
	const faults = sessionFaultSources()
	const actor = createActor(
		createApplicationReadinessMachine(
			{ readHref, navigate },
			bindRestoration,
			createJazzSessionReadinessAdapter
		).provide({ actors: faults.actors })
	).start()
	actors.push(actor)
	faults.bind(actor)
	startupBindings.set(actor, startupOwner(open, current.value))
	beginStartup(actor)
	await waitFor(actor, (state) => state.matches({ running: 'ready' }))
	const workspace = attach(actor, observed)
	const attachment = actor.getSnapshot().context.attachment
	if (!attachment) throw new Error('Expected attachment')
	const phrase = RecoveryPhrase.fromSecret(generateAuthSecret())
	const command = {
		type: 'RECOVER',
		phrase,
		origin: '/login',
		destination: '/?workspace=original'
	} satisfies Parameters<typeof actor.send>[0]
	return {
		actor,
		current,
		bindings,
		bindRestoration,
		pending,
		restore,
		retry,
		navigate,
		readHref,
		open,
		workspace,
		attachment,
		phrase,
		command
	}
}
async function beginRestore(f: Awaited<ReturnType<typeof mutationFixture>>) {
	f.actor.send(f.command)
	await waitFor(f.actor, (s) => s.matches({ running: { recovering: 'draining' } }))
	expect(f.restore).not.toHaveBeenCalled()
	control(f.workspace).close()
	await vi.waitFor(() => expect(f.restore).toHaveBeenCalledOnce())
}
function beginRetry(f: Awaited<ReturnType<typeof mutationFixture>>) {
	f.actor.send({ type: 'RETRY' })
	expect(f.retry).not.toHaveBeenCalled()
	expect(f.workspace.getSnapshot().matches('closing')).toBe(true)
	control(f.workspace).close()
	expect(f.retry).toHaveBeenCalledOnce()
}

describe('session mutation pre-drain and issued retry ownership', () => {
	it.each(['ready', 'signed-out', 'error', 'closed', 'transitioning'] satisfies ReturnType<
		Session['getSnapshot']
	>['status'][])('keeps retry through %s observations and duplicate commands', async (status) => {
		const f = await mutationFixture()
		beginRetry(f)
		f.current.getSnapshot.mockReturnValue({ status })
		f.current.notify()
		f.actor.send({ type: 'RETRY' })
		beginStartup(f.actor)
		f.actor.send(f.command)
		expect(f.actor.getSnapshot().matches({ running: { retrying: 'active' } })).toBe(true)
		expect(f.actor.getSnapshot().context.status).toBe(status)
		expect(f.retry).toHaveBeenCalledOnce()
		expect(f.current.unsubscribe).not.toHaveBeenCalled()
		f.pending.resolve()
		await waitFor(f.actor, (s) => !s.matches({ running: 'retrying' }))
		expect(f.actor.getSnapshot().context.status).toBe(status)
		expect(f.actor.getSnapshot().context.attachmentRevision).toBe(1)
		expect(f.restore).not.toHaveBeenCalled()
		expect(f.current.value.close).not.toHaveBeenCalled()
	})
	it('rejects pending replacement work and stale closure before issuing retry', async () => {
		const f = await mutationFixture()
		f.actor.send({ type: 'RETRY' })
		f.actor.send({ type: 'WORKSPACE_CLOSED', actor: {} })
		f.actor.send({ type: 'ATTACH_WORKSPACE', attachment: { ...f.attachment } })
		f.actor.send({ type: 'RETRY' })
		expect(f.retry).not.toHaveBeenCalled()
		expect(f.actor.getSnapshot().context.workspace).toBe(f.workspace)
		control(f.workspace).close()
		expect(f.retry).toHaveBeenCalledOnce()
		expect(f.actor.getSnapshot().context.workspace).toBeUndefined()
		f.pending.resolve()
		await waitFor(f.actor, (s) => s.matches({ running: 'ready' }))
		expect(f.actor.getSnapshot().context.pending).toBeUndefined()
	})
	it.each(['shutdown', 'observer', 'crash'])(
		'starts no retry after %s during pre-drain',
		async (interruption) => {
			const f = await mutationFixture()
			f.actor.send({ type: 'RETRY' })
			if (interruption === 'shutdown') f.actor.send({ type: 'SHUTDOWN' })
			else if (interruption === 'observer') failObservation(f.actor)
			else control(f.workspace).crash()
			if (interruption !== 'crash') control(f.workspace).close()
			expect(f.retry).not.toHaveBeenCalled()
			expect(f.actor.getSnapshot().status).toBe(interruption === 'shutdown' ? 'done' : 'active')
		}
	)
	it('reports rejection without an SDK error observation and permits a fresh retry', async () => {
		const f = await mutationFixture()
		beginRetry(f)
		f.pending.reject(new Error('private retry failure'))
		await waitFor(f.actor, (s) => s.matches({ running: 'retryFailed' }))
		f.retry.mockResolvedValueOnce()
		f.actor.send({ type: 'RETRY' })
		await waitFor(f.actor, (s) => s.matches({ running: 'ready' }))
		expect(f.retry).toHaveBeenCalledTimes(2)
		expect(f.actor.getSnapshot().context.attachmentRevision).toBe(2)
	})
	it.each([
		{ interruption: 'shutdown', reject: false },
		{ interruption: 'shutdown', reject: true },
		{ interruption: 'observer', reject: false },
		{ interruption: 'observer', reject: true },
		{ interruption: 'startup', reject: false }
	])(
		'retains issued retry on $interruption (reject: $reject)',
		async ({ interruption, reject }) => {
			const f = await mutationFixture()
			beginRetry(f)
			if (interruption === 'shutdown') f.actor.send({ type: 'SHUTDOWN' })
			else if (interruption === 'observer') {
				f.current.getSnapshot.mockImplementationOnce(() => {
					throw new Error('private')
				})
				f.current.notify()
			} else failStartup(f.actor)
			f.actor.send({ type: 'RETRY' })
			f.actor.send({ type: 'ATTACH_WORKSPACE', attachment: { ...f.attachment } })
			reportStatus(f.actor, 'ready')
			expect(f.actor.getSnapshot().status).toBe('active')
			expect(f.current.unsubscribe).toHaveBeenCalledOnce()
			expect(f.actor.getSnapshot().context.pending).toBeUndefined()
			if (reject) f.pending.reject(new Error('private'))
			else f.pending.resolve()
			await waitFor(f.actor, (s) => !s.matches({ running: 'retrying' }))
			if (interruption === 'shutdown') expect(f.actor.getSnapshot().status).toBe('done')
			else
				expect(
					f.actor
						.getSnapshot()
						.matches(interruption === 'startup' ? 'startupActorFailed' : 'observerFailed')
				).toBe(true)
			expect(f.retry).toHaveBeenCalledOnce()
		}
	)
})

describe('application-owned account recovery', () => {
	it('preserves invalid drafts without workspace cleanup or an SDK call', async () => {
		const f = await mutationFixture()
		f.actor.send({ ...f.command, phrase: 'invalid' })
		await waitFor(f.actor, (s) => s.context.recoveryResult?.outcome === 'invalid')
		expect(selectRecoveryView(f.actor.getSnapshot())).toMatchObject({
			invalid: true,
			busy: false,
			draftRevision: 0
		})
		expect(f.workspace.getSnapshot().matches('active')).toBe(true)
		expect(f.actor.getSnapshot().context.attachmentRevision).toBe(0)
		expect(f.restore).not.toHaveBeenCalled()
		expect(f.actor.getSnapshot().context.recoveryRequest).toBeUndefined()
	})
	it('waits for matching workspace cleanup, clears the secret and ignores duplicate commands', async () => {
		const f = await mutationFixture()
		f.actor.send(f.command)
		await waitFor(f.actor, (s) => s.matches({ running: { recovering: 'draining' } }))
		const attempt = f.actor.getSnapshot().context.recoveryAttempt
		f.actor.send({ type: 'RECOVERY_DRAIN_REQUESTED', attempt: attempt - 1 })
		f.actor.send({ type: 'RECOVERY_VALIDATED', attempt: attempt - 1 })
		f.actor.send({ type: 'WORKSPACE_CLOSED', actor: {} })
		f.actor.send(f.command)
		f.actor.send({ type: 'RETRY' })
		expect(f.actor.getSnapshot().context.recoveryAttempt).toBe(attempt)
		expect(f.actor.getSnapshot().context.recoveryDraftRevision).toBe(1)
		expect(f.actor.getSnapshot().context.recoveryRequest).toBeUndefined()
		expect(f.restore).not.toHaveBeenCalled()
		control(f.workspace).close()
		await vi.waitFor(() => expect(f.restore).toHaveBeenCalledOnce())
		expect(f.restore.mock.calls[0]?.[0] === RecoveryPhrase.toSecret(f.phrase)).toBe(true)
		expect(f.bindRestoration).toHaveBeenCalledOnce()
		const binding = f.bindings[0]
		if (!binding) throw new Error('Expected restoration binding')
		expect(binding.capability.isCurrentBinding(binding.binding)).toBe(true)
		expect(binding.invalidate).not.toHaveBeenCalled()
		f.actor.send({ type: 'DETACH_WORKSPACE', attachment: f.attachment })
		f.pending.resolve()
		await waitFor(f.actor, (s) => s.context.recoveryResult?.outcome === 'restored')
		expect(f.navigate).toHaveBeenCalledExactlyOnceWith('/?workspace=original')
		expect(f.actor.getSnapshot().context.attachmentRevision).toBe(1)
		expect(JSON.stringify(f.actor.getSnapshot().context).includes(f.phrase)).toBe(false)
		expect(binding.invalidate).toHaveBeenCalledOnce()
		expect(binding.capability.isCurrentBinding(binding.binding)).toBe(false)
	})
	it.each(['shutdown', 'observer', 'crash'])(
		'starts no restore after %s during drain',
		async (interruption) => {
			const f = await mutationFixture()
			f.actor.send(f.command)
			await waitFor(f.actor, (s) => s.matches({ running: { recovering: 'draining' } }))
			if (interruption === 'shutdown') f.actor.send({ type: 'SHUTDOWN' })
			else if (interruption === 'observer') failObservation(f.actor)
			else control(f.workspace).crash()
			if (interruption !== 'crash') control(f.workspace).close()
			await waitFor(f.actor, (s) => !s.matches({ running: 'recovering' }))
			expect(f.restore).not.toHaveBeenCalled()
			expect(f.navigate).not.toHaveBeenCalled()
			expect(f.actor.getSnapshot().status).toBe(interruption === 'shutdown' ? 'done' : 'active')
		}
	)
	it.each([
		{ interruption: 'shutdown', reject: false },
		{ interruption: 'shutdown', reject: true },
		{ interruption: 'observer', reject: false },
		{ interruption: 'observer', reject: true },
		{ interruption: 'startup', reject: false }
	])(
		'retains issued restore on $interruption (reject: $reject)',
		async ({ interruption, reject }) => {
			const f = await mutationFixture()
			await beginRestore(f)
			if (interruption === 'shutdown') f.actor.send({ type: 'SHUTDOWN' })
			else if (interruption === 'observer') failObservation(f.actor)
			else failStartup(f.actor)
			reportStatus(f.actor, 'ready')
			f.actor.send({ type: 'RETRY' })
			f.actor.send({ type: 'ATTACH_WORKSPACE', attachment: { ...f.attachment } })
			expect(f.actor.getSnapshot().status).toBe('active')
			expect(f.actor.getSnapshot().context.pending).toBeUndefined()
			if (reject) f.pending.reject(new Error('private'))
			else f.pending.resolve()
			await waitFor(f.actor, (s) => !s.matches({ running: 'recovering' }))
			expect(f.navigate).not.toHaveBeenCalled()
			expect(f.restore).toHaveBeenCalledOnce()
			expect(f.actor.getSnapshot().status).toBe(interruption === 'shutdown' ? 'done' : 'active')
			expect(f.actor.getSnapshot().context.recoveryRequest).toBeUndefined()
		}
	)
	it('keeps shutdown priority over late actor failures and restore rejection', async () => {
		const f = await mutationFixture()
		await beginRestore(f)
		failObservation(f.actor)
		failStartup(f.actor)
		f.actor.send({ type: 'SHUTDOWN' })
		failStartup(f.actor)
		failReadiness(f.actor)
		failObservation(f.actor)
		reportStatus(f.actor, 'ready')
		f.pending.reject(new Error('late'))
		await waitFor(f.actor, (s) => s.status === 'done')
		expect(f.navigate).not.toHaveBeenCalled()
	})
	it('remounts after same-client restore failure and rejects obsolete attachments', async () => {
		const f = await mutationFixture()
		await beginRestore(f)
		const pendingAttachment = { ...f.attachment }
		f.actor.send({ type: 'ATTACH_WORKSPACE', attachment: pendingAttachment })
		expect(f.actor.getSnapshot().context.workspace).toBeUndefined()
		f.pending.reject(new Error('private restore failure'))
		await waitFor(f.actor, (s) => s.context.recoveryResult?.outcome === 'restoreFailed')
		expect(f.actor.getSnapshot().context.attachmentRevision).toBe(1)
		expect(f.actor.getSnapshot().context.pending).toBeUndefined()
		const replacement = attach(f.actor)
		f.actor.send({ type: 'DETACH_WORKSPACE', attachment: f.attachment })
		f.actor.send({ type: 'WORKSPACE_CLOSED', actor: f.workspace })
		expect(f.actor.getSnapshot().context.workspace).toBe(replacement)
		expect(selectRecoveryView(f.actor.getSnapshot()).failed).toBe(true)
	})
	it('rejects stale attempt and foreign binding reports before accepting library validation', async () => {
		const f = await mutationFixture()
		f.actor.send(f.command)
		const wrapper = f.actor.getSnapshot().children.recovery
		const binding = f.bindings[0]
		if (!wrapper || !binding) throw new Error('Expected recovery binding and actor')
		const attempt = f.actor.getSnapshot().context.recoveryAttempt
		wrapper.send({ type: 'RESTORATION_VALIDATED', binding: {}, attempt })
		wrapper.send({ type: 'RESTORATION_PREPARE_REQUESTED', binding: {}, attempt })
		wrapper.send({ type: 'RESTORATION_VALIDATED', binding: binding.binding, attempt: attempt - 1 })
		wrapper.send({
			type: 'RESTORATION_PREPARE_REQUESTED',
			binding: binding.binding,
			attempt: attempt - 1
		})
		expect(f.actor.getSnapshot().context.recoveryDraftRevision).toBe(0)
		expect(f.workspace.getSnapshot().matches('active')).toBe(true)
		await waitFor(f.actor, (s) => s.matches({ running: { recovering: 'draining' } }))
		expect(f.actor.getSnapshot().context.recoveryDraftRevision).toBe(1)
		control(f.workspace).close()
		await vi.waitFor(() => expect(f.restore).toHaveBeenCalledOnce())
		f.pending.resolve()
		await waitFor(f.actor, (s) => s.context.recoveryResult?.outcome === 'restored')
		expect(binding.invalidate).toHaveBeenCalledOnce()
	})

	it('reports a settled restore with unavailable identity without navigation or mutation retry', async () => {
		const f = await mutationFixture()
		await beginRestore(f)
		const binding = f.bindings[0]
		if (!binding) throw new Error('Expected recovery binding')
		vi.spyOn(binding.capability, 'readIdentity').mockResolvedValueOnce({ kind: 'unavailable' })
		f.pending.resolve()
		await waitFor(f.actor, (s) => s.context.recoveryResult?.outcome === 'navigationFailed')
		expect(selectRecoveryView(f.actor.getSnapshot())).toMatchObject({
			navigationFailed: true,
			canRetryNavigation: false
		})
		f.actor.send({ type: 'RETRY_NAVIGATION' })
		expect(f.restore).toHaveBeenCalledOnce()
		expect(f.navigate).not.toHaveBeenCalled()
		expect(f.actor.getSnapshot().context.attachmentRevision).toBe(1)
		expect(binding.invalidate).toHaveBeenCalledOnce()
	})

	it('retries navigation without another restore or remount', async () => {
		const f = await mutationFixture()
		f.navigate.mockRejectedValueOnce(new Error('private navigation failure'))
		await beginRestore(f)
		f.pending.resolve()
		await waitFor(f.actor, (s) => s.context.recoveryResult?.outcome === 'navigationFailed')
		expect(selectRecoveryView(f.actor.getSnapshot())).toMatchObject({
			navigationFailed: true,
			canRetryNavigation: true
		})
		f.actor.send({ type: 'RETRY_NAVIGATION' })
		await waitFor(f.actor, (s) => s.context.recoveryResult?.outcome === 'restored')
		expect(f.restore).toHaveBeenCalledOnce()
		expect(f.navigate).toHaveBeenCalledTimes(2)
		expect(f.bindRestoration).toHaveBeenCalledOnce()
		expect(f.bindings[0]?.invalidate).toHaveBeenCalledOnce()
		expect(f.actor.getSnapshot().context.attachmentRevision).toBe(1)
	})
	it('does not redirect after the user navigates away during restoration', async () => {
		const f = await mutationFixture()
		await beginRestore(f)
		f.readHref.mockReturnValue('/accounts')
		f.pending.resolve()
		await waitFor(f.actor, (s) => s.context.recoveryResult?.outcome === 'restored')
		expect(f.navigate).not.toHaveBeenCalled()
	})
	it('rechecks identity before retrying navigation', async () => {
		const f = await mutationFixture()
		f.navigate.mockRejectedValueOnce(new Error('private'))
		await beginRestore(f)
		f.pending.resolve()
		await waitFor(f.actor, (s) => s.context.recoveryResult?.outcome === 'navigationFailed')
		f.current.getSnapshot.mockReturnValue(accountSnapshot('other'))
		f.actor.send({ type: 'RETRY_NAVIGATION' })
		await waitFor(f.actor, (s) => s.context.recoveryResult?.outcome === 'restored')
		expect(f.navigate).toHaveBeenCalledOnce()
		expect(f.restore).toHaveBeenCalledOnce()
	})
	it.each([false, true])('awaits issued navigation on shutdown (reject: %s)', async (reject) => {
		const f = await mutationFixture()
		const navigation = Promise.withResolvers<void>()
		f.navigate.mockReturnValue(navigation.promise)
		await beginRestore(f)
		f.pending.resolve()
		await vi.waitFor(() => expect(f.navigate).toHaveBeenCalledOnce())
		f.actor.send({ type: 'SHUTDOWN' })
		expect(f.actor.getSnapshot().status).toBe('active')
		if (reject) navigation.reject(new Error('private'))
		else navigation.resolve()
		await waitFor(f.actor, (s) => s.status === 'done')
		expect(f.restore).toHaveBeenCalledOnce()
	})
})

describe('shared startup attachment integration', () => {
	it('closes before browser START without creating a session owner', async () => {
		const actor = createActor(
			createApplicationReadinessMachine(undefined, undefined, createJazzSessionReadinessAdapter)
		).start()
		actors.push(actor)
		actor.send({ type: 'SHUTDOWN' })
		expect(actor.getSnapshot().status).toBe('done')
		expect(actor.getSnapshot().context.session).toBeUndefined()
		expect(actor.getSnapshot().context.startupBinding).toBeUndefined()
	})

	it.each([false, true])(
		'retains acquisition across application release/remount (reject: %s)',
		async (reject) => {
			const current = session(),
				pending = Promise.withResolvers<Session>()
			const open = vi
				.fn<() => Promise<Session>>()
				.mockImplementationOnce(() => pending.promise)
				.mockResolvedValue(current.value)
			const source = startupOwner(open)
			const first = createActor(
				createApplicationReadinessMachine(undefined, undefined, createJazzSessionReadinessAdapter)
			).start()
			actors.push(first)
			startupBindings.set(first, source)
			beginStartup(first)
			first.send({ type: 'SHUTDOWN' })
			await waitFor(first, (s) => s.status === 'done')
			expect(source.owner.getSnapshot().status).toBe('active')
			if (reject) pending.reject(new Error('private SDK open failure'))
			else pending.resolve(current.value)
			await waitFor(source.owner, (s) => s.matches(reject ? 'failed' : 'acquired'))
			const second = createActor(
				createApplicationReadinessMachine(undefined, undefined, createJazzSessionReadinessAdapter)
			).start()
			actors.push(second)
			startupBindings.set(second, {
				owner: source.owner,
				scope: { ...source.scope, attachment: {} }
			})
			beginStartup(second)
			if (reject) {
				await waitFor(second, (s) => s.matches('startupFailed'))
				expect(open).toHaveBeenCalledTimes(1)
				second.send({ type: 'RETRY' })
			}
			await waitFor(second, (s) => s.matches({ running: 'ready' }))
			expect(second.getSnapshot().context.session).toBe(current.value)
			expect(selectAcquiredSession(source.owner.getSnapshot())).toBe(current.value)
			expect(open).toHaveBeenCalledTimes(reject ? 2 : 1)
			expect(current.value.close).not.toHaveBeenCalled()
			expect(current.value.logout).not.toHaveBeenCalled()
		}
	)

	it('drains workspace before requesting release and waits for the matching acknowledgement', async () => {
		const requests: SessionOwnerEvent<Session>[] = []
		const owner = createActor(
			createCallbackLogic<SessionOwnerEvent<Session>>(({ receive }) =>
				receive((event) => requests.push(event))
			)
		).start()
		const actor = createActor(
			createApplicationReadinessMachine(undefined, undefined, createJazzSessionReadinessAdapter)
		).start()
		actors.push(actor)
		const scope = { binding: {}, attachment: {}, generation: 0 },
			current = session()
		try {
			actor.send({ type: 'START', startup: { owner, scope } })
			const request = requests[0]
			if (!request) throw new Error('Expected acquisition request')
			request.replyTo.send({ type: 'ACQUIRED', scope, session: current.value })
			await waitFor(actor, (state) => state.matches({ running: 'ready' }))
			const workspace = attach(actor)
			actor.send({ type: 'SHUTDOWN' })
			expect(requests.map((event) => event.type)).toEqual(['ACQUIRE'])
			control(workspace).close()
			expect(actor.getSnapshot().matches('releasingStartup')).toBe(true)
			expect(requests.map((event) => event.type)).toEqual(['ACQUIRE', 'RELEASE'])
			expect(current.unsubscribe).toHaveBeenCalledOnce()
			const release = requests[1]
			if (!release) throw new Error('Expected release request')
			release.replyTo.send({ type: 'RELEASED', scope: { ...scope, generation: 1 } })
			expect(actor.getSnapshot().status).toBe('active')
			release.replyTo.send({ type: 'RELEASED', scope })
			await waitFor(actor, (s) => s.status === 'done')
			expect(actor.getSnapshot().context.session).toBeUndefined()
			expect(current.value.close).not.toHaveBeenCalled()
		} finally {
			owner.stop()
		}
	})

	it('rejects stale reports and duplicate rebinding while acquisition is pending', async () => {
		const pending = Promise.withResolvers<Session>(),
			current = session()
		const actor = await start(() => pending.promise)
		beginStartup(actor)
		const startup = startupBindings.get(actor)
		if (!startup) throw new Error('Expected startup binding')
		for (const scope of [
			{ ...startup.scope, binding: {} },
			{ ...startup.scope, attachment: {} },
			{ ...startup.scope, generation: 1 }
		]) {
			actor.send({ type: 'SESSION_ACQUIRED', scope, session: current.value })
			actor.send({ type: 'SESSION_STARTUP_FAILED', scope, reason: 'ownerFailed' })
		}
		actor.send({
			type: 'START',
			startup: { ...startup, scope: { ...startup.scope, attachment: {} } }
		})
		expect(actor.getSnapshot().matches('opening')).toBe(true)
		expect(actor.getSnapshot().context.startupBinding?.owner).toBe(startup.owner)
		expect(actor.getSnapshot().context.startupBinding?.scope).toBe(startup.scope)
		expect(actor.getSnapshot().context.session).toBeUndefined()
		pending.resolve(current.value)
		await waitFor(actor, (s) => s.matches({ running: 'ready' }))
	})

	it.each(['restore', 'retry'])(
		'retains an issued %s through real owner failure',
		async (operation) => {
			const f = await mutationFixture()
			if (operation === 'restore') await beginRestore(f)
			else beginRetry(f)
			const source = startupBindings.get(f.actor)
			if (!source) throw new Error('Expected startup owner')
			if (!(source.owner instanceof Actor)) throw new Error('Expected native startup owner')
			source.owner.stop()
			expect(f.actor.getSnapshot().status).toBe('active')
			f.pending.resolve()
			await waitFor(f.actor, (s) => s.matches('startupActorFailed'))
			expect(f.navigate).not.toHaveBeenCalled()
			if (operation === 'restore') expect(f.restore).toHaveBeenCalledOnce()
			else expect(f.retry).toHaveBeenCalledOnce()
		}
	)
})

describe('shared acquired session readiness integration', () => {
	it('rejects foreign binding, attachment, observation, and retry reports', async () => {
		const f = await mutationFixture()
		const scope = readinessScope(f.actor)
		for (const invalid of [
			{ ...scope, binding: {} },
			{ ...scope, attachment: {} }
		]) {
			f.actor.send({
				type: 'SESSION_STATUS',
				scope: invalid,
				observation: 0,
				status: 'error',
				afterRetry: undefined
			})
			f.actor.send({
				type: 'SESSION_OBSERVATION_FAILED',
				scope: invalid,
				observation: 0,
				reason: 'readFailed'
			})
		}
		f.actor.send({
			type: 'SESSION_STATUS',
			scope,
			observation: 1,
			status: 'error',
			afterRetry: undefined
		})
		expect(f.actor.getSnapshot().matches({ running: 'ready' })).toBe(true)
		beginRetry(f)
		for (const invalid of [
			{ ...scope, binding: {} },
			{ ...scope, attachment: {} }
		])
			f.actor.send({
				type: 'SESSION_RETRY_SETTLED',
				scope: invalid,
				attempt: 1,
				outcome: 'resolved'
			})
		f.actor.send({ type: 'SESSION_RETRY_SETTLED', scope, attempt: 0, outcome: 'rejected' })
		expect(f.actor.getSnapshot().matches({ running: { retrying: 'active' } })).toBe(true)
		f.pending.resolve()
		await waitFor(f.actor, (state) => state.matches({ running: 'ready' }))
	})
	it('preserves rejection feedback after a later ready notification', async () => {
		const f = await mutationFixture()
		beginRetry(f)
		f.pending.reject(new Error('private retry rejection'))
		await waitFor(f.actor, (state) => state.matches({ running: 'retryFailed' }))
		f.current.notify()
		f.actor.send(f.command)
		expect(f.actor.getSnapshot().matches({ running: 'retryFailed' })).toBe(true)
		expect(f.actor.getSnapshot().hasTag('startup-error')).toBe(true)
		expect(f.restore).not.toHaveBeenCalled()
		f.retry.mockResolvedValueOnce()
		f.actor.send({ type: 'RETRY' })
		await waitFor(f.actor, (state) => state.matches({ running: 'ready' }))
		expect(f.retry).toHaveBeenCalledTimes(2)
	})
	it('waits for post-retry status and recovers a refresh failure by reobserving only', async () => {
		const f = await mutationFixture()
		beginRetry(f)
		f.current.notify()
		expect(f.actor.getSnapshot().matches({ running: { retrying: 'active' } })).toBe(true)
		f.current.getSnapshot.mockImplementationOnce(() => {
			throw new Error('private refresh fault')
		})
		f.pending.resolve()
		await waitFor(f.actor, (state) => state.matches('observerFailed'))
		expect(f.actor.getSnapshot().context.attachmentRevision).toBe(1)
		f.actor.send({ type: 'RETRY' })
		await waitFor(f.actor, (state) => state.matches({ running: 'ready' }))
		expect(f.retry).toHaveBeenCalledOnce()
		expect(f.current.subscribe).toHaveBeenCalledTimes(2)
	})
	it.each(['restore', 'retry'])(
		'does not replay an issued %s after readiness actor crash',
		async (operation) => {
			const f = await mutationFixture()
			if (operation === 'restore') await beginRestore(f)
			else beginRetry(f)
			// Exercise parent supervision separately from ordinary SDK/observation rejection.
			failReadiness(f.actor)
			if (operation === 'restore') {
				expect(f.actor.getSnapshot().matches({ running: { recovering: 'readinessCrashed' } })).toBe(
					true
				)
				f.pending.resolve()
				await waitFor(f.actor, (state) => state.matches('readinessCrashed'))
			} else {
				expect(f.actor.getSnapshot().matches('readinessCrashed')).toBe(true)
				f.pending.resolve()
			}
			f.actor.send({ type: 'RETRY' })
			f.actor.send(f.command)
			expect(f.navigate).not.toHaveBeenCalled()
			expect(f.retry).toHaveBeenCalledTimes(operation === 'retry' ? 1 : 0)
			expect(f.restore).toHaveBeenCalledTimes(operation === 'restore' ? 1 : 0)
		}
	)
	it('finishes shutdown after a readiness crash without waiting for a lost retry report', async () => {
		const f = await mutationFixture()
		beginRetry(f)
		f.actor.send({ type: 'SHUTDOWN' })
		failReadiness(f.actor)
		f.pending.resolve()
		await waitFor(f.actor, (state) => state.status === 'done')
		expect(f.retry).toHaveBeenCalledOnce()
		expect(f.current.value.close).not.toHaveBeenCalled()
	})
})

function localObservation(overrides: Partial<ReadinessObservation> = {}): ReadinessObservation {
	return {
		source: { userId: scope.userId, organizationId: scope.organizationId, membership },
		sessionStatus: 'ready',
		membershipLoading: false,
		membershipError: undefined,
		organizations: [],
		organizationsLoading: false,
		organizationsError: undefined,
		route: { pathname: '/expenses', search: `?workspace=${scope.organizationId}`, hash: '' },
		...overrides
	}
}
async function selectedApplication(release: WorkspaceResourceRelease['outcome'] = 'released') {
	const current = session()
	const actor = await start(async () => current.value, current.value)
	const facts = localObservation()
	const workspace = attach(actor, facts)
	const attachment = actor.getSnapshot().context.attachment
	const lease = actor.getSnapshot().context.selectionLease
	if (!attachment || !lease) throw new Error('Missing local selection')
	const resource = createActor(heldResources(), {
		input: { lease, release: { outcome: release } }
	}).start()
	heldActors.push(resource)
	control(workspace).resource(lease, resource)
	function finish() {
		resource.send({ type: 'FINISH' })
		const result = resource.getSnapshot().output
		if (!result) throw new Error('Expected actual finite resource output')
		actor.send({ type: 'SELECTED_RESOURCES_RELEASED', result })
	}
	return { actor, current, facts, workspace, attachment, lease, resource, finish }
}

describe('application shared-selection handoff', () => {
	it.each([
		{ organizations: undefined, organizationsLoading: true, organizationsError: undefined },
		{
			organizations: undefined,
			organizationsLoading: false,
			organizationsError: new Error('Directory failed')
		}
	])('publishes local selection despite directory availability: %j', async (directory) => {
		const current = session()
		const actor = await start(async () => current.value, current.value)
		attach(actor, localObservation(directory))
		expect(actor.getSnapshot().context.selectionLease?.request.workspaceId).toBe(
			scope.organizationId
		)
		expect(actor.getSnapshot().context.transferScope?.workspaceId).toBe(scope.organizationId)
	})
	it.each([
		'released',
		'releasedWithFailure',
		'unresolved'
	] satisfies WorkspaceResourceRelease['outcome'][])(
		'waits for %s resource evidence after coordinator closure before SDK retry',
		async (outcome) => {
			const test = await selectedApplication(outcome)
			test.actor.send({ type: 'RETRY' })
			expect(test.resource.getSnapshot().matches('draining')).toBe(true)
			test.actor.send({ type: 'WORKSPACE_CLOSED', actor: test.workspace })
			expect(test.actor.getSnapshot().context.workspace).toBe(test.workspace)
			control(test.workspace).close()
			expect(test.actor.getSnapshot().context.workspace).toBeUndefined()
			expect(test.actor.getSnapshot().context.selectionBinding).toBeDefined()
			expect(test.current.value.retry).not.toHaveBeenCalled()
			test.finish()
			if (outcome === 'unresolved') {
				expect(test.actor.getSnapshot().matches('cleanupFailed')).toBe(true)
				test.actor.send({ type: 'RETRY' })
				expect(test.current.value.retry).not.toHaveBeenCalled()
			} else {
				await waitFor(test.actor, (snapshot) => snapshot.matches({ running: 'ready' }))
				expect(test.current.value.retry).toHaveBeenCalledOnce()
			}
		}
	)
	it('keeps the transfer owner alive until selection cleanup has finished during whole shutdown', async () => {
		const test = await selectedApplication()
		const owner = test.actor.getSnapshot().children.transferMutationOwner
		test.actor.send({ type: 'SHUTDOWN' })
		control(test.workspace).close()
		expect(owner?.getSnapshot().status).toBe('active')
		expect(test.actor.getSnapshot().status).toBe('active')
		test.finish()
		await waitFor(test.actor, (snapshot) => snapshot.status === 'done')
		expect(owner?.getSnapshot().status).toBe('done')
		expect(test.current.value.close).not.toHaveBeenCalled()
	})
	it('rejects an original A request after A -> B -> A, with no SDK mutation', async () => {
		const test = await selectedApplication()
		const responses: unknown[] = []
		const request: Extract<TransferMutationRequest, { operation: 'link' }> = {
			requestId: 'old-a',
			workspaceId: scope.organizationId,
			operation: 'link',
			recipient: { send: (event) => responses.push(event) },
			input: {
				db: test.attachment.dependencies.db,
				identityId: scope.userId,
				organizationId: scope.organizationId,
				expenseTransactionId: 'expense',
				incomeTransactionId: 'income',
				trackWrite() {}
			}
		}
		const original = captureTransferMutationScope(test.actor.getSnapshot(), request)
		if (!original) throw new Error('Missing captured transfer scope')
		const next = localObservation({
			source: {
				userId: scope.userId,
				organizationId: scope.profileId,
				membership: { ...membership, organizationId: scope.profileId }
			},
			route: { pathname: '/expenses', search: `?workspace=${scope.profileId}`, hash: '' }
		})
		test.actor.send({
			type: 'WORKSPACE_SELECTION_OBSERVED',
			attachment: test.attachment,
			observation: next
		})
		const drain = test.actor.getSnapshot().context.selectionDrain
		if (!drain) throw new Error('Missing retained drain')
		test.actor.send({
			type: 'WORKSPACE_SELECTION_OBSERVED',
			attachment: test.attachment,
			observation: test.facts
		})
		expect(test.actor.getSnapshot().context.selectionLease).toBeUndefined()
		test.finish()
		const current = test.actor.getSnapshot().context.selectionLease
		expect(current?.request.workspaceId).toBe(scope.organizationId)
		expect(current?.epoch).toBeGreaterThan(test.lease.epoch)
		test.actor.send({ type: 'TRANSFER_MUTATION_REQUEST', request: { ...request, scope: original } })
		expect(responses).toEqual([
			{
				type: 'TRANSFER_MUTATION_RESULT',
				requestId: request.requestId,
				result: { operation: 'link', result: { outcome: 'unavailable', settlement: 'notStarted' } }
			}
		])
		test.actor.send({ type: 'WORKSPACE_DRAIN_REQUESTED', drain })
		test.actor.send({ type: 'SELECTED_RESOURCES_CRASHED', lease: test.lease })
		test.actor.send({ type: 'WORKSPACE_SCOPE_INVALIDATED', lease: test.lease })
		expect(test.actor.getSnapshot().context.selectionLease).toEqual(current)
		expect(test.actor.getSnapshot().context.cleanupRelease.outcome).toBe('released')
	})
	it('advances transfer generations when attachment replacement restarts library epoch', async () => {
		const current = session()
		const actor = await start(async () => current.value, current.value)
		const first = attach(actor, localObservation())
		const before = actor.getSnapshot().context.transferScope
		const lease = actor.getSnapshot().context.selectionLease
		if (!before || !lease) throw new Error('Missing initial scope')
		const attachment = actor.getSnapshot().context.attachment
		if (!attachment) throw new Error('Missing attachment')
		actor.send({ type: 'ATTACH_WORKSPACE', attachment: { ...attachment } })
		control(first).close()
		const next = actor.getSnapshot().context.transferScope
		expect(actor.getSnapshot().context.selectionLease?.epoch).toBe(1)
		expect(next?.binding).not.toBe(before.binding)
		expect(next?.generation).toBeGreaterThan(before.generation)
		expect(actor.getSnapshot().children.transferMutationOwner?.getSnapshot().context.scope).toEqual(
			next
		)
	})
})

it('retains selected-resource drain before restoration, then reattaches after a recoverable SDK failure', async () => {
	const observed = localObservation({
		source: {
			userId: 'restored',
			organizationId: scope.organizationId,
			membership: { ...membership, userId: 'restored' }
		}
	})
	const test = await mutationFixture(observed)
	const lease = test.actor.getSnapshot().context.selectionLease
	if (!lease) throw new Error('Missing selected lease')
	const resource = createActor(heldResources(), {
		input: { lease, release: { outcome: 'released' } }
	}).start()
	heldActors.push(resource)
	control(test.workspace).resource(lease, resource)
	test.actor.send(test.command)
	await waitFor(test.actor, (snapshot) => snapshot.matches({ running: { recovering: 'draining' } }))
	control(test.workspace).close()
	expect(test.restore).not.toHaveBeenCalled()
	resource.send({ type: 'FINISH' })
	const result = resource.getSnapshot().output
	if (!result) throw new Error('Missing finite resource result')
	test.actor.send({ type: 'SELECTED_RESOURCES_RELEASED', result })
	await vi.waitFor(() => expect(test.restore).toHaveBeenCalledOnce())
	test.pending.reject(new Error('Recoverable SDK failure'))
	await waitFor(
		test.actor,
		(snapshot) => snapshot.context.recoveryResult?.outcome === 'restoreFailed'
	)
	expect(test.actor.getSnapshot().context.attachmentRevision).toBe(1)
	const fresh = attach(test.actor, observed)
	expect(fresh).not.toBe(test.workspace)
	expect(test.actor.getSnapshot().context.selectionLease?.scope.attachment).not.toBe(
		lease.scope.attachment
	)
	expect(test.current.value.close).not.toHaveBeenCalled()
})

it('does not forward saved resource output to an immediately completed drain join', async () => {
	const late: string[] = []
	const current = session()
	const actor = await start(
		async () => current.value,
		current.value,
		(event) => {
			if (
				event.type === '@xstate.transition' &&
				event.event.type === 'SELECTED_RESOURCES_RELEASED' &&
				event.actorRef.getSnapshot().status === 'done'
			)
				late.push(event.event.type)
		}
	)
	const facts = localObservation()
	const workspace = attach(actor, facts)
	const lease = actor.getSnapshot().context.selectionLease
	const attachment = actor.getSnapshot().context.attachment
	if (!lease || !attachment) throw new Error('Missing lease')
	const resource = createActor(heldResources(), {
		input: { lease, release: { outcome: 'released' } }
	}).start()
	heldActors.push(resource)
	control(workspace).resource(lease, resource)
	actor.send({ type: 'WORKSPACE_SCOPE_INVALIDATED', lease })
	resource.send({ type: 'SHUTDOWN' })
	resource.send({ type: 'FINISH' })
	const result = resource.getSnapshot().output
	if (!result) throw new Error('Missing finite result')
	actor.send({ type: 'SELECTED_RESOURCES_RELEASED', result })
	actor.send({
		type: 'WORKSPACE_SELECTION_OBSERVED',
		attachment,
		observation: localObservation({
			source: {
				userId: scope.userId,
				organizationId: scope.profileId,
				membership: { ...membership, organizationId: scope.profileId }
			},
			route: { pathname: '/expenses', search: `?workspace=${scope.profileId}`, hash: '' }
		})
	})
	expect(actor.getSnapshot().context.selectionLease?.request.workspaceId).toBe(scope.profileId)
	expect(late).toEqual([])
})

describe('application-owned workspace restore drain', () => {
	async function fixture(crash = false, reload = vi.fn<() => void>()) {
		const current = session(),
			snapshot = accountSnapshot(crypto.randomUUID())
		Object.defineProperty(snapshot, 'client', {
			value: { db: { onMutationError: () => () => {} } }
		})
		current.getSnapshot.mockReturnValue(snapshot)
		const gate = Promise.withResolvers<void>(),
			entered = Promise.withResolvers<void>(),
			pending = Promise.withResolvers<void>()
		const restore = vi.spyOn(current.value, 'restoreLocalFirst').mockReturnValue(pending.promise)
		const retry = vi.spyOn(current.value, 'retry').mockReturnValue(pending.promise)
		const { createWorkspaceRestoreController, prepareWorkspaceRestoreFile } =
			await import('../workspaces/workspace-restore.js')
		const controller = createWorkspaceRestoreController().provide({
			actors: {
				readFile: createAsyncLogic<
					void,
					import('../workspaces/workspace-restore.js').WorkspaceRestoreFile
				>({
					run: () => {
						entered.resolve()
						return gate.promise
					}
				})
			}
		})
		const transition = controller.transition.bind(controller)
		vi.spyOn(controller, 'transition').mockImplementation((...args) => {
			if (crash && args[1].type === 'CANCEL')
				throw new Error('Injected controller calculation crash')
			return transition(...args)
		})

		const faults = sessionFaultSources()
		const actor = createActor(
			createApplicationReadinessMachine(
				{ readHref: () => '/', navigate: async () => {}, reload },
				(value) => createJazzRestorationAdapter(value, () => current.value),
				createJazzSessionReadinessAdapter,
				{ appId: crypto.randomUUID(), serverUrl: 'http://disposable.invalid', environment: 'test' }
			).provide({ actors: { workspaceRestore: controller, ...faults.actors } })
		).start()
		actors.push(actor)
		const startup = startupOwner(async () => current.value, current.value)
		faults.bind(actor)
		startupBindings.set(actor, startup)
		beginStartup(actor)
		await waitFor(actor, (state) => state.matches({ running: 'ready' }))
		const workspace = attach(actor)
		actor.send({
			type: 'WORKSPACE_RESTORE',
			request: prepareWorkspaceRestoreFile(new File(['x'], 'backup.dlf'), 'secret-backup-password')
		})
		await entered.promise
		expect(actor.getSnapshot().context.workspaceRestoreView.busy).toBe(true)
		expect(JSON.stringify(actor.getSnapshot())).not.toContain('secret-backup-password')
		return { actor, current, gate, pending, workspace, restore, retry, startup, reload }
	}
	it('offers reload after an actual controller crash without retrying the SDK or acknowledging cleanup', async () => {
		const reload = vi
			.fn<() => void>()
			.mockImplementationOnce(() => {
				throw new Error('Injected reload failure')
			})
			.mockImplementation(() => {})
		const f = await fixture(true, reload)
		const controller = f.actor.getSnapshot().children.workspaceRestore
		if (!controller) throw new Error('Missing restore controller')
		f.actor.send({ type: 'WORKSPACE_RESTORE_COMMAND', command: { type: 'CANCEL' } })
		await waitFor(f.actor, (state) => state.matches({ reloadRecovery: 'required' }))
		expect(controller.getSnapshot().status).toBe('error')
		expect(selectApplicationWorkspaceRestore(f.actor.getSnapshot())).toMatchObject({
			busy: true,
			editable: false,
			canCancel: false,
			canReload: true,
			canRetryRelease: false,
			canConfirm: false,
			canOpen: false,
			message: 'failed'
		})
		f.actor.send({ type: 'SHUTDOWN' })
		f.actor.send({ type: 'RETRY' })
		await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
		await waitFor(f.actor, (state) => state.matches({ reloadRecovery: 'required' }))
		f.actor.send({ type: 'WORKSPACE_RESTORE_COMMAND', command: { type: 'RELOAD' } })
		await waitFor(f.actor, (state) => state.matches({ reloadRecovery: 'requested' }))
		expect(reload).toHaveBeenCalledTimes(2)
		expect(f.actor.getSnapshot().context.workspaceRestoreView.busy).toBe(true)
		expect(f.restore).not.toHaveBeenCalled()
		expect(f.retry).not.toHaveBeenCalled()
		expect(
			f.startup.owner
				.getSnapshot()
				.context.released.some((reference) => reference.deref() === f.startup.scope.attachment)
		).toBe(false)
	})
	it('retains reload intent against late failure and startup events', async () => {
		const f = await fixture()
		f.actor.send({ type: 'RELOAD_REQUIRED' })
		f.actor.send({ type: 'RETRY' })
		f.actor.send({ type: 'CLEANUP_FAILED' })
		f.actor.send({ type: 'RELOAD_REQUIRED' })
		f.actor.send({ type: 'SHUTDOWN' })
		await waitFor(f.actor, (state) => state.matches({ reloadRecovery: 'requested' }))
		const readiness = f.actor.getSnapshot().children.sessionReadiness
		if (!readiness) throw new Error('Missing readiness observer')
		readiness.send({ type: 'SHUTDOWN' })
		await waitFor(readiness, (state) => state.status === 'done')
		expect(f.actor.getSnapshot().matches({ reloadRecovery: 'requested' })).toBe(true)
		expect(f.reload).toHaveBeenCalledOnce()
		expect(f.restore).not.toHaveBeenCalled()
		expect(f.retry).not.toHaveBeenCalled()
		expect(f.actor.getSnapshot().context.workspaceRestoreView.busy).toBe(true)
		f.gate.resolve()
	})
	for (const command of ['shutdown', 'retry', 'recovery', 'startup-failure', 'observer-failure']) {
		it(`retains restore resources before ${command}`, async () => {
			const f = await fixture()
			if (command === 'shutdown') f.actor.send({ type: 'SHUTDOWN' })
			else if (command === 'retry') f.actor.send({ type: 'RETRY' })
			else if (command === 'recovery')
				f.actor.send({
					type: 'RECOVER',
					phrase: RecoveryPhrase.fromSecret(generateAuthSecret()),
					origin: '/login',
					destination: '/'
				})
			else if (command === 'startup-failure') failStartup(f.actor)
			else failObservation(f.actor)
			await waitFor(f.workspace, (state) => state.matches('closing'))
			control(f.workspace).close()
			await Promise.resolve()
			expect(f.actor.getSnapshot().status).toBe('active')
			expect(f.actor.getSnapshot().context.workspaceRestoreView.busy).toBe(true)
			expect(f.restore).not.toHaveBeenCalled()
			expect(f.retry).not.toHaveBeenCalled()
			expect(f.startup.owner.getSnapshot().status).toBe('active')
			expect(
				f.startup.owner
					.getSnapshot()
					.context.released.some((reference) => reference.deref() === f.startup.scope.attachment)
			).toBe(false)
			f.gate.resolve()
			await waitFor(f.actor, (state) => !state.context.workspaceRestoreView.busy)
			if (command === 'shutdown') await waitFor(f.actor, (state) => state.status === 'done')
			if (command === 'retry') {
				await vi.waitFor(() => expect(f.retry).toHaveBeenCalledOnce())
				f.pending.resolve()
			}
			if (command === 'recovery') {
				await vi.waitFor(() => expect(f.restore).toHaveBeenCalledOnce())
				f.pending.resolve()
			}
			if (command === 'startup-failure')
				await waitFor(f.startup.owner, (state) =>
					state.context.released.some(
						(reference) => reference.deref() === f.startup.scope.attachment
					)
				)
		})
	}
	it('allows unrelated workspace replacement while restore remains active', async () => {
		const f = await fixture(),
			previous = f.actor.getSnapshot().context.attachment
		if (!previous) throw new Error('Missing attachment')
		const next = { ...previous }
		f.actor.send({ type: 'ATTACH_WORKSPACE', attachment: next })
		control(f.workspace).close()
		await waitFor(f.actor, (state) => state.context.attachment === next)
		expect(f.actor.getSnapshot().context.workspaceRestoreView.busy).toBe(true)
		f.actor.send({ type: 'SHUTDOWN' })
		const workspace = f.actor.getSnapshot().context.workspace
		if (workspace) control(workspace).close()
		f.gate.resolve()
		await waitFor(f.actor, (state) => state.status === 'done')
	})
})

it('keeps the session out of the UI until local-first preparation has completed', async () => {
	const current = session(),
		gate = Promise.withResolvers<void>()
	const prepare = vi.fn(() => gate.promise)
	const actor = await start(async () => current.value, undefined, undefined, prepare)
	beginStartup(actor)
	await waitFor(actor, (state) => state.matches({ preparingLocalFirst: 'active' }))
	expect(prepare).toHaveBeenCalledWith(current.value)
	expect(actor.getSnapshot().context.session).toBeUndefined()
	gate.resolve()
	await waitFor(actor, (state) => state.matches('running'))
	expect(actor.getSnapshot().context.session).toBe(current.value)
})
it('drains local-first preparation before acknowledging application shutdown', async () => {
	const current = session(),
		gate = Promise.withResolvers<void>()
	const actor = await start(
		async () => current.value,
		undefined,
		undefined,
		() => gate.promise
	)
	beginStartup(actor)
	await waitFor(actor, (state) => state.matches({ preparingLocalFirst: 'active' }))
	actor.send({ type: 'SHUTDOWN' })
	expect(actor.getSnapshot().matches({ preparingLocalFirst: 'stopping' })).toBe(true)
	expect(actor.getSnapshot().context.session).toBeUndefined()
	gate.resolve()
	await waitFor(actor, (state) => state.status === 'done')
	expect(actor.getSnapshot().context.workspace).toBeUndefined()
})
