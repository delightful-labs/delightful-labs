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
	type NotebookRootExpected
} from './restore-request.js'
import { createNotebookRestoreRootMachine, prepareNotebookRootRestore } from './restore-notebook.js'

const identifier = z.string().min(1).max(256)
const digest = z.string().regex(/^[0-9a-f]{64}$/)
const notebookObservation = z.object({
	id: identifier,
	destinationId: identifier,
	ownerId: identifier,
	operationId: identifier,
	title: z.string().max(payloadLimits.textBytes)
})
const destinationObservation = z.object({
	id: identifier,
	ownerId: identifier,
	operationId: identifier,
	payloadSha256: digest,
	graphSha256: digest,
	status: z.enum(['incomplete', 'active']),
	notebooks: z.array(notebookObservation).max(1)
})
type DestinationObservation = z.infer<typeof destinationObservation>

function expectedScopeMatches(
	expected: NotebookRootExpected,
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
	expected: NotebookRootExpected,
	intent: RestoreJournalIntent,
	step: RestorePlannedWrite
): boolean {
	if (step.mappingIndexes.length !== 1) return false
	const index = step.mappingIndexes[0]
	const mapping = index === undefined ? undefined : intent.plan.mappings[index]
	return (
		mapping?.kind === 'record' &&
		mapping.type === 'notebook' &&
		mapping.destinationId === expected.id &&
		mapping.sourceId === expected.sourceId
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
function notebookMatches(
	row: z.infer<typeof notebookObservation>,
	expected: NotebookRootExpected
): boolean {
	return (
		row.id === expected.id &&
		row.destinationId === expected.destinationId &&
		row.ownerId === expected.ownerId &&
		row.operationId === expected.operationId &&
		row.title === expected.title
	)
}
/** Pure decoding/content classification only; no I/O, retries or workflow advancement. */
function presence(
	raw: unknown,
	expected: NotebookRootExpected,
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
	const row = observed.data.notebooks[0]
	if (!row) return 'missingOrHidden'
	return notebookMatches(row, expected) ? 'match' : 'conflict'
}
function query(intent: RestoreJournalIntent, expected: NotebookRootExpected) {
	return notebookRestoreApp.restoreDestinations
		.where({ id: intent.operation.destinationWorkspaceId })
		.include({ notebooks: notebookRestoreApp.restoreNotebooks.where({ id: expected.id }) })
}
/** Every asynchronous method performs one SDK leaf against the original bound database. */
export function createNotebookRootWriter(
	db: Db,
	request: NotebookRestoreRequest,
	retainDetached: RestoreStepWriter<Transaction<'mergeable'>, WriteHandle>['retainDetached']
): RestoreStepWriter<Transaction<'mergeable'>, WriteHandle> {
	const native = createNotebookPreparationWriter(db, retainDetached)
	const expected = () => required(notebookRestoreData({ request }).notebook)
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
				throw new Error('Notebook write scope changed')
			transaction.insert(
				notebookRestoreApp.restoreNotebooks,
				{
					destinationId: row.destinationId,
					ownerId: row.ownerId,
					operationId: row.operationId,
					title: row.title
				},
				{ id: row.id }
			)
		}
	}
}
/** Creates an unstarted host root, binding its writer and private checked-file request together. */
export function createNotebookRootRestore(
	options: Omit<NotebookRestoreOptions, 'mode'> & {
		db: Db
		retainDetached: RestoreStepWriter<Transaction<'mergeable'>, WriteHandle>['retainDetached']
	}
) {
	const request = prepareNotebookRootRestore({
		archive: options.archive,
		binding: options.binding,
		databaseName: options.databaseName
	})
	const writer = createNotebookRootWriter(options.db, request, options.retainDetached)
	const actor = createActor(createNotebookRestoreRootMachine(writer), { input: { request } })
	return { actor, request }
}
