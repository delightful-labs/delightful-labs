import { forwardTo, raise, assign, createActor, fromCallback, fromPromise, setup } from 'xstate'
import type { Db, Transaction, WriteHandle } from 'jazz-tools'
import { sameBackupBinding, type BackupBinding } from 'delightful-local-first/backup/export'
import type {
	RestoreEvent,
	RestoreResult,
	RestoreTransactionWriter
} from 'delightful-local-first/backup/restore'
import {
	parseRestoreJournalRecord,
	type RestoreJournalRecord
} from 'delightful-local-first/backup/restore/journal'
import {
	createRestoreMachine,
	createRestoreJournalStepMachine
} from 'delightful-local-first/backup/restore/workflow'
import {
	claimNotebookRestore,
	notebookRestoreData as data,
	notebookRestoreResources,
	prepareNotebookRestore,
	requiredNotebookRestoreValue as required,
	type NotebookRestoreRequest,
	type NotebookRestoreOptions
} from './restore-request.js'
import { createNotebookRestorePlanningMachine } from './restore-planning.js'
import { notebookRecoveryIntentMatches, currentNotebookBatch } from './restore-step-data.js'
import {
	notebookCurrentStepIsAttachment,
	prepareNotebookAttachmentBytes
} from './restore-attachment-data.js'
import { notebookCurrentStepIsRoot, prepareNotebookRoot } from './restore-notebook.js'
import { notebookCurrentStepIsNote, prepareNotebookNote } from './restore-note.js'
import { createNotebookAttachmentWriter } from './restore-attachment-writer.js'
import { createNotebookRootWriter } from './restore-notebook-writer.js'
import { createNotebookNoteWriter } from './restore-note-writer.js'
import {
	createNotebookPreparationWriter,
	createNotebookTransactionWriter
} from './restore-writer.js'
import {
	compareNotebookDestination,
	createNotebookActivationDestination,
	notebookDestinationGraphQuery,
	type NotebookComparison
} from './restore-comparison.js'

