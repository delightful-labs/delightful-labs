import { types, createAsyncLogic, setup, type SnapshotFrom } from 'xstate'

import type { EventPayload } from '../../contracts/machine-events.js'
import type {
	AvailableRecoveryScope,
	RecoveryPhraseCapability,
	RecoveryPhraseEvent,
	RecoveryPhraseView,
	RecoveryScope
} from '../../contracts/recovery-phrase.js'
type Context = {
	scope: RecoveryScope
	phrase: string | undefined
}
type RevealedPhrase = {
	scope: AvailableRecoveryScope
	phrase: string
}
type _Guards = {
	currentScope: undefined
	unchangedObservation: undefined
	availableObservation: undefined
}
function sameScope(left: RecoveryScope, right: RecoveryScope): boolean {
	if (left.kind === 'unavailable' || right.kind === 'unavailable') return left.kind === right.kind
	return (
		left.identityId === right.identityId &&
		left.binding === right.binding &&
		left.generation === right.generation
	)
}
/** Sensitive actor: its context and invoke output must not enter inspection or snapshot history. */
export function createRecoveryPhraseMachine(capability: RecoveryPhraseCapability) {
	const actors = {
		// One leaf plus result correlation. Availability and lifecycle decisions stay in guards.
		reveal: createAsyncLogic<RevealedPhrase, AvailableRecoveryScope>({
			run: async ({ input }) => ({
				scope: input,
				phrase: await capability.readPhrase(input)
			})
		})
	}
	const model = setup({
		schemas: {
			context: types<Context>(),
			events: {
				SHUTDOWN: types<EventPayload<RecoveryPhraseEvent, 'SHUTDOWN'>>(),
				RETRY: types<EventPayload<RecoveryPhraseEvent, 'RETRY'>>(),
				REVEAL: types<EventPayload<RecoveryPhraseEvent, 'REVEAL'>>(),
				HIDE: types<EventPayload<RecoveryPhraseEvent, 'HIDE'>>(),
				COMPLETE: types<EventPayload<RecoveryPhraseEvent, 'COMPLETE'>>(),
				CONFIRM: types<EventPayload<RecoveryPhraseEvent, 'CONFIRM'>>(),
				OBSERVE: types<EventPayload<RecoveryPhraseEvent, 'OBSERVE'>>()
			},
			input: types<RecoveryScope>()
		},
		actors,
		guards: {
			currentScope: ({ context }: { context: Context }) =>
				context.scope.kind === 'available' && capability.isCurrentScope(context.scope),
			unchangedObservation: ({
				context,
				event
			}: {
				context: Context
				event: RecoveryPhraseEvent
			}) =>
				event.type === 'OBSERVE' &&
				sameScope(context.scope, event.scope) &&
				(event.scope.kind === 'unavailable' || capability.isCurrentScope(event.scope)),
			availableObservation: ({ event }: { event: RecoveryPhraseEvent }) =>
				event.type === 'OBSERVE' &&
				event.scope.kind === 'available' &&
				capability.isCurrentScope(event.scope)
		}
	})
	type CompletionEntry = Extract<
		NonNullable<Parameters<typeof model.createStateConfig>[0]['entry']>,
		(...args: never[]) => unknown
	>
	type CompletionArgs = Pick<Parameters<CompletionEntry>[0], 'context' | 'actions'>
	type CompletionQueue = Parameters<CompletionEntry>[1]
	const finalizers = {
		closed: (_args) => {
			return {
				context: { scope: { kind: 'unavailable' }, phrase: undefined } satisfies Partial<Context>
			}
		}
	} satisfies Record<
		string,
		(args: CompletionArgs, enq: CompletionQueue) => void | { context?: Partial<Context> }
	>

	return model.createMachine({
		id: 'recovery-phrase',
		initial: 'assessing',
		context: ({ input }) => ({ scope: input, phrase: undefined }),
		on: {
			SHUTDOWN: (_args) => {
				return { target: '.closed' }
			},
			OBSERVE: (args) => {
				const { event } = args
				if (args.guards.unchangedObservation(args)) {
					return {}
				}
				if (args.guards.availableObservation(args)) {
					return {
						target: '.hidden',
						context: (event.type === 'OBSERVE'
							? { scope: event.scope, phrase: undefined }
							: {}) satisfies Partial<Context>
					}
				}
				return { target: '.unavailable' }
			},
			HIDE: (args) => {
				if (args.guards.currentScope(args)) {
					return {
						target: '.hidden',
						context: { phrase: undefined } satisfies Partial<Context>
					}
				}
				return { target: '.unavailable' }
			}
		},
		states: {
			assessing: {
				type: 'choice',
				choice: (args) => {
					if (args.guards.currentScope(args)) {
						return { target: 'hidden' }
					}
					return { target: 'unavailable' }
				}
			},
			unavailable: {
				entry: (_args) => {
					return {
						context: {
							scope: { kind: 'unavailable' },
							phrase: undefined
						} satisfies Partial<Context>
					}
				}
			},
			hidden: {
				on: {
					REVEAL: (args) => {
						if (args.guards.currentScope(args)) {
							return { target: 'revealing' }
						}
						return { target: 'unavailable' }
					}
				}
			},
			revealing: {
				invoke: {
					src: actors.reveal,
					input: ({ context }) => {
						if (context.scope.kind !== 'available') throw new Error('Recovery scope unavailable')
						return context.scope
					},
					onDone: (args) => {
						const { event } = args
						if (
							!sameScope(args.context.scope, event.output.scope) ||
							!capability.isCurrentScope(event.output.scope)
						) {
							return { target: 'unavailable' }
						}
						if (event.output.phrase.trim().length > 0) {
							return {
								target: 'revealed',
								context: { phrase: event.output.phrase } satisfies Partial<Context>
							}
						}
						return { target: 'failed' }
					},
					onError: (args) => {
						if (args.guards.currentScope(args)) {
							return { target: 'failed' }
						}
						return { target: 'unavailable' }
					}
				}
			},
			revealed: {
				initial: 'unconfirmed',
				states: {
					unconfirmed: {
						on: {
							CONFIRM: (args) => {
								if (!args.guards.currentScope(args)) {
									return { target: '#recovery-phrase.unavailable' }
								}
								if (args.event.value) {
									return { target: 'confirmed' }
								}
							}
						}
					},
					confirmed: {
						on: {
							CONFIRM: (args) => {
								if (!args.guards.currentScope(args)) {
									return { target: '#recovery-phrase.unavailable' }
								}
								if (!args.event.value) {
									return { target: 'unconfirmed' }
								}
							},
							COMPLETE: (args) => {
								if (args.guards.currentScope(args)) {
									return {
										target: '#recovery-phrase.hidden',
										context: { phrase: undefined } satisfies Partial<Context>
									}
								}
								return { target: '#recovery-phrase.unavailable' }
							}
						}
					}
				}
			},
			failed: {
				entry: (_args) => {
					return { context: { phrase: undefined } satisfies Partial<Context> }
				},
				on: {
					RETRY: (args) => {
						if (args.guards.currentScope(args)) {
							return { target: 'revealing' }
						}
						return { target: 'unavailable' }
					}
				}
			},
			closed: {
				type: 'final',
				entry: finalizers.closed
			}
		}
	})
}
export function selectRecoveryPhraseView(
	snapshot: SnapshotFrom<ReturnType<typeof createRecoveryPhraseMachine>>
): RecoveryPhraseView {
	if (snapshot.matches('revealed')) {
		if (snapshot.context.phrase === undefined) throw new Error('Recovery phrase missing')
		return {
			kind: 'revealed',
			phrase: snapshot.context.phrase,
			confirmation: snapshot.matches({ revealed: 'confirmed' }) ? 'confirmed' : 'unconfirmed'
		}
	}
	if (snapshot.matches('closed')) return { kind: 'closed' }
	if (snapshot.matches('revealing')) return { kind: 'revealing' }
	if (snapshot.matches('failed')) return { kind: 'failed' }
	return { kind: snapshot.matches('hidden') ? 'hidden' : 'unavailable' }
}
