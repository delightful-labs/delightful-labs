import { describe, expect, it, vi } from 'vitest'
import { generateAuthSecret } from 'jazz-tools'
import type { JazzSession, JazzSessionSnapshot, JazzUser } from 'jazz-tools/client'
import { RecoveryPhrase } from 'jazz-tools/passphrase'
import { createJazzRecoveryAdapter } from './recovery-phrase.js'
import type { RecoveryScope, AvailableRecoveryScope } from '../../contracts/recovery-phrase.js'
function available(scope: RecoveryScope): AvailableRecoveryScope {
	if (scope.kind !== 'available') throw new Error('Expected available fixture scope')
	return scope
}
function fixture() {
	const key = generateAuthSecret()
	const user = (accountId: string = crypto.randomUUID()): JazzUser => ({
		accountId,
		kind: 'device',
		identity: { issuer: 'device', subject: accountId },
		claims: {}
	})
	let snapshot: JazzSessionSnapshot<unknown> = { status: 'ready', user: user(), localFirst: true }
	const session = { getSnapshot: () => snapshot, exportDeviceKey: vi.fn(() => key) } satisfies Pick<
		JazzSession<unknown>,
		'getSnapshot' | 'exportDeviceKey'
	>
	let current: typeof session | undefined = session
	const adapter = createJazzRecoveryAdapter(() => current)
	return {
		key,
		session,
		adapter,
		user,
		observe: (next: JazzSessionSnapshot<unknown>) => {
			snapshot = next
			return adapter.observeSession()
		},
		replace: () => {
			current = { ...session }
		},
		clear: () => {
			current = undefined
		}
	}
}
// Credentials are compared only as booleans so a failed assertion cannot print them.
async function rejectsStaleRead(
	adapter: ReturnType<typeof createJazzRecoveryAdapter>,
	scope: AvailableRecoveryScope
) {
	return adapter.capability.readPhrase(scope).then(
		() => false,
		(error: unknown) => error instanceof Error && error.message === 'Recovery scope unavailable'
	)
}
describe('Jazz recovery session boundary', () => {
	it('exports through the host session and keeps the stable observation', async () => {
		const f = fixture(),
			scope = available(f.adapter.observeSession())
		expect(f.session.exportDeviceKey).not.toHaveBeenCalled()
		const phrase = await f.adapter.capability.readPhrase(scope)
		expect(RecoveryPhrase.toSecret(phrase) === f.key).toBe(true)
		expect(f.session.exportDeviceKey).toHaveBeenCalledOnce()
		expect(f.adapter.observeSession()).toBe(scope)
	})
	it('advances generation for a replacement native user with the same identity', async () => {
		const f = fixture(),
			first = available(f.adapter.observeSession())
		const second = available(
			f.observe({ status: 'ready', user: f.user(first.identityId), localFirst: true })
		)
		expect(second.identityId).toBe(first.identityId)
		expect(second.generation).toBeGreaterThan(first.generation)
		expect(await rejectsStaleRead(f.adapter, first)).toBe(true)
		expect(f.adapter.capability.isCurrentScope(second)).toBe(true)
	})
	it('rejects old A after A to B to A', async () => {
		const f = fixture(),
			first = available(f.adapter.observeSession())
		const second = available(f.observe({ status: 'ready', user: f.user(), localFirst: true }))
		const restored = available(
			f.observe({ status: 'ready', user: f.user(first.identityId), localFirst: true })
		)
		expect(restored.generation).toBeGreaterThan(second.generation)
		expect(await rejectsStaleRead(f.adapter, first)).toBe(true)
		expect(await rejectsStaleRead(f.adapter, second)).toBe(true)
		expect(f.adapter.capability.isCurrentScope(restored)).toBe(true)
	})
	it('rejects a replaced host session before another observation', async () => {
		const f = fixture(),
			scope = available(f.adapter.observeSession())
		f.replace()
		expect(await rejectsStaleRead(f.adapter, scope)).toBe(true)
		expect(f.session.exportDeviceKey).not.toHaveBeenCalled()
	})
	it('invalidates without changing the host and admits a new generation', async () => {
		const f = fixture(),
			first = available(f.adapter.observeSession())
		expect(f.adapter.invalidate()).toEqual({ kind: 'unavailable' })
		expect(await rejectsStaleRead(f.adapter, first)).toBe(true)
		const second = available(f.adapter.observeSession())
		expect(second.generation).toBeGreaterThan(first.generation)
		expect(f.session.exportDeviceKey).not.toHaveBeenCalled()
	})
	it('rejects another adapter token for the same session', async () => {
		const f = fixture(),
			other = createJazzRecoveryAdapter(() => f.session)
		const scope = available(f.adapter.observeSession())
		other.observeSession()
		expect(await rejectsStaleRead(other, scope)).toBe(true)
	})
	it('fails closed when the host getter throws', async () => {
		const f = fixture()
		let broken = false
		const adapter = createJazzRecoveryAdapter(() => {
			if (broken) throw new Error('Synthetic getter failure')
			return f.session
		})
		const scope = available(adapter.observeSession())
		broken = true
		expect(await rejectsStaleRead(adapter, scope)).toBe(true)
	})
	it('propagates a failed native export without another operation', async () => {
		const f = fixture(),
			scope = available(f.adapter.observeSession())
		f.session.exportDeviceKey.mockImplementationOnce(() => {
			throw new Error('Synthetic native export failure')
		})
		expect(
			await f.adapter.capability.readPhrase(scope).then(
				() => false,
				() => true
			)
		).toBe(true)
		expect(f.session.exportDeviceKey).toHaveBeenCalledOnce()
	})
	it('keeps absent, signed-out, and backend users unavailable', () => {
		const f = fixture()
		f.clear()
		expect(f.adapter.observeSession()).toEqual({ kind: 'unavailable' })
		const other = fixture()
		expect(other.observe({ status: 'signed-out', user: null, localFirst: false })).toEqual({
			kind: 'unavailable'
		})
		expect(
			other.observe({
				status: 'ready',
				user: { ...other.user(), kind: 'backend' },
				localFirst: true
			})
		).toEqual({ kind: 'unavailable' })
		expect(other.session.exportDeviceKey).not.toHaveBeenCalled()
	})
})