type Input = { request: NotebookRestoreRequest }
/** Application-owned workflow. The shared writers retain all native transaction lifetimes. */
export function createNotebookRestoreWorkflow(
	db: Db,
	writer: RestoreTransactionWriter<Transaction<'mergeable'>, WriteHandle>,
	request: NotebookRestoreRequest
) {
	type Context = Input & {
		binding: BackupBinding
		databaseName: string
		interruption: 'cancelled' | 'closed' | 'invalidated' | undefined
		result: RestoreResult
	}
	const actors = {
		resources: notebookRestoreResources,
		identity: fromCallback<RestoreEvent, BackupBinding>(({ input, sendBack }) => {
			try {
				return db.onAuthChanged((state) =>
					sendBack({ type: 'IDENTITY', binding: input, identityId: state.session?.user.account })
				)
			} catch {
				sendBack({ type: 'IDENTITY_FAILED', binding: input })
			}
		}),
		journal: createRestoreJournalStepMachine(),
		plan: createNotebookRestorePlanningMachine(),
		prepare: createRestoreMachine(writer, createNotebookPreparationWriter(db)),
		attachment: createRestoreMachine(writer, createNotebookAttachmentWriter(db, request)),
		notebook: createRestoreMachine(writer, createNotebookRootWriter(db, request)),
		note: createRestoreMachine(writer, createNotebookNoteWriter(db, request)),
		activate: createRestoreMachine(writer, createNotebookActivationDestination(db, request)),
		compare: fromPromise<NotebookComparison, Input>(({ input }) =>
			db
				.one(notebookDestinationGraphQuery(data(input).binding.workspaceId), { tier: 'remote' })
				.then((row) => compareNotebookDestination(row, input.request))
		)
	}
	const model = setup<
		Context,
		| RestoreEvent
		| { type: 'RELEASE' | 'CLAIMED' | 'CLAIM_FAILED' | 'EXPECTED_READY' | 'EXPECTED_FAILED' }
		| { type: 'IDENTITY'; binding: BackupBinding; identityId: string | undefined }
		| { type: 'IDENTITY_FAILED'; binding: BackupBinding },
		typeof actors,
		{},
		{ interrupt: undefined },
		{ interrupted: undefined; currentBinding: undefined },
		never,
		string,
		Input,
		RestoreResult
	>({
		actors,
		guards: {
			interrupted: ({ context }) => context.interruption !== undefined,
			currentBinding: ({ context, event }) =>
				event.type === 'INVALIDATE' && sameBackupBinding(context.binding, event.binding)
		},
		actions: {
			interrupt: assign({
				interruption: ({ context, event }) =>
					context.interruption ??
					(event.type === 'SHUTDOWN'
						? 'closed'
						: event.type === 'INVALIDATE' ||
							  event.type === 'IDENTITY' ||
							  event.type === 'IDENTITY_FAILED'
							? 'invalidated'
							: 'cancelled')
			})
		}
	})

	const input = ({ context }: { context: Context }) => ({ request: context.request })
	const writeInput = ({ context }: { context: Context }) => ({
		binding: context.binding,
		databaseName: context.databaseName,
		intent: required(data(context).intent),
		writeId: required(currentNotebookBatch(context)).writeId
	})
	// Retained journal metadata is the only cursor; expected content stays in the private request.
	const retainRecord = (context: Context, record: RestoreJournalRecord | undefined) => {
		data(context).observedJournal = record
	}
	const terminal = '#notebook-restore-workflow.reporting'
	const batchWrite = (src: 'attachment' | 'notebook' | 'note') =>
		model.createStateConfig({
			on: {
				CANCEL: { actions: ['interrupt', forwardTo('effect')] },
				SHUTDOWN: { actions: ['interrupt', forwardTo('effect')] },
				INVALIDATE: { guard: 'currentBinding', actions: ['interrupt', forwardTo('effect')] }
			},

			invoke: {
				id: 'effect',
				src,
				input: writeInput,
				onDone: [
					{
						guard: ({ event }) => event.output.outcome === 'batchWritten',
						target: 'selecting',
						actions: [
							({ context, event }) => {
								data(context).attachment = undefined
								data(context).notebook = undefined
								data(context).notes = undefined
								retainRecord(context, event.output.record)
							},
							assign({ result: ({ event }) => ({ ...event.output, outcome: 'incomplete' }) })
						]
					},
					{ target: terminal, actions: assign({ result: ({ event }) => event.output }) }
				],
				onError: terminal
			}
		})
	return model.createMachine({
		id: 'notebook-restore-workflow',
		initial: 'claiming',
		context: ({ input }) => ({
			...input,
			binding: data(input).binding,
			databaseName: data(input).options?.databaseName ?? '',
			interruption: undefined,
			result: { binding: data(input).binding, outcome: 'unavailable', record: undefined }
		}),
		output: ({ context }) => ({
			...context.result,
			outcome: context.interruption ?? context.result.outcome
		}),
		on: {
			CANCEL: { actions: 'interrupt' },
			SHUTDOWN: { actions: 'interrupt' },
			INVALIDATE: { guard: 'currentBinding', actions: 'interrupt' },
			RELEASE: { actions: raise({ type: 'CANCEL' }) },
			IDENTITY: {
				guard: ({ context, event }) =>
					sameBackupBinding(context.binding, event.binding) &&
					event.identityId !== context.binding.identityId,
				actions: raise(({ context }) => ({ type: 'INVALIDATE', binding: context.binding }))
			},
			IDENTITY_FAILED: {
				guard: ({ context, event }) => sameBackupBinding(context.binding, event.binding),
				actions: raise(({ context }) => ({ type: 'INVALIDATE', binding: context.binding }))
			}
		},
		states: {
			claiming: {
				entry: ({ context, self }) =>
					self.send({ type: claimNotebookRestore(context) ? 'CLAIMED' : 'CLAIM_FAILED' }),
				on: { CLAIMED: 'working', CLAIM_FAILED: 'reporting' }
			},
			working: {
				initial: 'admitting',
				invoke: [
					{ src: 'resources', input, onError: terminal },
					{
						src: 'identity',
						input: ({ context }) => context.binding,
						onError: {
							actions: raise(({ context }) => ({
								type: 'IDENTITY_FAILED',
								binding: context.binding
							}))
						}
					}
				],
				states: {
					admitting: {
						always: [
							{ guard: 'interrupted', target: terminal },
							{
								guard: ({ context }) => data(context).options?.mode === 'new',
								target: 'initializing'
							},
							{ target: 'planning' }
						]
					},
					initializing: {
						invoke: {
							id: 'effect',
							src: 'journal',
							input: ({ context }) => ({
								binding: context.binding,
								databaseName: context.databaseName,
								command: { mode: 'initialize' }
							}),
							onDone: [
								{ guard: 'interrupted', target: terminal },
								{
									guard: ({ event }) => event.output.outcome === 'initialized',
									target: 'planning'
								},
								{ target: terminal }
							],
							onError: terminal
						}
					},
					planning: {
						on: {
							CANCEL: { actions: ['interrupt', forwardTo('effect')] },
							SHUTDOWN: { actions: ['interrupt', forwardTo('effect')] },
							INVALIDATE: { guard: 'currentBinding', actions: ['interrupt', forwardTo('effect')] }
						},

						invoke: {
							id: 'effect',
							src: 'plan',
							input,
							onDone: [
								{ guard: 'interrupted', target: terminal },
								{
									guard: ({ context, event }) =>
										event.output.outcome === 'planned' &&
										(data(context).options?.mode === 'new' ||
											notebookRecoveryIntentMatches(context)),
									target: 'selecting',
									actions: assign({
										result: ({ context }) => ({
											binding: context.binding,
											outcome: 'incomplete',
											record: data(context).observedJournal
										})
									})
								},
								{ target: terminal }
							],
							onError: terminal
						}
					},
					selecting: {
						always: [
							{ guard: 'interrupted', target: terminal },
							{
								guard: ({ context }) => {
									const checkpoint = data(context).observedJournal?.checkpoint
									return (
										!checkpoint ||
										(checkpoint.kind === 'writing' && checkpoint.completed.length === 0)
									)
								},
								target: 'preparing'
							},
							{
								guard: ({ context }) =>
									data(context).observedJournal?.checkpoint.kind === 'comparing',
								target: 'comparing'
							},
							{
								guard: ({ context }) =>
									data(context).observedJournal?.checkpoint.kind === 'activating' ||
									data(context).observedJournal?.checkpoint.kind === 'complete',
								target: 'activating'
							},
							{
								guard: ({ context }) => notebookCurrentStepIsAttachment(context),
								target: 'preparingAttachment'
							},
							{
								guard: ({ context }) => notebookCurrentStepIsRoot(context),
								target: 'preparingNotebook'
							},
							{
								guard: ({ context }) => notebookCurrentStepIsNote(context),
								target: 'preparingNote'
							},
							{ target: '#notebook-restore-workflow.conflict' }
						]
					},
					preparing: {
						on: {
							CANCEL: { actions: ['interrupt', forwardTo('effect')] },
							SHUTDOWN: { actions: ['interrupt', forwardTo('effect')] },
							INVALIDATE: { guard: 'currentBinding', actions: ['interrupt', forwardTo('effect')] }
						},

						invoke: {
							id: 'effect',
							src: 'prepare',
							input: ({ context }) => ({
								binding: context.binding,
								databaseName: context.databaseName,
								intent: required(data(context).intent),
								writeId: required(data(context).intent).plan.preparation.writeId
							}),
							onDone: [
								{
									guard: ({ event }) => event.output.outcome === 'prepared',
									target: 'selecting',
									actions: [
										({ context, event }) => retainRecord(context, event.output.record),
										assign({ result: ({ event }) => ({ ...event.output, outcome: 'incomplete' }) })
									]
								},
								{ target: terminal, actions: assign({ result: ({ event }) => event.output }) }
							],
							onError: terminal
						}
					},
					preparingAttachment: {
						entry: ({ context, self }) => {
							try {
								prepareNotebookAttachmentBytes(context)
								self.send({ type: 'EXPECTED_READY' })
							} catch {
								self.send({ type: 'EXPECTED_FAILED' })
							}
						},
						on: { EXPECTED_READY: 'writingAttachment', EXPECTED_FAILED: terminal }
					},
					preparingNotebook: {
						entry: ({ context, self }) => {
							try {
								prepareNotebookRoot(context)
								self.send({ type: 'EXPECTED_READY' })
							} catch {
								self.send({ type: 'EXPECTED_FAILED' })
							}
						},
						on: { EXPECTED_READY: 'writingNotebook', EXPECTED_FAILED: terminal }
					},
					preparingNote: {
						entry: ({ context, self }) => {
							try {
								prepareNotebookNote(context)
								self.send({ type: 'EXPECTED_READY' })
							} catch {
								self.send({ type: 'EXPECTED_FAILED' })
							}
						},
						on: { EXPECTED_READY: 'writingNote', EXPECTED_FAILED: terminal }
					},
					writingAttachment: batchWrite('attachment'),
					writingNotebook: batchWrite('notebook'),
					writingNote: batchWrite('note'),
					comparing: {
						invoke: {
							id: 'effect',
							src: 'compare',
							input,
							onDone: [
								{ guard: 'interrupted', target: terminal },
								{
									guard: ({ event }) => event.output === 'incompleteMatch',
									target: 'savingComparison'
								},
								{
									guard: ({ event }) =>
										event.output === 'conflict' || event.output === 'activeMatch',
									target: '#notebook-restore-workflow.conflict'
								},
								{ target: terminal }
							],
							onError: terminal
						}
					},
					savingComparison: {
						invoke: {
							id: 'effect',
							src: 'journal',
							input: ({ context }) => {
								const record = required(data(context).observedJournal)
								return {
									binding: context.binding,
									databaseName: context.databaseName,
									command: {
										mode: 'update',
										expectedRevision: record.revision,
										record: parseRestoreJournalRecord({
											...record,
											revision: record.revision + 1,
											checkpoint: {
												kind: 'activating',
												completed:
													record.checkpoint.kind === 'conflict'
														? record.checkpoint.prior.completed
														: record.checkpoint.completed,
												comparison: {
													payloadSha256: record.intent.archive.payloadSha256,
													graphSha256: record.intent.plan.expectedGraphSha256
												},
												current: {
													status: 'notIssued',
													writeId: record.intent.plan.activation.writeId,
													issuance: 0
												}
											}
										})
									}
								}
							},
							onDone: [
								{
									guard: ({ event }) =>
										event.output.outcome === 'updated' && event.output.record !== undefined,
									target: 'selecting',
									actions: [
										({ context, event }) => retainRecord(context, event.output.record),
										assign({
											result: ({ context, event }) => ({
												...context.result,
												record: event.output.record
											})
										})
									]
								},
								{ target: terminal }
							],
							onError: terminal
						}
					},
					activating: {
						on: {
							CANCEL: { actions: ['interrupt', forwardTo('effect')] },
							SHUTDOWN: { actions: ['interrupt', forwardTo('effect')] },
							INVALIDATE: { guard: 'currentBinding', actions: ['interrupt', forwardTo('effect')] }
						},

						invoke: {
							id: 'effect',
							src: 'activate',
							input: ({ context }) => ({
								binding: context.binding,
								databaseName: context.databaseName,
								intent: required(data(context).intent),
								writeId: required(data(context).intent).plan.activation.writeId
							}),
							onDone: {
								target: terminal,
								actions: assign({ result: ({ event }) => event.output })
							},
							onError: terminal
						}
					}
				}
			},
			conflict: {
				type: 'final',
				entry: assign({ result: ({ context }) => ({ ...context.result, outcome: 'conflict' }) })
			},
			reporting: {
				always: [
					{ guard: ({ context }) => context.interruption === 'cancelled', target: 'cancelled' },
					{ guard: ({ context }) => context.interruption === 'closed', target: 'closed' },
					{ guard: ({ context }) => context.interruption === 'invalidated', target: 'invalidated' },
					{ guard: ({ context }) => context.result.outcome === 'complete', target: 'succeeded' },
					{ guard: ({ context }) => context.result.outcome === 'conflict', target: 'conflict' },
					{
						guard: ({ context }) => context.result.outcome === 'unavailable',
						target: 'unavailable'
					},
					{ target: 'incomplete' }
				]
			},
			succeeded: { type: 'final' },
			incomplete: {
				type: 'final',
				entry: assign({ result: ({ context }) => ({ ...context.result, outcome: 'incomplete' }) })
			},
			unavailable: { type: 'final' },
			cancelled: { type: 'final' },
			closed: { type: 'final' },
			invalidated: { type: 'final' }
		}
	})
}

export function createNotebookRestore(
	options: NotebookRestoreOptions & {
		db: Db
		retainDetached: RestoreTransactionWriter<
			Transaction<'mergeable'>,
			WriteHandle
		>['retainDetached']
	}
) {
	const request = prepareNotebookRestore({
		mode: options.mode,
		binding: options.binding,
		databaseName: options.databaseName,
		archive: options.archive
	})
	const writer = createNotebookTransactionWriter(options.db, options.retainDetached)
	return {
		request,
		actor: createActor(createNotebookRestoreWorkflow(options.db, writer, request), {
			input: { request }
		})
	}
}
