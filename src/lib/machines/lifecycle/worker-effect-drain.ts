import { createAsyncLogic, setup, types } from 'xstate'
import type { ActorRefFrom } from 'xstate'
import { DEFAULT_WORKER_REQUEST_TIMEOUT_MS } from '../../contracts/worker-request.js'
import type {
	WorkerEffectDrainInput,
	WorkerEffectProof,
	WorkerEffectSettlement
} from '../../contracts/worker-effect-drain.js'
import type { WorkerHostClosed } from '../../contracts/worker-channel.js'

function required<Value>(value: Value | undefined): Value {
	if (value === undefined) throw new Error('Missing worker effect drain resource')
	return value
}
/** Proof of quiescence for one original effect. The caller retains its lock,
 * operation result and custody; this chart neither replays nor releases them. */
export function createWorkerEffectDrain() {
	type Input = WorkerEffectDrainInput
	type Context = {
		record: {
			input: Input | undefined
			identity: WorkerHostClosed
			deadlineMs: number
			proof: WorkerEffectProof | undefined
		}
	}
	const actors = {
		settlement: createAsyncLogic<WorkerEffectSettlement, Input>({
			run: ({ input }) => input.settlement
		}),
		host: createAsyncLogic<WorkerHostClosed, Input>({ run: ({ input }) => input.hostClosed }),
		close: createAsyncLogic<void, Input>({ run: async ({ input }) => input.requestClose() })
	}
	return setup({
		schemas: {
			context: types<Context>(),
			input: types<Input>(),
			output: types<WorkerEffectProof>(),
			children: {
				settlement: types<ActorRefFrom<typeof actors.settlement>>(),
				host: types<ActorRefFrom<typeof actors.host>>(),
				close: types<ActorRefFrom<typeof actors.close>>()
			}
		},
		actors,
		delays: { deadline: ({ context }) => context.record.deadlineMs },
		guards: {
			validDeadline: ({ context }: { context: Context }) =>
				Number.isSafeInteger(context.record.deadlineMs) &&
				context.record.deadlineMs > 0 &&
				context.record.deadlineMs <= 2_147_483_647,
			matchingReceipt: ({ context }: { context: Context }, receipt: WorkerHostClosed) =>
				context.record.identity.scope === receipt.scope &&
				context.record.identity.requestId === receipt.requestId
		}
	}).createMachine({
		id: 'worker-effect-drain',
		context: ({ input }) => ({
			record: {
				input,
				identity: input.identity,
				deadlineMs: input.deadlineMs ?? DEFAULT_WORKER_REQUEST_TIMEOUT_MS,
				proof: undefined
			}
		}),
		initial: 'checking',
		output: ({ context }) => required(context.record.proof),
		states: {
			checking: {
				type: 'choice',
				choice: (args) =>
					args.guards.validDeadline(args)
						? { target: 'owning.waiting' }
						: { target: 'owning.overdue' }
			},
			owning: {
				initial: 'waiting',
				invoke: [
					{
						id: 'settlement',
						src: 'settlement',
						input: ({ context }) => required(context.record.input),
						onDone: ({ context, event }) =>
							event.output.kind === 'settled'
								? {
										target: 'proven',
										context: { record: { ...context.record, proof: { kind: 'settled' } } }
									}
								: undefined,
						onError: {}
					},
					{
						id: 'host',
						src: 'host',
						input: ({ context }) => required(context.record.input),
						onDone: (args) => {
							if (!args.guards.matchingReceipt(args, args.event.output))
								return { target: '.overdue' }
							return {
								target: 'proven',
								context: {
									record: {
										...args.context.record,
										proof: { kind: 'host-closed', receipt: args.event.output }
									}
								}
							}
						},
						onError: { target: '.overdue' }
					},
					{
						id: 'close',
						src: 'close',
						input: ({ context }) => required(context.record.input),
						onError: { target: '.overdue' }
					}
				],
				onError: { target: '.overdue' },
				states: {
					waiting: { timeout: 'deadline', onTimeout: { target: 'overdue' } },
					overdue: {
						entry: ({ context }, enq) =>
							enq(required(context.record.input).onOverdue, context.record.identity)
					}
				}
			},
			proven: {
				type: 'final',
				entry: ({ context }) => ({ context: { record: { ...context.record, input: undefined } } })
			}
		}
	})
}
