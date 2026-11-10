import { createAsyncLogic, setup, types, type ActorRefFrom } from 'xstate'
import {
	DEFAULT_SIGN_OUT_DEADLINE_MS,
	type OrderedSignOutInput,
	type OrderedSignOutResult,
	type SignOutStage
} from '../../contracts/sign-out.js'

function required<Value>(value: Value | undefined): Value {
	if (value === undefined) throw new Error('Sign-out capability unavailable')
	return value
}
function validDeadline(value: number | undefined) {
	return value === undefined || (Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647)
}
function reportOverdue(input: OrderedSignOutInput, stage: SignOutStage) {
	// A feedback observer cannot turn an unsettled operation into a failed call.
	try {
		input.onOverdue?.(stage)
	} catch {
		/* Retain original effect ownership. */
	}
}
/** Parent must retain this child through shutdown. Expiry keeps the same native
 * invocation; forced stop is disruptive disposal, never successful settlement. */
export function createOrderedSignOutMachine() {
	type Context = {
		input: OrderedSignOutInput | undefined
		result: OrderedSignOutResult | undefined
	}
	const provider = createAsyncLogic<void, OrderedSignOutInput>({
		run: ({ input }) => required(input.provider)()
	})
	const session = createAsyncLogic<void, OrderedSignOutInput>({
		run: ({ input }) => input.session()
	})
	return setup({
		schemas: {
			context: types<Context>(),
			input: types<OrderedSignOutInput>(),
			output: types<OrderedSignOutResult>(),
			events: { SHUTDOWN: types() },
			children: {
				provider: types<ActorRefFrom<typeof provider>>(),
				session: types<ActorRefFrom<typeof session>>()
			}
		},
		actors: { provider, session },
		delays: {
			providerDeadline: ({ context }) =>
				required(context.input).providerDeadlineMs ?? DEFAULT_SIGN_OUT_DEADLINE_MS,
			sessionDeadline: ({ context }) =>
				required(context.input).sessionDeadlineMs ?? DEFAULT_SIGN_OUT_DEADLINE_MS
		},
		guards: {
			validDeadlines: ({ context }: { context: Context }) =>
				validDeadline(required(context.input).providerDeadlineMs) &&
				validDeadline(required(context.input).sessionDeadlineMs),
			hasProvider: ({ context }: { context: Context }) =>
				required(context.input).provider !== undefined
		}
	}).createMachine({
		id: 'ordered-sign-out',
		initial: 'admitting',
		context: ({ input }) => ({ input, result: undefined }),
		output: ({ context }) => required(context.result),
		on: { SHUTDOWN: {} },
		states: {
			admitting: {
				type: 'choice',
				choice: (args) =>
					!args.guards.validDeadlines(args)
						? {
								target: 'settled',
								context: { result: { outcome: 'failed', stage: 'configuration' } }
							}
						: args.guards.hasProvider(args)
							? { target: 'provider' }
							: { target: 'session' }
			},
			provider: {
				initial: 'waiting',
				invoke: {
					id: 'provider',
					src: 'provider',
					input: ({ context }) => required(context.input),
					onDone: { target: 'session' },
					onError: {
						target: 'settled',
						context: { result: { outcome: 'failed', stage: 'provider' } }
					}
				},
				states: {
					waiting: { timeout: 'providerDeadline', onTimeout: { target: 'overdue' } },
					overdue: {
						entry: ({ context }, enq) =>
							enq(() => reportOverdue(required(context.input), 'provider'))
					}
				}
			},
			session: {
				initial: 'waiting',
				invoke: {
					id: 'session',
					src: 'session',
					input: ({ context }) => required(context.input),
					onDone: { target: 'settled', context: { result: { outcome: 'completed' } } },
					onError: {
						target: 'settled',
						context: { result: { outcome: 'failed', stage: 'session' } }
					}
				},
				states: {
					waiting: { timeout: 'sessionDeadline', onTimeout: { target: 'overdue' } },
					overdue: {
						entry: ({ context }, enq) =>
							enq(() => reportOverdue(required(context.input), 'session'))
					}
				}
			},
			settled: { type: 'final', entry: () => ({ context: { input: undefined } }) }
		}
	})
}
