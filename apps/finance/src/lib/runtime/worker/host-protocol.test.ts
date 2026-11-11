import { expect, it } from 'vitest'
import {
	HOST_PROTOCOL_VERSION,
	MAX_ACCOUNT_STORE_LENGTH,
	hostRequestSchema
} from './host-protocol.js'

const correlation = {
	version: HOST_PROTOCOL_VERSION,
	scope: '11111111-1111-4111-8111-111111111111',
	requestId: '22222222-2222-4222-8222-222222222222',
	sequence: 1
}
it.each([
	{ ...correlation, version: 2, type: 'READ_ACCOUNT' },
	{ ...correlation, scope: 'old-binding', type: 'READ_ACCOUNT' },
	{ ...correlation, sequence: 0, type: 'READ_ACCOUNT' },
	{ ...correlation, sequence: Number.MAX_SAFE_INTEGER + 1, type: 'READ_ACCOUNT' },
	{ ...correlation, type: 'READ_ACCOUNT', key: 'other-account' },
	{ ...correlation, type: 'WRITE_ACCOUNT', value: 'x'.repeat(MAX_ACCOUNT_STORE_LENGTH + 1) },
	{ ...correlation, type: 'WRITE_GENERATION', key: 'generation', value: '-1' },
	{ ...correlation, type: 'WRITE_GENERATION', key: 'generation', value: '9007199254740992' }
])('rejects invalid or oversized native commands %#', (message) => {
	expect(hostRequestSchema.safeParse(message).success).toBe(false)
})
