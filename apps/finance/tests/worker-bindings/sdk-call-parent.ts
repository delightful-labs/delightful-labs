import { setup, types, type ActorRefFrom } from 'xstate'
import { createFinanceSdkCallOwner } from '../../src/lib/machines/runtime/worker-sdk-call-owner.js'
import type {
	FinanceSdkCallOwnerInput,
	FinanceSdkCallOwnerEvent,
	FinanceSdkCallOutput,
	FinanceSdkCallReport
} from '../../src/lib/machines/runtime/worker-sdk-call-owner-contracts.js'

type Event = FinanceSdkCallOwnerEvent | FinanceSdkCallReport
type Payload<Kind extends Event['type']> = Omit<Extract<Event, { type: Kind }>, 'type'>
export type SdkCallNativeParentInput = {
	configuration: () => Omit<FinanceSdkCallOwnerInput, 'reportTo'>
	report: (report: FinanceSdkCallReport) => void
}
/** A one-call browser-fixture parent, not the production SDK facade/population.
 * It invokes the real call owner and explicitly acknowledges failure admission. */
export function createSdkCallNativeParent() {
	const call = createFinanceSdkCallOwner()
	return setup({
		schemas: {
			input: types<SdkCallNativeParentInput>(),
			context: types<{
				input: SdkCallNativeParentInput
				output: FinanceSdkCallOutput | undefined
			}>(),
			output: types<FinanceSdkCallOutput>(),
			events: {
				GRANT_AVAILABLE: types<Payload<'GRANT_AVAILABLE'>>(),
				BROKER_RESULT: types<Payload<'BROKER_RESULT'>>(),
				SDK_CALLBACK_SETTLED: types<Payload<'SDK_CALLBACK_SETTLED'>>(),
				GRANT_CLOSED: types<Payload<'GRANT_CLOSED'>>(),
				CANCEL_WAITING: types<Payload<'CANCEL_WAITING'>>(),
				ADMISSION_FAULTED: types<Payload<'ADMISSION_FAULTED'>>(),
				SDK_CALL_REQUIRES_FAULT: types<Payload<'SDK_CALL_REQUIRES_FAULT'>>(),
				SDK_CALL_DELIVERED: types<Payload<'SDK_CALL_DELIVERED'>>(),
				SDK_CALL_BLOCKED: types<Payload<'SDK_CALL_BLOCKED'>>()
			},
			children: { call: types<ActorRefFrom<typeof call>>() }
		},
		actors: { call }
	}).createMachine({
		context: ({ input }) => ({ input, output: undefined }),
		initial: 'owning',
		output: ({ context }) => {
			if (!context.output) throw new Error('Missing native callback output')
			return context.output
		},
		states: {
			owning: {
				initial: 'accepting',
				invoke: {
					id: 'call',
					src: 'call',
					input: ({ context, self }) => ({ ...context.input.configuration(), reportTo: self }),
					onDone: ({ event }) => ({ target: 'released', context: { output: event.output } }),
					onError: { target: '.faulted' }
				},
				on: {
					SDK_CALL_REQUIRES_FAULT: ({ context, event }, enq) => {
						enq(context.input.report, event)
						enq.sendTo('call', { type: 'ADMISSION_FAULTED', identity: event.identity })
						return { target: '.faulted' }
					},
					SDK_CALL_DELIVERED: ({ context, event }, enq) => enq(context.input.report, event),
					SDK_CALL_BLOCKED: ({ context, event }, enq) => {
						enq(context.input.report, event)
						return { target: '.faulted' }
					},
					'*': ({ event }, enq) => {
						// Completion/error notifications belong to invoke handlers.
						if (
							event.type === 'GRANT_AVAILABLE' ||
							event.type === 'BROKER_RESULT' ||
							event.type === 'SDK_CALLBACK_SETTLED' ||
							event.type === 'GRANT_CLOSED' ||
							event.type === 'CANCEL_WAITING' ||
							event.type === 'ADMISSION_FAULTED'
						)
							enq.sendTo('call', event)
					}
				},
				states: { accepting: {}, faulted: {} }
			},
			released: { type: 'final' }
		}
	})
}
