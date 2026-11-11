import type { TransferMutationScope } from '../../contracts/transfer-scope-drain.js'
import type {
	TransferMutationRecipient,
	TransferMutationRequest,
	TransferMutationResponse,
	TransferMutationResult
} from './internal-transfer-mutation-owner.js'
import { setup, types } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'

export type TransferMutationGateway = {
	captureScope?: (request: TransferMutationRequestInput) => TransferMutationScope | undefined
	send: (
		event:
			| { type: 'TRANSFER_MUTATION_REQUEST'; request: TransferMutationRequest }
			| { type: 'CANCEL_TRANSFER_MUTATION'; requestId: string }
	) => void
}

export type TransferMutationRequestInput = TransferMutationRequest extends infer Request
	? Request extends TransferMutationRequest
		? Omit<Request, 'recipient' | 'requestId'>
		: never
	: never

type Context = {
	request: TransferMutationRequestInput
	requestId: string
	result: TransferMutationResult | undefined
}
type Event = TransferMutationResponse | { type: 'CANCEL' | 'INVALIDATE' | 'SHUTDOWN' }

function required<Value>(value: Value | undefined): Value {
	if (value === undefined) throw new Error('Missing transfer mutation result')
	return value
}

export function createTransferMutationRequestMachine(gateway: TransferMutationGateway) {
	const events0 = {
		TRANSFER_MUTATION_RESULT: types<EventPayload<Event, 'TRANSFER_MUTATION_RESULT'>>(),
		CANCEL: types<EventPayload<Event, 'CANCEL'>>(),
		INVALIDATE: types<EventPayload<Event, 'INVALIDATE'>>(),
		SHUTDOWN: types<EventPayload<Event, 'SHUTDOWN'>>()
	}
	type NativeEvent0 =
		| import('xstate').InferEvents<typeof events0>
		| import('xstate').DoneActorEvent<never>
		| import('xstate').ErrorActorEvent
	const machine = setup({
		schemas: {
			context: types<Context>(),
			events: events0,
			input: types<TransferMutationRequestInput>(),
			output: types<TransferMutationResult>()
		},
		guards: {
			matchingResponse: ({ context, event }: { context: Context; event: NativeEvent0 }) =>
				event.type === 'TRANSFER_MUTATION_RESULT' && event.requestId === context.requestId
		},
		actions: {
			submit: ({
				context,
				self
			}: {
				context: Context
				self: { id: string; send: (event: TransferMutationResponse) => void }
			}) => {
				const recipient: TransferMutationRecipient = {
					send: (event) => self.send(event)
				}
				gateway.send({
					type: 'TRANSFER_MUTATION_REQUEST',
					request: { ...context.request, requestId: self.id, recipient }
				})
			},
			cancel: ({ context }: { context: Context }) =>
				gateway.send({
					type: 'CANCEL_TRANSFER_MUTATION',
					requestId: context.requestId
				})
		}
	})
	return machine.createMachine({
		id: 'transfer-mutation-request',
		context: ({ input, self }) => {
			const scope = input.scope ?? gateway.captureScope?.(input)
			return {
				request: scope ? { ...input, scope: Object.freeze({ ...scope }) } : { ...input },
				requestId: self.id,
				result: undefined
			}
		},
		initial: 'waiting',
		output: ({ context }) => required(context.result),
		states: {
			waiting: {
				entry: (args, enq) => {
					enq(args.actions.submit, args)
				},
				on: {
					TRANSFER_MUTATION_RESULT: (args) => {
						if (!args.guards.matchingResponse(args)) return
						return { target: 'complete', context: { result: args.event.result } }
					},
					CANCEL: (args, enq) => {
						enq(args.actions.cancel, args)
						return { target: 'cancelling' }
					},
					INVALIDATE: (args, enq) => {
						enq(args.actions.cancel, args)
						return { target: 'cancelling' }
					},
					SHUTDOWN: (args, enq) => {
						enq(args.actions.cancel, args)
						return { target: 'cancelling' }
					}
				}
			},
			cancelling: {
				on: {
					TRANSFER_MUTATION_RESULT: (args) => {
						if (!args.guards.matchingResponse(args)) return
						return { target: 'complete', context: { result: args.event.result } }
					}
				}
			},
			complete: { type: 'final' }
		}
	})
}
