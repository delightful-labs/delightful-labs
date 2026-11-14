import { z } from 'zod'

/** Private shared wire schemas. Public native exports expose plain contracts. */
export const WORKER_HOST_PROTOCOL_VERSION = 1
export const hostScopeSchema = z.string().uuid()
export const hostIdentitySchema = z.object({ scope: hostScopeSchema, requestId: z.string().uuid() })
export const hostEnvelopeSchema = hostIdentitySchema.extend({
	version: z.literal(WORKER_HOST_PROTOCOL_VERSION)
})
