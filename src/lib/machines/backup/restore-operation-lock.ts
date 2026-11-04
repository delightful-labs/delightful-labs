import { assign, fromCallback, sendParent, sendTo, setup } from 'xstate'
import type { RestoreScope } from '../../backup/restore.js'

export type LockEvent = { type: 'LOCK_ACQUIRED' | 'LOCK_FAILED' }
type Input = Pick<RestoreScope, 'binding'>
type NativeEvent =
	| { type: 'NATIVE_OFFERED'; available: boolean }
	| { type: 'NATIVE_SETTLED' | 'NATIVE_FAILED' }
type Release = { type: 'RELEASE' }
type Outcome = 'released' | 'unavailable' | 'failed'

/** One browser protocol call. The owner decides admission and when to release. */
const nativeLock = fromCallback<Release, { name: string }>(({ input, sendBack, receive }) => {
	let release: (() => void) | undefined
	const held = new Promise<void>((resolve) => {
		release = resolve
	})
	receive(() => release?.())
	void Promise.resolve()
		.then(() =>
			navigator.locks.request(input.name, { mode: 'exclusive', ifAvailable: true }, (lock) => {
				sendBack({ type: 'NATIVE_OFFERED', available: lock !== null })
				return held
			})
		)
		.then(
			() => sendBack({ type: 'NATIVE_SETTLED' }),
			() => sendBack({ type: 'NATIVE_FAILED' })
		)
	// Disposing before a late callback also leaves its returned promise resolved.
	return () => release?.()
})

/** Native observations feed this lifecycle; no acquisition policy lives in callbacks. */
const actors = { native: nativeLock }
export const operationLock = setup<
	{ name: string; outcome: Outcome },
	Release | NativeEvent,
	typeof actors,
	{},
	never,
	{ supported: undefined },
	never,
	string,
	Input,
	Outcome
>({
	actors,
	guards: { supported: () => Boolean(globalThis.navigator?.locks) }
}).createMachine({
	id: 'restore-operation-lock',
	initial: 'checkingSupport',
	context: ({ input }) => ({
		outcome: 'unavailable',
		name: JSON.stringify([
			'dlf-restore',
			input.binding.applicationId,
			input.binding.environment,
			input.binding.identityId,
			input.binding.operationId
		])
	}),
	output: ({ context }) => context.outcome,
	states: {
		checkingSupport: {
			always: [{ guard: 'supported', target: 'active' }, { target: 'unavailable' }]
		},
		active: {
			initial: 'acquiring',
			invoke: {
				id: 'native',
				src: 'native',
				input: ({ context }) => ({ name: context.name }),
				onError: 'failed'
			},
			on: { NATIVE_FAILED: '#restore-operation-lock.failed' },
			states: {
				acquiring: {
					on: {
						NATIVE_OFFERED: [
							{ guard: ({ event }) => event.available, target: 'held' },
							{ target: 'releasingUnavailable' }
						],
						RELEASE: 'releasing'
					}
				},
				held: {
					entry: sendParent({ type: 'LOCK_ACQUIRED' } satisfies LockEvent),
					on: { RELEASE: 'releasing', NATIVE_FAILED: 'lost', NATIVE_SETTLED: 'lost' }
				},
				lost: {
					entry: sendParent({ type: 'LOCK_FAILED' } satisfies LockEvent),
					on: { RELEASE: '#restore-operation-lock.failed' }
				},
				releasing: {
					entry: sendTo('native', { type: 'RELEASE' }),
					on: { NATIVE_SETTLED: '#restore-operation-lock.released' }
				},
				releasingUnavailable: {
					entry: sendTo('native', { type: 'RELEASE' }),
					on: { NATIVE_SETTLED: '#restore-operation-lock.unavailable' }
				}
			}
		},
		released: { type: 'final', entry: assign({ outcome: 'released' }) },
		unavailable: { type: 'final' },
		failed: { type: 'final', entry: assign({ outcome: 'failed' }) }
	}
})
