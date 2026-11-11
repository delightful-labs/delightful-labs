import { describe, expect, it, vi } from 'vitest'
import type { JazzSession } from 'jazz-tools/svelte'
import type { SessionStatus } from '../../contracts/session.js'
import { createJazzSessionReadinessAdapter } from './session-readiness.js'

function fixture(status: SessionStatus = 'ready') {
	const unused = vi.fn(async () => {})
	const unsubscribe = vi.fn()
	const session = {
		getSnapshot: vi.fn(() => ({ status })),
		subscribe: vi.fn((_notify: () => void) => unsubscribe),
		retry: vi.fn(async () => {}),
		createLocalFirst: unused,
		restoreLocalFirst: unused,
		becomeBackend: unused,
		registerJWT: unused,
		loginJWT: unused,
		loginOrRegisterJWT: unused,
		linkJWT: unused,
		logout: unused,
		close: unused
	} satisfies JazzSession<object>
	return { session, unused, unsubscribe }
}
describe('Jazz acquired session readiness boundary', () => {
	it('constructs a lazy binding without touching SDK state or creating a session', () => {
		const f = fixture()
		const first = createJazzSessionReadinessAdapter(f.session)
		expect(first.binding).not.toBe(createJazzSessionReadinessAdapter(f.session).binding)
		expect(Object.isFrozen(first.binding)).toBe(true)
		expect(f.session.getSnapshot).not.toHaveBeenCalled()
		expect(f.session.subscribe).not.toHaveBeenCalled()
		expect(f.session.retry).not.toHaveBeenCalled()
		expect(f.unused).not.toHaveBeenCalled()
	})
	it.each<SessionStatus>(['ready', 'signed-out', 'transitioning', 'error', 'closed'])(
		'projects only %s status',
		(status) => {
			const f = fixture(status)
			expect(createJazzSessionReadinessAdapter(f.session).capability.readStatus()).toBe(status)
			expect(f.session.getSnapshot).toHaveBeenCalledOnce()
		}
	)
	it('uses the supplied session subscription and exact cleanup', () => {
		const f = fixture(),
			notify = vi.fn()
		const adapter = createJazzSessionReadinessAdapter(f.session)
		expect(adapter.capability.subscribe(notify)).toBe(f.unsubscribe)
		expect(f.session.subscribe).toHaveBeenCalledExactlyOnceWith(notify)
		expect(f.unused).not.toHaveBeenCalled()
	})
	it('calls retry once without automatic repetition or cleanup', async () => {
		const f = fixture()
		f.session.retry.mockRejectedValueOnce(new Error('PRIVATE_SDK'))
		await expect(createJazzSessionReadinessAdapter(f.session).capability.retry()).rejects.toThrow(
			'PRIVATE_SDK'
		)
		expect(f.session.retry).toHaveBeenCalledOnce()
		expect(f.unused).not.toHaveBeenCalled()
	})
})
