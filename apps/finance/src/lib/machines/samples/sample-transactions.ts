import type { AppTransaction } from '#lib/domain/transaction.js'
import type {
	FormChildEvent,
	FormOperationInput,
	FormOperationResult
} from '#lib/contracts/form-contract.js'
import type {
	TransactionEntryObservation,
	TransactionEntryReason,
	TransactionEntryScope
} from '#lib/contracts/transaction-entry-contract.js'
import { setup, types, createAsyncLogic, matchesState } from 'xstate'
import type { ActorLogic, Snapshot } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'

type CreationInput<Values = AppTransaction> = FormOperationInput<
	Values,
	TransactionEntryScope,
	TransactionEntryObservation
>
type Result = FormOperationResult<void, TransactionEntryReason>
type Event = FormChildEvent<TransactionEntryObservation> | { type: 'ADD' }

/** Batch iteration owns the current creation child until its transaction has settled. */
export function createSampleTransactionsMachine<
	Logic extends import('xstate').AnyActorLogic
>(operation: {
	logic: Logic
	prepare: (index: number) => import('xstate').InputFrom<Logic>
	result: (output: import('xstate').OutputFrom<Logic>) => Result | undefined
	recipient: (
		actor: import('xstate').ActorRefFrom<Logic>
	) => import('xstate').ActorRef<Snapshot<Result>, FormChildEvent<TransactionEntryObservation>>
}) {
	type Context = {
		saved: number
		request: { input: import('xstate').InputFrom<Logic> } | undefined
		lastResult: Result | undefined
	}
	const actors = {
		prepare: createAsyncLogic({
			run: ({ input }: { input: number }) => Promise.resolve({ input: operation.prepare(input) })
		}),
		write: operation.logic
	}
	const events0 = {
		INVALIDATE: types<EventPayload<Event, 'INVALIDATE'>>(),
		CANCEL: types<EventPayload<Event, 'CANCEL'>>(),
		SHUTDOWN: types<EventPayload<Event, 'SHUTDOWN'>>(),
		OBSERVE: types<EventPayload<Event, 'OBSERVE'>>(),
		ADD: types<EventPayload<Event, 'ADD'>>()
	}
	type NativeEvent0 =
		| import('xstate').InferEvents<typeof events0>
		| import('xstate').DoneActorEvent<
				| import('xstate').OutputFrom<(typeof actors)['prepare']>
				| import('xstate').OutputFrom<(typeof actors)['write']>
		  >
		| import('xstate').ErrorActorEvent
	const model = setup({
		schemas: {
			context: types<Context>(),
			events: events0,
			children: {
				prepare: types<import('xstate').ActorRefFrom<(typeof actors)['prepare']>>(),
				write: types<import('xstate').ActorRefFrom<Logic>>()
			}
		},
		actors,
		actions: {},
		guards: {
			closing: (args: { value: import('xstate').StateValue }) =>
				matchesState({ saving: 'closing' }, args.value),
			interrupted: (args: { value: import('xstate').StateValue }) =>
				matchesState({ saving: 'interrupted' }, args.value)
		}
	})
	return model.createMachine({
		initial: 'idle',
		context: { saved: 0, request: undefined, lastResult: undefined },
		on: { SHUTDOWN: { target: '.closed' }, CANCEL: { target: '.cancelled' } },
		states: {
			idle: {
				on: {
					ADD: () => {
						return { target: 'preparing', context: { saved: 0, lastResult: undefined } }
					}
				}
			},
			preparing: {
				invoke: model.createInvoke({
					id: 'prepare',
					src: actors.prepare,
					input: ({ context }) => context.saved,
					onDone: (args) => {
						return { target: 'saving', context: { request: args.event.output } }
					},
					onError: () => {
						return {
							target: 'assessingFailure',
							context: {
								lastResult: {
									outcome: 'failed',
									code: 'validationFailed',
									settlement: 'notStarted'
								} satisfies Result
							}
						}
					}
				}),
				on: { INVALIDATE: { target: 'assessingFailure' } }
			},
			saving: {
				initial: 'pending',
				invoke: model.createInvoke({
					id: 'write',
					src: actors.write,
					input: ({ context }) => {
						if (!context.request) throw new Error('Missing sample request')
						return context.request.input
					},
					onDone: (args) => {
						const { context, event } = args
						const output = operation.result(event.output)
						if (matchesState({ saving: 'closing' }, args.value)) {
							return {
								target: 'closed',
								context: {
									lastResult: output,
									saved: context.saved + (output?.settlement === 'locallyPersisted' ? 1 : 0)
								}
							}
						}
						if (matchesState({ saving: 'interrupted' }, args.value)) {
							return {
								target: 'assessingFailure',
								context: {
									lastResult: output,
									saved: context.saved + (output?.settlement === 'locallyPersisted' ? 1 : 0)
								}
							}
						}
						if (output?.outcome === 'succeeded') {
							return { target: 'next', context: { lastResult: output, saved: context.saved + 1 } }
						}
						return {
							target: 'assessingFailure',
							context: {
								lastResult: output,
								saved: context.saved + (output?.settlement === 'locallyPersisted' ? 1 : 0)
							}
						}
					},
					onError: (args: { context: Context; value: import('xstate').StateValue }) => {
						if (matchesState({ saving: 'closing' }, args.value)) {
							return {
								target: 'closed',
								context: {
									lastResult: {
										outcome: 'failed',
										code: 'operationFailed',
										settlement: 'unknown'
									} satisfies Result
								}
							}
						}
						return {
							target: 'assessingFailure',
							context: {
								lastResult: {
									outcome: 'failed',
									code: 'operationFailed',
									settlement: 'unknown'
								} satisfies Result
							}
						}
					}
				}),
				on: {
					OBSERVE: (args, enq) => {
						const { event } = args
						{
							const child = args.children.write
							if (child && operation.recipient(child).getSnapshot().status === 'active') {
								const recipient = operation.recipient(child)
								enq.sendTo(recipient, event)
							}
						}
					},
					INVALIDATE: (args, enq) => {
						const { event } = args
						{
							const child = args.children.write
							if (child && operation.recipient(child).getSnapshot().status === 'active') {
								const recipient = operation.recipient(child)
								enq.sendTo(recipient, event)
							}
						}
						return { target: '.interrupted' }
					},
					CANCEL: (args, enq) => {
						const { event } = args
						{
							const child = args.children.write
							if (child && operation.recipient(child).getSnapshot().status === 'active') {
								const recipient = operation.recipient(child)
								enq.sendTo(recipient, event)
							}
						}
						return { target: '.interrupted' }
					},
					SHUTDOWN: (args, enq) => {
						const { event } = args
						{
							const child = args.children.write
							if (child && operation.recipient(child).getSnapshot().status === 'active') {
								const recipient = operation.recipient(child)
								enq.sendTo(recipient, event)
							}
						}
						return { target: '.closing' }
					}
				},
				states: {
					pending: {},
					interrupted: { on: { CANCEL: {}, INVALIDATE: {} } },
					closing: { on: { CANCEL: {}, INVALIDATE: {}, SHUTDOWN: {}, OBSERVE: {} } }
				}
			},
			next: {
				entry: () => {
					return { context: { request: undefined } }
				},
				always: (args) => {
					if (args.context.saved === 25) {
						return { target: 'complete' }
					}
					return { target: 'preparing' }
				}
			},
			assessingFailure: {
				entry: () => {
					return { context: { request: undefined } }
				},
				always: (args) => {
					if (args.context.saved > 0) {
						return { target: 'partial' }
					}
					return { target: 'failure' }
				}
			},
			complete: {
				on: {
					ADD: () => {
						return { target: 'preparing', context: { saved: 0, lastResult: undefined } }
					}
				}
			},
			partial: {
				on: {
					ADD: () => {
						return { target: 'preparing', context: { saved: 0, lastResult: undefined } }
					}
				}
			},
			failure: {
				on: {
					ADD: () => {
						return { target: 'preparing', context: { saved: 0, lastResult: undefined } }
					}
				}
			},
			cancelled: {
				type: 'final',
				entry: () => {
					return { context: { request: undefined } }
				}
			},
			closed: {
				type: 'final',
				entry: () => {
					return { context: { request: undefined } }
				}
			}
		}
	})
}
