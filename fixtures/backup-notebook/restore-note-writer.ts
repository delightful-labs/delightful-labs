import { z } from 'zod'
import { forwardTo, not, assign, createActor, fromCallback, fromPromise, setup } from 'xstate'
import type { Db, Transaction, WriteHandle } from 'jazz-tools'
import { payloadLimits } from 'delightful-local-first/backup/archive'
import type { RestoreJournalIntent } from 'delightful-local-first/backup/restore/journal'
import type {
	RestorePlannedWrite,
	RestoreDestinationInput,
	RestoreDestinationResult,
	RestoreTransactionWriter,
	RestoreEvent
} from 'delightful-local-first/backup/restore'
import { restoreTransactionAccess } from 'delightful-local-first/backup/restore'
import { sameBackupBinding } from 'delightful-local-first/backup/export'
import { notebookRestoreApp } from './restore-schema.js'
import {
	createNotebookTransactionWriter,
	createNotebookDestinationWriteMachine
} from './restore-writer.js'
import {
	prepareNotebookRestore,
	notebookRestoreNote,
	requiredNotebookRestoreValue as required,
	type NotebookRestoreRequest,
	type NotebookRestoreOptions,
	type NotebookNoteExpected
} from './restore-request.js'
import { createNotebookRestoreNoteMachine } from './restore-note.js'

const identifier = z.string().min(1).max(256)
const digest = z.string().regex(/^[0-9a-f]{64}$/)
const noteObservation = z.object({
	id: identifier,
	destinationId: identifier,
	ownerId: identifier,
	operationId: identifier,
	notebookId: identifier,
	attachmentId: identifier.nullable(),
	body: z.string().max(payloadLimits.textBytes),
	archived: z.boolean()
})
const parentObservation = z.object({
	id: identifier,
	destinationId: identifier,
	ownerId: identifier,
	operationId: identifier
})
const destinationObservation = z.object({
	id: identifier,
	ownerId: identifier,
	operationId: identifier,
	payloadSha256: digest,
	graphSha256: digest,
	status: z.enum(['incomplete', 'active']),
	notes: z.array(noteObservation).max(1),
	notebooks: z.array(parentObservation).max(1),
	attachments: z.array(parentObservation).max(1)
})
type DestinationObservation = z.infer<typeof destinationObservation>

