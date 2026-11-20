import assert from 'node:assert/strict'
import { test } from 'node:test'

test('built Finance auth serves identity-only metadata behind a forwarding proxy', async () => {
	const origin = 'https://finance-build.example.invalid'
	process.env.NODE_ENV = 'production'
	process.env.AUTH_BASE_URL = origin
	process.env.AUTH_SECRET = 'disposable-build-fixture-secret-at-least-thirty-two'
	process.env.FINANCE_EPHEMERAL_JAZZ = 'true'
	const { GET } =
		await import('../.svelte-kit/output/server/entries/endpoints/api/auth/_...all_/_server.ts.js')
	const response = await GET({
		request: new Request(origin + '/api/auth/oauth-client-metadata.json', {
			headers: { 'x-forwarded-for': '192.0.2.1' }
		})
	})
	assert.equal(response.status, 200)
	const metadata = await response.json()
	assert.equal(metadata.client_id, origin + '/api/auth/oauth-client-metadata.json')
	assert.equal(metadata.client_name, 'Delightful Finance')
	assert.equal(metadata.scope, 'atproto')
	assert.deepEqual(metadata.redirect_uris, [origin + '/api/auth/atproto/callback'])
})
