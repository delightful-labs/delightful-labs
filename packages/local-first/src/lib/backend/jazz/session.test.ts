import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createActor, createCallbackLogic } from 'xstate'
import type { createJazzClient } from 'jazz-tools/client'
import type { JazzClient, JazzSession, JazzClientConfig } from 'jazz-tools/client'
import {
	createSessionAcquisitionMachine,
	selectAcquiredSession
} from '../../machines/identity/session-acquisition.js'
import { createJazzSessionAcquisition } from './session.js'
import { createJazzStartupRegistry } from './startup.js'
import type { SessionOwnerReply } from '../../contracts/session.js'

const sdk = vi.hoisted(() => ({ create: vi.fn<typeof createJazzClient>() }))
vi.mock('jazz-tools/client', () => ({ createJazzClient: sdk.create }))

function session(): Awaited<ReturnType<typeof createJazzClient>> {
	const unused = vi.fn(async () => {})
	return {
		getSnapshot: () => ({ status: 'signed-out' }),
		subscribe: () => () => {},
		createLocalFirst: unused,
		restoreLocalFirst: unused,
		loginWithBackend: unused,
		linkWithBackend: unused,
		logout: vi.fn(async () => {}),
		retry: unused,
		reauthenticate: unused,
		close: vi.fn(async () => {})
	}
}
beforeEach(() => sdk.create.mockReset())

describe('Jazz session acquisition leaf', () => {
	it('captures host config without opening on factory construction', async () => {
		const config = {
			scope: 'original',
			serverUrl: 'http://127.0.0.1:9',
			initial: 'local-first'
		} satisfies JazzClientConfig
		const adapter = createJazzSessionAcquisition(config)
		config.scope = 'changed'
		config.serverUrl = 'http://127.0.0.1:10'
		expect(sdk.create).not.toHaveBeenCalled()
		const supplied = session()
		sdk.create.mockResolvedValueOnce(supplied)
		expect(await adapter.capability.open()).toBe(supplied)
		expect(sdk.create).toHaveBeenCalledExactlyOnceWith({
			scope: 'original',
			serverUrl: 'http://127.0.0.1:9',
			initial: 'local-first'
		})
		expect(supplied.close).not.toHaveBeenCalled()
		expect(supplied.logout).not.toHaveBeenCalled()
	})

	it('does not invent an initial identity or storage policy', async () => {
		const config = { scope: 'configured', serverUrl: 'http://127.0.0.1:9' }
		const adapter = createJazzSessionAcquisition(config)
		sdk.create.mockResolvedValueOnce(session())
		await adapter.capability.open()
		expect(sdk.create).toHaveBeenCalledExactlyOnceWith(config)
		expect(createJazzSessionAcquisition(config).binding).not.toBe(adapter.binding)
	})

	it('preserves SDK rejection for the owner to sanitize without retrying', async () => {
		const adapter = createJazzSessionAcquisition({
			scope: 'failure',
			serverUrl: 'http://127.0.0.1:9'
		})
		const failure = new Error('synthetic SDK failure')
		sdk.create.mockRejectedValueOnce(failure)
		await expect(adapter.capability.open()).rejects.toBe(failure)
		expect(sdk.create).toHaveBeenCalledOnce()
	})

	it('lets a supplied host reference bypass the SDK entirely', () => {
		const adapter = createJazzSessionAcquisition({
			scope: 'reuse',
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

describe('Jazz registry availability observation', () => {
	it('projects the owner wait and clears it when the current session becomes available', async () => {
		const busy = new Error('Synthetic storage contention')
		let release = () => {}
		const available = new Promise<void>((resolve) => {
			release = resolve
		})
		const registry = createJazzStartupRegistry((config) => {
			const adapter = createJazzSessionAcquisition(config)
			return {
				...adapter,
				capability: {
					...adapter.capability,
					availability: {
						classify: (error) => (error === busy ? { resourceKey: 'registry-storage' } : undefined),
						wait: async (_key: string, _signal: AbortSignal) => available
					}
				}
			}
		})
		const selected = session()
		sdk.create.mockRejectedValueOnce(busy).mockResolvedValueOnce(selected)
		expect(registry.getCurrentSessionAvailability()).toBeUndefined()
		const binding = registry.getJazzStartupBinding({
			scope: 'availability',
			serverUrl: 'http://127.0.0.1:9'
		})
		const recipient = createActor(
			createCallbackLogic<SessionOwnerReply<JazzSession<JazzClient>>, undefined>(() => {}),
			{ input: undefined }
		).start()
		try {
			binding.owner.send({ type: 'ACQUIRE', scope: binding.scope, replyTo: recipient })
			await vi.waitFor(() =>
				expect(registry.getCurrentSessionAvailability()).toEqual({
					resourceKey: 'registry-storage'
				})
			)
			expect(registry.getCurrentJazzSession()).toBeUndefined()
			release()
			await vi.waitFor(() => expect(registry.getCurrentJazzSession()).toBe(selected))
			expect(registry.getCurrentSessionAvailability()).toBeUndefined()
			expect(sdk.create).toHaveBeenCalledTimes(2)
		} finally {
			binding.owner.send({ type: 'RELEASE', scope: binding.scope, replyTo: recipient })
			recipient.stop()
		}
	})
})
