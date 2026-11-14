import { types } from 'xstate'
import { noteInputTextSchema } from './schema.js'
import type { PreparedAnnotation } from './schema.js'
import { transactionDomainModel, domainContext } from '../machines/storage/domain-model.js'
import type { DomainRead, DomainReceipt } from '../machines/storage/domain-model.js'
import type { TransactionResource } from '../backend/jazz/transaction.js'

export type AnnotationFacts = {
	draft: PreparedAnnotation
	documentAvailable: boolean
	documentReadable: boolean
	highlightAvailable: boolean
	highlightDeleted: boolean
	noteAvailable: boolean
	noteDocumentId: string | undefined
	existingNote: boolean
	source: string | undefined
	highlight: { libraryId: string; documentId: string; source: string } | undefined
}
type Mutation = (resource: TransactionResource, facts: AnnotationFacts) => void
function canMutateAnnotation(facts: AnnotationFacts) {
	if (!facts.documentAvailable) return false
	const command = facts.draft.command
	if (command.type === 'HIGHLIGHT')
		return facts.documentReadable && !!facts.source && !!facts.draft.range && !!facts.draft.textHash
	if (command.type === 'ADD_NOTE')
		return (
			!facts.existingNote && !!facts.source && (!command.highlightId || facts.highlightAvailable)
		)
	if (command.type === 'EDIT_NOTE' || command.type === 'DELETE_NOTE')
		return (
			facts.noteAvailable &&
			facts.noteDocumentId === command.documentId &&
			(command.type !== 'EDIT_NOTE' || noteInputTextSchema.safeParse(command.text).success)
		)
	if (command.type === 'RESTORE_HIGHLIGHT') return facts.highlightDeleted
	return facts.highlightAvailable
}
export function createAnnotationDomain(io: {
	read: DomainRead<PreparedAnnotation, AnnotationFacts>
	createHighlight: Mutation
	createNote: Mutation
	editNote: Mutation
	deleteHighlight: Mutation
	restoreHighlight: Mutation
	deleteNote: Mutation
	receipt: DomainReceipt
}) {
	const model = transactionDomainModel(io.read, 'Annotation parent unavailable').extend({
		states: {
			reading: {},
			ready: { schemas: { context: types<{ facts: AnnotationFacts }>() } },
			createHighlight: { schemas: { context: types<{ facts: AnnotationFacts }>() } },
			createNote: { schemas: { context: types<{ facts: AnnotationFacts }>() } },
			editNote: { schemas: { context: types<{ facts: AnnotationFacts }>() } },
			deleteHighlight: { schemas: { context: types<{ facts: AnnotationFacts }>() } },
			restoreHighlight: { schemas: { context: types<{ facts: AnnotationFacts }>() } },
			deleteNote: { schemas: { context: types<{ facts: AnnotationFacts }>() } },
			blocked: {},
			done: {}
		},
		guards: { eligible: (_, { facts }: { facts: AnnotationFacts }) => canMutateAnnotation(facts) }
	})
	return model.createMachine({
		id: 'annotation-domain',
		initial: 'reading',
		context: domainContext<PreparedAnnotation, AnnotationFacts>,
		output: ({ context }) => io.receipt(context.resource),
		states: {
			reading: {
				invoke: {
					src: 'read',
					input: ({ context }) => context,
					onDone: (args) =>
						args.guards.eligible(args, { facts: args.event.output })
							? { target: 'ready', context: { facts: args.event.output } }
							: { target: 'blocked' },
					onError: { target: 'blocked' }
				}
			},
			ready: {
				entry: (args, enq) => {
					enq(() => args.actions.allow(args))
				},
				on: {
					STAGE: ({ context }) => {
						const command = context.facts.draft.command
						if (command.type === 'HIGHLIGHT') return { target: 'createHighlight' }
						if (command.type === 'ADD_NOTE') return { target: 'createNote' }
						if (command.type === 'EDIT_NOTE') return { target: 'editNote' }
						if (command.type === 'DELETE_HIGHLIGHT') return { target: 'deleteHighlight' }
						if (command.type === 'RESTORE_HIGHLIGHT') return { target: 'restoreHighlight' }
						return { target: 'deleteNote' }
					}
				}
			},
			createHighlight: {
				entry: ({ context, self }, enq) => {
					enq(() => io.createHighlight(context.resource, context.facts))
					enq.sendTo(self, { type: 'STAGED' })
				},
				on: { STAGED: { target: 'done' } }
			},
			createNote: {
				entry: ({ context, self }, enq) => {
					enq(() => io.createNote(context.resource, context.facts))
					enq.sendTo(self, { type: 'STAGED' })
				},
				on: { STAGED: { target: 'done' } }
			},
			editNote: {
				entry: ({ context, self }, enq) => {
					enq(() => io.editNote(context.resource, context.facts))
					enq.sendTo(self, { type: 'STAGED' })
				},
				on: { STAGED: { target: 'done' } }
			},
			deleteHighlight: {
				entry: ({ context, self }, enq) => {
					enq(() => io.deleteHighlight(context.resource, context.facts))
					enq.sendTo(self, { type: 'STAGED' })
				},
				on: { STAGED: { target: 'done' } }
			},
			restoreHighlight: {
				entry: ({ context, self }, enq) => {
					enq(() => io.restoreHighlight(context.resource, context.facts))
					enq.sendTo(self, { type: 'STAGED' })
				},
				on: { STAGED: { target: 'done' } }
			},
			deleteNote: {
				entry: ({ context, self }, enq) => {
					enq(() => io.deleteNote(context.resource, context.facts))
					enq.sendTo(self, { type: 'STAGED' })
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
