import {
	providerRequestMachine,
	type ProviderRequest
} from '#lib/machines/bank-sync/provider-request.js'
import { createActor } from 'xstate'

// One request per worker. Termination is the resource boundary for HTTP, secrets and payloads.
self.onmessage = (event: MessageEvent<ProviderRequest>) => {
	self.onmessage = null
	const actor = createActor(providerRequestMachine, { input: event.data })
	actor.subscribe({
		complete: () => self.postMessage(actor.getSnapshot().output),
		error: () => self.postMessage({ ok: false, stage: 'request' })
	})
	actor.start()
}
