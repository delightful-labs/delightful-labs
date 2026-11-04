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
	type NotebookAttachmentExpected
} from './restore-request.js'
import {
	createNotebookRestoreAttachmentMachine,
	prepareNotebookAttachmentRestore
} from './restore-attachment.js'

const identifier = z.string().min(1).max(256)
const digest = z.string().regex(/^[0-9a-f]{64}$/)
const attachmentObservation = z.object({
	id: identifier,
	destinationId: identifier,
	ownerId: identifier,
	operationId: identifier,
	mediaType: z.string().max(payloadLimits.textBytes),
	fileName: z.string().max(payloadLimits.textBytes),
	sizeBytes: z.int().min(0).max(payloadLimits.attachmentBytes),
	sha256: digest,
	contents: z
		.instanceof(Uint8Array)
		.refine((bytes) => bytes.byteLength <= payloadLimits.attachmentBytes)
})
const destinationObservation = z.object({
	id: identifier,
	ownerId: identifier,
	operationId: identifier,
	payloadSha256: digest,
	graphSha256: digest,
	status: z.enum(['incomplete', 'active']),
	attachments: z.array(attachmentObservation).max(1)
})
type DestinationObservation = z.infer<typeof destinationObservation>

function expectedScopeMatches(
	expected: NotebookAttachmentExpected,
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
	expected: NotebookAttachmentExpected,
	intent: RestoreJournalIntent,
	step: RestorePlannedWrite
): boolean {
	if (step.mappingIndexes.length !== 1) return false
	const index = step.mappingIndexes[0]
	const mapping = index === undefined ? undefined : intent.plan.mappings[index]
	return (
		mapping?.kind === 'attachment' &&
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
function attachmentMatches(
	file: z.infer<typeof attachmentObservation>,
	expected: NotebookAttachmentExpected
): boolean {
	return (
		file.id === expected.id &&
		file.destinationId === expected.destinationId &&
		file.ownerId === expected.ownerId &&
		file.operationId === expected.operationId &&
		file.mediaType === expected.mediaType &&
		file.fileName === expected.fileName &&
		file.sizeBytes === expected.sizeBytes &&
		file.sha256 === expected.sha256 &&
		file.contents.byteLength === expected.contents.byteLength &&
		file.contents.every((byte, index) => byte === expected.contents[index])
	)
}
/** Pure decoding/content classification only; no I/O, retries or workflow advancement. */
function presence(
	raw: unknown,
	expected: NotebookAttachmentExpected,
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
	const file = observed.data.attachments[0]
	if (!file) return 'missingOrHidden'
	return attachmentMatches(file, expected) ? 'match' : 'conflict'
}
function query(intent: RestoreJournalIntent, expected: NotebookAttachmentExpected) {
	return notebookRestoreApp.restoreDestinations
		.where({ id: intent.operation.destinationWorkspaceId })
		.include({ attachments: notebookRestoreApp.restoreAttachments.where({ id: expected.id }) })
}
/** Every asynchronous method performs one SDK leaf against the original bound database. */
export function createNotebookAttachmentWriter(
	db: Db,
	request: NotebookRestoreRequest,
	retainDetached: RestoreStepWriter<Transaction<'mergeable'>, WriteHandle>['retainDetached']
): RestoreStepWriter<Transaction<'mergeable'>, WriteHandle> {
	const native = createNotebookPreparationWriter(db, retainDetached)
	const expected = () => required(notebookRestoreData({ request }).attachment)
	return {
		...native,
		readRemote: (intent, step) => {
			const file = expected()
			return db
				.one(query(intent, file), { tier: 'remote' })
				.then((row) => presence(row, file, intent, step))
		},
		checkAuthority: (intent, step) =>
			Promise.resolve(
				db.getAuthState().session?.user.account === intent.operation.identityId &&
					expectedScopeMatches(expected(), intent, step) &&
					expectedMappingMatches(expected(), intent, step)
			),
		readTransaction: (transaction, intent, step) => {
			const file = expected()
			return transaction.one(query(intent, file)).then((row) => presence(row, file, intent, step))
		},
		stage(transaction, intent, step) {
			const file = expected()
			// Recheck atomic scope beside the mutation; the chart owns issuance eligibility.
			if (
				db.getAuthState().session?.user.account !== intent.operation.identityId ||
				!expectedScopeMatches(file, intent, step) ||
				!expectedMappingMatches(file, intent, step)
			)
				throw new Error('Attachment write scope changed')
			transaction.insert(
				notebookRestoreApp.restoreAttachments,
				{
					destinationId: file.destinationId,
					ownerId: file.ownerId,
					operationId: file.operationId,
					mediaType: file.mediaType,
					fileName: file.fileName,
					sizeBytes: file.sizeBytes,
					sha256: file.sha256,
					contents: file.contents
				},
				{ id: file.id }
			)
		}
	}
}
/** Creates an unstarted host root, binding its writer and private checked-file request together. */
export function createNotebookAttachmentRestore(
	options: Omit<NotebookRestoreOptions, 'mode'> & {
		db: Db
		retainDetached: RestoreStepWriter<Transaction<'mergeable'>, WriteHandle>['retainDetached']
	}
) {
	const request = prepareNotebookAttachmentRestore({
		archive: options.archive,
		binding: options.binding,
		databaseName: options.databaseName
	})
	const writer = createNotebookAttachmentWriter(options.db, request, options.retainDetached)
	const actor = createActor(createNotebookRestoreAttachmentMachine(writer), { input: { request } })
	return { actor, request }
}
