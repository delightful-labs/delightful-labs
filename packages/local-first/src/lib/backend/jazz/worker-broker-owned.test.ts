import { createActor, setup, types, SimulatedClock, type ActorRefFrom } from 'xstate'
import { afterEach, expect, it, vi } from 'vitest'
import type { WorkerHostClosed } from '../../contracts/worker-channel.js'
import type { WorkerRequestIdentity } from '../../contracts/worker-request.js'
import {
	createBrokerHostChannel,
	brokerHostChannelInput,
	brokerHostCall,
	serveBrokerHost,
	type BrokerHostCall,
	type BrokerHostChannelInput,
	type BrokerHostOperation,
	type BrokerHostResult
} from './worker-broker.js'

const key = 'jazz:shared-worker-generation:jazz-runtime:owned'
const url = 'https://owned.example/broker.js'
const name = 'jazz-runtime:owned:generation-2'
const cleanup = new Set<() => void>()
afterEach(() => {
	for (const release of cleanup) release()
	cleanup.clear()
	vi.restoreAllMocks()
})
function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Missing owned-channel fixture observation')
	return value
}
function deferred<T>() {
	let resolve!: (value: T) => void
	const promise = new Promise<T>((accept) => {
		resolve = accept
	})
	return { promise, resolve }
}
function ports() {
	const pair = new MessageChannel()
	const closed = vi.fn()
	pair.port2.addEventListener('close', closed)
	cleanup.add(() => {
		pair.port1.close()
		pair.port2.close()
	})
	return { ...pair, closed }
}
function createParent() {
	const channel = createBrokerHostChannel()
	type Context = { input: BrokerHostChannelInput; receipt: WorkerHostClosed | undefined }
	return setup({
		schemas: {
			context: types<Context>(),
			input: types<BrokerHostChannelInput>(),
			output: types<WorkerHostClosed>(),
			events: { CALL: types<{ call: BrokerHostCall }>(), CLOSE: types() },
			children: { channel: types<ActorRefFrom<typeof channel>>() }
		},
		actors: { channel }
	}).createMachine({
		id: 'owned-broker-fixture',
		initial: 'owning',
		context: ({ input }) => ({ input, receipt: undefined }),
		output: ({ context }) => required(context.receipt),
		states: {
			owning: {
				invoke: {
					id: 'channel',
					src: 'channel',
					input: ({ context }) => context.input,
					onDone: ({ event }) => ({ target: 'closed', context: { receipt: event.output } }),
					onError: { target: 'failed' }
				},
				on: {
					CALL: ({ event }, enq) => enq.sendTo('channel', { type: 'REQUEST', call: event.call }),
					CLOSE: (_, enq) => enq.sendTo('channel', { type: 'CLOSE' })
				}
			},
			failed: {},
			closed: { type: 'final' }
		}
	})
}
function fixture(manual = false, start = true) {
	const data = ports(),
		control = ports(),
		peer = ports()
	const identity = { scope: crypto.randomUUID(), requestId: crypto.randomUUID() }
	const original = { ...identity }
	const clock = new SimulatedClock()
	const onOverdue = vi.fn(),
		onBlocked = vi.fn(),
		onCloseFailure = vi.fn()
	const options = { requestTimeoutMs: 5, closeTimeoutMs: 10, onOverdue, onBlocked, onCloseFailure }
	const input = brokerHostChannelInput(data.port2, control.port2, identity, options)
	const native = {
		admitOpen: (candidate: string, candidateName: string) =>
			candidate === url && candidateName === name,
		admitGeneration: (candidate: string) => candidate === key,
		storage: { getItem: vi.fn(() => 'raw SDK value'), setItem: vi.fn() },
		open: vi.fn(() => Object.assign(new EventTarget(), { port: peer.port1 }))
	}
	const messages: WorkerRequestIdentity[] = [],
		controls: WorkerHostClosed[] = []
	if (manual) {
		data.port1.onmessage = ({ data }: MessageEvent<WorkerRequestIdentity>) => messages.push(data)
		control.port1.onmessage = ({ data }: MessageEvent<WorkerHostClosed>) => controls.push(data)
	}
	const release = manual
		? () => {}
		: serveBrokerHost(data.port1, control.port1, original.scope, native)
	const parent = createActor(createParent(), { input, clock })
	const closed = deferred<WorkerHostClosed>(),
		outputs: WorkerHostClosed[] = []
	parent.subscribe({
		complete() {
			const receipt = parent.getSnapshot().output
			if (receipt) {
				outputs.push(receipt)
				closed.resolve(receipt)
			}
		}
	})
	cleanup.add(() => {
		parent.stop()
		release()
	})
	if (start) parent.start()
	function begin(operation: BrokerHostOperation) {
		const result = deferred<BrokerHostResult>()
		const settle = vi.fn((value: BrokerHostResult) => result.resolve(value))
		parent.send({ type: 'CALL', call: brokerHostCall(crypto.randomUUID(), operation, settle) })
		return { result: result.promise, settle }
	}
	function acknowledge() {
		control.port1.postMessage({ version: 1, type: 'HOST_CLOSED', ...original })
	}
	return {
		data,
		control,
		peer,
		identity,
		original,
		input,
		options,
		native,
		clock,
		onOverdue,
		onBlocked,
		onCloseFailure,
		parent,
		closed: closed.promise,
		outputs,
		messages,
		controls,
		begin,
		acknowledge
	}
}
function wire(identity: WorkerRequestIdentity) {
	return { version: 1, ...identity }
}

