import { types } from 'xstate'
import type { ReaderChange } from '../../reader/schema.js'
import type { TransactionResource } from '../../backend/jazz/transaction.js'
import { transactionDomainModel, domainContext } from './domain-model.js'
import type { DomainRead, DomainReceipt } from './domain-model.js'
export type ReaderFacts = {
	draft: ReaderChange
	operationId: string
	library: unknown
	document: unknown
	parents: string[]
}
type Mutation = (resource: TransactionResource, facts: ReaderFacts) => void
export function createReaderDomain(io: {
	read: DomainRead<ReaderChange, ReaderFacts>
	updatePosition: Mutation
	insertPreference: Mutation
	receipt: DomainReceipt
}) {
	const model = transactionDomainModel(io.read, 'Reading parent unavailable').extend({
		states: {
			reading: {},
			ready: { schemas: { context: types<{ facts: ReaderFacts }>() } },
			position: { schemas: { context: types<{ facts: ReaderFacts }>() } },
			preference: { schemas: { context: types<{ facts: ReaderFacts }>() } },
			blocked: {},
			done: {}
		},
		guards: {
			parentAvailable: (_, { facts }: { facts: ReaderFacts }) =>
				!!facts.library && (facts.draft.documentId === null || !!facts.document),
			positionChange: (_, { facts }: { facts: ReaderFacts }) => facts.draft.field === 'position'
		}
	})
	return model.createMachine({
		id: 'reader-domain',
		initial: 'reading',
		context: domainContext<ReaderChange, ReaderFacts>,
		output: ({ context }) => io.receipt(context.resource),
		states: {
			reading: {
				invoke: {
					src: 'read',
					input: ({ context }) => context,
					onDone: (args) =>
						args.guards.parentAvailable(args, { facts: args.event.output })
							? { target: 'ready', context: { facts: args.event.output } }
							: { target: 'blocked' }
				}
			},
			ready: {
				entry: (args, enq) => {
					enq(() => args.actions.allow(args))
				},
				on: {
					STAGE: (args) => ({
						target: args.guards.positionChange(args, { facts: args.context.facts })
							? 'position'
							: 'preference'
					})
				}
			},
			position: {
				entry: (args, enq) => {
					enq(() => io.updatePosition(args.context.resource, args.context.facts))
					enq.sendTo(args.self, { type: 'STAGED' })
				},
				on: { STAGED: { target: 'done' } }
			},
			preference: {
				entry: (args, enq) => {
					enq(() => io.insertPreference(args.context.resource, args.context.facts))
					enq.sendTo(args.self, { type: 'STAGED' })
				},
				on: { STAGED: { target: 'done' } }
			},
			blocked: {
				entry: (args, enq) => {
					enq(() => args.actions.block(args))
				}
			},
			done: { type: 'final' }
		}
	})
}
