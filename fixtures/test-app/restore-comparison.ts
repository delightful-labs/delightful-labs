import { forwardTo, assign, fromPromise, setup } from 'xstate'
import type { Db, Transaction, schema } from 'jazz-tools'
import {
	restoreTransactionAccess,
	type RestoreDestinationInput,
	type RestoreDestinationResult,
	type RestoreEvent
} from 'delightful-local-first/backup/restore'
import { sameBackupBinding } from 'delightful-local-first/backup/export'
import { testAppRestoreApp } from './restore-schema.js'
import { testAppCanonical, projectTestAppRecords } from './restore-plan.js'
import { testAppRestoreData, type TestAppRestoreRequest } from './restore-request.js'
import { createTestAppDestinationWriteMachine } from './restore-writer.js'

type Input = RestoreDestinationInput<Transaction<'mergeable'>>
type Control = schema.RowOf<typeof testAppRestoreApp.restoreDestinations>
type Graph = Control & {
	notebooks: schema.RowOf<typeof testAppRestoreApp.restoreNotebooks>[]
	notes: schema.RowOf<typeof testAppRestoreApp.restoreNotes>[]
	attachments: schema.RowOf<typeof testAppRestoreApp.restoreAttachments>[]
}
export type TestAppComparison = 'incompleteMatch' | 'activeMatch' | 'conflict' | 'unavailable'
export function testAppDestinationGraphQuery(destinationId: string) {
	return testAppRestoreApp.restoreDestinations.where({ id: destinationId }).include({
		notebooks: testAppRestoreApp.restoreNotebooks,
		notes: testAppRestoreApp.restoreNotes,
		attachments: testAppRestoreApp.restoreAttachments
	})
}
/** Pure complete-set comparison. Native rows and private content never enter actor snapshots. */
export function compareTestAppDestination(
	row: Graph | null,
	request: TestAppRestoreRequest
): TestAppComparison {
	if (!row) return 'unavailable'
	const value = testAppRestoreData({ request }),
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
	const expectedRecords = projectTestAppRecords(value).sort((a, b) => (a.id < b.id ? -1 : 1))
	if (testAppCanonical(records) !== testAppCanonical(expectedRecords)) return 'conflict'
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
export function createTestAppActivationDestination(db: Db, request: TestAppRestoreRequest) {
	type Context = {
		input: Input
		interruption: 'cancelled' | 'closed' | 'invalidated' | undefined
		result: RestoreDestinationResult
	}
	const actors = {
		remote: fromPromise<TestAppComparison, Input>(({ input }) =>
			db
				.one(testAppDestinationGraphQuery(input.binding.workspaceId), { tier: 'remote' })
				.then((row) => compareTestAppDestination(row, request))
		),
		read: fromPromise<TestAppComparison, Input>(({ input }) =>
			restoreTransactionAccess(input).call((transaction) =>
				transaction
					.one(testAppDestinationGraphQuery(input.binding.workspaceId))
					.then((row) => compareTestAppDestination(row, request))
			)
		),
		write: createTestAppDestinationWriteMachine(db, (transaction, input) => {
			transaction.update(testAppRestoreApp.restoreDestinations, input.binding.workspaceId, {
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

	const input = ({ context }: { context: Context }) => context.input
	return model.createMachine({
		id: 'test-app-activation-destination',
		initial: 'admitting',
		context: ({ input }) => ({ input, interruption: undefined, result: 'unavailable' }),
		output: ({ context }) => context.interruption ?? context.result,
		on: {
			CANCEL: {
				actions: assign({ interruption: ({ context }) => context.interruption ?? 'cancelled' })
			},
			SHUTDOWN: {
				actions: assign({ interruption: ({ context }) => context.interruption ?? 'closed' })
			},
			INVALIDATE: {
				guard: ({ context, event }) => sameBackupBinding(context.input.binding, event.binding),
				actions: assign({ interruption: ({ context }) => context.interruption ?? 'invalidated' })
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
				on: {
					CANCEL: {
						actions: [
							assign({ interruption: ({ context }) => context.interruption ?? 'cancelled' }),
							forwardTo('write')
						]
					},
					SHUTDOWN: {
						actions: [
							assign({ interruption: ({ context }) => context.interruption ?? 'closed' }),
							forwardTo('write')
						]
					},
					INVALIDATE: {
						guard: ({ context, event }) => sameBackupBinding(context.input.binding, event.binding),
						actions: [
							assign({ interruption: ({ context }) => context.interruption ?? 'invalidated' }),
							forwardTo('write')
						]
					}
				},

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