it('the child-owned channel forwards native failure to its owner and completes only on a genuine receipt', async () => {
	const f = fixture(true)
	f.parent.send({ type: 'CLOSE' })
	await vi.waitFor(() => expect(f.controls).toHaveLength(1))
	f.clock.increment(4)
	f.control.port1.postMessage({
		version: 1,
		type: 'HOST_CLOSE_FAILED',
		...f.original,
		stage: 'dispose'
	})
	await vi.waitFor(() =>
		expect(f.onCloseFailure).toHaveBeenCalledExactlyOnceWith({ ...f.original, stage: 'dispose' })
	)
	expect(f.outputs).toEqual([])
	f.clock.increment(6)
	expect(f.onOverdue).toHaveBeenCalledOnce()
	expect(f.outputs).toEqual([])
	f.acknowledge()
	expect(await f.closed).toEqual(f.original)
	expect(f.controls).toHaveLength(1)
	expect(f.onBlocked).not.toHaveBeenCalled()
})

it('constructs logic, native input and a call without randomness, listeners, starts or posts', () => {
	const data = ports(),
		control = ports()
	const identity = { scope: crypto.randomUUID(), requestId: crypto.randomUUID() }
	const id = crypto.randomUUID()
	const randomness = vi.spyOn(crypto, 'randomUUID')
	const effects = [
		vi.spyOn(data.port2, 'addEventListener'),
		vi.spyOn(data.port2, 'start'),
		vi.spyOn(data.port2, 'postMessage'),
		vi.spyOn(control.port2, 'addEventListener'),
		vi.spyOn(control.port2, 'start'),
		vi.spyOn(control.port2, 'postMessage')
	]
	createBrokerHostChannel()
	brokerHostChannelInput(data.port2, control.port2, identity, {
		onOverdue: vi.fn(),
		onBlocked: vi.fn()
	})
	const settle = vi.fn()
	brokerHostCall(id, { type: 'READ', key }, settle)
	for (const effect of effects) expect(effect).not.toHaveBeenCalled()
	expect(randomness).not.toHaveBeenCalled()
	expect(settle).not.toHaveBeenCalled()
})

