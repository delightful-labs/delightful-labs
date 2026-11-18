import { sessionRuntimeObservation } from './session-runtime-observation.js'
import { createAsyncLogic, setup, types } from 'xstate'
import type {
	SessionRuntimeChangeInput,
	SessionRuntimeChangeReport,
	SessionRuntimeChangeOutcome,
	SessionRuntimeIdentityChange,
	SessionRuntimeView,
	SessionRuntimeConnection
} from '../../contracts/session-runtime.js'

type Operation =
	| SessionRuntimeChangeInput
	| Readonly<{
			operation: SessionRuntimeIdentityChange['operation']
			native: () => Promise<void>
	  }>
/** Replaces an existing workflow's promise leaf. No new root, queue or dynamic population.
 * Sensitive invocation: never inspect/persist its input or command event. */
export function createSessionChangeMachine<Input>(readInput: (input: Input) => Operation) {
	type Context = {
		request: Operation | undefined
		session: SessionRuntimeConnection | undefined
		scope: SessionRuntimeChangeInput['scope'] | undefined
		operation: SessionRuntimeIdentityChange['operation']
		outcome: SessionRuntimeChangeOutcome | undefined
	}
	const native = createAsyncLogic({ run: ({ input }: { input: () => Promise<void> }) => input() })
	return setup({
		schemas: {
			input: types<Input>(),
			context: types<Context>(),
			output: types<{ outcome: SessionRuntimeChangeOutcome }>(),
			events: {
				SESSION_CHANGE_SETTLED: types<Omit<SessionRuntimeChangeReport, 'type'>>(),
				SHUTDOWN: types(),
				OBSERVED: types<{ view: SessionRuntimeView }>(),
				FAILED: types()
			},
			internalEvents: { RELEASE_COMMAND: types() }
		},
		actors: { native, observation: sessionRuntimeObservation }
	}).createMachine({
		id: 'session-change',
		context: ({ input }) => {
			const request = readInput(input)
			return {
				request,
				session: 'session' in request ? request.session : undefined,
				scope: 'session' in request ? request.scope : undefined,
				operation: 'session' in request ? request.change.operation : request.operation,
				outcome: undefined
			}
		},
		initial: 'route',
		output: ({ context }) => {
			if (!context.outcome) throw new Error('Session operation has not settled')
			return { outcome: context.outcome }
		},
		on: { SHUTDOWN: {}, RELEASE_COMMAND: { context: { request: undefined } } },
		states: {
			route: {
				type: 'choice',
				choice: ({ context }) => ({
					target: context.request && 'native' in context.request ? 'native' : 'pending'
				})
			},
			native: {
				entry: (_, enq) => enq.raise({ type: 'RELEASE_COMMAND' }),
				invoke: {
					src: 'native',
					input: ({ context }) => {
						if (!context.request || !('native' in context.request))
							throw new Error('Native identity operation unavailable')
						return context.request.native
					},
					onDone: { target: 'settled', context: { outcome: 'completed' } },
					onError: { target: 'settled', context: { outcome: 'failed' } }
				}
			},
			pending: {
				invoke: {
					src: 'observation',
					input: ({ context }) => {
						if (!context.session) throw new Error('Session connection unavailable')
						return context.session
					},
					onError: { target: 'settled', context: { outcome: 'failed' } }
				},
				entry: ({ context, self }, enq) => {
					if (!context.request || !('session' in context.request))
						throw new Error('Session command unavailable')
					enq.sendTo(context.request.session.owner, {
						type: 'CHANGE_IDENTITY',
						scope: context.request.scope,
						change: context.request.change,
						replyTo: self
					})
					enq.raise({ type: 'RELEASE_COMMAND' })
				},
				on: {
					OBSERVED: ({ event }) =>
						event.view.stage === 'failed' || event.view.stage === 'closed'
							? { target: 'settled', context: { outcome: 'failed' } }
							: undefined,
					FAILED: { target: 'settled', context: { outcome: 'failed' } },
					SESSION_CHANGE_SETTLED: ({ context, event }) => {
						if (
							event.scope.binding !== context.scope?.binding ||
							event.scope.attempt !== context.scope.attempt ||
							event.operation !== context.operation
						)
							return
						return { target: 'settled', context: { request: undefined, outcome: event.outcome } }
					}
				}
			},
			settled: { type: 'final' }
		}
	})
}
