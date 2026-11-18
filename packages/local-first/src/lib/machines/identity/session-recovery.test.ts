import { createSessionRuntimeMachine, createSessionRuntimeConnection } from './session-runtime.js'
import type { EventPayload } from '../../contracts/machine-events.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
	createActor,
	createCallbackLogic,
	setup,
	waitFor,
	types,
	type ActorFromLogic
} from 'xstate'
import { deferred } from '../../../../tests/helpers/deferred.js'
import {
	sessionRecoveryMachine,
	type RecoverySession,
	type RecoveryNotice,
	type RecoveryRequest,
	type RecoveryResult
} from './session-recovery.js'
import { restorationMachine } from './restoration.js'
import type { RestorationCapability } from '../../contracts/restoration.js'

const roots = new Set<{ stop: () => void }>()
afterEach(() => {
	for (const root of roots) root.stop()
	roots.clear()
})
function fixture(crash: 'before' | 'after' | 'none' = 'none', request?: RecoveryRequest) {
	const restore = deferred<void>()
	const calls: string[] = []
	const invalidate = vi.fn(() => {
		calls.push('invalidate')
	})
	const navigate = vi.fn(async (_destination: string) => {})
	const capability: RestorationCapability = {
		parsePhrase: async () => 'private-credential',
		isCurrentBinding: () => true,
		restoreIdentity: vi.fn(() => restore.promise),
		readIdentity: async () => ({ kind: 'ready', identityId: 'restored' })
	}
	const provided = restorationMachine.provide({
		guards: {
			currentBinding: () => {
				if (crash === 'before') throw new Error('private-child-error')
				return true
			}
		}
	})
	// Fail the actor's transition at settlement, rather than overriding a removed v5 action.
	const child = {
		initialTransition: provided.initialTransition.bind(provided),
		getInitialSnapshot: provided.getInitialSnapshot.bind(provided),
		getPersistedSnapshot: provided.getPersistedSnapshot.bind(provided),
		start: provided.start.bind(provided),
		transition: (...args: Parameters<typeof provided.transition>) => {
			if (crash === 'after' && args[0].matches('restoring') && 'output' in args[1]) {
				throw new Error('private-child-error')
			}
			return provided.transition(...args)
		}
	}

	const recovery = sessionRecoveryMachine.provide({ actors: { restoration: child } })
	const parent = setup({
		schemas: {
			context: types<{ result: RecoveryResult | undefined; error: unknown }>(),
			events: {
				RECOVERY_VALIDATED: types<EventPayload<RecoveryNotice, 'RECOVERY_VALIDATED'>>(),
				RECOVERY_DRAIN_REQUESTED: types<EventPayload<RecoveryNotice, 'RECOVERY_DRAIN_REQUESTED'>>()
			}
		},
		actors: { recovery }
	}).createMachine({
		initial: 'active',
		context: { result: undefined, error: undefined },
		states: {
			active: {
				invoke: {
					id: 'recovery',
					src: 'recovery',
					input: {
						attempt: 1,
						request: request ?? {
							kind: 'restore',
							phrase: 'private-phrase',
							origin: '/from',
							destination: '/to'
						},
						session: { getSnapshot: () => ({ status: 'ready', account: { id: 'restored' } }) },
						restorationBinding: { binding: {}, capability, invalidate },
						readHref: () => '/from',
						navigate
					},
					onDone: (args, enq) => {
						enq(() => {
							calls.push('parent-done')
						})
						return { target: 'done', context: { result: args.event.output } }
					},
					onError: (args, enq) => {
						enq(() => {
							calls.push('parent-error')
						})
						return { target: 'failed', context: { error: args.event.error } }
					}
				},
				on: {
					RECOVERY_VALIDATED: {},
					RECOVERY_DRAIN_REQUESTED: (args, enq) => {
						enq.sendTo('recovery', { type: 'WORKSPACE_DRAINED' })
					}
				}
			},
			done: { type: 'final' },
			failed: { type: 'final' }
		}
	})
	const actor = createActor(parent)
	roots.add(actor)
	return {
		actor,
		restore,
		calls,
		invalidate,
		navigate,
		capability,
		done: () => waitFor(actor, (s) => s.status === 'done')
	}
}
describe('recovery coordinator failure cleanup', () => {
	it('releases a binding before reporting a crash during initial restoration assessment', async () => {
		const f = fixture('before')
		f.actor.start()
		const done = await f.done()
		expect(done.context.result).toEqual({
			outcome: 'restorationChildFailed',
			mutation: 'notStarted'
		})
		expect(done.context.error).toBeUndefined()
		expect(f.calls).toEqual(['invalidate', 'parent-done'])
		expect(f.capability.restoreIdentity).not.toHaveBeenCalled()
		expect(f.navigate).not.toHaveBeenCalled()
	})
	it.each([false, true])(
		'clears the failed snapshot and preserves failure after issued restore (shutdown: %s)',
		async (closing) => {
			const f = fixture('after')
			f.actor.start()
			await vi.waitFor(() => expect(f.capability.restoreIdentity).toHaveBeenCalledOnce())
			const coordinator = f.actor.getSnapshot().children.recovery
			if (!coordinator) throw new Error('Missing coordinator')
			if (closing) coordinator.send({ type: 'SHUTDOWN' })
			f.restore.resolve()
			const done = await f.done()
			expect(f.calls).toEqual(['invalidate', 'parent-done'])
			expect(done.context.result).toEqual({
				outcome: 'restorationChildFailed',
				mutation: 'unknown'
			})
			expect(done.context.error).toBeUndefined()
			expect(coordinator.getSnapshot().status).toBe('done')
			expect(coordinator.getSnapshot().context.request).toBeUndefined()
			expect(coordinator.getSnapshot().context.restorationBinding).toBeUndefined()
			expect(JSON.stringify(coordinator.getSnapshot().context.result)).not.toContain('private')
			expect(f.navigate).not.toHaveBeenCalled()
		}
	)
	it('returns known restoration success and navigates only after binding release', async () => {
		const f = fixture()
		f.actor.start()
		await vi.waitFor(() => expect(f.capability.restoreIdentity).toHaveBeenCalledOnce())
		f.restore.resolve()
		const done = await f.done()
		expect(done.context.result).toEqual({ outcome: 'restored', mutation: 'settled' })
		expect(f.invalidate).toHaveBeenCalledOnce()
		expect(f.navigate).toHaveBeenCalledExactlyOnceWith('/to')
		expect(done.context.error).toBeUndefined()
	})
	it('keeps ordinary SDK rejection a settled failure without navigation', async () => {
		const f = fixture()
		f.actor.start()
		await vi.waitFor(() => expect(f.capability.restoreIdentity).toHaveBeenCalledOnce())
		f.restore.reject(new Error('private-sdk-error'))
		const done = await f.done()
		expect(done.context.result).toEqual({ outcome: 'restoreFailed', mutation: 'settled' })
		expect(done.context.error).toBeUndefined()
		expect(f.invalidate).toHaveBeenCalledOnce()
		expect(f.navigate).not.toHaveBeenCalled()
	})
	it('drains an issued restoration before ordinary shutdown completes', async () => {
		const f = fixture()
		f.actor.start()
		await vi.waitFor(() => expect(f.capability.restoreIdentity).toHaveBeenCalledOnce())
		f.actor.getSnapshot().children.recovery?.send({ type: 'SHUTDOWN' })
		expect(f.actor.getSnapshot().status).toBe('active')
		expect(f.invalidate).not.toHaveBeenCalled()
		f.restore.resolve()
		const done = await f.done()
		expect(done.context.result).toEqual({ outcome: 'closed', mutation: 'settled' })
		expect(f.invalidate).toHaveBeenCalledOnce()
		expect(f.navigate).not.toHaveBeenCalled()
	})
})

