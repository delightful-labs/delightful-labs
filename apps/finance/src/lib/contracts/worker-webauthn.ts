import { z } from 'zod'
/** The browser validates the native WebAuthn options; they originate in our credential workflow. */
export const financeWebAuthnRequest = z.discriminatedUnion('operation', [
	z.strictObject({
		type: z.literal('WEBAUTHN'),
		operation: z.literal('create'),
		publicKey: z.custom<PublicKeyCredentialCreationOptions>(
			(value) => typeof value === 'object' && value !== null
		)
	}),
	z.strictObject({
		type: z.literal('WEBAUTHN'),
		operation: z.literal('get'),
		publicKey: z.custom<PublicKeyCredentialRequestOptions>(
			(value) => typeof value === 'object' && value !== null
		)
	})
])
export const financeWebAuthnResult = z.discriminatedUnion('ok', [
	z.strictObject({
		ok: z.literal(true),
		rawId: z.instanceof(ArrayBuffer),
		prfEnabled: z.boolean(),
		prfFirst: z.instanceof(ArrayBuffer).nullable()
	}),
	z.strictObject({ ok: z.literal(false) })
])
export type WebAuthnMaterial = z.output<typeof financeWebAuthnResult> & { ok: true }
export type WebAuthnRequest = z.output<typeof financeWebAuthnRequest>
