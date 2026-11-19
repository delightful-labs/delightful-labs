import type { Db as JazzDb } from 'jazz-tools'
import { app } from '#lib/queries.js'
import type { ImageEditorInput, ImageEditorOutput } from '../../images/image-editor.js'
import {
	transactionAttachmentReplacementMachine,
	type AttachmentReplacementInput,
	type AttachmentReplacementOutput
} from './transaction-attachment-replacement.js'
import { attachmentFile, completeAttachmentParts } from '#lib/domain/transaction-attachments.js'
import { setup, types, createAsyncLogic, matchesState } from 'xstate'
import type { OutputFrom, SnapshotFrom } from 'xstate'
import type { EventPayload } from '../../../contracts/event-payload.js'

type ImageReference = { id: string; fileId: string }
export type SavedImageObservation = {
	editable: boolean
	images: readonly ImageReference[]
	blockedIds: readonly string[]
}
type Db = Pick<JazzDb, 'one' | 'beginTransaction'>
type Input = {
	db: Db
	transaction: AttachmentReplacementInput['transaction']
	observation: SavedImageObservation
}
type Event =
	| { type: 'EDIT'; attachmentId: string }
	| {
			type: 'OBSERVE'
			observation: SavedImageObservation
			transaction?: AttachmentReplacementInput['transaction']
	  }
	| { type: 'CLOSE' | 'SHUTDOWN' }
type Problem = 'unavailable' | 'conflict' | 'editingFailed' | 'saveFailed' | 'unresolved' | null
function required<Value>(value: Value | undefined): Value {
	if (value === undefined) throw new Error('Missing saved image resource')
	return value
}
function eligible(target: ImageReference, observation: SavedImageObservation): boolean {
	return (
		observation.editable &&
		!observation.blockedIds.includes(target.id) &&
		observation.images.some((image) => image.id === target.id && image.fileId === target.fileId)
	)
}
const hydrate = createAsyncLogic({
	run: ({ input }: { input: { db: Db; transactionId: string; target: ImageReference } }) =>
		input.db.one(
			app.transactionAttachments
				.where({
					id: input.target.id,
					transactionId: input.transactionId,
					fileId: input.target.fileId
				})
				.include({ file: { parts: true }, transaction: true }),
			{ tier: 'local-first' }
		)
})
function completeContents(row: OutputFrom<typeof hydrate>): boolean {
	return row?.file != null && completeAttachmentParts(row.file) !== undefined
}
const assemble = createAsyncLogic({
	run: async ({ input }: { input: NonNullable<OutputFrom<typeof hydrate>> }) =>
		required(attachmentFile(required(input.file ?? undefined)))
})

const readBytes = createAsyncLogic({
	run: async ({ input }: { input: File }) => new Uint8Array(await input.arrayBuffer())
})
type Context = Input & {
	target: ImageReference | undefined
	records: OutputFrom<typeof hydrate> | undefined
	source: File | undefined
	edited: File | undefined
	bytes: Uint8Array | undefined
	problem: Problem
}
function invalidObservation(context: Context, observation: SavedImageObservation): boolean {
	return context.target !== undefined && !eligible(context.target, observation)
}
function saveProblem(result: AttachmentReplacementOutput): Problem {
	if (result.settlement === 'unresolved') return 'unresolved'
	if (result.outcome === 'conflict') return 'conflict'
	return result.outcome === 'failed' ? 'saveFailed' : null
}
const events0 = {
	EDIT: types<EventPayload<Event, 'EDIT'>>(),
	OBSERVE: types<EventPayload<Event, 'OBSERVE'>>(),
	CLOSE: types<EventPayload<Event, 'CLOSE'>>(),
	SHUTDOWN: types<EventPayload<Event, 'SHUTDOWN'>>()
}
/** Reads a saved attachment, invokes the reusable editor, then owns its replacement operation. */
export function createSavedTransactionImageEditor<
	S extends import('xstate').Snapshot<ImageEditorOutput>,
	E extends import('xstate').EventObject
