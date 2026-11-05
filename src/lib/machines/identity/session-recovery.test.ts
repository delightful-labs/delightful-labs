import { afterEach, describe, expect, it, vi } from 'vitest'
import { assign, createActor, sendTo, setup, waitFor } from 'xstate'
import { deferred } from '../../../../tests/helpers/deferred.js'
import {
	sessionRecoveryMachine,
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
	const child = restorationMachine.provide({
		guards: {
			currentBinding: () => {
				if (crash === 'before') throw new Error('private-child-error')
				return true
			}
		},
		actions: {
			settled:
				crash === 'after'
					? () => {
							throw new Error('private-child-error')
						}
					: assign({ mutation: 'settled' })
		}
	})
	const recovery = sessionRecoveryMachine.provide({ actors: { restoration: child } })
	const parent = setup<
		{ result: RecoveryResult | undefined; error: unknown },
		RecoveryNotice,
		{ recovery: typeof recovery }
	>({ actors: { recovery } }).createMachine({
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
					onDone: {
						target: 'done',
						actions: [
							() => {
								calls.push('parent-done')
							},
							assign({ result: ({ event }) => event.output })
						]
					},
					onError: {
						target: 'failed',
						actions: [
							() => {
								calls.push('parent-error')
							},
							assign({ error: ({ event }) => event.error })
						]
					}
				},
				on: {
					RECOVERY_VALIDATED: {},
					RECOVERY_DRAIN_REQUESTED: { actions: sendTo('recovery', { type: 'WORKSPACE_DRAINED' }) }
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
