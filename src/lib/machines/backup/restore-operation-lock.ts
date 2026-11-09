import { types, createCallbackLogic, setup } from 'xstate'

import type { EventPayload } from '../../contracts/machine-events.js'
import type { RestoreScope } from '../../backup/restore.js'
export type LockEvent = {
	type: 'LOCK_ACQUIRED' | 'LOCK_FAILED'
}
type Input = Pick<RestoreScope, 'binding'>
type NativeEvent =
	| {
			type: 'NATIVE_OFFERED'
			available: boolean
	  }
	| {
			type: 'NATIVE_SETTLED' | 'NATIVE_FAILED'
	  }
type Release = {
	type: 'RELEASE'
}
type Outcome = 'released' | 'unavailable' | 'failed'
/** One browser protocol call. The owner decides admission and when to release. */
const nativeLock = createCallbackLogic<
	Release,
	{
		name: string
	}
>(({ input, sendBack, receive }) => {
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
const completionModel = setup({
	schemas: {
		context: types<{
			name: string
			outcome: Outcome
		}>(),
		events: {
			RELEASE: types<EventPayload<Release | NativeEvent, 'RELEASE'>>(),
			NATIVE_OFFERED: types<EventPayload<Release | NativeEvent, 'NATIVE_OFFERED'>>(),
			NATIVE_SETTLED: types<EventPayload<Release | NativeEvent, 'NATIVE_SETTLED'>>(),
			NATIVE_FAILED: types<EventPayload<Release | NativeEvent, 'NATIVE_FAILED'>>()
		},
		input: types<Input>(),
		output: types<Outcome>()
	},
	actors,
	guards: { supported: () => Boolean(globalThis.navigator?.locks) }
})
type CompletionEntry = Extract<
	NonNullable<Parameters<typeof completionModel.createStateConfig>[0]['entry']>,
	(...args: never[]) => unknown
>
type CompletionArgs = Pick<Parameters<CompletionEntry>[0], 'context' | 'actions'>
type CompletionQueue = Parameters<CompletionEntry>[1]
const finalizers = {
	released: (_args) => {
		return {
			context: { outcome: 'released' } satisfies Partial<{
				name: string
				outcome: Outcome
			}>
		}
	},
	failed: (_args) => {
		return {
			context: { outcome: 'failed' } satisfies Partial<{
				name: string
				outcome: Outcome
			}>
		}
	}
} satisfies Record<
	string,
	(
		args: CompletionArgs,
		enq: CompletionQueue
	) => void | {
		context?: Partial<{
			name: string
			outcome: Outcome
		}>
	}
>

export const operationLock = completionModel.createMachine({
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
			type: 'choice',
			choice: (args) => {
				if (args.guards.supported()) {
					return { target: 'active' }
				}
				return { target: 'unavailable' }
			}
		},
		active: {
			initial: 'acquiring',
			invoke: {
				id: 'native',
				src: actors.native,
				input: ({ context }) => ({ name: context.name }),
				onError: (_args) => {
					return { target: 'failed' }
				}
			},
			on: {
				NATIVE_FAILED: (_args) => {
					return { target: '#restore-operation-lock.failed' }
				}
			},
			states: {
				acquiring: {
					on: {
						NATIVE_OFFERED: (args) => {
							if (args.event.available) {
								return { target: 'held' }
							}
							return { target: 'releasingUnavailable' }
						},
						RELEASE: { target: 'releasing' }
					}
				},
				held: {
					entry: (args, enq) => {
						enq.sendTo(args.parent, { type: 'LOCK_ACQUIRED' } satisfies LockEvent)
					},
					on: {
						RELEASE: { target: 'releasing' },
						NATIVE_FAILED: { target: 'lost' },
						NATIVE_SETTLED: { target: 'lost' }
					}
				},
				lost: {
					entry: (args, enq) => {
						enq.sendTo(args.parent, { type: 'LOCK_FAILED' } satisfies LockEvent)
					},
					on: {
						RELEASE: (_args) => {
							return { target: '#restore-operation-lock.failed' }
						}
					}
				},
				releasing: {
					entry: (args, enq) => {
						enq.sendTo('native', { type: 'RELEASE' })
					},
					on: {
						NATIVE_SETTLED: (_args) => {
							return { target: '#restore-operation-lock.released' }
						}
					}
				},
				releasingUnavailable: {
					entry: (args, enq) => {
						enq.sendTo('native', { type: 'RELEASE' })
					},
					on: { NATIVE_SETTLED: { target: '#restore-operation-lock.unavailable' } }
				}
			}
		},
		released: {
			type: 'final',
			entry: finalizers.released
		},
		unavailable: { type: 'final' },
		failed: {
			type: 'final',
			entry: finalizers.failed
		}
	}
})