function runtimeFixture() {
	const closed = deferred<void>()
	const changeIdentity = vi.fn<
		import('../../contracts/session-runtime.js').SessionRuntimeResource['changeIdentity']
	>(async () => 'completed')
	let publish: (
		value: import('../../contracts/session-runtime.js').SessionRuntimeObservation
	) => void = () => {}
	const binding = {}
	const actor = createActor(createSessionRuntimeMachine(), {
		input: {
			binding,
			capability: {
				open: async () => ({
					observe: (notify) => {
						publish = notify
						notify({
							status: 'ready',
							binding: {},
							identityId: 'restored',
							identityKind: 'device',
							localFirst: true,
							capabilities: undefined
						})
						return () => {}
					},
					close: () => closed.promise,
					changeIdentity
				})
			}
		}
	})
	roots.add(actor)
	actor.start()
	return {
		actor,
		closed,
		changeIdentity,
		publish: (value: import('../../contracts/session-runtime.js').SessionRuntimeObservation) =>
			publish(value),
		connection: createSessionRuntimeConnection(actor, binding)
	}
}
function navigationFixture(
	session: RecoverySession,
	navigate = vi.fn(async (_destination: string) => {}),
	identity = 'restored'
) {
	const actor = createActor(sessionRecoveryMachine, {
		input: {
			attempt: 1,
			request: { kind: 'navigate', origin: '/from', destination: '/to', identity },
			session,
			restorationBinding: undefined,
			readHref: () => '/from',
			navigate
		}
	})
	roots.add(actor)
	actor.start()
	return { actor, navigate }
}
describe('recovery navigation through a session actor connection', () => {
	it('uses the existing runtime identity without an SDK-shaped session wrapper', async () => {
		const runtime = runtimeFixture()
		await waitFor(runtime.actor, (s) => s.matches({ bound: 'observing' }))
		const f = navigationFixture(runtime.connection)
		const done = await waitFor(f.actor, (s) => s.status === 'done')
		expect(done.output).toEqual({ outcome: 'restored', mutation: 'notStarted' })
		expect(f.navigate).toHaveBeenCalledExactlyOnceWith('/to')
		expect(runtime.changeIdentity).not.toHaveBeenCalled()
		runtime.closed.resolve()
	})
	it('retries navigation after failure without another identity mutation', async () => {
		const runtime = runtimeFixture()
		await waitFor(runtime.actor, (s) => s.matches({ bound: 'observing' }))
		const navigate = vi
			.fn(async (_destination: string) => {})
			.mockRejectedValueOnce(new Error('Native navigation refused'))
		const first = navigationFixture(runtime.connection, navigate)
		const failed = await waitFor(first.actor, (s) => s.status === 'done')
		expect(failed.output).toMatchObject({
			outcome: 'navigationFailed',
			mutation: 'notStarted',
			navigation: { identity: 'restored', origin: '/from', destination: '/to' }
		})
		const retry = navigationFixture(runtime.connection, navigate)
		await waitFor(retry.actor, (s) => s.status === 'done')
		expect(retry.actor.getSnapshot().output?.outcome).toBe('restored')
		expect(navigate).toHaveBeenCalledTimes(2)
		expect(runtime.changeIdentity).not.toHaveBeenCalled()
		runtime.closed.resolve()
	})
	it.each(['signed-out', 'replacement', 'closing'])(
		'does not navigate for the old identity after %s',
		async (kind) => {
			const runtime = runtimeFixture()
			try {
				await waitFor(runtime.actor, (s) => s.matches({ bound: 'observing' }))
				if (kind === 'closing') runtime.actor.send({ type: 'CLOSE' })
				else
					runtime.publish(
						kind === 'signed-out'
							? { status: 'signed-out', binding: {} }
							: {
									status: 'ready',
									binding: {},
									identityId: 'other',
									identityKind: 'device',
									localFirst: true,
									capabilities: undefined
								}
					)
				const f = navigationFixture(runtime.connection)
				await waitFor(f.actor, (s) => s.status === 'done')
				expect(f.navigate).not.toHaveBeenCalled()
				expect(runtime.changeIdentity).not.toHaveBeenCalled()
			} finally {
				runtime.closed.resolve()
			}
		}
	)
})

