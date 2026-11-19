// Fixture-only native worker instrumentation; the production constructor is untouched.
const NativeWorker = globalThis.Worker
let created = 0
let closed = 0
let invalidReply = false
let failedBootstrap = false
globalThis.Worker = class extends NativeWorker {
	private readonly provider: boolean
	private ended = false
	constructor(url: string | URL, options?: WorkerOptions) {
		if (failedBootstrap && String(url).includes('simplefin.worker'))
			throw new Error('Synthetic provider worker bootstrap failure')
		super(url, options)
		this.provider = String(url).includes('simplefin.worker')
		if (this.provider) created++
	}
	postMessage(message: unknown, options?: Transferable[] | StructuredSerializeOptions) {
		if (this.provider && invalidReply)
			queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: undefined })))
		else if (Array.isArray(options)) super.postMessage(message, options)
		else super.postMessage(message, options)
	}
	terminate() {
		if (this.provider && !this.ended) {
			this.ended = true
			closed++
		}
		super.terminate()
	}
}
export function providerWorkerStatus() {
	return { created, closed }
}
export function failProviderReply() {
	invalidReply = true
}
export function failProviderBootstrap() {
	failedBootstrap = true
}
