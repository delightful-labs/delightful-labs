import type { EventPayload } from './restore-events.js'
import { z } from 'zod'
import { createActor, createCallbackLogic, setup, createAsyncLogic, types } from 'xstate'
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
import { sameBackupBinding } from 'delightful-local-first/backup/binding'
import { testAppRestoreApp } from './restore-schema.js'
import {
	createTestAppTransactionWriter,
	createTestAppDestinationWriteMachine
} from './restore-writer.js'
import {
	prepareTestAppRestore,
	testAppRestoreNotes,
	requiredTestAppRestoreValue as required,
	type TestAppRestoreRequest,
	type TestAppRestoreOptions,
	type TestAppNoteExpected
} from './restore-request.js'
import { createTestAppRestoreNoteMachine } from './restore-note.js'
import { testAppNoteBatchLimits } from './restore-plan.js'

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
	notes: z.array(noteObservation).max(testAppNoteBatchLimits.records),
	notebooks: z.array(parentObservation).max(1),
	attachments: z.array(parentObservation).max(testAppNoteBatchLimits.records)
})
type DestinationObservation = z.infer<typeof destinationObservation>

function expectedScopeMatches(
	expected: TestAppNoteExpected,
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
	expected: TestAppNoteExpected,
	intent: RestoreJournalIntent,
	step: RestorePlannedWrite
): boolean {
	const mapping = step.mappingIndexes
		.map((index) => intent.plan.mappings[index])
		.find((entry) => entry?.destinationId === expected.id)
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
function noteMatches(row: z.infer<typeof noteObservation>, expected: TestAppNoteExpected): boolean {
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
	expected: TestAppNoteExpected
): boolean {
	return (
		row.destinationId === expected.destinationId &&
		row.ownerId === expected.ownerId &&
		row.operationId === expected.operationId
	)
}
function parentsPresent(
	row: DestinationObservation,
	notes: readonly TestAppNoteExpected[]
): boolean {
	return (
		row.notebooks.length === 1 &&
		notes.every(
			(note) =>
				note.attachmentId === null || row.attachments.some((file) => file.id === note.attachmentId)
		)
	)
}
function parentsMatch(row: DestinationObservation, notes: readonly TestAppNoteExpected[]): boolean {
	const notebook = row.notebooks[0]
	if (
		!notebook ||
		!notes.every((note) => notebook.id === note.notebookId && parentScopeMatches(notebook, note))
	)
		return false
	const attachments = new Set(
		notes.flatMap((note) => (note.attachmentId === null ? [] : [note.attachmentId]))
	)
	return (
		row.attachments.length === attachments.size &&
		row.attachments.every(
			(file) => attachments.has(file.id) && notes.every((note) => parentScopeMatches(file, note))
		)
	)
}
function query(intent: RestoreJournalIntent, notes: readonly TestAppNoteExpected[]) {
	const first = required(notes[0])
	const attachments = [
		...new Set(notes.flatMap((note) => (note.attachmentId === null ? [] : [note.attachmentId])))
	]
	return testAppRestoreApp.restoreDestinations
		.where({ id: intent.operation.destinationWorkspaceId })
		.include({
			notes:
				notes.length === 1
					? testAppRestoreApp.restoreNotes.where({ id: first.id })
					: testAppRestoreApp.restoreNotes.where({ id: { in: notes.map((note) => note.id) } }),
			notebooks: testAppRestoreApp.restoreNotebooks.where({ id: first.notebookId }),
			attachments:
				attachments.length > 1
					? testAppRestoreApp.restoreAttachments.where({ id: { in: attachments } })
					: testAppRestoreApp.restoreAttachments.where({ id: attachments[0] ?? first.id })
		})
}
/** The destination actor borrows a transaction; the shared write actor owns its full lifetime. */
export function createTestAppNoteWriter(db: Db, request: TestAppRestoreRequest) {
	type Input = RestoreDestinationInput<Transaction<'mergeable'>>
	type Handle = { toJSON(): { kind: 'testAppNoteObservation' } }
	type Context = {
		input: Input
		handle: Handle
		interruption: 'cancelled' | 'closed' | 'invalidated' | undefined
		result: RestoreDestinationResult
	}
	const observations = new WeakMap<Handle, { observed: DestinationObservation | undefined }>()
	const expected = () => required(testAppRestoreNotes(request))
	const observed = (context: Context) => observations.get(context.handle)?.observed
	// This is result admission into an owned observation buffer, not workflow classification.
	const consume = (handle: Handle, raw: unknown) => {
		const cell = observations.get(handle)
		if (!cell) return
		const parsed = destinationObservation.safeParse(raw)
		cell.observed = parsed.success ? parsed.data : undefined
	}
	const actors = {
		observations: createCallbackLogic<
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
		remote: createAsyncLogic<void, Context>({
			run: ({ input }) =>
				db
					.one(query(input.input.intent, expected()), { tier: 'remote' })
					.then((row) => consume(input.handle, row))
		}),
		read: createAsyncLogic<void, Context>({
			run: ({ input }) => {
				const access = restoreTransactionAccess(input.input)
				return access.call((transaction) =>
					transaction
						.one(query(input.input.intent, expected()))
						.then((row) => consume(input.handle, row))
				)
			}
		}),
		write: createTestAppDestinationWriteMachine(db, (transaction) => {
			for (const note of expected())
				transaction.insert(
					testAppRestoreApp.restoreNotes,
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
	const model = setup({
		schemas: {
			output: types<RestoreDestinationResult>(),
			context: types<Context>(),
			events: {
				CANCEL: types<EventPayload<RestoreEvent, 'CANCEL'>>(),
				SHUTDOWN: types<EventPayload<RestoreEvent, 'SHUTDOWN'>>(),
				INVALIDATE: types<EventPayload<RestoreEvent, 'INVALIDATE'>>()
			},
			input: types<Input>()
		},
		actors,
		guards: {
			interrupted: ({ context }) => context.interruption !== undefined,
			currentBinding: ({ context, event }) =>
				event.type === 'INVALIDATE' && sameBackupBinding(context.input.binding, event.binding),
			scopeMatches: ({ context }) => {
				const notes = testAppRestoreNotes(request)
				return (
					notes !== undefined &&
					notes.length > 0 &&
					notes.length <= testAppNoteBatchLimits.records &&
					notes.length === context.input.step.mappingIndexes.length &&
					new Set(notes.map((note) => note.id)).size === notes.length &&
					notes.every(
						(note) =>
							expectedScopeMatches(note, context.input.intent, context.input.step) &&
							expectedMappingMatches(note, context.input.intent, context.input.step)
					)
				)
			},
			hasExpected: () => testAppRestoreNotes(request) !== undefined,
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
					expectation = testAppRestoreNotes(request)
				return row !== undefined && expectation !== undefined && parentsPresent(row, expectation)
			},
			parentsMatch: ({ context }) => {
				const row = observed(context),
					expectation = testAppRestoreNotes(request)
				return row !== undefined && expectation !== undefined && parentsMatch(row, expectation)
			},
			notePresent: ({ context }) => (observed(context)?.notes.length ?? 0) > 0,
			contentMatches: ({ context }) => {
				const rows = observed(context)?.notes,
					notes = testAppRestoreNotes(request)
				if (!rows || !notes || rows.length !== notes.length) return false
				const byId = new Map(rows.map((row) => [row.id, row]))
				return notes.every((note) => {
					const row = byId.get(note.id)
					return row !== undefined && noteMatches(row, note)
				})
			}
		},
		actions: {
			interrupt: ({ context, event }: { context: Context; event: RestoreEvent }) => ({
				context: {
					interruption:
						context.interruption ??
						(event.type === 'SHUTDOWN'
							? 'closed'
							: event.type === 'INVALIDATE'
								? 'invalidated'
								: 'cancelled')
				}
			})
		}
	})

	const input = ({ context }: { context: Context }) => context
	return model.createMachine({
		id: 'test-app-note-destination',
		initial: 'working',
		context: ({ input }) => {
			const handle: Handle = { toJSON: () => ({ kind: 'testAppNoteObservation' }) }
			observations.set(handle, { observed: undefined })
			return { input, handle, interruption: undefined, result: 'unavailable' }
		},
		output: ({ context }) => context.interruption ?? context.result,
		on: {
			CANCEL: (args) => {
				return args.actions.interrupt(args)
			},
			SHUTDOWN: (args) => {
				return args.actions.interrupt(args)
			},
			INVALIDATE: (args) => {
				if (!args.guards.currentBinding(args)) return
				return args.actions.interrupt(args)
			}
		},
		states: {
			working: {
				initial: 'admitting',
				invoke: {
					src: 'observations',
					input: ({ context, self }) => ({ handle: context.handle, owner: self }),
					onError: { target: 'unavailable' }
				},
				states: {
					admitting: {
						always: (args) => {
							if (args.guards.interrupted(args)) {
								return { target: '#test-app-note-destination.complete' }
							}
							if (!args.guards.hasExpected()) {
								return { target: '#test-app-note-destination.unavailable' }
							}
							if (args.guards.scopeMatches(args)) {
								return { target: 'selectingOperation' }
							}
							return { target: '#test-app-note-destination.conflict' }
						}
					},
					selectingOperation: {
						always: (args) => {
							if (args.guards.remoteOperation(args)) {
								return { target: 'readingRemote' }
							}
							if (args.guards.authorityOperation(args)) {
								return { target: 'writing' }
							}
							if (args.guards.readOperation(args)) {
								return { target: 'readingTransaction' }
							}
							if (args.guards.stageOperation(args)) {
								return { target: 'writing' }
							}
							return { target: '#test-app-note-destination.unavailable' }
						}
					},
					readingRemote: {
						invoke: {
							src: 'remote',
							input,
							onDone: (args) => {
								if (args.guards.interrupted(args)) {
									return { target: '#test-app-note-destination.complete' }
								}
								return { target: 'checkingObservation' }
							},
							onError: { target: '#test-app-note-destination.unavailable' }
						}
					},
					readingTransaction: {
						invoke: {
							src: 'read',
							input,
							onDone: (args) => {
								if (args.guards.interrupted(args)) {
									return { target: '#test-app-note-destination.complete' }
								}
								return { target: 'checkingObservation' }
							},
							onError: { target: '#test-app-note-destination.unavailable' }
						}
					},
					checkingObservation: {
						always: (args) => {
							if (!args.guards.hasObservation(args)) {
								return { target: '#test-app-note-destination.unavailable' }
							}
							if (!args.guards.controlMatches(args)) {
								return { target: '#test-app-note-destination.conflict' }
							}
							if (!args.guards.parentsPresent(args)) {
								return { target: '#test-app-note-destination.unavailable' }
							}
							if (!args.guards.parentsMatch(args)) {
								return { target: '#test-app-note-destination.conflict' }
							}
							if (!args.guards.notePresent(args)) {
								return { target: '#test-app-note-destination.missing' }
							}
							if (args.guards.contentMatches(args)) {
								return { target: '#test-app-note-destination.match' }
							}
							return { target: '#test-app-note-destination.conflict' }
						}
					},
					writing: {
						on: {
							CANCEL: (args, enq) => {
								enq.sendTo('write', args.event)
								return args.actions.interrupt(args)
							},
							SHUTDOWN: (args, enq) => {
								enq.sendTo('write', args.event)
								return args.actions.interrupt(args)
							},
							INVALIDATE: (args, enq) => {
								if (!args.guards.currentBinding(args)) return
								enq.sendTo('write', args.event)
								return args.actions.interrupt(args)
							}
						},

						invoke: {
							id: 'write',
							src: 'write',
							input: ({ context }) => context.input,
							onDone: (args) => {
								return {
									target: '#test-app-note-destination.complete',
									context: { result: args.event.output }
								}
							},
							onError: { target: '#test-app-note-destination.unavailable' }
						}
					}
				}
			},
			match: {
				type: 'final',
				entry: () => {
					return { context: { result: 'match' } }
				}
			},
			missing: {
				type: 'final',
				entry: () => {
					return { context: { result: 'missingOrHidden' } }
				}
			},
			conflict: {
				type: 'final',
				entry: () => {
					return { context: { result: 'conflict' } }
				}
			},
			unavailable: { type: 'final' },
			complete: { type: 'final' }
		}
	})
}
/** Creates an unstarted host root, binding its writer and private checked-file request together. */
export function createTestAppNoteRestore(
	options: Omit<TestAppRestoreOptions, 'mode'> & {
		db: Db
		retainDetached: RestoreTransactionWriter<
			Transaction<'mergeable'>,
			WriteHandle
		>['retainDetached']
	}
) {
	const request = prepareTestAppRestore({
		mode: 'resume',
		archive: options.archive,
		binding: options.binding,
		databaseName: options.databaseName
	})
	const destination = createTestAppNoteWriter(options.db, request)
	const writer = createTestAppTransactionWriter(options.db, options.retainDetached)
	const actor = createActor(createTestAppRestoreNoteMachine(writer, destination), {
		input: { request }
	})
	return { actor, request }
}
