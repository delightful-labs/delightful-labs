import { assign, fromPromise, setup } from 'xstate'
import type { Db, Transaction, schema } from 'jazz-tools'
import {
	restoreTransactionAccess,
	type RestoreDestinationInput,
	type RestoreDestinationResult,
	type RestoreEvent
} from 'delightful-local-first/backup/restore'
import { sameBackupBinding } from 'delightful-local-first/backup/export'
import { notebookRestoreApp } from './restore-schema.js'
import { notebookCanonical, projectNotebookRecords } from './restore-plan.js'
import { notebookRestoreData, type NotebookRestoreRequest } from './restore-request.js'
import { createNotebookDestinationWriteMachine } from './restore-writer.js'

type Input = RestoreDestinationInput<Transaction<'mergeable'>>
type Control = schema.RowOf<typeof notebookRestoreApp.restoreDestinations>
type Graph = Control & {
	notebooks: schema.RowOf<typeof notebookRestoreApp.restoreNotebooks>[]
	notes: schema.RowOf<typeof notebookRestoreApp.restoreNotes>[]
	attachments: schema.RowOf<typeof notebookRestoreApp.restoreAttachments>[]
}
export type NotebookComparison = 'incompleteMatch' | 'activeMatch' | 'conflict' | 'unavailable'
export function notebookDestinationGraphQuery(destinationId: string) {
	return notebookRestoreApp.restoreDestinations.where({ id: destinationId }).include({
		notebooks: notebookRestoreApp.restoreNotebooks,
		notes: notebookRestoreApp.restoreNotes,
		attachments: notebookRestoreApp.restoreAttachments
	})
}
/** Pure complete-set comparison. Native rows and private content never enter actor snapshots. */
export function compareNotebookDestination(
	row: Graph | null,
	request: NotebookRestoreRequest
): NotebookComparison {
	if (!row) return 'unavailable'
	const value = notebookRestoreData({ request }),
		intent = value.intent
	if (!intent) return 'unavailable'
	const operation = intent.operation
	const scope = (child: { destinationId: string; ownerId: string; operationId: string }) =>
		child.destinationId === operation.destinationWorkspaceId &&
		child.ownerId === operation.identityId &&
		child.operationId === operation.operationId
	if (
		row.id !== operation.destinationWorkspaceId ||
		row.ownerId !== operation.identityId ||
		row.operationId !== operation.operationId ||
		row.payloadSha256 !== intent.archive.payloadSha256 ||
		row.graphSha256 !== intent.plan.expectedGraphSha256 ||
		![...row.notebooks, ...row.notes, ...row.attachments].every(scope)
	)
		return 'conflict'
	const records = [
		...row.notebooks.map((book) => ({
			type: 'notebook',
			id: book.id,
			fields: { title: { kind: 'text', value: book.title } }
		})),
		...row.notes.map((note) => ({
			type: 'note',
			id: note.id,
			fields: {
				notebook: { kind: 'reference', type: 'notebook', id: note.notebookId },
				body: { kind: 'text', value: note.body },
				archived: { kind: 'boolean', value: note.archived },
				attachment:
					note.attachmentId === null
						? { kind: 'null' }
						: { kind: 'attachment', id: note.attachmentId }
			}
		}))
	].sort((a, b) => (a.id < b.id ? -1 : 1))
	const expectedRecords = projectNotebookRecords(value).sort((a, b) => (a.id < b.id ? -1 : 1))
	if (notebookCanonical(records) !== notebookCanonical(expectedRecords)) return 'conflict'
	const files = new Map(value.archive.readPayload().attachments.map((file) => [file.id, file]))
	const mappings = new Map(
		intent.plan.mappings
			.filter((mapping) => mapping.kind === 'attachment')
			.map((mapping) => [mapping.destinationId, mapping.sourceId])
	)
	if (row.attachments.length !== files.size) return 'conflict'
	for (const actual of row.attachments) {
		const sourceId = mappings.get(actual.id),
			expected = sourceId === undefined ? undefined : files.get(sourceId)
		if (
			!expected ||
			actual.mediaType !== expected.mediaType ||
			actual.fileName !== expected.fileName ||
			actual.sizeBytes !== expected.sizeBytes ||
			actual.sha256 !== expected.sha256 ||
			actual.contents.length !== expected.sizeBytes
		)
			return 'conflict'
		const bytes = atob(expected.data)
		if (!actual.contents.every((byte, index) => byte === bytes.charCodeAt(index))) return 'conflict'
	}

	return row.status === 'active' ? 'activeMatch' : 'incompleteMatch'
}

