import { types } from 'xstate'
import type { PreparedSave } from '../../contracts/storage.js'
import {
	canBindStorageIntent,
	canPublishStoredContent,
	hasExistingArticle
} from '../../capture/content-policy.js'
import type { ContentFacts } from '../../capture/content-policy.js'
import type { TransactionResource } from '../../backend/jazz/transaction.js'
import { transactionDomainModel, domainContext } from './domain-model.js'
import type { DomainRead, DomainReceipt } from './domain-model.js'
type Mutation = (resource: TransactionResource, facts: ContentFacts) => void

export function createContentIntentDomain(io: {
	read: DomainRead<PreparedSave, ContentFacts>
	insertIntent: Mutation
	bindArticle: Mutation
	createArticle: Mutation
	receipt: DomainReceipt
}) {
	const model = transactionDomainModel(io.read, 'Operation identity is not eligible').extend({
		states: {
			reading: {},
			ready: { schemas: { context: types<{ facts: ContentFacts }>() } },
			binding: { schemas: { context: types<{ facts: ContentFacts }>() } },
			creating: { schemas: { context: types<{ facts: ContentFacts }>() } },
			blocked: {},
			done: {}
		},
		guards: {
			eligible: (_, { facts }: { facts: ContentFacts }) => canBindStorageIntent(facts),
			exists: (_, { facts }: { facts: ContentFacts }) => hasExistingArticle(facts)
		}
	})
	return model.createMachine({
		id: 'content-intent-domain',
		initial: 'reading',
		context: domainContext<PreparedSave, ContentFacts>,
		output: ({ context }) => io.receipt(context.resource),
		states: {
			reading: {
				invoke: {
					src: 'read',
					input: ({ context }) => context,
					onDone: (args) =>
						args.guards.eligible(args, { facts: args.event.output })
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
						target: args.guards.exists(args, { facts: args.context.facts }) ? 'binding' : 'creating'
					})
				}
			},
			binding: {
				entry: (args, enq) => {
					enq(() => {
						io.insertIntent(args.context.resource, args.context.facts)
						io.bindArticle(args.context.resource, args.context.facts)
					})
					enq.sendTo(args.self, { type: 'STAGED' })
				},
				on: { STAGED: { target: 'done' } }
			},
			creating: {
				entry: (args, enq) => {
					enq(() => {
						io.insertIntent(args.context.resource, args.context.facts)
						io.createArticle(args.context.resource, args.context.facts)
					})
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
export function createContentPublicationDomain(io: {
	read: DomainRead<PreparedSave, ContentFacts>
	publishContent: Mutation
	attachContent: Mutation
	receipt: DomainReceipt
}) {
	const model = transactionDomainModel(io.read, 'Operation identity is not eligible').extend({
		states: {
			reading: {},
			ready: { schemas: { context: types<{ facts: ContentFacts }>() } },
			publishing: { schemas: { context: types<{ facts: ContentFacts }>() } },
			blocked: {},
			done: {}
		},
		guards: { eligible: (_, { facts }: { facts: ContentFacts }) => canPublishStoredContent(facts) }
	})
	return model.createMachine({
		id: 'content-publication-domain',
		context: domainContext<PreparedSave, ContentFacts>,
		initial: 'reading',
		output: ({ context }) => io.receipt(context.resource),
		states: {
			reading: {
				invoke: {
					src: 'read',
					input: ({ context }) => context,
					onDone: (args) =>
						args.guards.eligible(args, { facts: args.event.output })
							? { target: 'ready', context: { facts: args.event.output } }
							: { target: 'blocked' }
				}
			},
			ready: {
				entry: (args, enq) => {
					enq(() => {
						args.actions.allow(args)
					})
				},
				on: { STAGE: { target: 'publishing' } }
			},
			publishing: {
				entry: (args, enq) => {
					enq(() => {
						io.publishContent(args.context.resource, args.context.facts)
						io.attachContent(args.context.resource, args.context.facts)
					})
					enq.sendTo(args.self, { type: 'STAGED' })
				},
				on: { STAGED: { target: 'done' } }
			},
			blocked: {
				entry: (args, enq) => {
					enq(() => {
						args.actions.block(args)
					})
				}
			},
			done: { type: 'final' }
		}
	})
}
