import { afterEach, describe, expect, it, vi } from 'vitest'
import { createActor, createCallbackLogic, waitFor } from 'xstate'
import type { SessionReadinessReport, SessionStatus } from '../../contracts/session.js'
import { createSessionReadinessMachine } from './session-readiness.js'

const actors = new Set<{ stop: () => void }>()
afterEach(() => {
	for (const actor of actors) actor.stop()
	actors.clear()
})
function fixture(bind = true) {
	const reports: SessionReadinessReport[] = []
	const recipient = createActor(
		createCallbackLogic<SessionReadinessReport>(({ receive }) =>
			receive((event) => reports.push(event))
		)
	).start()
	const actor = createActor(createSessionReadinessMachine(), {
		input: { reportTo: recipient }
	}).start()
	actors.add(actor)
	actors.add(recipient)
	let status: SessionStatus = 'ready'
	const notifications: (() => void)[] = []
	const unsubscribe = vi.fn()
	let resolve = (): void => {
		throw new Error('Deferred not initialized')
	}
	let reject = (_error: Error): void => {
		throw new Error('Deferred not initialized')
	}
	const promise = new Promise<void>((done, fail) => {
		resolve = done
		reject = fail
	})
	const pending = { promise, resolve, reject }
	const capability = {
		readStatus: vi.fn(() => status),
		subscribe: vi.fn((notify: () => void) => {
			notifications.push(notify)
			return unsubscribe
		}),
		retry: vi.fn(() => pending.promise)
	}
	const scope = { binding: {}, attachment: {} }
	const attach = () => actor.send({ type: 'BIND', scope, capability })
	if (bind) attach()
	return {
		actor,
		reports,
		capability,
		scope,
		pending,
		unsubscribe,
		notifications,
		attach,
		notify: (value: SessionStatus) => {
			status = value
			notifications.at(-1)?.()
		},
		retry: (attempt = 1) => actor.send({ type: 'RETRY', scope, attempt })
	}
}
async function settled(f: ReturnType<typeof fixture>, outcome: 'resolved' | 'rejected') {
	await waitFor(f.actor, () =>
		f.reports.some(
			(report) => report.type === 'SESSION_RETRY_SETTLED' && report.outcome === outcome
		)
	)
}

