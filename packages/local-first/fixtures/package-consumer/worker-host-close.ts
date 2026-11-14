import {
	serveHostClose,
	workerHostControl,
	type HostCloseIdentity
} from 'delightful-local-first/worker/host-close'
import type { WorkerChannelControl } from 'delightful-local-first/worker/channel/contracts'

const data = new MessageChannel(),
	control = new MessageChannel()
const scope = crypto.randomUUID(),
	requestId = crypto.randomUUID()
let disposed = false,
	failures = 0
let accept!: (receipt: HostCloseIdentity) => void
const received = new Promise<HostCloseIdentity>((resolve) => {
	accept = resolve
})
const releaseHost = serveHostClose(control.port1, scope, () => {
	data.port1.onmessage = null
	data.port1.close()
	disposed = true
})
const client = workerHostControl(control.port2, scope)
const observe = (report: WorkerChannelControl) => {
	if (report.type === 'CLOSE_FAILED') failures++
	else accept(report.receipt)
}
const releaseClient = client.listen(observe)
let timer: ReturnType<typeof setTimeout> | undefined
try {
	control.port2.dispatchEvent(new MessageEvent('messageerror'))
	client.post({ scope, requestId })
	const receipt = await Promise.race([
		received,
		new Promise<never>((_, reject) => {
			timer = setTimeout(() => reject(new Error('Native close consumer deadline exceeded')), 2000)
		})
	])
	if (receipt.scope !== scope || receipt.requestId !== requestId || !disposed || failures !== 1)
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
