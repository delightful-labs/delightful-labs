import {
	brokerHostClient,
	serveBrokerHost,
	type BrokerHostNative
} from 'delightful-local-first/backend/jazz/worker-broker'

async function bounded<Value>(promise: Promise<Value>) {
	let timer: ReturnType<typeof setTimeout> | undefined
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				timer = setTimeout(
					() => reject(new Error('Packed broker consumer deadline exceeded')),
					2000
				)
			})
		])
	} finally {
		clearTimeout(timer)
	}
}

const data = new MessageChannel(),
	control = new MessageChannel()
const scope = crypto.randomUUID()
const url = 'https://broker.test/exact-worker.js',
	name = 'jazz-runtime:packed-consumer:generation-0',
	key = 'jazz:shared-worker-generation:jazz-runtime:packed-consumer'
let stored = 'raw SDK generation representation',
	opens = 0,
	writes = 0
const peers: MessagePort[] = []
const native: BrokerHostNative = {
	admitOpen: (candidate, candidateName) => candidate === url && candidateName === name,
	admitGeneration: (candidate) => candidate === key,
	storage: {
		getItem: () => stored,
		setItem: (_key, value) => {
			writes++
			stored = value
		}
	},
	open: () => {
		opens++
		const pair = new MessageChannel()
		peers.push(pair.port1, pair.port2)
		pair.port2.onmessage = ({ data }) => pair.port2.postMessage(data)
		return Object.assign(new EventTarget(), { port: pair.port1 })
	}
}
const release = serveBrokerHost(data.port1, control.port1, scope, native)
const client = brokerHostClient(data.port2, control.port2, scope, {
	onOverdue: () => {
		throw new Error('Unexpected broker close deadline')
	},
	onBlocked: () => {
		throw new Error('Unexpected broker transport failure')
	}
})
let accepted: MessagePort | undefined
try {
	if ((await bounded(client.readGeneration(key))) !== stored)
		throw new Error('Broker changed the SDK generation representation')
	try {
		await bounded(client.writeGeneration(key + ':foreign', '9'))
		throw new Error('Broker admitted a foreign generation write')
	} catch (error) {
		if (
			!(error instanceof Error) ||
			!('workerEffectOutcome' in error) ||
			error.workerEffectOutcome !== 'not-issued'
		)
			throw error
	}
	await bounded(client.writeGeneration(key, '3'))
	accepted = (await bounded(client.open(url, name))).port
	const receipt = await bounded(client.close())
	if (
		receipt.scope !== scope ||
		receipt.requestId !== client.host.identity.requestId ||
		opens !== 1 ||
		writes !== 1 ||
		stored !== '3'
	)
		throw new Error('Broker native effects or close receipt did not match the admitted scope')
	const echo = new Promise<unknown>((resolve) => {
		if (accepted) accepted.onmessage = ({ data }) => resolve(data)
	})
	accepted.postMessage('SDK retains the accepted port after host closure')
	if ((await bounded(echo)) !== 'SDK retains the accepted port after host closure')
		throw new Error('Broker reclaimed an accepted SDK port')
} finally {
	accepted?.close()
	client.dispose()
	release()
	for (const port of peers) port.close()
	data.port1.close()
	data.port2.close()
	control.port1.close()
	control.port2.close()
}
