import { afterEach, expect, it, vi } from 'vitest'
import { createWorkerHostClient } from './host-client.js'
import { serveWindowHost } from './window-host.js'
import {
	HOST_PROTOCOL_VERSION,
	HOST_REQUEST_TIMEOUT_MS,
	MAX_HOST_REQUESTS,
	hostReplySchema,
	hostRequestSchema,
	type HostRequest
} from './host-protocol.js'

const scope = '11111111-1111-4111-8111-111111111111'
const brokerUrl = 'https://finance.example/assets/jazz-broker.js'
const baseName = 'jazz-runtime:finance-test:alpha60'
const generationKey = `jazz:shared-worker-generation:${baseName}`
const key = 'jazz-account-selection-v1:registry:dev'
const cleanup = new Set<() => void>()
afterEach(() => {
	for (const close of cleanup) close()
	cleanup.clear()
	vi.useRealTimers()
})
function channel() {
	const ports = new MessageChannel()
	cleanup.add(() => {
		ports.port1.close()
		ports.port2.close()
	})
	return ports
}
function incoming(port: MessagePort) {
	return new Promise<HostRequest>((resolve, reject) => {
		port.addEventListener(
			'message',
			(event) => {
				const result = hostRequestSchema.safeParse(event.data)
				if (result.success) resolve(result.data)
				else reject(new Error('Invalid test request'))
			},
			{ once: true }
		)
		port.start()
	})
}
function manualClient(port: MessagePort) {
	let sequence = 0
	return (payload: object) =>
		new Promise<unknown>((resolve) => {
			port.addEventListener('message', (event) => resolve(event.data), { once: true })
			port.start()
			port.postMessage({
				version: HOST_PROTOCOL_VERSION,
				scope,
				requestId: crypto.randomUUID(),
				sequence: ++sequence,
				...payload
			})
		})
}
function fixture() {
	const ports = channel(),
		values = new Map<string, string>()
	const storage = {
		getItem: vi.fn((name: string) => values.get(name) ?? null),
		setItem: vi.fn((name: string, value: string) => {
			values.set(name, value)
		})
	}
	const addEventListener = vi.fn<SharedWorker['addEventListener']>()
	const removeEventListener = vi.fn<SharedWorker['removeEventListener']>()
	const openBroker = vi.fn(() => ({ port: channel().port1, addEventListener, removeEventListener }))
	const failBroker = () => {
		const listener = addEventListener.mock.calls[0]?.[1]
		if (typeof listener === 'function') listener(new Event('error'))
		else listener?.handleEvent(new Event('error'))
	}
	const stop = serveWindowHost(
		ports.port2,
		{ scope, accountStorageKey: key, broker: { url: brokerUrl, baseName } },
		{ origin: 'https://finance.example', storage, openBroker }
	)
	cleanup.add(stop)
	const failed = vi.fn()
	const client = createWorkerHostClient(ports.port1, scope, failed)
	cleanup.add(client.close)
	return { ports, client, storage, values, openBroker, failed, failBroker }
}
it('uses the bound account namespace and acknowledges writes after storage returns', async () => {
	const f = fixture()
	await f.client.accountStorage.write('private-selection')
	expect(await f.client.accountStorage.read()).toBe('private-selection')
	expect(f.storage.setItem).toHaveBeenCalledExactlyOnceWith(key, 'private-selection')
	expect(f.failed).not.toHaveBeenCalled()
})
it('preserves raw SDK generation values and limits generation writes to the bound key', async () => {
	const f = fixture()
	f.values.set(generationKey, 'legacy-or-corrupt-value')
	expect(await f.client.broker.readGeneration(generationKey)).toBe('legacy-or-corrupt-value')
	await f.client.broker.writeGeneration(generationKey, '3')
	await expect(
		f.client.broker.writeGeneration(generationKey + ':foreign', '4')
	).rejects.toMatchObject({ reason: 'rejected', writeOutcome: 'not-issued' })
	expect(f.values.get(generationKey)).toBe('3')
	expect(f.storage.setItem).toHaveBeenCalledOnce()
})
it('rejects foreign broker URLs and names before opening a native resource', async () => {
	const f = fixture()
	await expect(
		f.client.broker.open('https://other.example/broker.js', `${baseName}:generation-0`)
	).rejects.toMatchObject({ reason: 'rejected' })
	await expect(
		f.client.broker.open(brokerUrl, 'jazz-runtime:foreign:generation-0')
	).rejects.toMatchObject({ reason: 'rejected' })
	expect(f.openBroker).not.toHaveBeenCalled()
})
it('transfers the approved broker port and reports later native broker failure once', async () => {
	const f = fixture()
	const opened = await f.client.broker.open(brokerUrl, `${baseName}:generation-0`)
	cleanup.add(() => opened.port.close())
	expect(opened.port).toBeInstanceOf(MessagePort)
	f.failBroker()
	await vi.waitFor(() => expect(f.failed).toHaveBeenCalledOnce())
	await expect(f.client.accountStorage.read()).rejects.toMatchObject({ reason: 'closed' })
})
it('does not repeat a storage write when the same sequence is delivered again', async () => {
	const f = fixture(),
		send = manualClient(f.ports.port1)
	const original = { type: 'WRITE_ACCOUNT', value: 'first', sequence: 1 }
	expect(hostReplySchema.parse(await send(original)).type).toBe('WRITTEN')
	expect(hostReplySchema.parse(await send({ ...original, value: 'replayed' })).type).toBe('FAILED')
	expect(f.values.get(key)).toBe('first')
	expect(f.storage.setItem).toHaveBeenCalledOnce()
})
it('keeps an issued storage write uncertain when its acknowledgement is lost', async () => {
	vi.useFakeTimers()
	const ports = channel(),
		failed = vi.fn(),
		client = createWorkerHostClient(ports.port1, scope, failed)
	cleanup.add(client.close)
	const observed = incoming(ports.port2)
	const result = expect(client.accountStorage.write('private-selection')).rejects.toMatchObject({
		reason: 'timeout',
		writeOutcome: 'unknown'
	})
	expect((await observed).type).toBe('WRITE_ACCOUNT')
	await vi.advanceTimersByTimeAsync(HOST_REQUEST_TIMEOUT_MS)
	await result
	expect(failed).toHaveBeenCalledOnce()
})
it('does not settle a current request from an obsolete binding response', async () => {
	vi.useFakeTimers()
	const ports = channel(),
		client = createWorkerHostClient(ports.port1, scope, () => {})
	cleanup.add(client.close)
	const observed = incoming(ports.port2)
	const result = expect(client.accountStorage.read()).rejects.toMatchObject({ reason: 'timeout' })
	const request = await observed
	ports.port1.dispatchEvent(
		new MessageEvent('message', {
			data: {
				...request,
				type: 'ACCOUNT',
				scope: '33333333-3333-4333-8333-333333333333',
				value: 'stale'
			}
		})
	)
	await vi.advanceTimersByTimeAsync(HOST_REQUEST_TIMEOUT_MS)
	await result
})
it('bounds pending requests and rejects them all on explicit close without claiming rollback', async () => {
	const ports = channel(),
		client = createWorkerHostClient(ports.port1, scope, () => {})
	cleanup.add(client.close)
	const pending = Array.from({ length: MAX_HOST_REQUESTS }, () =>
		expect(client.accountStorage.write('pending')).rejects.toMatchObject({
			reason: 'closed',
			writeOutcome: 'unknown'
		})
	)
	await expect(client.accountStorage.write('overflow')).rejects.toMatchObject({
		reason: 'overloaded',
		writeOutcome: 'not-issued'
	})
	client.close()
	await Promise.all(pending)
})
it('sanitizes native storage errors instead of exposing private exception content', async () => {
	const f = fixture()
	f.storage.setItem.mockImplementation(() => {
		throw new Error('private-selection')
	})
	await expect(f.client.accountStorage.write('secret')).rejects.toMatchObject({
		message: 'Finance worker host unavailable',
		reason: 'unavailable',
		writeOutcome: 'unknown'
	})
})
