import { describe, it, expect, vi } from 'vitest'
import { createJazzStartupRegistry } from './startup.js'
import type { JazzSession, JazzClient, JazzSessionConfig } from 'jazz-tools/svelte'

describe('application-owned Jazz startup registry', () => {
	it('retains one lazy owner across distinct layout attachments', () => {
		const open = vi.fn<() => Promise<JazzSession<JazzClient>>>()
		const acquire = vi.fn((_config: JazzSessionConfig) => ({ binding: {}, capability: { open } }))
		const registry = createJazzStartupRegistry(acquire)
		const config = {
			appId: 'notes',
			serverUrl: 'http://127.0.0.1:9999',
			initial: 'local-first'
		} satisfies JazzSessionConfig
		const first = registry.getJazzStartupBinding(config)
		const second = registry.getJazzStartupBinding({ ...config })
		expect(first.owner).toBe(second.owner)
		expect(first.scope.attachment).not.toBe(second.scope.attachment)
		expect(acquire).toHaveBeenCalledOnce()
		expect(open).not.toHaveBeenCalled()
		expect(registry.getCurrentJazzSession()).toBeUndefined()
	})
	it('requires coordinated cleanup before an environment replacement', () => {
		const registry = createJazzStartupRegistry(() => ({
			binding: {},
			capability: { open: vi.fn<() => Promise<JazzSession<JazzClient>>>() }
		}))
		const first = registry.getJazzStartupBinding({
			appId: 'notes',
			serverUrl: 'http://127.0.0.1:9999',
			initial: 'local-first'
		})
		expect(() =>
			registry.getJazzStartupBinding({
				appId: 'different',
				serverUrl: 'http://127.0.0.1:9999',
				initial: 'local-first'
			})
		).toThrow('environment replacement requires coordinated cleanup')
		expect(
			registry.getJazzStartupBinding({
				appId: 'notes',
				serverUrl: 'http://127.0.0.1:9999',
				initial: 'local-first'
			}).owner
		).toBe(first.owner)
	})
})
