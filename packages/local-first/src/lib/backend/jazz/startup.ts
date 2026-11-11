import { createActor } from 'xstate'
import type { ActorRefFrom } from 'xstate'
import type { JazzClient, JazzSession, JazzClientConfig } from 'jazz-tools/client'
import { createJazzSessionAcquisition } from './session.js'
import { createSessionAcquisitionMachine, selectAcquiredSession } from '../../session.js'
import type { SessionOwnerRef } from '../../session.js'
import type { SessionScope } from '../../contracts/session.js'

type Session = JazzSession<JazzClient>
type Owner = ActorRefFrom<ReturnType<typeof createSessionAcquisitionMachine<Session>>>
export type JazzStartupBinding = Readonly<{ owner: SessionOwnerRef<Session>; scope: SessionScope }>

/** One registry per host application lifetime. Layout attachments do not own acquisition. */
export function createJazzStartupRegistry(
	acquire: typeof createJazzSessionAcquisition = createJazzSessionAcquisition
) {
	// One browser-scoped actor reference, not a second session/promise cache. The actor owns acquisition.
	let shared: { owner: Owner; binding: object; config: JazzClientConfig } | undefined

	function sameConfiguration(left: JazzClientConfig, right: JazzClientConfig): boolean {
		const expected: Record<string, unknown> = { ...left }
		const actual: Record<string, unknown> = { ...right }
		return (
			Object.keys(expected).length === Object.keys(actual).length &&
			Object.keys(expected).every((key) => expected[key] === actual[key])
		)
	}

	function getCurrentJazzSession(): Session | undefined {
		return shared ? selectAcquiredSession(shared.owner.getSnapshot()) : undefined
	}

	/** Browser mount binding only. The retained owner survives layout detach and pending SDK creation. */
	function getJazzStartupBinding(config: JazzClientConfig): JazzStartupBinding {
		if (shared && !sameConfiguration(shared.config, config)) {
			throw new Error('Jazz environment replacement requires coordinated cleanup')
		}
		if (!shared) {
			const adapter = acquire(config)
			const owner = createActor(createSessionAcquisitionMachine<Session>(), {
				input: adapter
			}).start()
			shared = { owner, binding: adapter.binding, config: { ...config } }
		}
		return {
			owner: shared.owner,
			scope: { binding: shared.binding, attachment: {}, generation: 0 }
		}
	}

	return { getCurrentJazzSession, getJazzStartupBinding }
}
