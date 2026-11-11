import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPwaUpdateMachine, selectPwaUpdateView, type UpdateEvent } from './pwa-update.js'
import { createActor, waitFor } from 'xstate'

function fixture() {
	const original = { postMessage: vi.fn<(message: { type: 'ACTIVATE_UPDATE' }) => void>() }
	const update = { postMessage: vi.fn<(message: { type: 'ACTIVATE_UPDATE' }) => void>() }
	const registration: EventTarget & {
		waiting: Extract<UpdateEvent, { type: 'READY' }>['worker'] | null
		installing: ServiceWorker | null
	} = Object.assign(new EventTarget(), { waiting: update, installing: null })
	let controller = original
	let send: (event: UpdateEvent) => void = () => {}
	const dispose = vi.fn()
	const reload = vi.fn()
	const acquire = vi.fn<() => Promise<typeof registration | undefined>>(async () => registration)
	const observe = vi.fn((_: typeof registration, notify: typeof send) => {
		send = notify
		return dispose
	})
	const actor = createActor(
		createPwaUpdateMachine({
			registration: acquire,
			observe,
			controller: () => controller,
			reload
		})
	)
	const activate = () => {
		controller = update
		send({ type: 'ACTIVATED' })
	}
	return {
		actor,
		original,
		update,
		registration,
		acquire,
		observe,
		dispose,
		reload,
		activate,
		notify: (event: UpdateEvent) => send(event),
		view: () => selectPwaUpdateView(actor.getSnapshot())
	}
}

async function start(f: ReturnType<typeof fixture>) {
	f.actor.start()
	await waitFor(f.actor, (s) => s.matches({ watching: 'idle' }))
	return f
}

afterEach(() => vi.useRealTimers())

