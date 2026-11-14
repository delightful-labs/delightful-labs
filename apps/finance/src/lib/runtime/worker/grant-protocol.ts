import { z } from 'zod'
import { financeGrantDescriptorSchema, financeGrantScopeSchema } from './grant-binding.js'

/** Private runtime capability transport, separate from render messages and the
 * shared broker's per-operation protocol. */
export const FINANCE_GRANT_PROTOCOL_VERSION = 1
export const MAX_FINANCE_GRANTS = 32
export const MAX_FINANCE_GRANT_CALLS = 8
export const MAX_FINANCE_GRANT_PENDING_BYTES = 1_048_576

const identity = z
	.object({
		runtimeId: financeGrantScopeSchema,
		grantId: financeGrantScopeSchema,
		acquisitionId: financeGrantScopeSchema
	})
	.strict()
const envelope = identity.extend({ version: z.literal(FINANCE_GRANT_PROTOCOL_VERSION) })
const request = envelope
	.extend({ type: z.literal('ACQUIRE_GRANT'), descriptor: financeGrantDescriptorSchema })
	.strict()
const granted = envelope
	.extend({
		type: z.literal('GRANT_READY'),
		dataPort: z.instanceof(MessagePort),
		controlPort: z.instanceof(MessagePort)
	})
	.strict()
const refused = envelope
	.extend({
		type: z.literal('GRANT_REFUSED'),
		reason: z.enum(['rejected', 'overloaded', 'unavailable'])
	})
	.strict()
const uncertain = envelope
	.extend({ type: z.literal('GRANT_UNCERTAIN'), reason: z.literal('unavailable') })
	.strict()
const reply = z.discriminatedUnion('type', [granted, refused, uncertain])

export type FinanceGrantIdentity = z.infer<typeof identity>
export type FinanceGrantRequest = z.infer<typeof request>
export type FinanceGrantReply = z.infer<typeof reply>
type Decoded<Message> = { kind: 'valid'; message: Message } | { kind: 'invalid' }

/** Shape/transfer validation only. The owning chart selects scope admission,
 * acquisition state and disposition; native adapters close rejected transfers. */
export function decodeFinanceGrantRequest(
	value: unknown,
	ports: readonly MessagePort[]
): Decoded<FinanceGrantRequest> {
	const decoded = request.safeParse(value)
	return decoded.success && ports.length === 0
		? { kind: 'valid', message: decoded.data }
		: { kind: 'invalid' }
}

/** GRANT_READY must carry exactly its two distinct declared ports in order.
 * Validation neither takes custody nor closes resources. In particular, a late
 * valid grant still belongs to the original acquisition's cleanup owner. */
export function decodeFinanceGrantReply(
	value: unknown,
	ports: readonly MessagePort[]
): Decoded<FinanceGrantReply> {
	const decoded = reply.safeParse(value)
	if (!decoded.success) return { kind: 'invalid' }
	const message = decoded.data
	if (message.type !== 'GRANT_READY')
		return ports.length === 0 ? { kind: 'valid', message } : { kind: 'invalid' }
	if (
		ports.length !== 2 ||
		message.dataPort === message.controlPort ||
		ports[0] !== message.dataPort ||
		ports[1] !== message.controlPort
	)
		return { kind: 'invalid' }
	return { kind: 'valid', message }
}

export function sameFinanceGrantIdentity(left: FinanceGrantIdentity, right: FinanceGrantIdentity) {
	return (
		left.runtimeId === right.runtimeId &&
		left.grantId === right.grantId &&
		left.acquisitionId === right.acquisitionId
	)
}
