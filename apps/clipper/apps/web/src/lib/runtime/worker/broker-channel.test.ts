import { afterEach, expect, it, vi } from 'vitest'
import { SimulatedClock } from 'xstate'
import { brokerHostClient, serveBrokerHost } from './broker-channel.js'

const cleanup = new Set<() => void>()
afterEach(() => {
	for (const release of cleanup) release()
	cleanup.clear()
	vi.restoreAllMocks()
})
const origin = 'https://clipper.example'
const url = `${origin}/jazz-runtime-worker.js`
const name = 'jazz-runtime:original:generation-0'
const key = 'jazz:shared-worker-generation:jazz-runtime:original'
function channel() {
	const pair = new MessageChannel()
	const closed = vi.fn()
	pair.port2.addEventListener('close', closed)
	cleanup.add(() => {
		pair.port1.close()
		pair.port2.close()
	})
	return { ...pair, closed }
}
function fixture() {
	const data = new MessageChannel(),
		control = new MessageChannel()
	const scope = crypto.randomUUID(),
		clock = new SimulatedClock()
	const native = {
		origin,
		storage: { getItem: vi.fn((): string | null => '2'), setItem: vi.fn() },
		open: vi.fn((_url: string, _name: string) => {
			const pair = channel()
			const worker = Object.assign(new EventTarget(), { port: pair.port1 })
			vi.spyOn(worker, 'removeEventListener')
			return worker
		})
	}
	const onOverdue = vi.fn(),
		onBlocked = vi.fn()
	const release = serveBrokerHost(data.port1, control.port1, scope, native)
	const client = brokerHostClient(data.port2, control.port2, scope, {
		clock,
		requestTimeoutMs: 5,
		closeTimeoutMs: 10,
		onOverdue,
		onBlocked
	})
	cleanup.add(() => {
		client.dispose()
		release()
		data.port1.close()
		control.port1.close()
	})
	return { data, control, scope, clock, native, client, onOverdue, onBlocked }
}

it('preserves exact SDK URL/name and raw generation values, and transfers port ownership to the SDK', async () => {
	const f = fixture()
	f.native.storage.getItem.mockReturnValue('legacy malformed value')
	const reading = f.client.readGeneration(key),
		writing = f.client.writeGeneration(key, '3')
	const opened = await f.client.open(url, name)
	cleanup.add(() => opened.port.close())
	expect(await reading).toBe('legacy malformed value')
	await writing
	expect(f.native.storage.getItem).toHaveBeenCalledExactlyOnceWith(key)
	expect(f.native.storage.setItem).toHaveBeenCalledExactlyOnceWith(key, '3')
	expect(f.native.open).toHaveBeenCalledExactlyOnceWith(url, name)
	const worker = f.native.open.mock.results[0]?.value
	if (!worker) throw new Error('Missing native worker')
	expect(await f.client.close()).toEqual(f.client.host.identity)
	expect(worker.removeEventListener).toHaveBeenCalledWith('error', expect.any(Function))
	expect(f.onBlocked).not.toHaveBeenCalled()
})

it('rejects foreign-origin and credential-bearing URLs without constructing brokers and keeps healthy FIFO continuity', async () => {
	const f = fixture()
	for (const refused of [
		'https://foreign.example/worker.js',
		'https://secret@clipper.example/worker.js'
	])
		await expect(f.client.open(refused, name)).rejects.toMatchObject({
			workerEffectOutcome: 'not-issued'
		})
	expect(f.native.open).not.toHaveBeenCalled()
	expect(await f.client.readGeneration(key)).toBe('2')
})

it('retains Clipper admission for sibling same-origin brokers and Jazz generation scopes', async () => {
	const f = fixture()
	const siblingUrl = origin + '/sibling-worker.js'
	const siblingName = 'jazz-runtime:sibling:generation-1'
	const siblingKey = key + ':sibling'
	const opened = await f.client.open(siblingUrl, siblingName)
	cleanup.add(() => opened.port.close())
	expect(await f.client.readGeneration(siblingKey)).toBe('2')
	await f.client.writeGeneration(siblingKey, '4')
	expect(f.native.open).toHaveBeenCalledExactlyOnceWith(siblingUrl, siblingName)
	expect(f.native.storage.setItem).toHaveBeenCalledExactlyOnceWith(siblingKey, '4')
	await f.client.close()
})
