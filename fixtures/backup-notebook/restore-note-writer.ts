import { z } from 'zod'
import { createActor } from 'xstate'
import type { Db, Transaction, WriteHandle } from 'jazz-tools'
import { payloadLimits } from 'delightful-local-first/backup/archive'
import type { RestoreJournalIntent } from 'delightful-local-first/backup/restore/journal'
import type {
	RestorePlannedWrite,
	RestoreStepPresence,
	RestoreStepWriter
} from 'delightful-local-first/backup/restore/batch'
import { notebookRestoreApp } from './restore-schema.js'
import { createNotebookPreparationWriter } from './restore-writer.js'
import {
	notebookRestoreData,
	requiredNotebookRestoreValue as required,
	type NotebookRestoreRequest,
	type NotebookRestoreOptions,
	type NotebookNoteExpected
} from './restore-request.js'
import { createNotebookRestoreNoteMachine, prepareNotebookNoteRestore } from './restore-note.js'

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
/** Pure decoding/content classification only; no I/O, retries or workflow advancement. */
function presence(
	raw: unknown,
	expected: NotebookNoteExpected,
	intent: RestoreJournalIntent,
	step: RestorePlannedWrite
): RestoreStepPresence {
	const observed = destinationObservation.safeParse(raw)
	if (!observed.success) return 'unavailable'
	if (
		!expectedScopeMatches(expected, intent, step) ||
		!expectedMappingMatches(expected, intent, step)
	)
		return 'conflict'
	if (!destinationMatches(observed.data, intent)) return 'conflict'
	if (!parentsPresent(observed.data, expected)) return 'unavailable'
	if (!parentsMatch(observed.data, expected)) return 'conflict'
	const row = observed.data.notes[0]
	if (!row) return 'missingOrHidden'
	return noteMatches(row, expected) ? 'match' : 'conflict'
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
/** Every asynchronous method performs one SDK leaf against the original bound database. */
export function createNotebookNoteWriter(
	db: Db,
	request: NotebookRestoreRequest,
	retainDetached: RestoreStepWriter<Transaction<'mergeable'>, WriteHandle>['retainDetached']
): RestoreStepWriter<Transaction<'mergeable'>, WriteHandle> {
	const native = createNotebookPreparationWriter(db, retainDetached)
	const expected = () => required(notebookRestoreData({ request }).note)
	return {
		...native,
		readRemote: (intent, step) => {
			const row = expected()
			return db
				.one(query(intent, row), { tier: 'remote' })
				.then((observed) => presence(observed, row, intent, step))
		},
		checkAuthority: (intent, step) =>
			Promise.resolve(
				db.getAuthState().session?.user.account === intent.operation.identityId &&
					expectedScopeMatches(expected(), intent, step) &&
					expectedMappingMatches(expected(), intent, step)
			),
		readTransaction: (transaction, intent, step) => {
			const row = expected()
			return transaction
				.one(query(intent, row))
				.then((observed) => presence(observed, row, intent, step))
		},
		stage(transaction, intent, step) {
			const row = expected()
			// Recheck atomic scope beside the mutation; the chart owns issuance eligibility.
			if (
				db.getAuthState().session?.user.account !== intent.operation.identityId ||
				!expectedScopeMatches(row, intent, step) ||
				!expectedMappingMatches(row, intent, step)
			)
				throw new Error('Note write scope changed')
			transaction.insert(
				notebookRestoreApp.restoreNotes,
				{
					destinationId: row.destinationId,
					ownerId: row.ownerId,
					operationId: row.operationId,
					notebookId: row.notebookId,
					attachmentId: row.attachmentId,
					body: row.body,
					archived: row.archived
				},
				{ id: row.id }
			)
		}
	}
}
/** Creates an unstarted host root, binding its writer and private checked-file request together. */
export function createNotebookNoteRestore(
	options: Omit<NotebookRestoreOptions, 'mode'> & {
		db: Db
		retainDetached: RestoreStepWriter<Transaction<'mergeable'>, WriteHandle>['retainDetached']
	}
) {
	const request = prepareNotebookNoteRestore({
		archive: options.archive,
		binding: options.binding,
		databaseName: options.databaseName
	})
	const writer = createNotebookNoteWriter(options.db, request, options.retainDetached)
	const actor = createActor(createNotebookRestoreNoteMachine(writer), { input: { request } })
	return { actor, request }
}
