import { types } from 'xstate'
import type { OrganizationDraft } from './organize.js'
import type { TransactionResource } from '../../backend/jazz/transaction.js'
import { transactionDomainModel, domainContext } from './domain-model.js'
import type { DomainRead, DomainReceipt } from './domain-model.js'
export type OrganizationFacts = {
	draft: OrganizationDraft
	operationId: string
	document: unknown
	parents: string[]
}
type Mutation = (resource: TransactionResource, facts: OrganizationFacts) => void
export function createOrganizationDomain(io: {
	read: DomainRead<OrganizationDraft, OrganizationFacts>
	insertTag: Mutation
	insertOrganization: Mutation
	receipt: DomainReceipt
}) {
	const model = transactionDomainModel(io.read, 'Article unavailable').extend({
		states: {
			reading: {},
			ready: { schemas: { context: types<{ facts: OrganizationFacts }>() } },
			insertTag: { schemas: { context: types<{ facts: OrganizationFacts }>() } },
			insertOrganization: { schemas: { context: types<{ facts: OrganizationFacts }>() } },
			blocked: {},
			done: {}
		},
		guards: {
			parentAvailable: (_, { facts }: { facts: OrganizationFacts }) => facts.document != null,
			tagAssignment: (_, { facts }: { facts: OrganizationFacts }) => facts.draft.field === 'tag'
		},
		actions: {
			insertTag: (
				{
					context
				}: {
					context: import('./domain-model.js').DomainContext<OrganizationDraft, OrganizationFacts>
				},
				{ facts }: { facts: OrganizationFacts }
			) => io.insertTag(context.resource, facts),
			insertOrganization: (
				{
					context
				}: {
					context: import('./domain-model.js').DomainContext<OrganizationDraft, OrganizationFacts>
				},
				{ facts }: { facts: OrganizationFacts }
			) => io.insertOrganization(context.resource, facts)
		}
	})
	return model.createMachine({
		id: 'organization-domain',
		context: domainContext<OrganizationDraft, OrganizationFacts>,
		initial: 'reading',
		output: ({
			context
		}: {
			context: import('./domain-model.js').DomainContext<OrganizationDraft, OrganizationFacts>
		}) => io.receipt(context.resource),
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
						target: args.guards.tagAssignment(args, { facts: args.context.facts })
							? 'insertTag'
							: 'insertOrganization'
					})
				}
			},
			insertTag: {
				entry: (args, enq) => {
					enq(() => args.actions.insertTag(args, { facts: args.context.facts }))
					enq.sendTo(args.self, { type: 'STAGED' })
				},
				on: { STAGED: { target: 'done' } }
			},
			insertOrganization: {
				entry: (args, enq) => {
					enq(() => args.actions.insertOrganization(args, { facts: args.context.facts }))
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