>(editor: import('xstate').ActorLogic<S, E | { type: 'CANCEL' | 'SHUTDOWN' }, ImageEditorInput>) {
	const model = setup({
		schemas: {
			context: types<Context>(),
			events: events0,
			input: types<Input>(),
			output: types<{ kind: 'closed' }>()
		},
		actors: {
			hydrate,
			assemble,
			editor,
			readBytes,
			persist: transactionAttachmentReplacementMachine
		},
		guards: {},
		actions: {}
	})
	return model.createMachine({
		id: 'saved-image-editor',
		initial: 'idle',
		context: ({ input }) => ({
			...input,
			target: undefined,
			records: undefined,
			source: undefined,
			edited: undefined,
			bytes: undefined,
			problem: null
		}),
		output: () => ({ kind: 'closed' }),
		on: {
			OBSERVE: (args) => {
				const { context, event } = args
				if (invalidObservation(context, event.observation)) {
					return {
						target: '.idle',
						context: {
							observation: event.observation,
							transaction: event.transaction ?? context.transaction
						} satisfies Partial<Context>
					}
				}
				return {
					context: {
						observation: event.observation,
						transaction: event.transaction ?? context.transaction
					} satisfies Partial<Context>
				}
			},
			CLOSE: { target: '.idle' },
			SHUTDOWN: { target: '.closed' }
		},
		states: {
			idle: {
				entry: () => {
					return {
						context: {
							target: undefined,
							records: undefined,
							source: undefined,
							edited: undefined,
							bytes: undefined
						} satisfies Partial<Context>
					}
				},
				on: {
					EDIT: (args) => {
						const { context, event } = args
						if (
							!context.observation.images.some(
								(image) => image.id === event.attachmentId && eligible(image, context.observation)
							)
						)
							return
						return {
							target: 'hydrating',
							context: {
								target: context.observation.images.find((image) => image.id === event.attachmentId),
								problem: null
							} satisfies Partial<Context>
						}
					}
				}
			},
			hydrating: {
				invoke: {
					src: 'hydrate',
					input: ({ context }) => ({
						db: context.db,
						transactionId: context.transaction.id,
						target: required(context.target)
					}),
					onDone: (args: {
						context: Context
						event: import('xstate').DoneActorEvent<OutputFrom<typeof hydrate>>
						value: import('xstate').StateValue
					}) => {
						const { context, event } = args
						if (
							event.output !== null &&
							event.output.transaction?.accountId === context.transaction.accountId &&
							event.output.transaction.organizationId === context.transaction.organizationId &&
							completeContents(event.output)
						) {
							return {
								target: 'assembling',
								context: { records: event.output } satisfies Partial<Context>
							}
						}
						return {
							target: 'idle',
							context: {
								problem: event.output === null ? 'conflict' : 'unavailable'
							} satisfies Partial<Context>
						}
					},
					onError: () => {
						return {
							target: 'idle',
							context: { problem: 'unavailable' } satisfies Partial<Context>
						}
					}
				}
			},
			assembling: {
				invoke: {
					src: 'assemble',
					input: ({ context }) => required(context.records ?? undefined),
					onDone: (args: {
						context: Context
						event: import('xstate').DoneActorEvent<OutputFrom<typeof assemble>>
						value: import('xstate').StateValue
					}) => {
						return {
							target: 'editing',
							context: { source: args.event.output } satisfies Partial<Context>
						}
					},
					onError: () => {
						return {
							target: 'idle',
							context: { problem: 'unavailable' } satisfies Partial<Context>
						}
					}
				}
			},
			editing: {
				initial: 'open',
				invoke: model.createInvoke<typeof editor, Context>({
					id: 'editor',
					src: editor,
					input: ({ context }: { context: Context }): ImageEditorInput => ({
						file: required(context.source),
						mode: 'perspective'
					}),
					onDone: (args) => {
						const { context, event } = args
						const output = event.output
						if (matchesState({ editing: 'shuttingDown' }, args.value)) {
							return { target: 'closed' }
						}
						if (!output)
							return {
								target: 'idle',
								context: { problem: 'editingFailed' } satisfies Partial<Context>
							}
						if (
							matchesState({ editing: 'open' }, args.value) &&
							eligible(required(context.target), context.observation) &&
							output.kind === 'applied'
						) {
							return {
								target: 'readingBytes',
								context: {
									edited: output.kind === 'applied' ? output.file : undefined
								} satisfies Partial<Context>
							}
						}
						if (matchesState({ editing: 'open' }, args.value) && output.kind === 'failed') {
							return {
								target: 'idle',
								context: { problem: 'editingFailed' } satisfies Partial<Context>
							}
						}
						return { target: 'idle' }
					},
					onError: (args: { value: import('xstate').StateValue }) => {
						if (matchesState({ editing: 'shuttingDown' }, args.value)) {
							return { target: 'closed' }
						}
						return {
							target: 'idle',
							context: { problem: 'editingFailed' } satisfies Partial<Context>
						}
					}
				}),
				on: {
					CLOSE: (args, enq) => {
						{
							const command: 'CANCEL' | 'SHUTDOWN' = 'CANCEL'
							const child = args.children.editor
							if (child?.getSnapshot().status === 'active') enq(() => child.send({ type: command }))
						}
						return { target: '.cancelling' }
					},
					SHUTDOWN: (args, enq) => {
						{
							const command: 'CANCEL' | 'SHUTDOWN' = 'SHUTDOWN'
							const child = args.children.editor
							if (child?.getSnapshot().status === 'active') enq(() => child.send({ type: command }))
						}
						return { target: '.shuttingDown' }
					},
					OBSERVE: (args, enq) => {
						const { context, event } = args
						if (invalidObservation(context, event.observation)) {
							{
								const command: 'CANCEL' | 'SHUTDOWN' = 'CANCEL'
								const child = args.children.editor
								if (child?.getSnapshot().status === 'active')
									enq(() => child.send({ type: command }))
							}
							return {
								target: '.cancelling',
								context: ((args) => ({
									observation: args.event.observation,
									transaction: args.event.transaction ?? args.context.transaction
								}))(args)
							}
						}
						return {
							context: ((args) => ({
								observation: args.event.observation,
								transaction: args.event.transaction ?? args.context.transaction
							}))(args)
						}
					}
				},
				states: {
					open: {},
					cancelling: {},
					shuttingDown: { on: { CLOSE: {}, SHUTDOWN: {}, OBSERVE: {} } }
				}
			},
			readingBytes: {
				invoke: {
					src: 'readBytes',
					input: ({ context }) => required(context.edited),
					onDone: (args: {
						context: Context
						event: import('xstate').DoneActorEvent<OutputFrom<typeof readBytes>>
						value: import('xstate').StateValue
					}) => {
						return {
							target: 'saving',
							context: { bytes: args.event.output } satisfies Partial<Context>
						}
					},
					onError: () => {
						return { target: 'idle', context: { problem: 'saveFailed' } satisfies Partial<Context> }
					}
				}
			},
			saving: {
				initial: 'open',
				invoke: {
					id: 'persist',
					src: 'persist',
					input: ({ context }) => ({
						db: context.db,
						transaction: context.transaction,
						attachment: required(context.target),
						file: required(context.edited),
						bytes: required(context.bytes)
					}),
					onDone: (args: {
						context: Context
						event: import('xstate').DoneActorEvent<
							OutputFrom<typeof transactionAttachmentReplacementMachine>
						>
						value: import('xstate').StateValue
					}) => {
						if (matchesState({ saving: 'shuttingDown' }, args.value)) {
							return { target: 'closed' }
						}
						return {
							target: 'idle',
							context: { problem: saveProblem(args.event.output) } satisfies Partial<Context>
						}
					},
					onError: (args: { value: import('xstate').StateValue }) => {
						if (matchesState({ saving: 'shuttingDown' }, args.value)) {
							return { target: 'closed' }
						}
						return { target: 'idle', context: { problem: 'unresolved' } satisfies Partial<Context> }
					}
				},
				on: {
					CLOSE: (args, enq) => {
						{
							const command: 'CANCEL' | 'SHUTDOWN' = 'CANCEL'
							const child = args.children.persist
							if (child?.getSnapshot().status === 'active') enq(() => child.send({ type: command }))
						}
						return { target: '.cancelling' }
					},
					SHUTDOWN: (args, enq) => {
						{
							const command: 'CANCEL' | 'SHUTDOWN' = 'SHUTDOWN'
							const child = args.children.persist
							if (child?.getSnapshot().status === 'active') enq(() => child.send({ type: command }))
						}
						return { target: '.shuttingDown' }
					},
					OBSERVE: (args, enq) => {
						const { context, event } = args
						if (invalidObservation(context, event.observation)) {
							{
								const command: 'CANCEL' | 'SHUTDOWN' = 'CANCEL'
								const child = args.children.persist
								if (child?.getSnapshot().status === 'active')
									enq(() => child.send({ type: command }))
							}
							return {
								target: '.cancelling',
								context: ((args) => ({
									observation: args.event.observation,
									transaction: args.event.transaction ?? args.context.transaction
								}))(args)
							}
						}
						return {
							context: ((args) => ({
								observation: args.event.observation,
								transaction: args.event.transaction ?? args.context.transaction
							}))(args)
						}
					}
				},
				states: {
					open: {},
					cancelling: {},
					shuttingDown: { on: { CLOSE: {}, SHUTDOWN: {}, OBSERVE: {} } }
				}
			},
			closed: { type: 'final' }
		}
	})
}

/** Cloneable report for the application worker; the editor itself uses a private native port. */
export function savedImageEditorReport(
	snapshot: Pick<
		SnapshotFrom<ReturnType<typeof createSavedTransactionImageEditor>>,
		'context' | 'matches'
	>
) {
	const { target, observation } = snapshot.context
	return {
		editableIds: snapshot.matches('idle')
			? observation.images.filter((image) => eligible(image, observation)).map((image) => image.id)
			: [],
		disabledIds: target ? [...observation.blockedIds, target.id] : [...observation.blockedIds],
		problem: snapshot.context.problem,
		activity:
			snapshot.matches('hydrating') || snapshot.matches('assembling')
				? 'loading'
				: snapshot.matches('editing')
					? 'editing'
					: snapshot.matches('readingBytes') || snapshot.matches('saving')
						? 'saving'
						: 'idle'
	}
}
