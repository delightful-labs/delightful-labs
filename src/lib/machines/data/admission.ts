import { assign, createActor, setup, waitFor } from 'xstate'

export type MutationAdmissionDenial = 'capturing' | 'closed' | 'unresolved'
export type MutationAdmissionResult<Lease> =
	| { outcome: 'admitted'; lease: Lease }
	| { outcome: 'denied'; reason: MutationAdmissionDenial }

export interface MutationLease {
	/** Retain an issued native receipt before releasing the operation. Does not await it.
	 * Resolve known rejections explicitly; a rejected/unknown receipt blocks future captures.
	 */
	retain(receipt: PromiseLike<unknown>): void
	/** End the finite operation. Its retained native receipts remain independently owned. */
	release(): void
	/** An interrupted/crashed writer cannot claim that its native effects settled. */
	unresolved(): void
}
export interface CaptureAdmissionLease {
	/** Wait for admitted operations AND their native receipts. Reject after release or close. */
	drain(): Promise<void>
	/** Direct, synchronous and idempotent. Requires no cooperation from a capture child. */
	release(): void
}
export interface MutationAdmission {
	/** Call at the start of a finite mutation, never when constructing an idle form/page. */
	write(): MutationAdmissionResult<MutationLease>
	/** Immediately prevent new operations. Aborting releases admission, not native reads. */
	capture(signal: AbortSignal): MutationAdmissionResult<CaptureAdmissionLease>
	/** Retire this session's admission; a replacement session needs its own owner. */
	close(): void
}

type Context = {
	writers: ReadonlySet<object>
	receipts: ReadonlySet<object>
	capture: object | undefined
	uncertain: boolean
}
type Event =
	| { type: 'WRITE' | 'RELEASE_WRITE' | 'UNRESOLVED'; token: object }
	| { type: 'RETAIN'; writer: object; token: object }
	| { type: 'SETTLE'; token: object; resolved: boolean }
	| { type: 'CAPTURE' | 'RELEASE_CAPTURE'; token: object }
	| { type: 'CLOSE' }

const without = (values: ReadonlySet<object>, token: object) => {
	const next = new Set(values)
	next.delete(token)
	return next
}

/** One independent session resource owner. No consumer actors are wrapped or intercepted. */
const admissionMachine = setup<Context, Event, {}, {}, { releaseCapture: undefined }>({
	actions: {
		releaseCapture: assign({ capture: undefined })
	}
}).createMachine({
	id: 'mutation-admission',
	initial: 'open',
	context: { writers: new Set(), receipts: new Set(), capture: undefined, uncertain: false },
	on: {
		CLOSE: { target: '.closed', actions: 'releaseCapture' },
		RELEASE_WRITE: {
			actions: assign({ writers: ({ context, event }) => without(context.writers, event.token) })
		},
		UNRESOLVED: {
			guard: ({ context, event }) => context.writers.has(event.token),
			actions: assign({
				writers: ({ context, event }) => without(context.writers, event.token),
				uncertain: true
			})
		},
		RETAIN: {
			guard: ({ context, event }) => context.writers.has(event.writer),
			actions: assign({
				receipts: ({ context, event }) => new Set([...context.receipts, event.token])
			})
		},
		SETTLE: {
			guard: ({ context, event }) => context.receipts.has(event.token),
			actions: assign({
				receipts: ({ context, event }) => without(context.receipts, event.token),
				uncertain: ({ context, event }) => context.uncertain || !event.resolved
			})
		}
	},
	states: {
		open: {
			on: {
				WRITE: {
					actions: assign({
						writers: ({ context, event }) => new Set([...context.writers, event.token])
					})
				},
				CAPTURE: {
					guard: ({ context }) => !context.uncertain,
					target: 'capturing',
					actions: assign({ capture: ({ event }) => event.token })
				}
			}
		},
		capturing: {
			on: {
				RELEASE_CAPTURE: {
					guard: ({ context, event }) => context.capture === event.token,
					target: 'open',
					actions: 'releaseCapture'
				}
			}
		},
		closed: {}
	}
})

/** Create once per native session. Ordinary offline saves never wait for capture or remote writes.
 * Every mutation path must participate; this API cannot discover unregistered SDK calls.
 */
export function createMutationAdmission(): MutationAdmission {
	const actor = createActor(admissionMachine).start()
	const lifetime = new AbortController()
	function denial(): { outcome: 'denied'; reason: MutationAdmissionDenial } {
		const snapshot = actor.getSnapshot()
		return {
			outcome: 'denied',
			reason: snapshot.matches('closed')
				? 'closed'
				: snapshot.context.uncertain
					? 'unresolved'
					: 'capturing'
		}
	}
	return Object.freeze({
		write(): MutationAdmissionResult<MutationLease> {
			const token = {}
			actor.send({ type: 'WRITE', token })
			if (!actor.getSnapshot().context.writers.has(token)) return denial()
			const lease: MutationLease = Object.freeze({
				retain(receipt: PromiseLike<unknown>) {
					const retained = {}
					actor.send({ type: 'RETAIN', writer: token, token: retained })
					if (!actor.getSnapshot().context.receipts.has(retained))
						throw new Error('Mutation admission lease released')
					void Promise.resolve(receipt).then(
						() => actor.send({ type: 'SETTLE', token: retained, resolved: true }),
						() => actor.send({ type: 'SETTLE', token: retained, resolved: false })
					)
				},
				release: () => actor.send({ type: 'RELEASE_WRITE', token }),
				unresolved: () => actor.send({ type: 'UNRESOLVED', token })
			})
			return { outcome: 'admitted', lease }
		},
		capture(signal: AbortSignal): MutationAdmissionResult<CaptureAdmissionLease> {
			if (signal.aborted) return { outcome: 'denied', reason: 'closed' }
			const token = {}
			actor.send({ type: 'CAPTURE', token })
			if (actor.getSnapshot().context.capture !== token) return denial()
			const released = new AbortController()
			const release = () => {
				signal.removeEventListener('abort', release)
				lifetime.signal.removeEventListener('abort', release)
				actor.send({ type: 'RELEASE_CAPTURE', token })
				released.abort()
			}
			signal.addEventListener('abort', release, { once: true })
			lifetime.signal.addEventListener('abort', release, { once: true })
			const lease: CaptureAdmissionLease = Object.freeze({
				drain: () =>
					waitFor(
						actor,
						(snapshot) =>
							snapshot.context.capture !== token ||
							snapshot.context.uncertain ||
							(snapshot.context.writers.size === 0 && snapshot.context.receipts.size === 0),
						{ signal: released.signal }
					).then(() => {
						const snapshot = actor.getSnapshot()
						if (
							released.signal.aborted ||
							snapshot.context.capture !== token ||
							snapshot.context.uncertain
						)
							throw new Error('Capture admission unavailable')
					}),
				release
			})
			return { outcome: 'admitted', lease }
		},
		close() {
			actor.send({ type: 'CLOSE' })
			lifetime.abort()
		}
	})
}
