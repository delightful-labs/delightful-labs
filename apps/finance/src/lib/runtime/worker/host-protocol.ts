import { z } from 'zod'

export const HOST_PROTOCOL_VERSION = 1
export const MAX_ACCOUNT_STORE_LENGTH = 1024 * 1024
export const MAX_STORAGE_SLOTS = 4096
export const MAX_EARLIER_STORES = 128
export const MAX_ACCOUNT_SNAPSHOT_LENGTH = 2 * 1024 * 1024
export const MAX_HOST_REQUESTS = 8
export const MAX_HOST_BROKERS = 32
export const HOST_REQUEST_TIMEOUT_MS = 10_000

const correlation = z.object({
	version: z.literal(HOST_PROTOCOL_VERSION),
	scope: z.string().uuid(),
	requestId: z.string().uuid(),
	sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
})
const storageKey = z.string().min(1).max(65_536)
export const generationSchema = z
	.string()
	.regex(/^\d{1,16}$/)
	.refine((value) => Number.isSafeInteger(Number(value)))
const accountValue = z.string().max(MAX_ACCOUNT_STORE_LENGTH)
export const accountSnapshotSchema = z
	.object({
		current: accountValue.nullable(),
		earlier: z
			.array(z.object({ key: storageKey, value: accountValue.nullable() }).strict())
			.max(MAX_EARLIER_STORES)
	})
	.strict()
	.refine(
		(snapshot) =>
			(snapshot.current?.length ?? 0) +
				snapshot.earlier.reduce(
					(size, entry) => size + entry.key.length + (entry.value?.length ?? 0),
					0
				) <=
			MAX_ACCOUNT_SNAPSHOT_LENGTH
	)

export const hostRequestSchema = z.discriminatedUnion('type', [
	correlation.extend({ type: z.literal('READ_ACCOUNT') }).strict(),
	correlation.extend({ type: z.literal('READ_ACCOUNT_SNAPSHOT') }).strict(),
	correlation.extend({ type: z.literal('READ_EARLIER'), key: storageKey }).strict(),
	correlation
		.extend({ type: z.literal('WRITE_EARLIER'), key: storageKey, value: accountValue })
		.strict(),
	correlation.extend({ type: z.literal('WRITE_ACCOUNT'), value: accountValue }).strict(),
	correlation
		.extend({
			type: z.literal('OPEN_BROKER'),
			url: z.string().url().max(8192),
			name: z.string().min(1).max(65_536)
		})
		.strict(),
	correlation.extend({ type: z.literal('READ_GENERATION'), key: storageKey }).strict(),
	correlation
		.extend({ type: z.literal('WRITE_GENERATION'), key: storageKey, value: generationSchema })
		.strict()
])

const messagePort = z.custom<MessagePort>(
	(value) => typeof MessagePort !== 'undefined' && value instanceof MessagePort
)
export const hostReplySchema = z.discriminatedUnion('type', [
	correlation.extend({ type: z.literal('ACCOUNT'), value: accountValue.nullable() }).strict(),
	correlation.extend({ type: z.literal('SNAPSHOT'), snapshot: accountSnapshotSchema }).strict(),
	correlation
		.extend({ type: z.literal('GENERATION'), value: z.string().max(65_536).nullable() })
		.strict(),
	correlation.extend({ type: z.literal('BROKER'), port: messagePort }).strict(),
	correlation.extend({ type: z.literal('WRITTEN') }).strict(),
	correlation
		.extend({ type: z.literal('FAILED'), reason: z.enum(['rejected', 'unavailable']) })
		.strict()
])
export const hostFailureSchema = z
	.object({
		version: z.literal(HOST_PROTOCOL_VERSION),
		scope: z.string().uuid(),
		type: z.literal('HOST_FAILED')
	})
	.strict()
export const hostScopeSchema = correlation.shape.scope
export type HostRequest = z.infer<typeof hostRequestSchema>
export type HostReply = z.infer<typeof hostReplySchema>
type CommandPayload<Request> = Request extends HostRequest
	? Omit<Request, keyof z.infer<typeof correlation>>
	: never
export type HostCommand = CommandPayload<HostRequest>

export type HostFailureReason =
	'closed' | 'timeout' | 'unavailable' | 'rejected' | 'invalid-reply' | 'overloaded'
/** An issued write with no acknowledgement remains uncertain. Callers must not
 * retry it automatically or interpret a transport close as rollback. */
export class WorkerHostError extends Error {
	constructor(
		readonly reason: HostFailureReason,
		readonly writeOutcome: 'not-issued' | 'unknown'
	) {
		super('Finance worker host unavailable')
		this.name = 'WorkerHostError'
	}
}
