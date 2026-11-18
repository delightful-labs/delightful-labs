import { sessionRuntimeObservation } from './session-runtime-observation.js'
import { setup, types, type SnapshotFrom } from 'xstate'
import type {
	SessionRuntimeConnection,
	SessionRuntimeView
} from '../../contracts/session-runtime.js'

/** A fixed close invocation observes actual SDK-owner completion. It owns no SDK resource. */
export const sessionCloseMachine = setup({
	schemas: {
		input: types<SessionRuntimeConnection>(),
		context: types<{
			session: SessionRuntimeConnection
			stage: 'acquisition' | 'session'
			result: 'closed' | 'failed' | undefined
		}>(),
		output: types<{ outcome: 'closed' | 'failed' }>(),
		events: { OBSERVED: types<{ view: SessionRuntimeView }>(), FAILED: types(), SHUTDOWN: types() }
	},
	actors: { observation: sessionRuntimeObservation }
}).createMachine({
	id: 'session-close',
	context: ({ input }) => ({
		session: input,
		stage: input.view.get().stage === 'acquiring' ? 'acquisition' : 'session',
		result: undefined
	}),
	initial: 'pending',
	output: ({ context }) => {
		if (!context.result) throw new Error('Session close has not settled')
		return { outcome: context.result }
	},
	on: { SHUTDOWN: {} },
	states: {
		pending: {
			entry: ({ context }, enq) => enq.sendTo(context.session.owner, { type: 'CLOSE' }),
			invoke: {
				src: 'observation',
				input: ({ context }) => context.session,
				onError: { target: 'settled', context: { result: 'failed' } }
			},
			on: {
				OBSERVED: ({ event }) => {
					if (event.view.stage === 'closed')
						return { target: 'settled', context: { result: 'closed' } }
					if (event.view.stage === 'failed')
						return { target: 'settled', context: { result: 'failed' } }
					return {
						context: { stage: event.view.stage === 'acquiring' ? 'acquisition' : 'session' }
					}
				},
				FAILED: { target: 'settled', context: { result: 'failed' } }
			}
		},
		settled: { type: 'final' }
	}
})

export function selectSessionCloseStage(snapshot: SnapshotFrom<typeof sessionCloseMachine>) {
	return snapshot.context.stage
}
