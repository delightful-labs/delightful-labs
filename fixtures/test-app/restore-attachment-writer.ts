import type { EventPayload } from '../../src/lib/contracts/machine-events.js'
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
	testAppRestoreAttachment,
	requiredTestAppRestoreValue as required,
	type TestAppRestoreRequest,
	type TestAppRestoreOptions,
	type TestAppAttachmentExpected
} from './restore-request.js'
import { createTestAppRestoreAttachmentMachine } from './restore-attachment.js'

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
	expected: TestAppAttachmentExpected,
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
	expected: TestAppAttachmentExpected,
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
	expected: TestAppAttachmentExpected
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
function query(intent: RestoreJournalIntent, expected: TestAppAttachmentExpected) {
	return testAppRestoreApp.restoreDestinations
		.where({ id: intent.operation.destinationWorkspaceId })
		.include({ attachments: testAppRestoreApp.restoreAttachments.where({ id: expected.id }) })
}
/** The destination actor borrows a transaction; the shared write actor owns its full lifetime. */
export function createTestAppAttachmentWriter(db: Db, request: TestAppRestoreRequest) {
	type Input = RestoreDestinationInput<Transaction<'mergeable'>>
	type Handle = { toJSON(): { kind: 'testAppAttachmentObservation' } }
	type Context = {
		input: Input
		handle: Handle
		interruption: 'cancelled' | 'closed' | 'invalidated' | undefined
		result: RestoreDestinationResult
	}
	const observations = new WeakMap<Handle, { observed: DestinationObservation | undefined }>()
	const expected = () => required(testAppRestoreAttachment(request))
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
			const file = expected()
			transaction.insert(
				testAppRestoreApp.restoreAttachments,
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
				const file = testAppRestoreAttachment(request)
				return (
					file !== undefined &&
					expectedScopeMatches(file, context.input.intent, context.input.step) &&
					expectedMappingMatches(file, context.input.intent, context.input.step)
				)
			},
			hasExpected: () => testAppRestoreAttachment(request) !== undefined,
			remoteOperation: ({ context }) => context.input.operation === 'remote',
			authorityOperation: ({ context }) => context.input.operation === 'authority',
			readOperation: ({ context }) => context.input.operation === 'read',
			stageOperation: ({ context }) => context.input.operation === 'stage',
			hasObservation: ({ context }) => observed(context) !== undefined,
			controlMatches: ({ context }) => {
				const row = observed(context)
				return row !== undefined && destinationMatches(row, context.input.intent)
			},
			filePresent: ({ context }) => observed(context)?.attachments.length === 1,
			contentMatches: ({ context }) => {
				const file = observed(context)?.attachments[0]
				const expectation = testAppRestoreAttachment(request)
				return (
					file !== undefined && expectation !== undefined && attachmentMatches(file, expectation)
				)
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
		id: 'test-app-attachment-destination',
		initial: 'working',
		context: ({ input }) => {
			const handle: Handle = { toJSON: () => ({ kind: 'testAppAttachmentObservation' }) }
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
								return { target: '#test-app-attachment-destination.complete' }
							}
							if (!args.guards.hasExpected()) {
								return { target: '#test-app-attachment-destination.unavailable' }
							}
							if (args.guards.scopeMatches(args)) {
								return { target: 'selectingOperation' }
							}
							return { target: '#test-app-attachment-destination.conflict' }
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
							return { target: '#test-app-attachment-destination.unavailable' }
						}
					},
					readingRemote: {
						invoke: {
							src: 'remote',
							input,
							onDone: (args) => {
								if (args.guards.interrupted(args)) {
									return { target: '#test-app-attachment-destination.complete' }
								}
								return { target: 'checkingObservation' }
							},
							onError: { target: '#test-app-attachment-destination.unavailable' }
						}
					},
					readingTransaction: {
						invoke: {
							src: 'read',
							input,
							onDone: (args) => {
								if (args.guards.interrupted(args)) {
									return { target: '#test-app-attachment-destination.complete' }
								}
								return { target: 'checkingObservation' }
							},
							onError: { target: '#test-app-attachment-destination.unavailable' }
						}
					},
					checkingObservation: {
						always: (args) => {
							if (!args.guards.hasObservation(args)) {
								return { target: '#test-app-attachment-destination.unavailable' }
							}
							if (!args.guards.controlMatches(args)) {
								return { target: '#test-app-attachment-destination.conflict' }
							}
							if (!args.guards.filePresent(args)) {
								return { target: '#test-app-attachment-destination.missing' }
							}
							if (args.guards.contentMatches(args)) {
								return { target: '#test-app-attachment-destination.match' }
							}
							return { target: '#test-app-attachment-destination.conflict' }
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
									target: '#test-app-attachment-destination.complete',
									context: { result: args.event.output }
								}
							},
							onError: { target: '#test-app-attachment-destination.unavailable' }
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
export function createTestAppAttachmentRestore(
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
	const destination = createTestAppAttachmentWriter(options.db, request)
	const writer = createTestAppTransactionWriter(options.db, options.retainDetached)
	const actor = createActor(createTestAppRestoreAttachmentMachine(writer, destination), {
		input: { request }
	})
	return { actor, request }
}
