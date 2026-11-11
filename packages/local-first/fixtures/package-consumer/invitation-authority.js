// Server-only public entry: no backend is created when constructing the adapter.
import { createJazzInvitationAuthority } from 'delightful-local-first/backend/jazz/invitation-authority'
let calls = 0
function callCount() {
	return calls
}
/** @type {Parameters<Parameters<typeof createJazzInvitationAuthority>[1]>[]} */
const detached = []
const authority = createJazzInvitationAuthority(
	{
		forReqUser: async () => {
			calls++
			const error = new Error('synthetic-private-credential')
			error.name = 'RequestAuthenticationError'
			throw error
		}
	},
	(accountId, custody) => {
		detached.push([accountId, custody])
	}
)
if (callCount() !== 0) throw new Error('Packaged authority eagerly admitted a request')
const result = await authority.admit(
	new Request('https://example.test/redeem', {
		headers: { authorization: 'Bearer synthetic-private-credential' }
	})
)
if (
	result.outcome !== 'unauthenticated' ||
	callCount() !== 1 ||
	JSON.stringify(result).includes('synthetic-private')
)
	throw new Error('Packaged authority lost sanitized authentication failure')
