import { annotationRecoveryMachine, selectAnnotationRecovery } from './recovery.js'
import { setup, types, createAsyncLogic, createCallbackLogic, matchesState } from 'xstate'
import type { SnapshotFrom } from 'xstate'
import { createOwnedOperation } from 'delightful-local-first/lifecycle/operation/workflow'
import type { WorkspaceCreationResult } from 'delightful-local-first/workspace/creation/contracts'
import { syncOwnerMachine } from '../machines/storage/sync-owner.js'
import type { SyncReceipt, SyncReport } from '../contracts/storage.js'
import { stateFeedback } from '../contracts/feedback.js'
import type { WorkflowMessage } from '../contracts/feedback.js'
import { t, noun, action } from '../localization/index.js'
import {
	emptyAnnotationRows,
	noteInputTextSchema,
	normalizeReaderText,
	domOffset,
	READER_TEXT_VERSION,
	textFingerprint
} from './schema.js'
import type {
	AnnotationCommand,
	AnnotationMutation,
	AnnotationRows,
	PreparedAnnotation
} from './schema.js'
import type { AnnotationCapability } from '../backend/jazz/annotations.js'

function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Annotation owner unavailable')
	return value
}
type Context = {
	capability: AnnotationCapability | undefined
	documentId: string
	text: string
	textHash: string | undefined
	rows: AnnotationRows
	visibleRows: AnnotationRows
	queue: AnnotationMutation[]
	prepared: PreparedAnnotation | undefined
	receiptId: string
	receiptSubject: 'highlight' | 'note'
	draftReceipts: Record<string, { noteId: string; text: string; writerId: string | undefined }>
	undoId: string | undefined
	invalidNotes: Record<string, string>
	invalidBases: Record<string, string>
	recoveryChoices: Record<string, { text: string; writerId: string | undefined }>
	adoptedWriters: Record<string, string>
	observationGeneration: number
}
type Event =
	| AnnotationCommand
	| SyncReport
	| { type: 'ROWS'; documentId: string; generation: number; rows: Partial<AnnotationRows> }
	| { type: 'OBSERVATION_FAILED'; documentId: string; generation: number }
	| { type: 'SHUTDOWN' }
