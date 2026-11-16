import {
	createWorkerCallbackCustody,
	type WorkerCallbackInterruption,
	type WorkerCallbackResult,
	type WorkerCallbackStopResult
} from 'delightful-local-first/worker/callback-custody'
import type { WorkerChannelResult } from 'delightful-local-first/worker/channel/contracts'
import type { WorkerRequestIdentity } from 'delightful-local-first/worker/request/contracts'

type Response = { port: MessagePort }
// Both directions preserve the exact default result contract in published types.
const defaultResultIsExact: WorkerCallbackResult<Response> extends WorkerChannelResult<Response>
	? WorkerChannelResult<Response> extends WorkerCallbackResult<Response>
		? true
		: false
	: false = true
if (!defaultResultIsExact) throw new Error('Default callback result contract changed')

type SdkIdentity = Readonly<{ runtimeId: string; requestId: string }>
const sdkResults: WorkerCallbackResult<Response, WorkerCallbackInterruption>[] = []
const sdkCustody = createWorkerCallbackCustody<SdkIdentity, Response, WorkerCallbackInterruption>({
	sameIdentity: (a, b) => a.runtimeId === b.runtimeId && a.requestId === b.requestId,
	discard: (response) => response.port.close()
})
const waitingId = { runtimeId: crypto.randomUUID(), requestId: crypto.randomUUID() }
const issuedId = { ...waitingId, requestId: crypto.randomUUID() }
const waitingStop: WorkerCallbackInterruption = {
	kind: 'interrupted',
	reason: 'closed',
	effectOutcome: 'not-issued'
}
sdkCustody.register({
	identity: waitingId,
	stopped: waitingStop,
	settle: (result) => {
		sdkResults.push(result)
	}
})
sdkCustody.register({
	identity: issuedId,
	stopped: waitingStop,
	settle: (result) => {
		sdkResults.push(result)
	}
})
sdkCustody.recordStopResult(issuedId, {
	kind: 'interrupted',
	reason: 'unavailable',
	effectOutcome: 'unknown'
})
sdkCustody.stop()
sdkCustody.stop()
const waitingResult = sdkResults[0],
	issuedResult = sdkResults[1]
if (
	sdkResults.length !== 2 ||
	waitingResult?.kind !== 'interrupted' ||
	waitingResult.effectOutcome !== 'not-issued' ||
	issuedResult?.kind !== 'interrupted' ||
	issuedResult.reason !== 'unavailable' ||
	issuedResult.effectOutcome !== 'unknown' ||
	'identity' in waitingResult ||
	'identity' in issuedResult
)
	throw new Error('Packed SDK callback stop results fabricated or lost an issuance outcome')

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