/** Fresh graph checks and one native activation update. Shared actors own custody and settlement. */
export function createNotebookActivationDestination(db: Db, request: NotebookRestoreRequest) {
	type Context = {
		input: Input
		interruption: 'cancelled' | 'closed' | 'invalidated' | undefined
		result: RestoreDestinationResult
	}
	const actors = {
		remote: fromPromise<NotebookComparison, Input>(({ input }) =>
			db
				.one(notebookDestinationGraphQuery(input.binding.workspaceId), { tier: 'remote' })
				.then((row) => compareNotebookDestination(row, request))
		),
		read: fromPromise<NotebookComparison, Input>(({ input }) =>
			restoreTransactionAccess(input).call((transaction) =>
				transaction
					.one(notebookDestinationGraphQuery(input.binding.workspaceId))
					.then((row) => compareNotebookDestination(row, request))
			)
		),
		write: createNotebookDestinationWriteMachine(db, (transaction, input) => {
			transaction.update(notebookRestoreApp.restoreDestinations, input.binding.workspaceId, {
				status: 'active'
			})
		})
	}
	const model = setup<
		Context,
		RestoreEvent,
		typeof actors,
		{},
		{},
		{},
		never,
		string,
		Input,
		RestoreDestinationResult
	>({ actors })
	const forward = model.enqueueActions(({ self, event, enqueue }) => {
		const child = self.getSnapshot().children.write
		if (child?.getSnapshot().status === 'active') enqueue.sendTo(child, event)
	})
	const input = ({ context }: { context: Context }) => context.input
	return model.createMachine({
		id: 'notebook-activation-destination',
		initial: 'admitting',
		context: ({ input }) => ({ input, interruption: undefined, result: 'unavailable' }),
		output: ({ context }) => context.interruption ?? context.result,
		on: {
			CANCEL: {
				actions: [
					assign({ interruption: ({ context }) => context.interruption ?? 'cancelled' }),
					forward
				]
			},
			SHUTDOWN: {
				actions: [
					assign({ interruption: ({ context }) => context.interruption ?? 'closed' }),
					forward
				]
			},
			INVALIDATE: {
				guard: ({ context, event }) => sameBackupBinding(context.input.binding, event.binding),
				actions: [
					assign({ interruption: ({ context }) => context.interruption ?? 'invalidated' }),
					forward
				]
			}
		},
		states: {
			admitting: {
				always: [
					{
						guard: ({ context }) =>
							context.input.step.writeId !== context.input.intent.plan.activation.writeId,
						target: 'conflict'
					},
					{ guard: ({ context }) => context.input.operation === 'remote', target: 'remote' },
					{ guard: ({ context }) => context.input.operation === 'read', target: 'read' },
					{ target: 'writing' }
				]
			},
			remote: {
				invoke: {
					src: 'remote',
					input,
					onDone: [
						{ guard: ({ context }) => context.interruption !== undefined, target: 'complete' },
						{ guard: ({ event }) => event.output === 'activeMatch', target: 'match' },
						{ guard: ({ event }) => event.output === 'incompleteMatch', target: 'missing' },
						{ guard: ({ event }) => event.output === 'conflict', target: 'conflict' },
						{ target: 'complete' }
					],
					onError: 'unavailable'
				}
			},
			read: {
				invoke: {
					src: 'read',
					input,
					onDone: [
						{ guard: ({ context }) => context.interruption !== undefined, target: 'complete' },
						{ guard: ({ event }) => event.output === 'incompleteMatch', target: 'missing' },
						{ guard: ({ event }) => event.output === 'conflict', target: 'conflict' },
						{ target: 'complete' }
					],
					onError: 'unavailable'
				}
			},
			writing: {
				invoke: {
					id: 'write',
					src: 'write',
					input,
					onDone: { target: 'complete', actions: assign({ result: ({ event }) => event.output }) },
					onError: 'unavailable'
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
