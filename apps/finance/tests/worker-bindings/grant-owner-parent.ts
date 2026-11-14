import { setup, types, type ActorRefFrom } from 'xstate'
import type { BrokerHostCall } from 'delightful-local-first/backend/jazz/worker-broker'
import { createFinanceGrantOwner } from '../../src/lib/machines/runtime/worker-grant-owner.js'
import type {
	FinanceGrantOwnerInput,
	FinanceGrantOwnerOutput,
	FinanceGrantOwnerReport
} from '../../src/lib/machines/runtime/worker-grant-contracts.js'
import type { FinanceGrantReply } from '../../src/lib/runtime/worker/grant-protocol.js'

export type GrantFixtureInput = {
	/** Pure fixture input read; the mutable caller source is outside parent context. */
	configuration: () => Omit<FinanceGrantOwnerInput, 'reportTo'>
	onReport?: (report: FinanceGrantOwnerReport) => void
}
type Payload<Kind extends FinanceGrantOwnerReport['type']> = Omit<
	Extract<FinanceGrantOwnerReport, { type: Kind }>,
	'type'
>

/** Disposable parent used by unit/model/native fixtures. It invokes the real
 * owner and records public reports/output; it supplies no lifecycle policy. */
export function createGrantFixtureParent() {
	const grant = createFinanceGrantOwner()
	return setup({
		schemas: {
			input: types<GrantFixtureInput>(),
			context: types<{
				input: GrantFixtureInput
				reports: FinanceGrantOwnerReport[]
				output: FinanceGrantOwnerOutput | undefined
				errors: number
			}>(),
			output: types<FinanceGrantOwnerOutput | undefined>(),
			events: {
				GRANT_REPLY: types<{ reply: FinanceGrantReply }>(),
				REQUEST: types<{ call: BrokerHostCall }>(),
				RETIRE: types(),
				GRANT_ACQUIRED: types<Payload<'GRANT_ACQUIRED'>>(),
				GRANT_AVAILABLE: types<Payload<'GRANT_AVAILABLE'>>(),
				GRANT_ISSUE: types<Payload<'GRANT_ISSUE'>>(),
				GRANT_REPLY_REJECTED: types<Payload<'GRANT_REPLY_REJECTED'>>()
			},
			children: { grant: types<ActorRefFrom<typeof grant>>() }
		},
		actors: { grant }
	}).createMachine({
		id: 'grant-owner-test-parent',
		context: ({ input }) => ({ input, reports: [], output: undefined, errors: 0 }),
		output: ({ context }) => context.output,
		initial: 'owning',
		states: {
			owning: {
				invoke: {
					id: 'grant',
					src: 'grant',
					input: ({ context, self }) => ({ ...context.input.configuration(), reportTo: self }),
					onDone: ({ event }) => ({ target: 'closed', context: { output: event.output } }),
					onError: ({ context }) => ({ target: 'failed', context: { errors: context.errors + 1 } })
				},
				on: {
					GRANT_REPLY: ({ event }, enq) => enq.sendTo('grant', event),
					REQUEST: ({ event }, enq) => enq.sendTo('grant', event),
					RETIRE: (_, enq) => enq.sendTo('grant', { type: 'RETIRE' }),
					'*': ({ context, event }, enq) => {
						if (
							event.type !== 'GRANT_ACQUIRED' &&
							event.type !== 'GRANT_AVAILABLE' &&
							event.type !== 'GRANT_ISSUE' &&
							event.type !== 'GRANT_REPLY_REJECTED'
						)
							return
						if (context.input.onReport) enq(context.input.onReport, event)
						return { context: { reports: [...context.reports, event] } }
					}
				}
			},
			failed: {},
			closed: { type: 'final' }
		}
	})
}
