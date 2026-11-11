import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JazzClient, JazzSession, JazzClientConfig } from 'jazz-tools/client'
import { createSessionStartupMachine } from 'delightful-local-first/session/workflow'
import type { SessionStartupReport } from 'delightful-local-first/session/contracts'
import type { JazzStartupBinding } from './jazz-session.js'
import { Actor, createActor, createCallbackLogic, waitFor } from 'xstate'

const environment = vi.hoisted(() => ({ browser: true }))
vi.mock('$app/env', () => environment)
// Keep the real shared owner/attachment; stub only SDK creation at the public backend boundary.
// The vendored ESM adapter is external in Vitest, so mocking its transitive SDK import is insufficient.
const backend = vi.hoisted(() => ({
	create: vi.fn<(config: JazzClientConfig) => Promise<JazzSession<JazzClient>>>()
}))
vi.mock('delightful-local-first/backend/jazz/session', () => ({
	createJazzSessionAcquisition: (config: JazzClientConfig) => {
		const captured = { ...config }
		return { binding: Object.freeze({}), capability: { open: () => backend.create(captured) } }
	}
}))
const actors = new Set<{ stop: () => void }>()
function stopOwner(owner: JazzStartupBinding['owner']) {
	if (!(owner instanceof Actor)) throw new Error('Expected native session owner')
	owner.stop()
}
const owners = new Set<JazzStartupBinding['owner']>()
const config = {
	scope: 'test-app',
	serverUrl: 'http://localhost:1234',
	initial: 'local-first'
} satisfies JazzClientConfig

type Session = JazzSession<JazzClient>
function sessionStub(): Session {
	const unused = vi.fn(async () => {})
	return {
		getSnapshot: () => ({ status: 'ready' }),
		subscribe: () => () => {},
		createLocalFirst: unused,
		restoreLocalFirst: unused,
		loginWithBackend: unused,
		linkWithBackend: unused,
		logout: vi.fn(async () => {}),
		retry: unused,
		close: vi.fn(async () => {})
	}
}
function attach(binding: JazzStartupBinding) {
	owners.add(binding.owner)
	const reports: SessionStartupReport<Session>[] = []
	const recipient = createActor(
		createCallbackLogic<SessionStartupReport<Session>>(({ receive }) =>
			receive((event) => reports.push(event))
		)
	).start()
	const actor = createActor(createSessionStartupMachine<Session>(), {
		input: { reportTo: recipient }
	}).start()
	actors.add(actor)
	actors.add(recipient)
	actor.send({ type: 'START', ...binding })
	return { actor, reports }
}
beforeEach(() => {
	vi.resetModules()
	environment.browser = true
	vi.spyOn(console, 'error').mockImplementation(() => {})
	backend.create.mockReset()
})
afterEach(() => {
	for (const actor of actors) actor.stop()
	for (const owner of owners) stopOwner(owner)
	actors.clear()
	owners.clear()
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
})