type StageResult = WorkspaceCreationResult<PreparedAnnotation, SyncReceipt>
const writeOperation = createOwnedOperation<PreparedAnnotation, StageResult>()
const actors = {
	fingerprint: createAsyncLogic({
		run: async ({ input }: { input: { text: string; generation: number } }) => ({
			hash: await textFingerprint(normalizeReaderText(input.text)),
			generation: input.generation
		})
	}),
	recovery: annotationRecoveryMachine,
	writeOperation,
	receipts: syncOwnerMachine,
	prepare: createAsyncLogic({
		run: ({
			input
		}: {
			input: { capability: AnnotationCapability; command: AnnotationMutation }
		}) => input.capability.prepare(input.command)
	}),
	observe: createCallbackLogic<
		never,
		{ capability: AnnotationCapability; documentId: string; generation: number }
	>(({ input, sendBack }) => {
		try {
			return input.capability.observe(
				input.documentId,
				(rows) =>
					sendBack({
						type: 'ROWS',
						documentId: input.documentId,
						generation: input.generation,
						rows
					}),
				() =>
					sendBack({
						type: 'OBSERVATION_FAILED',
						documentId: input.documentId,
						generation: input.generation
					})
			)
		} catch {
			sendBack({
				type: 'OBSERVATION_FAILED',
				documentId: input.documentId,
				generation: input.generation
			})
			return
		}
	})
}
const model = setup({
	schemas: {
		context: types<Context>(),
		input: types<{ capability: AnnotationCapability | undefined }>(),
		output: types<undefined>(),
		events: {
			OPEN: types<Extract<Event, { type: 'OPEN' }>>(),
			CLOSE: types(),
			HIGHLIGHT: types<Extract<Event, { type: 'HIGHLIGHT' }>>(),
			ADD_NOTE: types<Extract<Event, { type: 'ADD_NOTE' }>>(),
			EDIT_NOTE: types<Extract<Event, { type: 'EDIT_NOTE' }>>(),
			KEEP_DRAFT: types<Extract<Event, { type: 'KEEP_DRAFT' }>>(),
			DELETE_HIGHLIGHT: types<{ documentId: string; id: string }>(),
			RESTORE_HIGHLIGHT: types<{ documentId: string; id: string }>(),
			DELETE_NOTE: types<{ documentId: string; id: string }>(),
			ROWS: types<Extract<Event, { type: 'ROWS' }>>(),
			OBSERVATION_FAILED: types<Extract<Event, { type: 'OBSERVATION_FAILED' }>>(),
			SYNC: types<Extract<Event, { type: 'SYNC' }>>(),
			SHUTDOWN: types()
		},
		internalEvents: {
			QUEUED: types(),
			INVALID: types(),
			LOCAL_SAVED: types(),
			WRITE_FAILED: types(),
			WRITE_UNKNOWN: types()
		},
		meta: types<{ channel?: string; name?: string; variant?: WorkflowMessage['variant'] }>(),
		children: {
			fingerprint: types<import('xstate').ActorRefFrom<typeof actors.fingerprint>>(),
			recovery: types<import('xstate').ActorRefFrom<typeof actors.recovery>>(),
			prepare: types<import('xstate').ActorRefFrom<typeof actors.prepare>>(),
			observe: types<import('xstate').ActorRefFrom<typeof actors.observe>>(),
			writeOperation: types<import('xstate').ActorRefFrom<typeof actors.writeOperation>>(),
			receipts: types<import('xstate').ActorRefFrom<typeof actors.receipts>>()
		}
	},
	actors,
	guards: {
		accepting: ({ context, value }: { context: Context; value: import('xstate').StateValue }) =>
			!!context.capability?.isCurrent() &&
			matchesState({ active: { control: 'accepting' } }, value),
		currentDocument: ({ context }: { context: Context }, { documentId }: { documentId: string }) =>
			context.documentId === documentId
	},
	actions: {
		enqueue: ({ context }: { context: Context }, { command }: { command: AnnotationMutation }) => ({
			context: { queue: [...context.queue, command] }
		})
	}
})
export const annotationsMachine = model.createMachine({
	id: 'annotations',
	initial: 'active',
	context: ({ input }) => ({
		capability: input.capability,
		documentId: '',
		text: '',
		textHash: undefined,
		rows: emptyAnnotationRows,
		visibleRows: emptyAnnotationRows,
		queue: [],
		prepared: undefined,
		receiptId: '',
		receiptSubject: 'note',
		draftReceipts: {},
		undoId: undefined,
		invalidNotes: {},
		invalidBases: {},
		recoveryChoices: {},
		adoptedWriters: {},
		observationGeneration: 0
	}),
	states: {
		active: {
			type: 'parallel',
			invoke: { id: 'receipts', src: 'receipts', input: ({ self }) => ({ reportTo: self }) },
			always: ({ value }) =>
				matchesState(
					{ active: { control: 'closing', writer: 'idle', recoveryLifecycle: 'closed' } },
					value
				)
					? { target: 'closed' }
					: undefined,
			on: {
				HIGHLIGHT: (args, enq) => {
					if (!args.guards.accepting(args) || !args.guards.currentDocument(args, args.event)) return
					enq.raise({ type: 'QUEUED' })
					return args.actions.enqueue(args, { command: args.event })
				},
				ADD_NOTE: (args, enq) => {
					if (!args.guards.accepting(args) || !args.guards.currentDocument(args, args.event)) return
					enq.raise({ type: 'QUEUED' })
					return args.actions.enqueue(args, { command: args.event })
				},
				KEEP_DRAFT: (args, enq) => {
					if (!args.guards.accepting(args) || !args.guards.currentDocument(args, args.event)) return
					const recovered = selectAnnotationRecovery(
						args.self.getSnapshot().children.recovery?.getSnapshot()
					).records.find(
						(record) =>
							record.writerId === args.event.writerId && record.draft.noteId === args.event.id
					)
					const notes = [
						...args.context.rows.notes,
						...args.context.rows.highlights.flatMap((highlight) => highlight.notes)
					]
					const current = notes.find((note) => note.id === args.event.id)
					if (!recovered || !current) return
					enq.raise({
						type: 'EDIT_NOTE',
						documentId: args.event.documentId,
						id: current.id,
						text: recovered.draft.text,
						editedFrom: current.text
					})
					return {
						context: {
							adoptedWriters: { ...args.context.adoptedWriters, [current.id]: recovered.writerId }
						}
					}
				},
				EDIT_NOTE: (args, enq) => {
					if (!args.guards.accepting(args) || !args.guards.currentDocument(args, args.event)) return
					if (args.context.capability?.recovery)
						enq.sendTo('recovery', { type: 'RETAIN', noteId: args.event.id, text: args.event.text })
					if (!noteInputTextSchema.safeParse(args.event.text).success) {
						enq.raise({ type: 'INVALID' })
						return {
							context: {
								invalidNotes: { ...args.context.invalidNotes, [args.event.id]: args.event.text },
								invalidBases: {
									...args.context.invalidBases,
									[args.event.id]: args.context.invalidBases[args.event.id] ?? args.event.editedFrom
								}
							}
						}
					}
					const invalidNotes = { ...args.context.invalidNotes },
						invalidBases = { ...args.context.invalidBases }
					const command = {
						...args.event,
						editedFrom: invalidBases[args.event.id] ?? args.event.editedFrom
					}
					const recoveryChoices = { ...args.context.recoveryChoices }
					if (
						invalidBases[args.event.id] !== undefined ||
						args.context.adoptedWriters[args.event.id]
					)
						recoveryChoices[args.event.id] = {
							text: args.event.text,
							writerId: args.context.adoptedWriters[args.event.id]
						}
					delete invalidBases[args.event.id]
					delete invalidNotes[args.event.id]
					enq.raise({ type: 'QUEUED' })
					return {
						context: {
							...args.actions.enqueue(args, { command }).context,
							invalidNotes,
							invalidBases,
							recoveryChoices
						}
					}
				},
				DELETE_HIGHLIGHT: (args, enq) => {
					if (!args.guards.accepting(args) || !args.guards.currentDocument(args, args.event)) return
					enq.raise({ type: 'QUEUED' })
					return args.actions.enqueue(args, { command: args.event })
				},
				RESTORE_HIGHLIGHT: (args, enq) => {
					if (!args.guards.accepting(args) || !args.guards.currentDocument(args, args.event)) return
					enq.raise({ type: 'QUEUED' })
					return args.actions.enqueue(args, { command: args.event })
				},
				DELETE_NOTE: (args, enq) => {
					if (!args.guards.accepting(args) || !args.guards.currentDocument(args, args.event)) return
					enq.raise({ type: 'QUEUED' })
					return args.actions.enqueue(args, { command: args.event })
				}
			},
			states: {
				recoveryLifecycle: {
					initial: 'active',
					invoke: {
						id: 'recovery',
						src: 'recovery',
						input: ({ context }) => ({ capability: context.capability }),
						onSnapshot: {},
						onDone: { target: '.closed' },
						onError: { target: '.failed' }
					},
					states: {
						active: {
							on: {
								OPEN: ({ event }, enq) => {
									enq.sendTo('recovery', { type: 'OPEN', documentId: event.documentId })
								},
								CLOSE: (_args, enq) => {
									enq.sendTo('recovery', { type: 'CLOSE' })
								},
								SHUTDOWN: { target: 'draining' }
							}
						},
						draining: {
							always: ({ value }, enq) => {
								if (!matchesState({ active: { writer: 'idle' } }, value)) return
								enq.sendTo('recovery', { type: 'SHUTDOWN' })
								return { target: 'closing' }
							}
						},
						closing: {},
						closed: {},
						failed: {}
					}
				},
				control: {
					initial: 'accepting',
					states: { accepting: { on: { SHUTDOWN: { target: 'closing' } } }, closing: {} }
				},
				observation: {
					initial: 'idle',
					on: {
						OPEN: (args) => {
							if (!args.guards.accepting(args)) return
							return {
								target: '.watching',
								reenter: true,
								context: {
									documentId: args.event.documentId,
									observationGeneration: args.context.observationGeneration + 1,
									undoId: undefined,
									text: args.event.text,
									textHash: undefined,
									rows: emptyAnnotationRows,
									visibleRows: emptyAnnotationRows
								}
							}
						},
						CLOSE: {
							target: '.idle',
							context: {
								documentId: '',
								text: '',
								rows: emptyAnnotationRows,
								visibleRows: emptyAnnotationRows
							}
						},
						SHUTDOWN: { target: '.idle' }
					},
					states: {
						idle: {},
						watching: {
							invoke: [
								{
									id: 'observe',
									src: 'observe',
									input: ({ context }) => ({
										capability: required(context.capability),
										documentId: context.documentId,
										generation: context.observationGeneration
									}),
									onError: { target: 'failed' }
								},
								{
									id: 'fingerprint',
									src: 'fingerprint',
									input: ({ context }) => ({
										text: context.text,
										generation: context.observationGeneration
									}),
									onDone: ({ context, event }) =>
										event.output.generation === context.observationGeneration
											? { context: { textHash: event.output.hash } }
											: undefined,
									onError: { target: 'failed' }
								}
							],
							on: {
								ROWS: ({ context, event, value }) => {
									if (
										event.documentId !== context.documentId ||
										event.generation !== context.observationGeneration
									)
										return
									const rows = { ...context.rows, ...event.rows }
									return {
										context: {
											rows,
											visibleRows: matchesState({ active: { writer: 'idle' } }, value)
												? rows
												: context.visibleRows
										}
									}
								},
								OBSERVATION_FAILED: ({ context, event }) =>
									event.documentId === context.documentId &&
									event.generation === context.observationGeneration
										? { target: 'failed' }
										: undefined
							}
						},
						failed: {
							meta: {
								channel: 'annotation',
								name: t('status.unavailable_subject', { subject: noun('note', 2) }),
								variant: 'error'
							}
						}
					}
				},
				writer: {
					initial: 'idle',
					states: {
						idle: {
							entry: ({ context }) => ({ context: { visibleRows: context.rows } }),
							always: ({ context }) => (context.queue.length ? { target: 'preparing' } : undefined)
						},
						preparing: {
							invoke: {
								id: 'prepare',
								src: 'prepare',
								input: ({ context }) => ({
									capability: required(context.capability),
									command: required(context.queue[0])
								}),
								onDone: ({ event, context }) => ({
									target: 'writing',
									context: { prepared: event.output, queue: context.queue.slice(1) }
								}),
								onError: ({ context }, enq) => {
									enq.raise({ type: 'WRITE_FAILED' })
									return {
										target: 'idle',
										context: { queue: context.queue.slice(1), prepared: undefined }
									}
								}
							}
						},
						writing: {
							invoke: {
								id: 'writeOperation',
								src: 'writeOperation',
								input: ({ context }) => ({
									operationId: required(context.prepared).id,
									input: required(context.prepared),
									spawn: (spawn, input) =>
										spawn(required(context.capability).stage, {
											input: {
												attempt: {
													operationId: input.id,
													workspaceId: input.id,
													membershipId: input.id,
													draft: input
												}
											}
										})
								}),
								onDone: (args, enq) => {
									const operation = args.event.output
									if (
										operation.kind === 'failed' ||
										!operation.output ||
										operation.output.settlement.kind === 'unresolved'
									) {
										enq.raise({ type: 'WRITE_UNKNOWN' })
										return { target: 'uncertain' }
									}
									if (operation.output.settlement.kind !== 'locallyPersisted') {
										enq.raise({ type: 'WRITE_FAILED' })
										return { target: 'idle', context: { prepared: undefined } }
									}
									const prepared = required(args.context.prepared)
									const command = prepared.command

									enq.sendTo('receipts', {
										type: 'WATCH',
										id: prepared.id,
										receipts: [operation.output.settlement.workspace]
									})
									enq.raise({ type: 'LOCAL_SAVED' })
									return {
										target: 'idle',
										context: {
											receiptId: prepared.id,
											draftReceipts:
												command.type === 'EDIT_NOTE' && args.context.capability?.recovery
													? {
															...Object.fromEntries(
																Object.entries(args.context.draftReceipts).filter(
																	([, record]) => record.noteId !== command.id
																)
															),
															[prepared.id]: {
																noteId: command.id,
																text: command.text,
																writerId:
																	args.context.recoveryChoices[command.id]?.text === command.text
																		? args.context.recoveryChoices[command.id]?.writerId
																		: undefined
															}
														}
													: args.context.draftReceipts,
											receiptSubject:
												prepared.command.type === 'HIGHLIGHT' ||
												prepared.command.type === 'DELETE_HIGHLIGHT' ||
												prepared.command.type === 'RESTORE_HIGHLIGHT'
													? 'highlight'
													: 'note',
											undoId:
												prepared.command.type === 'DELETE_HIGHLIGHT'
													? prepared.command.id
													: prepared.command.type === 'RESTORE_HIGHLIGHT'
														? undefined
														: args.context.undoId,
											prepared: undefined
										}
									}
								},
								onError: { target: 'uncertain' }
							},
							on: {
								SHUTDOWN: (_args, enq) => {
									enq.sendTo('writeOperation', { type: 'DRAIN' })
								}
							}
						},
						failed: {
							meta: {
								channel: 'annotation',
								name: t('reader.save_failed'),
								variant: 'error'
							}
						},
						uncertain: {
							meta: { channel: 'annotation', name: t('status.save_unknown'), variant: 'error' }
						}
					}
				},
				feedback: {
					initial: 'idle',
					on: {
						QUEUED: { target: '.saving' },
						INVALID: { target: '.invalid' },
						LOCAL_SAVED: { target: '.local' },
						WRITE_FAILED: { target: '.failed' },
						WRITE_UNKNOWN: { target: '.unknown' },
						SYNC: ({ context, event }, enq) => {
							const record = context.draftReceipts[event.id]
							const draftReceipts = { ...context.draftReceipts }
							delete draftReceipts[event.id]
							if (record && event.status === 'accepted')
								enq.sendTo('recovery', { type: 'FORGET', ...record })
							if (event.id !== context.receiptId) return { context: { draftReceipts } }
							return {
								target:
									event.status === 'accepted'
										? context.receiptSubject === 'highlight'
											? '.syncedHighlight'
											: '.synced'
										: '.rejected',
								context: { draftReceipts }
							}
						}
					},
					states: {
						idle: {},
						saving: {
							meta: { channel: 'annotation', name: t('capture.status.saving'), variant: 'info' }
						},
						local: {
							meta: { channel: 'annotation', name: t('library.sync_pending'), variant: 'info' }
						},
						syncedHighlight: {
							meta: { channel: 'annotation', name: action('synced', 'highlight'), variant: 'info' }
						},
						synced: {
							meta: { channel: 'annotation', name: action('synced', 'note'), variant: 'info' }
						},
						rejected: {
							meta: { channel: 'annotation', name: t('capture.status.rejected'), variant: 'error' }
						},
						invalid: {
							meta: {
								channel: 'annotation',
								name: t('errors.too_large_subject', { subject: noun('note') }),
								variant: 'error'
							}
						},
						failed: {
							meta: {
								channel: 'annotation',
								name: t('reader.save_failed'),
								variant: 'error'
							}
						},
						unknown: {
							meta: { channel: 'annotation', name: t('status.save_unknown'), variant: 'error' }
						}
					}
				}
			}
		},
		closed: { type: 'final' }
	}
})
export function selectAnnotations(snapshot: SnapshotFrom<typeof annotationsMachine> | undefined) {
	const context = snapshot?.context
	const recovery = selectAnnotationRecovery(snapshot?.children.recovery?.getSnapshot())
	const ready =
		!!snapshot &&
		snapshot.status === 'active' &&
		snapshot.matches({ active: { control: 'accepting', observation: 'watching' } }) &&
		!!context?.capability?.isCurrent()
	const blocked =
		!!snapshot &&
		(snapshot.matches({ active: { writer: 'failed' } }) ||
			snapshot.matches({ active: { writer: 'uncertain' } }))
	const rows = ready && context ? context.visibleRows : emptyAnnotationRows
	const normalized = normalizeReaderText(context?.text ?? '')
	const highlights = rows.highlights.map((highlight) => {
		const anchor = highlight.anchors.find(
			(anchor) => anchor.kind === 'reader' && anchor.normalizationVersion === READER_TEXT_VERSION
		)
		let range: { start: number; end: number } | undefined
		if (anchor && context?.capability && anchor.textHash === context.textHash) {
			try {
				const resolved = context.capability.resolve(anchor.range, normalized)
				if (
					!resolved.ambiguous &&
					normalized.slice(resolved.start, resolved.end) === anchor.range.matched
				)
					range = {
						start: domOffset(context.text, resolved.start),
						end: domOffset(context.text, resolved.end)
					}
			} catch {
				/* Unresolved evidence remains readable. */
			}
		}
		return {
			id: highlight.id,
			quote: anchor?.range.matched ?? '',
			notes: highlight.notes.map((note) => ({
				id: note.id,
				text: context?.invalidNotes[note.id] ?? note.text,
				drafts: recovery.records.filter(
					(record) => record.draft.noteId === note.id && !context?.invalidNotes[note.id]
				)
			})),
			range
		}
	})
	return {
		documentId: ready && context ? context.documentId : '',
		highlights,
		notes: rows.notes.map((note) => ({
			id: note.id,
			text: context?.invalidNotes[note.id] ?? note.text,
			drafts: recovery.records.filter(
				(record) => record.draft.noteId === note.id && !context?.invalidNotes[note.id]
			)
		})),
		enabled: ready && !blocked && recovery.ready && !!context?.textHash,
		pending:
			!!context &&
			(context.queue.length > 0 ||
				!!context.prepared ||
				(Object.keys(context.invalidNotes).length > 0 &&
					(!context.capability?.recovery || recovery.failed)) ||
				recovery.pending),
		undoId: context?.undoId,
		message: snapshot ? stateFeedback(Object.values(snapshot.getMeta()), 'annotation') : undefined
	}
}
