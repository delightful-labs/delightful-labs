import { createActor, setup, types, type ActorRefFrom } from 'xstate'
import {
	createBrokerHostChannel,
	brokerHostChannelInput,
	brokerHostCall,
	serveBrokerHost,
	type BrokerHostChannelInput,
	type BrokerHostCall,
	type BrokerHostOperation,
	type BrokerHostResult
} from 'delightful-local-first/backend/jazz/worker-broker'
import type { WorkerHostClosed } from 'delightful-local-first/worker/channel/contracts'

async function bounded<T>(promise: Promise<T>): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new Error('Packed owned broker deadline exceeded')), 3000)
			})
		])
	} finally {
		clearTimeout(timer)
	}
}
const channel = createBrokerHostChannel()
const machine = setup({
	schemas: {
		context: types<{ input: BrokerHostChannelInput; receipt: WorkerHostClosed | undefined }>(),
		input: types<BrokerHostChannelInput>(),
		output: types<WorkerHostClosed | undefined>(),
		events: { CALL: types<{ call: BrokerHostCall }>(), CLOSE: types() },
		children: { channel: types<ActorRefFrom<typeof channel>>() }
	},
	actors: { channel }
}).createMachine({
	id: 'packed-owned-broker',
	initial: 'owning',
	context: ({ input }) => ({ input, receipt: undefined }),
	output: ({ context }) => context.receipt,
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
		closed: { type: 'final' },
		failed: { type: 'final' }
	}
})
const data = new MessageChannel(),
	control = new MessageChannel(),
	echo = new MessageChannel()
const identity = { scope: crypto.randomUUID(), requestId: crypto.randomUUID() }
const key = 'jazz:shared-worker-generation:jazz-runtime:packed-owned'
const url = 'https://packed.example/broker.js',
	name = 'jazz-runtime:packed-owned:generation-2'
let stored = 'raw generation',
	writes = 0,
	opens = 0
const release = serveBrokerHost(data.port1, control.port1, identity.scope, {
	admitOpen: (candidate, workerName) => candidate === url && workerName === name,
	admitGeneration: (candidate) => candidate === key,
	storage: {
		getItem: () => stored,
		setItem: (_key, value) => {
			stored = value
			writes++
		}
	},
	open: () => {
		opens++
		return Object.assign(new EventTarget(), { port: echo.port1 })
	}
})
echo.port2.onmessage = ({ data }) => echo.port2.postMessage(data)
const actor = createActor(machine, {
	input: brokerHostChannelInput(data.port2, control.port2, identity, {
		onOverdue: () => {
			throw new Error('Unexpected owned close deadline')
		},
		onBlocked: () => {
			throw new Error('Unexpected owned channel failure')
		}
	})
})
const closed = new Promise<WorkerHostClosed | undefined>((resolve) =>
	actor.subscribe({ complete: () => resolve(actor.getSnapshot().output) })
)
function call(operation: BrokerHostOperation) {
	return bounded(
		new Promise<BrokerHostResult>((resolve) =>
			actor.send({ type: 'CALL', call: brokerHostCall(crypto.randomUUID(), operation, resolve) })
		)
	)
}
actor.start()
let accepted: MessagePort | undefined
try {
	const read = await call({ type: 'READ', key })
	if (
		read.kind !== 'succeeded' ||
		read.response.type !== 'RESULT' ||
		read.response.value !== 'raw generation'
	)
		throw new Error('Owned generation read failed')
	const write = await call({ type: 'WRITE', key, value: '4' })
	if (write.kind !== 'succeeded' || writes !== 1 || stored !== '4')
		throw new Error('Owned generation write failed')
	const open = await call({ type: 'OPEN', url, name })
	if (open.kind !== 'succeeded' || open.response.type !== 'OPENED' || opens !== 1)
		throw new Error('Owned broker open failed')
	accepted = open.response.port
	actor.send({ type: 'CLOSE' })
	const receipt = await bounded(closed)
	if (receipt?.scope !== identity.scope || receipt.requestId !== identity.requestId)
		throw new Error('Owned close receipt mismatch')
	const reply = new Promise<unknown>((resolve) => {
		if (accepted) accepted.onmessage = ({ data }) => resolve(data)
	})
	accepted.postMessage('SDK owns accepted child port')
	if ((await bounded(reply)) !== 'SDK owns accepted child port')
		throw new Error('Child reclaimed accepted port')
} finally {
	accepted?.close()
	actor.stop()
	release()
	data.port1.close()
	data.port2.close()
	control.port1.close()
	control.port2.close()
	echo.port1.close()
	echo.port2.close()
}
