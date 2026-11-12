import { types } from 'xstate'
import type { NoteCreate, NoteRevision } from './schema.js'
import { canCreateNote, canWriteNoteRevision } from './eligibility.js'
import type { NoteAssociation, NoteRevisionRows } from './eligibility.js'

import { transactionDomainModel, domainContext } from '../machines/storage/domain-model.js'
import type {
	DomainRead as Read,
	DomainMutation as Mutation,
	DomainReceipt as Receipt
} from '../machines/storage/domain-model.js'

export type NoteParentFacts = NoteAssociation & {
	request: NoteCreate
}
export type NoteRevisionFacts = NoteRevisionRows & { revision: NoteRevision }

export function createNoteCreationMachine(io: {
	read: Read<NoteCreate, NoteParentFacts>
	insertDocument: Mutation<NoteCreate>
	receipt: Receipt
}) {
	const model = transactionDomainModel(io.read, 'Note parent or identity unavailable').extend({
		states: {
			reading: {},
			ready: { schemas: { context: types<{ facts: NoteParentFacts }>() } },
			insertDocument: { schemas: { context: types<{ facts: NoteParentFacts }>() } },
			blocked: {},
			done: {}
		},
		guards: {
			eligible: (_, { facts }: { facts: NoteParentFacts }) => canCreateNote(facts, facts.request.id)
		},
		actions: {
			insertDocument: (
				{
					context
				}: {
					context: import('../machines/storage/domain-model.js').DomainContext<
						NoteCreate,
						NoteParentFacts
					>
				},
				{ facts }: { facts: NoteParentFacts }
			) => io.insertDocument(context.resource, facts.request)
		}
	})
	return model.createMachine({
		id: 'note-creation-domain',
		context: domainContext<NoteCreate, NoteParentFacts>,
		initial: 'reading',
		output: ({
			context
		}: {
			context: import('../machines/storage/domain-model.js').DomainContext<
				NoteCreate,
				NoteParentFacts
			>
		}) => io.receipt(context.resource),
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
				on: { STAGE: { target: 'insertDocument' } }
			},
			insertDocument: {
				entry: (args, enq) => {
					enq(() => args.actions.insertDocument(args, { facts: args.context.facts }))
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

export function createNoteRevisionMachine(io: {
	read: Read<NoteRevision, NoteRevisionFacts>
	insertRevision: Mutation<NoteRevision>
	receipt: Receipt
}) {
	const model = transactionDomainModel(io.read, 'Note or revision unavailable').extend({
		states: {
			reading: {},
			ready: { schemas: { context: types<{ facts: NoteRevisionFacts }>() } },
			blocked: {},
			done: {},
			insertRevision: { schemas: { context: types<{ facts: NoteRevisionFacts }>() } }
		},
		guards: {
			canWriteRevision: (_, { facts }: { facts: NoteRevisionFacts }) =>
				canWriteNoteRevision(facts, facts.revision)
		},
		actions: {
			insertRevision: (
				{
					context
				}: {
					context: import('../machines/storage/domain-model.js').DomainContext<
						NoteRevision,
						NoteRevisionFacts
					>
				},
				{ facts }: { facts: NoteRevisionFacts }
			) => io.insertRevision(context.resource, facts.revision)
		}
	})
	return model.createMachine({
		id: 'note-revision-domain',
		context: domainContext<NoteRevision, NoteRevisionFacts>,
		initial: 'reading',
		output: ({
			context
		}: {
			context: import('../machines/storage/domain-model.js').DomainContext<
				NoteRevision,
				NoteRevisionFacts
			>
		}) => io.receipt(context.resource),
		states: {
			reading: {
				invoke: {
					src: 'read',
					input: ({ context }) => context,
					onDone: (args) => {
						if (args.guards.canWriteRevision(args, { facts: args.event.output })) {
							return { target: 'ready', context: { facts: args.event.output } }
						}
						return { target: 'blocked' }
					}
				}
			},
			ready: {
				entry: (args, enq) => {
					enq(() => {
						args.actions.allow(args)
					})
				},
				on: {
					STAGE: { target: 'insertRevision' }
				}
			},
			blocked: {
				entry: (args, enq) => {
					enq(() => {
						args.actions.block(args)
					})
				}
			},
			done: { type: 'final' },
			insertRevision: {
				entry: (args, enq) => {
					enq(() => {
						args.actions.insertRevision(args, { facts: args.context.facts })
					})
					enq.sendTo(args.self, { type: 'STAGED' })
				},
				on: { STAGED: { target: 'done' } }
			}
		}
	})
}
