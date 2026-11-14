import {
	serveHostClose,
	workerHostControl,
	type HostCloseIdentity,
	type HostCloseFailure
} from 'delightful-local-first/worker/host-close'
import type { WorkerChannelControl } from 'delightful-local-first/worker/channel/contracts'

const data = new MessageChannel(),
	control = new MessageChannel()
const scope = crypto.randomUUID(),
	requestId = crypto.randomUUID()
let disposed = false,
	failures = 0,
	disposalAttempts = 0
let accept!: (receipt: HostCloseIdentity) => void
const received = new Promise<HostCloseIdentity>((resolve) => {
	accept = resolve
})
let acceptFailure!: (failure: HostCloseFailure) => void
const failed = new Promise<HostCloseFailure>((resolve) => {
	acceptFailure = resolve
})
const releaseHost = serveHostClose(control.port1, scope, () => {
	disposalAttempts++
	if (disposalAttempts === 1) throw new Error('Selected native disposal failed')
	data.port1.onmessage = null
	data.port1.close()
	disposed = true
})
const client = workerHostControl(control.port2, scope)
const observe = (report: WorkerChannelControl) => {
	if (report.type === 'CLOSE_FAILED') failures++
	else if (report.type === 'HOST_CLOSE_FAILED') acceptFailure(report.failure)
	else accept(report.receipt)
}
const releaseClient = client.listen(observe)
let timer: ReturnType<typeof setTimeout> | undefined
try {
	control.port2.dispatchEvent(new MessageEvent('messageerror'))
	const closing = async () => {
		client.post({ scope, requestId })
		const failure = await failed
		if (
			failure.scope !== scope ||
			failure.requestId !== requestId ||
			failure.stage !== 'dispose' ||
			disposed
		)
			throw new Error(
				'Packed close failure did not retain correlation or falsely disposed the host'
			)
		client.post({ scope, requestId })
		return received
	}
	const receipt = await Promise.race([
		closing(),
		new Promise<never>((_, reject) => {
			timer = setTimeout(() => reject(new Error('Native close consumer deadline exceeded')), 2000)
		})
	])
	if (
		receipt.scope !== scope ||
		receipt.requestId !== requestId ||
		!disposed ||
		failures !== 1 ||
		disposalAttempts !== 2
	)
		throw new Error('Native close consumer did not retain a real scoped late receipt')
} finally {
	clearTimeout(timer)
	releaseHost()
	releaseClient()
	data.port1.close()
	data.port2.close()
	control.port1.close()
	control.port2.close()
}