describe('explicit recovery host reports', () => {
	it('runs a private root with an explicit recipient and waits for its drain permit', async () => {
		const runtime = runtimeFixture()
		await waitFor(runtime.actor, (s) => s.matches({ bound: 'observing' }))
		const notices: string[] = []
		let coordinator: ActorFromLogic<typeof sessionRecoveryMachine> | undefined
		const recipient = createActor(
			createCallbackLogic<RecoveryNotice>(({ receive }) => {
				receive((event) => {
					notices.push(event.type)
					if (event.type === 'RECOVERY_DRAIN_REQUESTED')
						coordinator?.send({ type: 'WORKSPACE_DRAINED' })
				})
			})
		).start()
		roots.add(recipient)
		const navigate = vi.fn(async (_destination: string) => {})
		coordinator = createActor(sessionRecoveryMachine, {
			input: {
				attempt: 1,
				reportTo: recipient,
				request: { kind: 'restore', phrase: 'private phrase', origin: '/from', destination: '/to' },
				session: runtime.connection,
				readHref: () => '/from',
				navigate,
				restorationBinding: {
					binding: runtime.connection.binding,
					invalidate: () => {},
					capability: {
						runtime: runtime.connection,
						parsePhrase: async () => 'private credential',
						isCurrentBinding: (binding) => binding === runtime.connection.binding,
						readIdentity: async () => ({ kind: 'ready', identityId: 'restored' })
					}
				}
			}
		})
		roots.add(coordinator)
		coordinator.start()
		const done = await waitFor(coordinator, (s) => s.status === 'done')
		expect(notices).toEqual(['RECOVERY_VALIDATED', 'RECOVERY_DRAIN_REQUESTED'])
		expect(done.output).toEqual({ outcome: 'restored', mutation: 'settled' })
		expect(runtime.changeIdentity).toHaveBeenCalledOnce()
		expect(navigate).toHaveBeenCalledExactlyOnceWith('/to')
		expect(done.context.request).toBeUndefined()
		expect(done.context.restorationBinding).toBeUndefined()
		runtime.closed.resolve()
	})
})
