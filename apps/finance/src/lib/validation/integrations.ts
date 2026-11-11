import { z } from 'zod'

const encoded = z
	.string()
	.min(1)
	.max(32768)
	.regex(/^[A-Za-z0-9_-]+$/)
export const credentialEnvelopeSchema = z.strictObject({
	version: z.literal(1),
	ownerId: z.uuid(),
	organizationId: z.uuid(),
	connectionId: z.uuid(),
	credentialId: encoded,
	prfSalt: encoded,
	iv: encoded,
	ciphertext: encoded
})
export type CredentialEnvelope = z.output<typeof credentialEnvelopeSchema>
export type CredentialScope = Pick<
	CredentialEnvelope,
	'ownerId' | 'organizationId' | 'connectionId'
>

export const providerAccountSchema = z.object({
	id: z.string().min(1).max(256),
	name: z.string().min(1).max(256),
	currency: z.string(),
	balance: z
		.string()
		.regex(/^-?(?:0|[1-9]\d*)(?:\.\d{1,2})?$/)
		.optional(),
	'available-balance': z
		.string()
		.regex(/^-?(?:0|[1-9]\d*)(?:\.\d{1,2})?$/)
		.optional(),
	'balance-date': z.number().int().nonnegative().optional(),
	org: z.object({
		'sfin-url': z.url(),
		domain: z.string().optional(),
		id: z.string().optional()
	}),
	transactions: z.array(z.unknown()).optional()
})
export const providerResponseSchema = z.object({
	errors: z.array(z.string()),
	accounts: z.array(providerAccountSchema)
})
export const providerReplySchema = z.discriminatedUnion('ok', [
	z.object({ ok: z.literal(true), response: providerResponseSchema }),
	z.object({
		ok: z.literal(false),
		stage: z.enum(['request', 'http', 'decode', 'validation']),
		status: z.number().int().min(0).max(599).optional()
	})
])
export type ProviderReply = z.output<typeof providerReplySchema>
export type ProviderAccount = z.output<typeof providerAccountSchema>
export const providerTransactionSchema = z.object({
	id: z.string().min(1).max(256),
	amount: z.string().regex(/^-?\d+(?:\.\d{1,2})?$/),
	posted: z.number().int().positive(),
	description: z.string(),
	pending: z.boolean().optional()
})
