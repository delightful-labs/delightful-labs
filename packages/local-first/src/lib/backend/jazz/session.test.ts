import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createActor } from 'xstate'
import type { createJazzSession } from 'jazz-tools'
import type { JazzClient, JazzSession, JazzSessionConfig } from 'jazz-tools/svelte'
import {
	createSessionAcquisitionMachine,
	selectAcquiredSession
} from '../../machines/identity/session-acquisition.js'
import { createJazzSessionAcquisition } from './session.js'

const sdk = vi.hoisted(() => ({ create: vi.fn<typeof createJazzSession>() }))
vi.mock('jazz-tools', () => ({ createJazzSession: sdk.create }))

function session(): JazzSession<JazzClient> {
	const unused = vi.fn(async () => {})
	return {
		getSnapshot: () => ({ status: 'signed-out' }),
		subscribe: () => () => {},
		createLocalFirst: unused,
		restoreLocalFirst: unused,
		becomeBackend: unused,
		registerJWT: unused,
		loginJWT: unused,
		loginOrRegisterJWT: unused,
		linkJWT: unused,
		logout: vi.fn(async () => {}),
		retry: unused,
		close: vi.fn(async () => {})
	}
}
beforeEach(() => sdk.create.mockReset())

describe('Jazz session acquisition leaf', () => {
	it('captures host config without opening on factory construction', async () => {
		const config = {
			appId: 'original',
			serverUrl: 'http://127.0.0.1:9',
			initial: 'local-first'
		} satisfies JazzSessionConfig
		const adapter = createJazzSessionAcquisition(config)
		config.appId = 'changed'
		config.serverUrl = 'http://127.0.0.1:10'
		expect(sdk.create).not.toHaveBeenCalled()
		const supplied = session()
		sdk.create.mockResolvedValueOnce(supplied)
		expect(await adapter.capability.open()).toBe(supplied)
		expect(sdk.create).toHaveBeenCalledExactlyOnceWith({
			appId: 'original',
			serverUrl: 'http://127.0.0.1:9',
			initial: 'local-first'
		})
		expect(supplied.close).not.toHaveBeenCalled()
		expect(supplied.logout).not.toHaveBeenCalled()
	})

	it('does not invent an initial identity or storage policy', async () => {
		const config = { appId: 'configured', serverUrl: 'http://127.0.0.1:9' }
		const adapter = createJazzSessionAcquisition(config)
		sdk.create.mockResolvedValueOnce(session())
		await adapter.capability.open()
		expect(sdk.create).toHaveBeenCalledExactlyOnceWith(config)
		expect(createJazzSessionAcquisition(config).binding).not.toBe(adapter.binding)
	})

	it('preserves SDK rejection for the owner to sanitize without retrying', async () => {
		const adapter = createJazzSessionAcquisition({
			appId: 'failure',
			serverUrl: 'http://127.0.0.1:9'
		})
		const failure = new Error('synthetic SDK failure')
		sdk.create.mockRejectedValueOnce(failure)
		await expect(adapter.capability.open()).rejects.toBe(failure)
		expect(sdk.create).toHaveBeenCalledOnce()
	})

	it('lets a supplied host reference bypass the SDK entirely', () => {
		const adapter = createJazzSessionAcquisition({
			appId: 'reuse',
			serverUrl: 'http://127.0.0.1:9'
		})
		const existing = session()
		const owner = createActor(createSessionAcquisitionMachine<JazzSession<JazzClient>>(), {
			input: { ...adapter, existing }
		}).start()
		try {
			expect(selectAcquiredSession(owner.getSnapshot())).toBe(existing)
			expect(sdk.create).not.toHaveBeenCalled()
		} finally {
			owner.stop()
		}
		expect(existing.close).not.toHaveBeenCalled()
		expect(existing.logout).not.toHaveBeenCalled()
	})
})
