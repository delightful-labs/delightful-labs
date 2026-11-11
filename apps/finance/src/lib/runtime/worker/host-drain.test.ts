import { afterEach, expect, it, vi } from 'vitest'
import { createWorkerHostDrain, serveWindowHostDrain } from './host-drain.js'
import { createWorkerHostClient } from './host-client.js'
import { serveWindowHost } from './window-host.js'
import { HOST_REQUEST_TIMEOUT_MS } from './host-protocol.js'

const scope = '11111111-1111-4111-8111-111111111111'
const cleanups = new Set<() => void>()
afterEach(() => {
	for (const dispose of cleanups) dispose()
	cleanups.clear()
	vi.useRealTimers()
})
function channel() {
	const ports = new MessageChannel()
	cleanups.add(() => {
		ports.port1.close()
		ports.port2.close()
	})
	return ports
}
function next(port: MessagePort) {
	return new Promise<Record<string, unknown>>((resolve) => {
		port.addEventListener('message', (event) => resolve(event.data), { once: true })
		port.start()
	})
}
function fixture() {
	const data = channel(),
		control = channel(),
		values = new Map<string, string>()
	const storage = {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: vi.fn((key: string, value: string) => {
			values.set(key, value)
		})
	}
	const stop = serveWindowHost(
		data.port2,
		{
			scope,
			accountStorageKey: 'account',
			broker: { url: 'https://finance.example/broker.js', baseName: 'jazz-runtime:test' }
		},
		{
			origin: 'https://finance.example',
			storage,
			openBroker: () => {
				throw new Error('unused')
			}
		}
	)
	cleanups.add(stop)
	cleanups.add(serveWindowHostDrain(control.port2, scope, stop))
	const onClosed = vi.fn(),
		drain = createWorkerHostDrain(control.port1, scope, onClosed)
	const client = createWorkerHostClient(data.port1, scope, () => {})
	cleanups.add(drain.dispose)
	cleanups.add(client.close)
	return { data, control, values, storage, drain, client, onClosed }
}
it('preserves an acknowledged write and reports host closure once for repeated requests', async () => {
	const f = fixture()
	await f.client.accountStorage.write('committed')
	const first = f.drain.closeHostAndDrain()
	expect(f.drain.closeHostAndDrain()).toBe(first)
	await first
	expect(f.values.get('account')).toBe('committed')
	expect(f.onClosed).toHaveBeenCalledExactlyOnceWith(scope)
})
it('prevents storage effects queued after the close receipt', async () => {
	const f = fixture()
	await f.drain.closeHostAndDrain()
	vi.useFakeTimers()
	const rejected = expect(f.client.accountStorage.write('too-late')).rejects.toMatchObject({
		writeOutcome: 'unknown'
	})
	await vi.advanceTimersByTimeAsync(HOST_REQUEST_TIMEOUT_MS)
	await rejected
	expect(f.storage.setItem).not.toHaveBeenCalled()
})
it('can close the Window host after the data client has failed', async () => {
	const f = fixture()
	f.client.close()
	await f.drain.closeHostAndDrain()
	expect(f.onClosed).toHaveBeenCalledExactlyOnceWith(scope)
})
it('observes a late correlated receipt after timeout without retrying closure', async () => {
	vi.useFakeTimers()
	const ports = channel(),
		onClosed = vi.fn(),
		drain = createWorkerHostDrain(ports.port1, scope, onClosed)
	cleanups.add(drain.dispose)
	const observed = next(ports.port2)
	const pending = drain.closeHostAndDrain()
	const rejected = expect(pending).rejects.toMatchObject({ reason: 'timeout' })
	const request = await observed
	await vi.advanceTimersByTimeAsync(HOST_REQUEST_TIMEOUT_MS)
	await rejected
	expect(drain.closeHostAndDrain()).toBe(pending)
	ports.port2.postMessage({ ...request, type: 'HOST_CLOSED' })
	await vi.waitFor(() => expect(onClosed).toHaveBeenCalledExactlyOnceWith(scope))
})
it('ignores foreign, uncorrelated and malformed receipts', async () => {
	const ports = channel(),
		onClosed = vi.fn(),
		drain = createWorkerHostDrain(ports.port1, scope, onClosed)
	cleanups.add(drain.dispose)
	const observed = next(ports.port2),
		pending = drain.closeHostAndDrain(),
		request = await observed
	for (const changed of [
		{ scope: crypto.randomUUID() },
		{ requestId: crypto.randomUUID() },
		{ version: 0 }
	]) {
		ports.port1.dispatchEvent(
			new MessageEvent('message', { data: { ...request, type: 'HOST_CLOSED', ...changed } })
		)
	}
	expect(onClosed).not.toHaveBeenCalled()
	ports.port2.postMessage({ ...request, type: 'HOST_CLOSED' })
	await pending
	expect(onClosed).toHaveBeenCalledOnce()
})
it('does not report channel disposal as a host-close receipt', async () => {
	const ports = channel(),
		onClosed = vi.fn(),
		drain = createWorkerHostDrain(ports.port1, scope, onClosed)
	const rejected = expect(drain.closeHostAndDrain()).rejects.toMatchObject({ reason: 'closed' })
	drain.dispose()
	await rejected
	expect(onClosed).not.toHaveBeenCalled()
})
it('does not acknowledge a failed Window disposer', async () => {
	vi.useFakeTimers()
	const ports = channel(),
		failed = vi.fn(() => {
			throw new Error('failed native close')
		}),
		onClosed = vi.fn()
	cleanups.add(serveWindowHostDrain(ports.port2, scope, failed))
	const drain = createWorkerHostDrain(ports.port1, scope, onClosed)
	cleanups.add(drain.dispose)
	const observed = next(ports.port2)
	const rejected = expect(drain.closeHostAndDrain()).rejects.toMatchObject({ reason: 'timeout' })
	await observed
	await vi.advanceTimersByTimeAsync(HOST_REQUEST_TIMEOUT_MS)
	await rejected
	expect(failed).toHaveBeenCalledOnce()
	expect(onClosed).not.toHaveBeenCalled()
})