function expectedScopeMatches(
	expected: NotebookNoteExpected,
	intent: RestoreJournalIntent,
	step: RestorePlannedWrite
): boolean {
	return (
		expected.writeId === step.writeId &&
		expected.contentSha256 === step.expectedContentSha256 &&
		expected.payloadSha256 === intent.archive.payloadSha256 &&
		expected.ownerId === intent.operation.identityId &&
		expected.destinationId === intent.operation.destinationWorkspaceId &&
		expected.operationId === intent.operation.operationId
	)
}
function expectedMappingMatches(
	expected: NotebookNoteExpected,
	intent: RestoreJournalIntent,
	step: RestorePlannedWrite
): boolean {
	if (step.mappingIndexes.length !== 1) return false
	const index = step.mappingIndexes[0]
	const mapping = index === undefined ? undefined : intent.plan.mappings[index]
	return (
		mapping?.kind === 'record' &&
		mapping.type === 'note' &&
		mapping.destinationId === expected.id &&
		mapping.sourceId === expected.sourceId &&
		intent.plan.mappings.some(
			(entry) =>
				entry.kind === 'record' &&
				entry.type === 'notebook' &&
				entry.destinationId === expected.notebookId
		) &&
		(expected.attachmentId === null ||
			intent.plan.mappings.some(
				(entry) => entry.kind === 'attachment' && entry.destinationId === expected.attachmentId
			))
	)
}
function destinationMatches(row: DestinationObservation, intent: RestoreJournalIntent): boolean {
	return (
		row.id === intent.operation.destinationWorkspaceId &&
		row.ownerId === intent.operation.identityId &&
		row.operationId === intent.operation.operationId &&
		row.payloadSha256 === intent.archive.payloadSha256 &&
		row.graphSha256 === intent.plan.expectedGraphSha256 &&
		row.status === 'incomplete'
	)
}
function noteMatches(
	row: z.infer<typeof noteObservation>,
	expected: NotebookNoteExpected
): boolean {
	return (
		row.id === expected.id &&
		row.destinationId === expected.destinationId &&
		row.ownerId === expected.ownerId &&
		row.operationId === expected.operationId &&
		row.notebookId === expected.notebookId &&
		row.attachmentId === expected.attachmentId &&
		row.body === expected.body &&
		row.archived === expected.archived
	)
}
function parentScopeMatches(
	row: z.infer<typeof parentObservation>,
	expected: NotebookNoteExpected
): boolean {
	return (
		row.destinationId === expected.destinationId &&
		row.ownerId === expected.ownerId &&
		row.operationId === expected.operationId
	)
}
function parentsPresent(row: DestinationObservation, expected: NotebookNoteExpected): boolean {
	return (
		row.notebooks.length === 1 && (expected.attachmentId === null || row.attachments.length === 1)
	)
}
function parentsMatch(row: DestinationObservation, expected: NotebookNoteExpected): boolean {
	const notebook = row.notebooks[0],
		attachment = row.attachments[0]
	if (!notebook || notebook.id !== expected.notebookId || !parentScopeMatches(notebook, expected))
		return false
	if (expected.attachmentId === null) return row.attachments.length === 0
	return (
		attachment !== undefined &&
		attachment.id === expected.attachmentId &&
		parentScopeMatches(attachment, expected)
	)
}
function query(intent: RestoreJournalIntent, expected: NotebookNoteExpected) {
	return notebookRestoreApp.restoreDestinations
		.where({ id: intent.operation.destinationWorkspaceId })
		.include({
			notes: notebookRestoreApp.restoreNotes.where({ id: expected.id }),
			notebooks: notebookRestoreApp.restoreNotebooks.where({ id: expected.notebookId }),
			// Mapping IDs are globally disjoint; a note ID cannot name an attachment.
			attachments: notebookRestoreApp.restoreAttachments.where({
				id: expected.attachmentId ?? expected.id
			})
		})
}
/** The destination actor borrows a transaction; the shared write actor owns its full lifetime. */
export function createNotebookNoteWriter(db: Db, request: NotebookRestoreRequest) {
	type Input = RestoreDestinationInput<Transaction<'mergeable'>>
	type Handle = { toJSON(): { kind: 'notebookNoteObservation' } }
	type Context = {
		input: Input
		handle: Handle
		interruption: 'cancelled' | 'closed' | 'invalidated' | undefined
		result: RestoreDestinationResult
	}
	const observations = new WeakMap<Handle, { observed: DestinationObservation | undefined }>()
	const expected = () => required(notebookRestoreNote(request))
	const observed = (context: Context) => observations.get(context.handle)?.observed
	// This is result admission into an owned observation buffer, not workflow classification.
	const consume = (handle: Handle, raw: unknown) => {
		const cell = observations.get(handle)
		if (!cell) return
		const parsed = destinationObservation.safeParse(raw)
		cell.observed = parsed.success ? parsed.data : undefined
	}
	const actors = {
		observations: fromCallback<
			{ type: string },
			{
				handle: Handle
				owner: { subscribe(observer: { error: (error: unknown) => void }): { unsubscribe(): void } }
			}
		>(({ input }) => {
			// As with transaction custody, owner failure must also release private observations.
			const clear = () => {
				observations.delete(input.handle)
			}
			const subscription = input.owner.subscribe({ error: clear })
			return () => {
				subscription.unsubscribe()
				clear()
			}
		}),
		remote: fromPromise<void, Context>(({ input }) =>
			db
				.one(query(input.input.intent, expected()), { tier: 'remote' })
				.then((row) => consume(input.handle, row))
		),
		read: fromPromise<void, Context>(({ input }) => {
			const access = restoreTransactionAccess(input.input)
			return access.call((transaction) =>
				transaction
					.one(query(input.input.intent, expected()))
					.then((row) => consume(input.handle, row))
			)
		}),
		write: createNotebookDestinationWriteMachine(db, (transaction) => {
			const note = expected()
			transaction.insert(
				notebookRestoreApp.restoreNotes,
				{
					destinationId: note.destinationId,
					ownerId: note.ownerId,
					operationId: note.operationId,
					notebookId: note.notebookId,
					attachmentId: note.attachmentId,
					body: note.body,
					archived: note.archived
				},
				{ id: note.id }
			)
		})
	}
	const model = setup<
		Context,
		RestoreEvent,
		typeof actors,
		{},
		{ interrupt: undefined },
		{
			interrupted: undefined
			currentBinding: undefined
			scopeMatches: undefined
			hasExpected: undefined
			remoteOperation: undefined
			authorityOperation: undefined
			readOperation: undefined
			stageOperation: undefined
			hasObservation: undefined
			controlMatches: undefined
			parentsPresent: undefined
			parentsMatch: undefined
			notePresent: undefined
			contentMatches: undefined
		},
		never,
		string,
		Input,
		RestoreDestinationResult
	>({
		actors,
		guards: {
			interrupted: ({ context }) => context.interruption !== undefined,
			currentBinding: ({ context, event }) =>
				event.type === 'INVALIDATE' && sameBackupBinding(context.input.binding, event.binding),
			scopeMatches: ({ context }) => {
				const note = notebookRestoreNote(request)
				return (
					note !== undefined &&
					expectedScopeMatches(note, context.input.intent, context.input.step) &&
					expectedMappingMatches(note, context.input.intent, context.input.step)
				)
			},
			hasExpected: () => notebookRestoreNote(request) !== undefined,
			remoteOperation: ({ context }) => context.input.operation === 'remote',
			authorityOperation: ({ context }) => context.input.operation === 'authority',
			readOperation: ({ context }) => context.input.operation === 'read',
			stageOperation: ({ context }) => context.input.operation === 'stage',
			hasObservation: ({ context }) => observed(context) !== undefined,
			controlMatches: ({ context }) => {
				const row = observed(context)
				return row !== undefined && destinationMatches(row, context.input.intent)
			},
			parentsPresent: ({ context }) => {
				const row = observed(context),
					expectation = notebookRestoreNote(request)
				return row !== undefined && expectation !== undefined && parentsPresent(row, expectation)
			},
			parentsMatch: ({ context }) => {
				const row = observed(context),
					expectation = notebookRestoreNote(request)
				return row !== undefined && expectation !== undefined && parentsMatch(row, expectation)
			},
			notePresent: ({ context }) => observed(context)?.notes.length === 1,
			contentMatches: ({ context }) => {
				const note = observed(context)?.notes[0]
				const expectation = notebookRestoreNote(request)
				return note !== undefined && expectation !== undefined && noteMatches(note, expectation)
			}
		},
		actions: {
			interrupt: assign({
				interruption: ({ context, event }) =>
					context.interruption ??
					(event.type === 'SHUTDOWN'
						? 'closed'
						: event.type === 'INVALIDATE'
							? 'invalidated'
							: 'cancelled')
			})
		}
	})

	const input = ({ context }: { context: Context }) => context
	return model.createMachine({
		id: 'notebook-note-destination',
		initial: 'working',
		context: ({ input }) => {
			const handle: Handle = { toJSON: () => ({ kind: 'notebookNoteObservation' }) }
			observations.set(handle, { observed: undefined })
			return { input, handle, interruption: undefined, result: 'unavailable' }
		},
		output: ({ context }) => context.interruption ?? context.result,
		on: {
			CANCEL: { actions: 'interrupt' },
			SHUTDOWN: { actions: 'interrupt' },
			INVALIDATE: { guard: 'currentBinding', actions: 'interrupt' }
		},
		states: {
			working: {
				initial: 'admitting',
				invoke: {
					src: 'observations',
					input: ({ context, self }) => ({ handle: context.handle, owner: self }),
					onError: 'unavailable'
				},
				states: {
					admitting: {
						always: [
							{ guard: 'interrupted', target: '#notebook-note-destination.complete' },
							{ guard: not('hasExpected'), target: '#notebook-note-destination.unavailable' },
							{ guard: 'scopeMatches', target: 'selectingOperation' },
							{ target: '#notebook-note-destination.conflict' }
						]
					},
					selectingOperation: {
						always: [
							{ guard: 'remoteOperation', target: 'readingRemote' },
							{ guard: 'authorityOperation', target: 'writing' },
							{ guard: 'readOperation', target: 'readingTransaction' },
							{ guard: 'stageOperation', target: 'writing' },
							{ target: '#notebook-note-destination.unavailable' }
						]
					},
					readingRemote: {
						invoke: {
							src: 'remote',
							input,
							onDone: [
								{ guard: 'interrupted', target: '#notebook-note-destination.complete' },
								{ target: 'checkingObservation' }
							],
							onError: '#notebook-note-destination.unavailable'
						}
					},
					readingTransaction: {
						invoke: {
							src: 'read',
							input,
							onDone: [
								{ guard: 'interrupted', target: '#notebook-note-destination.complete' },
								{ target: 'checkingObservation' }
							],
							onError: '#notebook-note-destination.unavailable'
						}
					},
					checkingObservation: {
						always: [
							{
								guard: not('hasObservation'),
								target: '#notebook-note-destination.unavailable'
							},
							{ guard: not('controlMatches'), target: '#notebook-note-destination.conflict' },
							{ guard: not('parentsPresent'), target: '#notebook-note-destination.unavailable' },
							{ guard: not('parentsMatch'), target: '#notebook-note-destination.conflict' },
							{ guard: not('notePresent'), target: '#notebook-note-destination.missing' },
							{ guard: 'contentMatches', target: '#notebook-note-destination.match' },
							{ target: '#notebook-note-destination.conflict' }
						]
					},
					writing: {
						on: {
							CANCEL: { actions: ['interrupt', forwardTo('write')] },
							SHUTDOWN: { actions: ['interrupt', forwardTo('write')] },
							INVALIDATE: { guard: 'currentBinding', actions: ['interrupt', forwardTo('write')] }
						},

						invoke: {
							id: 'write',
							src: 'write',
							input: ({ context }) => context.input,
							onDone: {
								target: '#notebook-note-destination.complete',
								actions: assign({ result: ({ event }) => event.output })
							},
							onError: '#notebook-note-destination.unavailable'
						}
					}
				}
			},
			match: { type: 'final', entry: assign({ result: 'match' }) },
			missing: { type: 'final', entry: assign({ result: 'missingOrHidden' }) },
			conflict: { type: 'final', entry: assign({ result: 'conflict' }) },
			unavailable: { type: 'final' },
			complete: { type: 'final' }
		}
	})
}
/** Creates an unstarted host root, binding its writer and private checked-file request together. */
export function createNotebookNoteRestore(
	options: Omit<NotebookRestoreOptions, 'mode'> & {
		db: Db
		retainDetached: RestoreTransactionWriter<
			Transaction<'mergeable'>,
			WriteHandle
		>['retainDetached']
	}
) {
	const request = prepareNotebookRestore({
		mode: 'resume',
		archive: options.archive,
		binding: options.binding,
		databaseName: options.databaseName
	})
	const destination = createNotebookNoteWriter(options.db, request)
	const writer = createNotebookTransactionWriter(options.db, options.retainDetached)
	const actor = createActor(createNotebookRestoreNoteMachine(writer, destination), {
		input: { request }
	})
	return { actor, request }
}
