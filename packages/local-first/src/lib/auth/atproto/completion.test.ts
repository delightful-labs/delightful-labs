import { afterEach, expect, it, vi } from 'vitest'
import { createCompletionProtocol } from './completion.js'

const origin = 'https://finance.example.invalid'
const secret = 'test-secret-at-least-thirty-two-characters'
const attemptId = crypto.randomUUID()
const finance = createCompletionProtocol({
	cookieName: 'finance.oauth-completion',
	callbackRoute: '/login'
})
const clipper = createCompletionProtocol({
	cookieName: 'clipper.oauth-completion',
	callbackRoute: '/'
})
const request = (cookie: string) => new Request(origin, { headers: { cookie } })
afterEach(() => vi.useRealTimers())

it('keeps app completion cookies separate even when an origin and secret are shared', () => {
	const cookie = finance.completionCookie(attemptId, 'finance-user', secret, true)
	expect(finance.readCompletion(request(cookie), secret)).toMatchObject({
		attemptId,
		userId: 'finance-user'
	})
	expect(clipper.readCompletion(request(cookie), secret)).toBeUndefined()
})

it('only accepts a successful callback to the configured same-origin route', () => {
	const location = finance.callbackPath(attemptId)
	expect(location).toBe('/login?atproto_attempt=' + attemptId)
	expect(
		finance.completedAttempt(new Response(null, { status: 302, headers: { location } }), origin)
	).toBe(attemptId)
	for (const rejected of [
		new Response(null, { status: 400, headers: { location } }),
		new Response(null, {
			status: 302,
			headers: { location: origin + '/?atproto_attempt=' + attemptId }
		}),
		new Response(null, { status: 302, headers: { location: 'https://other.invalid' + location } })
	])
		expect(finance.completedAttempt(rejected, origin)).toBeUndefined()
})

it('rejects changed signatures and expired receipts', () => {
	const cookie = finance.completionCookie(attemptId, 'finance-user', secret, true).split(';')[0]!
	expect(finance.readCompletion(request(cookie + 'forged'), secret)).toBeUndefined()
	expect(finance.readCompletion(request(cookie), 'another-secret')).toBeUndefined()
	vi.useFakeTimers()
	vi.setSystemTime(Date.now() + 600_001)
	expect(finance.readCompletion(request(cookie), secret)).toBeUndefined()
})

it.each(['//external.invalid/login', '/login?next=other', '/login#hash', '/a/../login'])(
	'refuses an ambiguous or nonlocal configured callback route: %s',
	(callbackRoute) => {
		expect(() =>
			createCompletionProtocol({ cookieName: 'finance.completion', callbackRoute })
		).toThrow()
	}
)

it('refuses invalid cookie names and clears the configured cookie at its original path', () => {
	expect(() =>
		createCompletionProtocol({ cookieName: 'invalid; Secure', callbackRoute: '/' })
	).toThrow()
	expect(finance.clearCompletionCookie).toBe(
		'finance.oauth-completion=; HttpOnly; SameSite=Lax; Path=/api/auth; Max-Age=0'
	)
})
