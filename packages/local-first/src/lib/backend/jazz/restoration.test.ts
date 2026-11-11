import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAccountManager, exportLocalFirstSecret } from 'jazz-tools'
import { RecoveryPhrase } from 'jazz-tools/passphrase'
import type { JazzSession, JazzSessionSnapshot } from 'jazz-tools/svelte'
import { createJazzRestorationAdapter } from './restoration.js'

function deferred<Value>() {
	let resolve = (_value: Value): void => {
		throw new Error('Deferred result not initialized')
	}
	let reject = (_error: Error): void => {
		throw new Error('Deferred result not initialized')
	}
	const promise = new Promise<Value>((done, fail) => {
		resolve = done
		reject = fail
	})
	return { promise, resolve, reject }
}

const managers: Awaited<ReturnType<typeof createAccountManager>>[] = []

// A typed host-session double isolates this adapter from database/client lifecycle. Phrase parsing
// uses the real SDK. The later Finance adoption qualifies the real session and its drain protocol.
async function fixture() {
	let stored: string | null = null
	const manager = await createAccountManager({
		appId: 'restoration-adapter-unit',
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
	let snapshot: JazzSessionSnapshot<unknown> = { status: 'ready', account }
	const unused = vi.fn(async () => {
		throw new Error('Unexpected host lifecycle operation')
	})
	const restore = vi.fn(async (_credential: string) => {})
	const session: JazzSession<unknown> = {
		getSnapshot: () => snapshot,
		subscribe: vi.fn(() => () => {}),
		restoreLocalFirst: restore,
		createLocalFirst: unused,
		becomeBackend: unused,
		registerJWT: unused,
		loginJWT: unused,
		loginOrRegisterJWT: unused,
		linkJWT: unused,
		logout: unused,
		retry: unused,
		close: unused
	}
	let current: JazzSession<unknown> | undefined = session
	const adapter = createJazzRestorationAdapter(session, () => current)
	return {
		manager,
		account,
		session,
		restore,
		unused,
		adapter,
		scope: { binding: adapter.binding, attempt: 3 },
		replace: () => {
			current = undefined
		},
		observe: (next: JazzSessionSnapshot<unknown>) => {
			snapshot = next
		}
	}
}

beforeEach(() => {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => {
			throw new Error('No service access in adapter tests')
		})
	)
})
afterEach(() => {
	for (const manager of managers.splice(0)) manager.logout()
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
})

describe('Jazz restoration leaf adapter', () => {
	it('parses a real SDK phrase and calls only the supplied host restore', async () => {
		const f = await fixture()
		const root = exportLocalFirstSecret(f.account)
		const parsed = await f.adapter.capability.parsePhrase(RecoveryPhrase.fromSecret(root))
		expect(parsed === root).toBe(true)
		await f.adapter.capability.restoreIdentity(f.scope, parsed)
		expect(f.restore.mock.calls.length === 1 && f.restore.mock.calls[0]?.[0] === root).toBe(true)
		expect(await f.adapter.capability.readIdentity(f.scope)).toEqual({
			kind: 'ready',
			identityId: f.account.id
		})
		expect(f.unused).not.toHaveBeenCalled()
		expect(f.session.subscribe).not.toHaveBeenCalled()
		expect(fetch).not.toHaveBeenCalled()
	})

	it('rejects malformed phrases without a host operation', async () => {
		const f = await fixture()
		const rejected = await f.adapter.capability.parsePhrase('invalid').then(
			() => false,
			() => true
		)
		expect(rejected).toBe(true)
		expect(f.restore).not.toHaveBeenCalled()
	})

	it.each(['foreign', 'replaced', 'invalidated', 'getter failure'])(
		'rejects %s binding at the SDK boundary',
		async (change) => {
			const f = await fixture()
			const broken = createJazzRestorationAdapter(f.session, () => {
				throw new Error('private getter failure')
			})
			const adapter = change === 'getter failure' ? broken : f.adapter
			const scope = { binding: change === 'foreign' ? {} : adapter.binding, attempt: 3 }
			if (change === 'replaced') f.replace()
			if (change === 'invalidated') adapter.invalidate()
			expect(adapter.capability.isCurrentBinding(scope.binding)).toBe(false)
			await expect(
				adapter.capability.restoreIdentity(scope, 'synthetic credential')
			).rejects.toThrow('Restoration binding unavailable')
			expect(await adapter.capability.readIdentity(scope)).toEqual({ kind: 'unavailable' })
			expect(f.restore).not.toHaveBeenCalled()
			expect(f.unused).not.toHaveBeenCalled()
		}
	)

	it.each([
		'transitioning',
		'error',
		'closed',
		'signed-out'
	] satisfies JazzSessionSnapshot<unknown>['status'][])(
		'projects %s as unavailable without invalidating the session binding',
		async (status) => {
			const f = await fixture()
			f.observe({ status, account: f.account })
			expect(await f.adapter.capability.readIdentity(f.scope)).toEqual({ kind: 'unavailable' })
			expect(f.adapter.capability.isCurrentBinding(f.scope.binding)).toBe(true)
		}
	)

	it('retains the binding across expected account replacement and requires a ready account', async () => {
		const f = await fixture()
		f.observe({ status: 'ready' })
		expect(await f.adapter.capability.readIdentity(f.scope)).toEqual({ kind: 'unavailable' })
		const replacement = f.manager.createLocalFirst()
		f.observe({ status: 'ready', account: replacement })
		expect(f.adapter.capability.isCurrentBinding(f.scope.binding)).toBe(true)
		expect(await f.adapter.capability.readIdentity(f.scope)).toEqual({
			kind: 'ready',
			identityId: replacement.id
		})
		f.adapter.invalidate()
		expect(f.manager.getLoggedIn() === replacement).toBe(true)
		expect(f.unused).not.toHaveBeenCalled()
	})

	it('retains one issued host promise across adapter invalidation', async () => {
		const f = await fixture()
		const pending = deferred<void>()
		f.restore.mockImplementationOnce(() => pending.promise)
		const operation = f.adapter.capability.restoreIdentity(f.scope, 'synthetic credential')
		f.adapter.invalidate()
		pending.resolve()
		await operation
		expect(f.restore).toHaveBeenCalledTimes(1)
		expect(f.unused).not.toHaveBeenCalled()
	})

	it('propagates SDK/snapshot rejection to the machine boundary without retry', async () => {
		const f = await fixture()
		f.restore.mockRejectedValueOnce(new Error('synthetic SDK failure'))
		await expect(
			f.adapter.capability.restoreIdentity(f.scope, 'synthetic credential')
		).rejects.toThrow('synthetic SDK failure')
		vi.spyOn(f.session, 'getSnapshot').mockImplementationOnce(() => {
			throw new Error('synthetic snapshot failure')
		})
		await expect(f.adapter.capability.readIdentity(f.scope)).rejects.toThrow(
			'synthetic snapshot failure'
		)
		expect(f.restore).toHaveBeenCalledTimes(1)
	})
})
