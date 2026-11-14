import { z } from 'zod'
import { WORKER_HOST_PROTOCOL_VERSION } from 'delightful-local-first/worker/host-close'

/** Broker/storage payloads compose schemas from Clipper's own Zod version.
 * Native close validation lives only in Local First's adapter. */
export const hostScopeSchema = z.string().uuid()
export const hostIdentitySchema = z.object({ scope: hostScopeSchema, requestId: z.string().uuid() })
export const hostEnvelopeSchema = hostIdentitySchema.extend({
	version: z.literal(WORKER_HOST_PROTOCOL_VERSION)
})

export {
	WORKER_HOST_PROTOCOL_VERSION,
	serveHostClose,
	workerHostControl
} from 'delightful-local-first/worker/host-close'
export type { HostCloseIdentity, HostControlReport } from 'delightful-local-first/worker/host-close'
