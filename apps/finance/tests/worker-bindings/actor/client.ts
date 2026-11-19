import { fixture as sdk } from '../sdk-session.js'

const fixture = {
	open: (initial: 'device' | 'signed-out', scope: string, brokerUrl: string, hold = false) =>
		sdk.openActor(initial, scope, brokerUrl, hold),
	async state() {
		const reply = await sdk.command({ type: 'ACTOR_STATE' })
		if (reply.kind !== 'actor-state') throw new Error('Unexpected actor state reply')
		return reply.state
	},
	async readBinding() {
		const reply = await sdk.command({ type: 'READ_ACTOR_BINDING' })
		if (reply.kind !== 'actor-binding') throw new Error('Unexpected binding reply')
		return reply.rows
	},
	createIdentity: () => sdk.command({ type: 'CREATE_ACTOR_IDENTITY' }),
	async recover() {
		const reply = await sdk.command({ type: 'RECOVER_ACTOR_IDENTITY' })
		if (reply.kind !== 'actor-recovered') throw new Error('Unexpected recovery reply')
		return reply.cleared
	},
	restoreIdentity: (hold = false) => sdk.command({ type: 'RESTORE_ACTOR_IDENTITY', hold }),
	close: () => sdk.command({ type: 'CLOSE_ACTOR' }),
	signOut: (stale = false, hold = false) => sdk.command({ type: 'SIGN_OUT_ACTOR', stale, hold }),
	releaseChange: () => sdk.command({ type: 'RELEASE_ACTOR_CHANGE' }),
	releaseOpen: () => sdk.command({ type: 'RELEASE_ACTOR_OPEN' }),
	dispose: () => sdk.closeActor()
}
declare global {
	interface Window {
		financeSessionActorFixture: typeof fixture
	}
}
window.financeSessionActorFixture = fixture
