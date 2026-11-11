import type { BankTrace } from './diagnostics.js'
import type { ProviderReply, ProviderRequest } from '#lib/machines/bank-sync/provider-request.js'
import { providerReplySchema } from '#lib/validation/integrations.js'

/** One platform operation; the worker statechart owns HTTP/decode/validation decisions. */
export function requestProviderWorker(
	accessUrl: string,
	discovery: boolean,
	signal: AbortSignal,
	trace: BankTrace
) {
	// Also bounds worker bootstrap and a stalled response body, outside the relay's deadline.
	const lifetime = AbortSignal.any([signal, AbortSignal.timeout(75000)])
	lifetime.throwIfAborted()
	return trace.step(
		'provider.worker',
		() =>
			new Promise<Extract<ProviderReply, { ok: true }>['response']>((resolve, reject) => {
				const worker = new Worker(new URL('./simplefin.worker.ts', import.meta.url), {
					type: 'module'
				})
				let settled = false
				const finish = (
					result: Extract<ProviderReply, { ok: true }> | { ok: false; error: unknown }
				) => {
					if (settled) return
					settled = true
					lifetime.removeEventListener('abort', abort)
					worker.onmessage = null
					worker.onerror = null
					worker.onmessageerror = null
					worker.terminate()
					if (result.ok) resolve(result.response)
					else reject(result.error)
				}
				const abort = () => {
					finish({ ok: false, error: lifetime.reason })
					trace.log(signal.aborted ? 'provider.worker.cancelled' : 'provider.worker.timeout')
				}
				const fail = () => finish({ ok: false, error: new Error('provider-failure') })
				worker.onerror = (event) => {
					event.preventDefault()
					fail()
				}
				worker.onmessageerror = fail
				worker.onmessage = (event: MessageEvent<unknown>) => {
					if (settled) return
					try {
						const reply = providerReplySchema.safeParse(event.data)
						if (!reply.success) {
							fail()
							return
						}
						if (!reply.data.ok) {
							trace.log(`provider.worker.${reply.data.stage}.failed`, {
								...(reply.data.status !== undefined ? { status: reply.data.status } : {})
							})
							fail()
							return
						}
						trace.log('provider.worker.response', {
							count: reply.data.response.accounts.length,
							providerErrors: reply.data.response.errors.length
						})
						finish(reply.data)
					} catch {
						fail()
					}
				}
				lifetime.addEventListener('abort', abort, { once: true })
				try {
					worker.postMessage({
						endpoint: new URL('/api/simplefin', window.location.origin).href,
						accessUrl,
						discovery,
						traceId: trace.id
					} satisfies ProviderRequest)
				} catch {
					fail()
				}
			})
	)
}
