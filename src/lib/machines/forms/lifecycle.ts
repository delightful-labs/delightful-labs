import type { Subscription } from 'xstate'

export type ShutdownActor = {
	getSnapshot: () => { status: string }
	subscribe: (observer: { complete: () => void; error: () => void }) => Subscription
	send: (event: { type: 'SHUTDOWN' }) => void
	stop: () => void
}

/** Finish a root actor's cleanup protocol before stopping it on owner teardown. */
export function stopAfterShutdown(actor: ShutdownActor): void {
	if (actor.getSnapshot().status !== 'active') {
		actor.stop()
		return
	}
	let draining: Subscription | undefined
	let stopped = false
	function finish() {
		if (stopped) return
		stopped = true
		draining?.unsubscribe()
		actor.stop()
	}
	draining = actor.subscribe({ complete: finish, error: finish })
	actor.send({ type: 'SHUTDOWN' })
	if (actor.getSnapshot().status !== 'active') finish()
}