it.each([
	{ scope: 'invalid', requestId: crypto.randomUUID() },
	{ scope: crypto.randomUUID(), requestId: 'invalid' }
])('refuses invalid identity before native listeners %#', (identity) => {
	const data = ports(),
		control = ports()
	const observe = vi.spyOn(data.port2, 'addEventListener')
	expect(() =>
		brokerHostChannelInput(data.port2, control.port2, identity, {
			onOverdue: vi.fn(),
			onBlocked: vi.fn()
		})
	).toThrow('Invalid broker host identity')
	expect(observe).not.toHaveBeenCalled()
})

it.each([
	{ id: 'invalid', operation: { type: 'READ', key } },
	{ id: crypto.randomUUID(), operation: { type: 'READ', key: 'foreign' } },
	{ id: crypto.randomUUID(), operation: { type: 'OPEN', url: url + 'x'.repeat(8192), name } },
	{ id: crypto.randomUUID(), operation: { type: 'OPEN', url, name: 'foreign' } },
	{ id: crypto.randomUUID(), operation: { type: 'WRITE', key, value: '9007199254740992' } }
] satisfies { id: string; operation: BrokerHostOperation }[])(
	'refuses invalid call identity or payload before admission %#',
	({ id, operation }) => {
		const settle = vi.fn()
		expect(() => brokerHostCall(id, operation, settle)).toThrow('Broker host unavailable')
		expect(settle).not.toHaveBeenCalled()
	}
)

it('invokes the real child for native reads, writes and opens and reports only the genuine parent close output', async () => {
	const f = fixture()
	expect(await f.begin({ type: 'READ', key }).result).toMatchObject({
		kind: 'succeeded',
		response: { type: 'RESULT', value: 'raw SDK value' }
	})
	expect(await f.begin({ type: 'WRITE', key, value: '3' }).result).toMatchObject({
		kind: 'succeeded'
	})
	const opening = await f.begin({ type: 'OPEN', url, name }).result
	if (opening.kind !== 'succeeded' || opening.response.type !== 'OPENED')
		throw new Error('Missing accepted broker port')
	const accepted = opening.response.port
	cleanup.add(() => accepted.close())
	expect(f.native.open).toHaveBeenCalledExactlyOnceWith(url, name)
	expect(f.native.storage.setItem).toHaveBeenCalledExactlyOnceWith(key, '3')
	f.parent.send({ type: 'CLOSE' })
	expect(await f.closed).toEqual(f.original)
	expect(f.outputs).toEqual([f.original])
	const echoed = deferred<unknown>()
	f.peer.port2.onmessage = ({ data }) => echoed.resolve(data)
	accepted.postMessage('accepted port remains SDK owned')
	expect(await echoed.promise).toBe('accepted port remains SDK owned')
})

it('captures identity, timeout options and operation fields before caller mutation', async () => {
	const f = fixture(false, false)
	f.identity.scope = crypto.randomUUID()
	f.identity.requestId = crypto.randomUUID()
	f.options.closeTimeoutMs = 1
	f.options.onOverdue = vi.fn()
	const operation = { type: 'WRITE', key, value: '4' } satisfies BrokerHostOperation
	const result = deferred<BrokerHostResult>()
	const call = brokerHostCall(crypto.randomUUID(), operation, result.resolve)
	operation.key += ':foreign'
	operation.value = '5'
	f.parent.start()
	f.parent.send({ type: 'CALL', call })
	expect(await result.promise).toMatchObject({
		kind: 'succeeded',
		identity: { scope: f.original.scope }
	})
	expect(f.native.storage.setItem).toHaveBeenCalledExactlyOnceWith(key, '4')
	f.parent.send({ type: 'CLOSE' })
	expect(await f.closed).toEqual(f.original)
})

