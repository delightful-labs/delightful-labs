import {
	createWorkerCallbackCustody,
	type WorkerCallbackStopResult
} from 'delightful-local-first/worker/callback-custody'
import type { WorkerChannelResult } from 'delightful-local-first/worker/channel/contracts'
import type { WorkerRequestIdentity } from 'delightful-local-first/worker/request/contracts'

type Response = { port: MessagePort }
const pair = new MessageChannel(),
	orphan = new MessageChannel()
const id = { scope: crypto.randomUUID(), requestId: crypto.randomUUID(), sequence: 1 }
const next = { ...id, requestId: crypto.randomUUID(), sequence: 2 }
const discarded: MessagePort[] = []
const results: WorkerChannelResult<Response>[] = []
const custody = createWorkerCallbackCustody<WorkerRequestIdentity, Response>({
	sameIdentity: (a, b) =>
		a.scope === b.scope && a.requestId === b.requestId && a.sequence === b.sequence,
	discard: (response) => {
		discarded.push(response.port)
		response.port.close()
	}
})
function stopped(identity: WorkerRequestIdentity): WorkerCallbackStopResult<Response> {
	return {
		kind: 'refused',
		scope: identity.scope,
		requestId: identity.requestId,
		reason: 'closed',
		effectOutcome: 'not-issued'
	}
}
let timer: ReturnType<typeof setTimeout> | undefined
try {
	custody.register({
		identity: id,
		settle: (result) => {
			results.push(result)
		},
		stopped: stopped(id)
	})
	custody.register({
		identity: next,
		settle: (result) => {
			results.push(result)
		},
		stopped: stopped(next)
	})
	const response = { port: pair.port1 },
		token = custody.capture(response)
	if (!token) throw new Error('Packed keeper refused initial response custody')
	const success: WorkerChannelResult<Response> = { kind: 'succeeded', identity: id, response }
	custody.deliver({ ...id, scope: 'foreign' }, success, token)
	if (results.length) throw new Error('Packed keeper delivered a foreign response')
	custody.deliver(id, success, token)
	custody.recordStopResult(next, {
		kind: 'failed',
		identity: next,
		reason: 'closed',
		effectOutcome: 'unknown'
	})
	custody.capture({ port: orphan.port1 })
	custody.stop()
	custody.stop()
	const accepted = results[0],
		interrupted = results[1]
	if (
		results.length !== 2 ||
		accepted?.kind !== 'succeeded' ||
		accepted.response.port !== pair.port1
	)
		throw new Error('Packed keeper did not deliver the original SDK port once')
	if (interrupted?.kind !== 'failed' || interrupted.effectOutcome !== 'unknown')
		throw new Error('Packed keeper lost the selected effect stop result')
	if (discarded.length !== 1 || discarded[0] !== orphan.port1)
		throw new Error('Packed keeper reclaimed accepted custody or lost an orphan')
	const echo = new Promise<unknown>((resolve) => {
		pair.port2.onmessage = (event) => resolve(event.data)
	})
	pair.port1.postMessage('SDK port survives keeper stop')
	const received = await Promise.race([
		echo,
		new Promise<never>((_, reject) => {
			timer = setTimeout(
				() => reject(new Error('Packed keeper native-port deadline exceeded')),
				3000
			)
		})
	])
	if (received !== 'SDK port survives keeper stop')
		throw new Error('Packed keeper closed the accepted SDK port')
} finally {
	clearTimeout(timer)
	custody.stop()
	pair.port1.close()
	pair.port2.close()
	orphan.port1.close()
	orphan.port2.close()
}