describe('PWA update lifecycle', () => {
	it('finishes silently when no registration is available', async () => {
		const f = fixture()
		f.acquire.mockResolvedValueOnce(undefined)
		f.actor.start()
		await waitFor(f.actor, (s) => s.status === 'done')
		expect(f.view()).toBe('hidden')
		expect(f.observe).not.toHaveBeenCalled()
	})

	it('supervises observer acquisition errors and offers retry', async () => {
		const f = fixture()
		f.observe.mockImplementationOnce(() => {
			throw new Error('subscribe failed')
		})
		f.actor.start()
		await waitFor(f.actor, (s) => s.matches('unavailable'))
		expect(f.view()).toBe('failed')
		f.actor.send({ type: 'RETRY' })
		await waitFor(f.actor, (s) => s.matches({ watching: 'idle' }))
		expect(f.view()).toBe('hidden')
		f.actor.send({ type: 'SHUTDOWN' })
	})

	it('fails safely if the offered worker disappears before acceptance', async () => {
		const f = await start(fixture())
		f.notify({ type: 'READY', worker: f.update })
		f.registration.waiting = null
		f.actor.send({ type: 'ACCEPT' })
		expect(f.view()).toBe('failed')
		expect(f.reload).not.toHaveBeenCalled()
		f.actor.send({ type: 'SHUTDOWN' })
	})

	it('reports reload failure and permits a fresh user-requested retry', async () => {
		const f = await start(fixture())
		f.reload.mockImplementationOnce(() => {
			throw new Error('reload failed')
		})
		f.registration.waiting = null
		f.activate()
		f.actor.send({ type: 'ACCEPT' })
		await waitFor(f.actor, (s) => s.matches({ watching: 'failed' }))
		expect(f.view()).toBe('failed')
		f.actor.send({ type: 'RETRY' })
		expect(f.reload).toHaveBeenCalledTimes(2)
		expect(f.update.postMessage).not.toHaveBeenCalled()
		f.actor.send({ type: 'SHUTDOWN' })
	})

	it('bounds a reload that never navigates and never automatically repeats it', async () => {
		vi.useFakeTimers()
		const f = await start(fixture())
		f.activate()
		f.actor.send({ type: 'ACCEPT' })
		await vi.advanceTimersByTimeAsync(15000)
		expect(f.view()).toBe('failed')
		await vi.advanceTimersByTimeAsync(30000)
		expect(f.reload).toHaveBeenCalledTimes(1)
		f.actor.send({ type: 'SHUTDOWN' })
	})

	it('stays hidden on startup, suppresses a dismissed release, and announces a replacement', async () => {
		const f = await start(fixture())
		expect(f.view()).toBe('hidden')
		f.notify({ type: 'READY', worker: f.update })
		expect(f.view()).toBe('ready')
		f.actor.send({ type: 'LATER' })
		f.notify({ type: 'READY', worker: f.update })
		expect(f.view()).toBe('hidden')
		f.notify({ type: 'READY', worker: f.original })
		expect(f.view()).toBe('ready')
		expect(f.reload).not.toHaveBeenCalled()
		f.actor.send({ type: 'SHUTDOWN' })
	})

	it('activates the latest waiting worker, ignores rapid clicks, and reloads once', async () => {
		const f = await start(fixture())
		f.notify({ type: 'READY', worker: f.original })
		f.actor.send({ type: 'ACCEPT' })
		f.actor.send({ type: 'ACCEPT' })
		expect(f.update.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'ACTIVATE_UPDATE' })
		expect(f.original.postMessage).not.toHaveBeenCalled()
		expect(f.reload).not.toHaveBeenCalled()
		expect(f.view()).toBe('busy')
		f.activate()
		f.activate()
		f.actor.send({ type: 'ACCEPT' })
		expect(f.reload).toHaveBeenCalledTimes(1)
		f.actor.send({ type: 'SHUTDOWN' })
		expect(f.dispose).toHaveBeenCalledTimes(1)
	})

	it('offers reload after another tab activates without automatically reloading', async () => {
		const f = await start(fixture())
		f.activate()
		expect(f.view()).toBe('reload')
		expect(f.reload).not.toHaveBeenCalled()
		f.actor.send({ type: 'ACCEPT' })
		expect(f.reload).toHaveBeenCalledTimes(1)
		expect(f.update.postMessage).not.toHaveBeenCalled()
		f.actor.send({ type: 'SHUTDOWN' })
	})

	it('times out activation and allows retry without resubscribing', async () => {
		vi.useFakeTimers()
		const f = await start(fixture())
		f.notify({ type: 'READY', worker: f.update })
		f.actor.send({ type: 'ACCEPT' })
		await vi.advanceTimersByTimeAsync(15000)
		expect(f.view()).toBe('failed')
		expect(f.reload).not.toHaveBeenCalled()
		f.actor.send({ type: 'RETRY' })
		f.activate()
		expect(f.reload).toHaveBeenCalledTimes(1)
		expect(f.update.postMessage).toHaveBeenCalledTimes(2)
		expect(f.observe).toHaveBeenCalledTimes(1)
		f.actor.send({ type: 'SHUTDOWN' })
	})

	it('reports a rejected activation request and retries it', async () => {
		const f = await start(fixture())
		f.update.postMessage.mockImplementationOnce(() => {
			throw new Error('cannot post')
		})
		f.notify({ type: 'READY', worker: f.update })
		f.actor.send({ type: 'ACCEPT' })
		await waitFor(f.actor, (s) => s.matches({ watching: 'failed' }))
		expect(f.view()).toBe('failed')
		f.actor.send({ type: 'RETRY' })
		f.activate()
		expect(f.reload).toHaveBeenCalledTimes(1)
		f.actor.send({ type: 'SHUTDOWN' })
	})

	it('releases a failed observer and reacquires it on retry', async () => {
		const f = await start(fixture())
		f.notify({ type: 'OBSERVER_FAILED' })
		expect(f.view()).toBe('failed')
		expect(f.dispose).toHaveBeenCalledTimes(1)
		f.actor.send({ type: 'RETRY' })
		await waitFor(f.actor, (s) => s.matches({ watching: 'idle' }))
		expect(f.acquire).toHaveBeenCalledTimes(2)
		expect(f.observe).toHaveBeenCalledTimes(2)
		f.actor.send({ type: 'SHUTDOWN' })
	})

	it('cancels observation and activation timeout and ignores late completion', async () => {
		vi.useFakeTimers()
		const f = await start(fixture())
		f.notify({ type: 'READY', worker: f.update })
		f.actor.send({ type: 'ACCEPT' })
		f.actor.send({ type: 'SHUTDOWN' })
		f.activate()
		await vi.advanceTimersByTimeAsync(30000)
		expect(f.actor.getSnapshot().status).toBe('done')
		expect(f.view()).toBe('hidden')
		expect(f.dispose).toHaveBeenCalledTimes(1)
		expect(f.reload).not.toHaveBeenCalled()
	})

	it('discards a registration that resolves after shutdown', async () => {
		const f = fixture()
		const pending = Promise.withResolvers<typeof f.registration>()
		f.acquire.mockImplementation(() => pending.promise)
		f.actor.start()
		f.actor.send({ type: 'SHUTDOWN' })
		pending.resolve(f.registration)
		await Promise.resolve()
		expect(f.actor.getSnapshot().status).toBe('done')
		expect(f.observe).not.toHaveBeenCalled()
	})

	it('reports discovery failure and recovers on retry', async () => {
		const f = fixture()
		f.acquire.mockRejectedValueOnce(new Error('registration failed'))
		f.actor.start()
		await waitFor(f.actor, (s) => s.matches('unavailable'))
		expect(f.view()).toBe('failed')
		f.actor.send({ type: 'RETRY' })
		await waitFor(f.actor, (s) => s.matches({ watching: 'idle' }))
		expect(f.view()).toBe('hidden')
		f.actor.send({ type: 'SHUTDOWN' })
	})
})