it('does not complete the parent for close deadlines, wrong identities or control errors and accepts the original late receipt', async () => {
	const f = fixture(true)
	f.parent.send({ type: 'CLOSE' })
	await vi.waitFor(() => expect(f.controls).toHaveLength(1))
	f.clock.increment(10)
	expect(f.onOverdue).toHaveBeenCalledOnce()
	expect(f.outputs).toEqual([])
	f.control.port1.postMessage({
		version: 1,
		type: 'HOST_CLOSED',
		scope: f.original.scope,
		requestId: crypto.randomUUID()
	})
	f.control.port2.dispatchEvent(new MessageEvent('messageerror'))
	f.acknowledge()
	expect(await f.closed).toEqual(f.original)
	expect(f.outputs).toEqual([f.original])
})

it('retains the original deadlines and overdue callback when caller options change before start', async () => {
	const f = fixture(true, false)
	const replacement = vi.fn()
	f.options.requestTimeoutMs = 100
	f.options.closeTimeoutMs = 100
	f.options.onOverdue = replacement
	f.parent.start()
	const reading = f.begin({ type: 'READ', key })
	await vi.waitFor(() => expect(f.messages).toHaveLength(1))
	f.clock.increment(5)
	expect(await reading.result).toMatchObject({ kind: 'failed', reason: 'timeout' })
	await vi.waitFor(() => expect(f.controls).toHaveLength(1))
	f.clock.increment(10)
	expect(f.onOverdue).toHaveBeenCalledOnce()
	expect(replacement).not.toHaveBeenCalled()
	f.acknowledge()
	expect(await f.closed).toEqual(f.original)
})

it('retains the independent close receipt after the owned data transport fails', async () => {
	const f = fixture(true)
	f.data.port2.dispatchEvent(new MessageEvent('messageerror'))
	await vi.waitFor(() => expect(f.controls).toHaveLength(1))
	expect(f.outputs).toEqual([])
	f.acknowledge()
	expect(await f.closed).toEqual(f.original)
})

it('discards a late transferred port after an owned OPEN times out and never replays it', async () => {
	const f = fixture(true)
	const opening = f.begin({ type: 'OPEN', url, name })
	await vi.waitFor(() => expect(f.messages).toHaveLength(1))
	f.clock.increment(5)
	expect(await opening.result).toMatchObject({ kind: 'failed', effectOutcome: 'unknown' })
	const orphan = ports()
	f.data.port1.postMessage(
		{ ...wire(required(f.messages[0])), type: 'OPENED', port: orphan.port1 },
		[orphan.port1]
	)
	await vi.waitFor(() => expect(orphan.closed).toHaveBeenCalledOnce())
	expect(f.messages).toHaveLength(1)
	expect(opening.settle).toHaveBeenCalledOnce()
	f.acknowledge()
	expect(await f.closed).toEqual(f.original)
})

it('disposes an unaccepted transferred port when the owned call observer throws', async () => {
	const f = fixture()
	const observe = vi.fn(() => {
		throw new Error('observer did not accept custody')
	})
	f.parent.send({
		type: 'CALL',
		call: brokerHostCall(crypto.randomUUID(), { type: 'OPEN', url, name }, observe)
	})
	await vi.waitFor(() => expect(f.peer.closed).toHaveBeenCalledOnce())
	expect(observe).toHaveBeenCalledOnce()
	f.parent.send({ type: 'CLOSE' })
	expect(await f.closed).toEqual(f.original)
})

it('forced parent stop releases its listeners and issued observer without producing a close output', async () => {
	const f = fixture(true)
	const dataClosed = vi.spyOn(f.data.port2, 'close'),
		controlClosed = vi.spyOn(f.control.port2, 'close')
	const opening = f.begin({ type: 'OPEN', url, name })
	await vi.waitFor(() => expect(f.messages).toHaveLength(1))
	f.parent.stop()
	expect(await opening.result).toMatchObject({ effectOutcome: 'unknown' })
	expect(f.parent.getSnapshot().status).toBe('stopped')
	expect(f.parent.getSnapshot().output).toBeUndefined()
	expect(f.outputs).toEqual([])
	expect(dataClosed).toHaveBeenCalledOnce()
	expect(controlClosed).toHaveBeenCalledOnce()
	expect(f.controls).toEqual([])
})