describe('browser shared acquisition binding', () => {
	it('is lazy, shares pending startup, and keeps the same acquired session across detach/remount', async () => {
		const session = sessionStub(),
			pending = Promise.withResolvers<Session>()
		backend.create.mockReturnValueOnce(pending.promise)
		const { getJazzStartupBinding, getCurrentJazzSession } = await import('./jazz-session.js')
		const firstBinding = getJazzStartupBinding(config),
			secondBinding = getJazzStartupBinding({ ...config })
		expect(firstBinding.owner).toBe(secondBinding.owner)
		expect(firstBinding.scope.attachment).not.toBe(secondBinding.scope.attachment)
		expect(backend.create).not.toHaveBeenCalled()
		const first = attach(firstBinding),
			second = attach(secondBinding)
		first.actor.send({ type: 'SHUTDOWN' })
		await waitFor(first.actor, (s) => s.status === 'done')
		expect(getCurrentJazzSession()).toBeUndefined()
		pending.resolve(session)
		await waitFor(second.actor, (s) => s.matches({ bound: 'attached' }))
		expect(getCurrentJazzSession()).toBe(session)
		const third = attach(getJazzStartupBinding(config))
		await waitFor(third.actor, (s) => s.matches({ bound: 'attached' }))
		expect(backend.create).toHaveBeenCalledExactlyOnceWith(config)
		expect(session.close).not.toHaveBeenCalled()
		expect(session.logout).not.toHaveBeenCalled()
	})

	it('remembers failure across remounts and recovers through explicit retries without raw errors', async () => {
		const session = sessionStub(),
			failure = new Error('Private SDK initialization detail')
		backend.create
			.mockRejectedValueOnce(failure)
			.mockRejectedValueOnce(failure)
			.mockResolvedValueOnce(session)
		const { getJazzStartupBinding, getCurrentJazzSession } = await import('./jazz-session.js')
		const first = attach(getJazzStartupBinding(config))
		await waitFor(first.actor, (s) => s.matches({ bound: 'failed' }))
		first.actor.send({ type: 'SHUTDOWN' })
		await waitFor(first.actor, (s) => s.status === 'done')
		const second = attach(getJazzStartupBinding(config))
		await waitFor(second.actor, (s) => s.matches({ bound: 'failed' }))
		expect(backend.create).toHaveBeenCalledTimes(1)
		expect(getCurrentJazzSession()).toBeUndefined()
		second.actor.send({ type: 'RETRY' })
		await waitFor(second.actor, (s) => s.matches({ bound: 'failed' }))
		second.actor.send({ type: 'RETRY' })
		await waitFor(second.actor, (s) => s.matches({ bound: 'attached' }))
		expect(backend.create).toHaveBeenCalledTimes(3)
		expect(getCurrentJazzSession()).toBe(session)
		expect(
			second.reports
				.filter((event) => event.type === 'SESSION_STARTUP_FAILED')
				.every((event) => event.reason === 'openFailed')
		).toBe(true)
		expect(console.error).not.toHaveBeenCalled()
	})

	it('waits for the other worker and resumes all attachments without a retry', async () => {
		const released = Promise.withResolvers<void>()
		const request = vi.fn((_key: string, _options: unknown, callback: () => void) =>
			released.promise.then(callback)
		)
		vi.stubGlobal('navigator', { locks: { request } })
		const session = sessionStub()
		backend.create
			.mockRejectedValueOnce(
				new Error(
					'IndexedDB database finance-db is active in another Jazz SharedWorker realm; wait for that worker to close before retrying'
				)
			)
			.mockResolvedValueOnce(session)
		const runtime = await import('./jazz-session.js')
		const first = attach(runtime.getJazzStartupBinding(config))
		const second = attach(runtime.getJazzStartupBinding(config))
		await vi.waitFor(() => expect(request).toHaveBeenCalledOnce())
		expect(runtime.getCurrentSessionAvailability()).toEqual({
			resourceKey: 'jazz:browser-physical-database:finance-db'
		})
		expect(first.reports.some((event) => event.type === 'SESSION_STARTUP_FAILED')).toBe(false)
		expect(backend.create).toHaveBeenCalledTimes(1)
		released.resolve()
		await waitFor(first.actor, (s) => s.matches({ bound: 'attached' }))
		await waitFor(second.actor, (s) => s.matches({ bound: 'attached' }))
		expect(backend.create).toHaveBeenCalledTimes(2)
		expect(runtime.getCurrentSessionAvailability()).toBeUndefined()
		expect(runtime.getCurrentJazzSession()).toBe(session)
	})

	it('cancels the pending lock request after the last attachment leaves', async () => {
		const aborted = vi.fn()
		const request = vi.fn(
			(_key: string, options: { signal: AbortSignal }) =>
				new Promise<void>((_resolve, reject) =>
					options.signal.addEventListener('abort', () => {
						aborted()
						reject(options.signal.reason)
					})
				)
		)
		vi.stubGlobal('navigator', { locks: { request } })
		backend.create.mockRejectedValueOnce(
			new Error(
				'IndexedDB database finance-db is active in another Jazz SharedWorker realm; wait for that worker to close before retrying'
			)
		)
		const runtime = await import('./jazz-session.js')
		const first = attach(runtime.getJazzStartupBinding(config))
		const second = attach(runtime.getJazzStartupBinding(config))
		await vi.waitFor(() => expect(request).toHaveBeenCalledOnce())
		first.actor.send({ type: 'SHUTDOWN' })
		await waitFor(first.actor, (s) => s.status === 'done')
		expect(aborted).not.toHaveBeenCalled()
		second.actor.send({ type: 'SHUTDOWN' })
		await waitFor(second.actor, (s) => s.status === 'done')
		expect(aborted).toHaveBeenCalledOnce()
		expect(runtime.getCurrentSessionAvailability()).toBeUndefined()
		expect(backend.create).toHaveBeenCalledTimes(1)
	})

	it('does not allocate an owner or SDK session during SSR', async () => {
		environment.browser = false
		const { getJazzStartupBinding, getCurrentJazzSession } = await import('./jazz-session.js')
		expect(getCurrentJazzSession()).toBeUndefined()
		expect(() => getJazzStartupBinding(config)).toThrow('Jazz startup binding requires the browser')
		expect(backend.create).not.toHaveBeenCalled()
	})

	it('rejects changed configuration instead of creating a competing owner', async () => {
		const { getJazzStartupBinding } = await import('./jazz-session.js')
		const first = getJazzStartupBinding(config)
		owners.add(first.owner)
		expect(() => getJazzStartupBinding({ ...config, serverUrl: 'http://localhost:4321' })).toThrow(
			'Jazz environment replacement requires coordinated cleanup'
		)
		expect(getJazzStartupBinding(config).owner).toBe(first.owner)
		expect(backend.create).not.toHaveBeenCalled()
	})

	it('never silently replaces a stopped owner', async () => {
		const { getJazzStartupBinding, getCurrentJazzSession } = await import('./jazz-session.js')
		const first = getJazzStartupBinding(config)
		owners.add(first.owner)
		stopOwner(first.owner)
		const second = getJazzStartupBinding(config)
		expect(second.owner).toBe(first.owner)
		const app = attach(second)
		await waitFor(app.actor, (s) => s.matches('ownerFailed'))
		expect(app.reports.at(-1)).toEqual({
			type: 'SESSION_STARTUP_FAILED',
			scope: second.scope,
			reason: 'ownerFailed'
		})
		expect(getCurrentJazzSession()).toBeUndefined()
		expect(backend.create).not.toHaveBeenCalled()
	})
})