describe('acquired session readiness', () => {
	it('waits without effects and closes before binding', () => {
		const f = fixture(false)
		f.actor.send({ type: 'SHUTDOWN' })
		f.attach()
		expect(f.actor.getSnapshot().output).toEqual({ outcome: 'closed' })
		expect(f.capability.readStatus).not.toHaveBeenCalled()
		expect(f.capability.subscribe).not.toHaveBeenCalled()
		expect(f.capability.retry).not.toHaveBeenCalled()
	})
	it.each<SessionStatus>(['ready', 'signed-out', 'transitioning', 'error', 'closed'])(
		'reports %s without inferring workspace readiness',
		(status) => {
			const f = fixture()
			f.notify(status)
			expect(f.reports.at(-1)).toEqual({
				type: 'SESSION_STATUS',
				scope: f.scope,
				observation: 0,
				status,
				afterRetry: undefined
			})
			expect(f.capability.retry).not.toHaveBeenCalled()
		}
	)
	it('ignores replacement binding and foreign or non-monotonic commands', () => {
		const f = fixture()
		f.actor.send({ type: 'BIND', scope: { binding: {}, attachment: {} }, capability: f.capability })
		for (const attempt of [0, -1, NaN, Infinity, 1.5]) f.retry(attempt)
		f.actor.send({ type: 'RETRY', scope: { ...f.scope, attachment: {} }, attempt: 1 })
		f.actor.send({ type: 'RETRY', scope: { ...f.scope, binding: {} }, attempt: 1 })
		expect(f.capability.subscribe).toHaveBeenCalledOnce()
		expect(f.capability.retry).not.toHaveBeenCalled()
	})
	it('does not turn late callbacks or foreign observations into reports', () => {
		const f = fixture()
		const before = f.reports.length
		f.actor.send({
			type: 'OBSERVED',
			scope: { ...f.scope, attachment: {} },
			observation: 0,
			status: 'error',
			afterRetry: undefined
		})
		f.actor.send({
			type: 'OBSERVATION_FAILED',
			scope: f.scope,
			observation: 1,
			reason: 'readFailed'
		})
		expect(f.reports).toHaveLength(before)
		f.actor.send({ type: 'SHUTDOWN' })
		f.notifications[0]?.()
		f.actor.send({ type: 'SHUTDOWN' })
		expect(f.unsubscribe).toHaveBeenCalledOnce()
		expect(f.reports).toHaveLength(before)
	})
	it('bridges a read failure and reobserves with a fresh scope epoch without SDK retry', () => {
		const f = fixture()
		f.capability.readStatus.mockImplementationOnce(() => {
			throw new Error('PRIVATE_READ')
		})
		f.notify('error')
		expect(f.reports.at(-1)).toEqual({
			type: 'SESSION_OBSERVATION_FAILED',
			scope: f.scope,
			observation: 0,
			reason: 'readFailed'
		})
		expect(f.unsubscribe).toHaveBeenCalledOnce()
		f.retry()
		f.actor.send({ type: 'REOBSERVE', scope: f.scope, observation: 0 })
		f.actor.send({ type: 'REOBSERVE', scope: { ...f.scope, binding: {} }, observation: 1 })
		expect(f.capability.subscribe).toHaveBeenCalledOnce()
		f.actor.send({ type: 'REOBSERVE', scope: f.scope, observation: 1 })
		expect(f.capability.subscribe).toHaveBeenCalledTimes(2)
		const before = f.reports.length
		f.notifications[0]?.()
		f.actor.send({
			type: 'OBSERVED',
			scope: f.scope,
			observation: 0,
			status: 'ready',
			afterRetry: undefined
		})
		expect(f.reports).toHaveLength(before)
		expect(f.capability.retry).not.toHaveBeenCalled()
		expect(JSON.stringify(f.reports)).not.toContain('PRIVATE_READ')
	})
	it('handles subscription setup failure and can recover', () => {
		const f = fixture(false)
		f.capability.subscribe.mockImplementationOnce(() => {
			throw new Error('PRIVATE_SUBSCRIBE')
		})
		f.attach()
		expect(f.reports.at(-1)).toMatchObject({
			type: 'SESSION_OBSERVATION_FAILED',
			reason: 'subscribeFailed'
		})
		expect(f.capability.readStatus).not.toHaveBeenCalled()
		f.actor.send({ type: 'REOBSERVE', scope: f.scope, observation: 1 })
		expect(f.reports.at(-1)).toMatchObject({ type: 'SESSION_STATUS', observation: 1 })
		expect(JSON.stringify(f.reports)).not.toContain('PRIVATE_SUBSCRIBE')
	})
	it('releases a subscription even when its synchronous setup notification fails to read', () => {
		const f = fixture(false)
		f.capability.subscribe.mockImplementationOnce((notify) => {
			notify()
			return f.unsubscribe
		})
		f.capability.readStatus.mockImplementationOnce(() => {
			throw new Error('PRIVATE_SYNC')
		})
		f.attach()
		expect(f.unsubscribe).toHaveBeenCalledOnce()
		expect(f.reports.filter((r) => r.type === 'SESSION_OBSERVATION_FAILED')).toHaveLength(1)
	})
	it('sanitizes throwing cleanup and still closes', () => {
		const f = fixture()
		f.unsubscribe.mockImplementation(() => {
			throw new Error('PRIVATE_CLEANUP')
		})
		f.actor.send({ type: 'SHUTDOWN' })
		expect(f.actor.getSnapshot().status).toBe('done')
		expect(f.reports.at(-1)).toEqual({
			type: 'SESSION_OBSERVATION_CLEANUP_FAILED',
			scope: f.scope,
			observation: 0
		})
		expect(f.unsubscribe).toHaveBeenCalledOnce()
		expect(JSON.stringify(f.reports)).not.toContain('PRIVATE_CLEANUP')
	})
	it('deduplicates issued retry and refreshes status after silent resolution', async () => {
		const f = fixture()
		f.retry()
		f.retry()
		f.retry(2)
		f.actor.send({ type: 'REOBSERVE', scope: f.scope, observation: 1 })
		f.notify('ready')
		expect(f.reports.some((r) => r.type === 'SESSION_RETRY_SETTLED')).toBe(false)
		expect(f.capability.retry).toHaveBeenCalledOnce()
		f.pending.resolve()
		await settled(f, 'resolved')
		expect(f.reports.at(-1)).toEqual({
			type: 'SESSION_STATUS',
			scope: f.scope,
			observation: 0,
			status: 'ready',
			afterRetry: 1
		})
		f.retry(1)
		expect(f.capability.retry).toHaveBeenCalledOnce()
	})
	it('does not invent ready on a resolved retry', async () => {
		const f = fixture()
		f.notify('signed-out')
		f.retry()
		f.pending.resolve()
		await settled(f, 'resolved')
		expect(f.reports.at(-1)).toMatchObject({
			type: 'SESSION_STATUS',
			status: 'signed-out',
			afterRetry: 1
		})
	})
	it('reports silent rejection and permits a new attempt', async () => {
		const f = fixture()
		f.retry()
		f.pending.reject(new Error('PRIVATE_RETRY'))
		await settled(f, 'rejected')
		expect(f.actor.getSnapshot().matches({ bound: 'retryFailed' })).toBe(true)
		f.capability.retry.mockResolvedValueOnce(undefined)
		f.retry(2)
		await waitFor(f.actor, () =>
			f.reports.some((r) => r.type === 'SESSION_STATUS' && r.afterRetry === 2)
		)
		expect(f.capability.retry).toHaveBeenCalledTimes(2)
		expect(JSON.stringify(f.reports)).not.toContain('PRIVATE_RETRY')
	})
	it('classifies a synchronous retry throw as rejected', async () => {
		const f = fixture()
		f.capability.retry.mockImplementationOnce(() => {
			throw new Error('PRIVATE_THROW')
		})
		f.retry()
		await settled(f, 'rejected')
		expect(f.actor.getSnapshot().status).toBe('active')
	})
	it('reports observation failure separately when post-retry refresh fails', async () => {
		const f = fixture()
		f.retry()
		f.capability.readStatus.mockImplementationOnce(() => {
			throw new Error('PRIVATE_REFRESH')
		})
		f.pending.resolve()
		await settled(f, 'resolved')
		expect(f.reports.at(-1)).toMatchObject({
			type: 'SESSION_OBSERVATION_FAILED',
			reason: 'readFailed'
		})
		expect(
			f.reports.some((r) => r.type === 'SESSION_RETRY_SETTLED' && r.outcome === 'rejected')
		).toBe(false)
		expect(f.unsubscribe).toHaveBeenCalledOnce()
	})
	it.each(['resolved', 'rejected'] satisfies ('resolved' | 'rejected')[])(
		'retains issued retry through observation failure until %s',
		async (outcome) => {
			const f = fixture()
			f.retry()
			f.capability.readStatus.mockImplementationOnce(() => {
				throw new Error('PRIVATE_OBSERVER')
			})
			f.notify('error')
			expect(f.unsubscribe).toHaveBeenCalledOnce()
			f.retry(2)
			f.actor.send({ type: 'REOBSERVE', scope: f.scope, observation: 1 })
			expect(f.capability.retry).toHaveBeenCalledOnce()
			expect(f.reports.some((r) => r.type === 'SESSION_RETRY_SETTLED')).toBe(false)
			if (outcome === 'resolved') f.pending.resolve()
			else f.pending.reject(new Error('PRIVATE_REJECT'))
			await settled(f, outcome)
			expect(f.actor.getSnapshot().matches({ bound: 'observerFailed' })).toBe(true)
			f.actor.send({ type: 'REOBSERVE', scope: f.scope, observation: 1 })
			expect(f.capability.subscribe).toHaveBeenCalledTimes(2)
		}
	)
	it.each(['resolved', 'rejected'] satisfies ('resolved' | 'rejected')[])(
		'retains retry after an injected observer error report until %s',
		async (outcome) => {
			const f = fixture()
			f.retry()
			f.actor.send({
				// @ts-expect-error Deliberate system-event fault injection, outside the public command API.
				type: 'xstate.error.actor',
				actorId: 'observer',
				error: new Error('PRIVATE_CRASH')
			})
			expect(f.actor.getSnapshot().matches({ bound: { retrying: 'observerFailed' } })).toBe(true)
			if (outcome === 'resolved') f.pending.resolve()
			else f.pending.reject(new Error('PRIVATE_REJECT'))
			await settled(f, outcome)
			expect(f.actor.getSnapshot().matches({ bound: 'observerFailed' })).toBe(true)
		}
	)
	it.each([
		{ failure: false, outcome: 'resolved' },
		{ failure: false, outcome: 'rejected' },
		{ failure: true, outcome: 'resolved' },
		{ failure: true, outcome: 'rejected' }
	])(
		'keeps shutdown priority (observer failed: $failure, retry: $outcome)',
		async ({ failure, outcome }) => {
			const f = fixture()
			f.retry()
			if (failure) {
				f.capability.readStatus.mockImplementationOnce(() => {
					throw new Error('PRIVATE_FAILURE')
				})
				f.notify('error')
			}
			f.actor.send({ type: 'SHUTDOWN' })
			f.actor.send({ type: 'SHUTDOWN' })
			f.actor.send({
				// @ts-expect-error Deliberate system-event fault injection, outside the public command API.
				type: 'xstate.error.actor',
				actorId: 'observer',
				error: new Error('PRIVATE_LATE')
			})
			f.retry(2)
			const reads = f.capability.readStatus.mock.calls.length
			f.notifications[0]?.()
			expect(f.actor.getSnapshot().status).toBe('active')
			expect(f.unsubscribe).toHaveBeenCalledOnce()
			if (outcome === 'resolved') f.pending.resolve()
			else f.pending.reject(new Error('PRIVATE_REJECT'))
			await waitFor(f.actor, (snapshot) => snapshot.status === 'done')
			expect(f.capability.readStatus).toHaveBeenCalledTimes(reads)
			expect(f.capability.retry).toHaveBeenCalledOnce()
			expect(f.actor.getSnapshot().context.capability).toBeUndefined()
			expect(f.actor.getSnapshot().context.scope).toBeUndefined()
		}
	)
})
