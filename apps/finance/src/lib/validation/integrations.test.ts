import { expect, it } from 'vitest'
import {
	credentialEnvelopeSchema,
	providerTransactionSchema,
	providerResponseSchema
} from './integrations.js'

const envelope = {
	version: 1,
	ownerId: '00000000-0000-4000-8000-000000000001',
	organizationId: '00000000-0000-4000-8000-000000000002',
	connectionId: '00000000-0000-4000-8000-000000000003',
	credentialId: 'AQID',
	prfSalt: 'AQID',
	iv: 'AQID',
	ciphertext: 'AQID'
}
it('accepts only versioned ciphertext metadata with UUID scope and no plaintext fields', () => {
	expect(credentialEnvelopeSchema.safeParse(envelope).success).toBe(true)
	expect(credentialEnvelopeSchema.safeParse({ ...envelope, accessUrl: 'plaintext' }).success).toBe(
		false
	)
	expect(credentialEnvelopeSchema.safeParse({ ...envelope, version: 2 }).success).toBe(false)
	expect(credentialEnvelopeSchema.safeParse({ ...envelope, ownerId: 'invalid' }).success).toBe(
		false
	)
	expect(credentialEnvelopeSchema.safeParse({ ...envelope, ciphertext: '' }).success).toBe(false)
})
it.each(['12', '-12.34', '0.01'])('accepts exact decimal amount %s', (amount) => {
	expect(
		providerTransactionSchema.safeParse({ id: 'id', amount, posted: 1792000000, description: '' })
			.success
	).toBe(true)
})
it.each(['1.234', '1e3', 'NaN', '+10.00', '1,000.00'])('rejects ambiguous amount %s', (amount) => {
	expect(
		providerTransactionSchema.safeParse({ id: 'id', amount, posted: 1792000000, description: '' })
			.success
	).toBe(false)
})
it('retains malformed transaction rows for individual omission instead of discarding the entire account', () => {
	const result = providerResponseSchema.parse({
		errors: ['Partial provider failure'],
		accounts: [
			{
				id: 'account',
				name: 'Checking',
				currency: 'USD',
				org: { 'sfin-url': 'https://bank.example' },
				transactions: [null, { amount: 'bad' }]
			}
		]
	})
	expect(result.accounts[0]?.transactions).toHaveLength(2)
	expect(result.errors).toEqual(['Partial provider failure'])
})
