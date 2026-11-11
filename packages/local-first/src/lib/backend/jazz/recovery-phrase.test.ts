import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAccountManager, exportLocalFirstSecret, type AccountHandle } from 'jazz-tools'
import { RecoveryPhrase } from 'jazz-tools/passphrase'
import type { AvailableRecoveryScope, RecoveryScope } from '../../contracts/recovery-phrase.js'
import { createJazzRecoveryAdapter } from './recovery-phrase.js'

const managers: Awaited<ReturnType<typeof createAccountManager>>[] = []

async function hostAccount() {
	let stored: string | null = null
	const manager = await createAccountManager({
		appId: 'recovery-adapter-unit',
		serverUrl: 'http://127.0.0.1:9',
		store: {
			read: async () => stored,
			update: async (transform) => {
				stored = transform(stored)
			}
		}
	})
	managers.push(manager)
	const account = manager.createLocalFirst()
	return { manager, account }
}

function available(scope: RecoveryScope): AvailableRecoveryScope {
	if (scope.kind !== 'available') throw new Error('Expected an available test scope')
	return scope
}

// Boolean assertions avoid printing SDK-generated credentials even on a regression.
async function rejectsStaleRead(
	adapter: ReturnType<typeof createJazzRecoveryAdapter>,
	scope: AvailableRecoveryScope
): Promise<boolean> {
	try {
		await adapter.capability.readPhrase(scope)
		return false
	} catch (error) {
		return error instanceof Error && error.message === 'Recovery scope unavailable'
	}
}

beforeEach(() => {
	vi.stubGlobal(
		'fetch',
		vi.fn<typeof fetch>(async () => {
			throw new Error('Adapter unit tests must not contact a service')
		})
	)
})

afterEach(() => {
	for (const manager of managers.splice(0)) manager.logout()
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
})

describe('Jazz recovery adapter', () => {
	it('exports a host-issued handle locally without changing host selection', async () => {
		const { manager, account } = await hostAccount()
		const logout = vi.spyOn(manager, 'logout')
		const adapter = createJazzRecoveryAdapter(() => manager.getLoggedIn())
		const scope = available(adapter.observeAccount(account))
		const phrase = await adapter.capability.readPhrase(scope)
		expect(RecoveryPhrase.toSecret(phrase) === exportLocalFirstSecret(account)).toBe(true)
		expect(manager.getLoggedIn() === account).toBe(true)
		expect(logout).not.toHaveBeenCalled()
		expect(fetch).not.toHaveBeenCalled()
		expect(scope.binding === account).toBe(false)
		expect(adapter.observeAccount(account)).toBe(scope)
	})

	it('advances generation for a replacement handle with the same identity', async () => {
		const { manager, account } = await hostAccount()
		const adapter = createJazzRecoveryAdapter(() => manager.getLoggedIn())
		const first = available(adapter.observeAccount(account))
		const replacement = manager.restoreLocalFirst(exportLocalFirstSecret(account))
		const second = available(adapter.observeAccount(replacement))
		expect(replacement === account).toBe(false)
		expect(second.identityId === first.identityId).toBe(true)
		expect(second.generation).toBeGreaterThan(first.generation)
		expect(adapter.capability.isCurrentScope(first)).toBe(false)
		expect(adapter.capability.isCurrentScope(second)).toBe(true)
		expect(await rejectsStaleRead(adapter, first)).toBe(true)
	})

	it('rejects the original scope after observed A → B → A', async () => {
		const { manager, account } = await hostAccount()
		const secret = exportLocalFirstSecret(account)
		const adapter = createJazzRecoveryAdapter(() => manager.getLoggedIn())
		const first = available(adapter.observeAccount(account))
		const second = available(adapter.observeAccount(manager.createLocalFirst()))
		const restored = available(adapter.observeAccount(manager.restoreLocalFirst(secret)))
		expect(restored.identityId === first.identityId).toBe(true)
		expect(restored.generation).toBeGreaterThan(second.generation)
		expect(adapter.capability.isCurrentScope(first)).toBe(false)
		expect(adapter.capability.isCurrentScope(second)).toBe(false)
		expect(adapter.capability.isCurrentScope(restored)).toBe(true)
		expect(await rejectsStaleRead(adapter, first)).toBe(true)
	})

	it('rejects a changed live handle before its observation has arrived', async () => {
		const { manager, account } = await hostAccount()
		const adapter = createJazzRecoveryAdapter(() => manager.getLoggedIn())
		const first = available(adapter.observeAccount(account))
		manager.createLocalFirst()
		expect(adapter.capability.isCurrentScope(first)).toBe(false)
		expect(await rejectsStaleRead(adapter, first)).toBe(true)
	})

	it('invalidates its own observation without logging the host out', async () => {
		const { manager, account } = await hostAccount()
		const adapter = createJazzRecoveryAdapter(() => manager.getLoggedIn())
		const first = available(adapter.observeAccount(account))
		expect(adapter.invalidate()).toEqual({ kind: 'unavailable' })
		expect(manager.getLoggedIn() === account).toBe(true)
		expect(await rejectsStaleRead(adapter, first)).toBe(true)
		const second = available(adapter.observeAccount(account))
		expect(second.generation).toBeGreaterThan(first.generation)
		expect(adapter.capability.isCurrentScope(second)).toBe(true)
	})

	it('does not accept a different adapter token for the same account', async () => {
		const { account } = await hostAccount()
		const first = createJazzRecoveryAdapter(() => account)
		const second = createJazzRecoveryAdapter(() => account)
		const scope = available(first.observeAccount(account))
		second.observeAccount(account)
		expect(second.capability.isCurrentScope(scope)).toBe(false)
		expect(await rejectsStaleRead(second, scope)).toBe(true)
	})

	it('fails closed when the host getter throws', async () => {
		const { account } = await hostAccount()
		let broken = false
		const adapter = createJazzRecoveryAdapter(() => {
			if (broken) throw new Error('Synthetic host getter failure')
			return account
		})
		const scope = available(adapter.observeAccount(account))
		broken = true
		expect(adapter.capability.isCurrentScope(scope)).toBe(false)
		expect(await rejectsStaleRead(adapter, scope)).toBe(true)
	})

	it('reports local export failure when the SDK no longer retains the handle root', async () => {
		const { manager, account } = await hostAccount()
		const adapter = createJazzRecoveryAdapter(() => account)
		const scope = available(adapter.observeAccount(account))
		manager.logout()
		const failed = await adapter.capability.readPhrase(scope).then(
			() => false,
			(error: unknown) =>
				error instanceof Error && error.message === 'local_first_recovery_unavailable'
		)
		expect(failed).toBe(true)
	})

	it('keeps absent and SDK-issued external identities unavailable', async () => {
		const { manager } = await hostAccount()
		const identity = { issuer: 'https://identity.example.test', subject: 'external-fixture' }
		const payload = Buffer.from(
			JSON.stringify({ iss: identity.issuer, sub: identity.subject })
		).toString('base64url')
		const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
		vi.mocked(fetch).mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					account: '11111111-1111-4111-8111-111111111111',
					identity
				}),
				{ headers: { 'Content-Type': 'application/json' } }
			)
		)
		const external: AccountHandle = await manager.loginJWT(`${header}.${payload}.fixture-signature`)
		const adapter = createJazzRecoveryAdapter(() => manager.getLoggedIn())
		expect(adapter.observeAccount(undefined)).toEqual({ kind: 'unavailable' })
		expect(adapter.observeAccount(external)).toEqual({ kind: 'unavailable' })
		expect(fetch).toHaveBeenCalledTimes(1)
	})
})
