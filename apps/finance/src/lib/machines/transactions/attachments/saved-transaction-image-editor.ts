import type { getDb } from 'jazz-tools/svelte'
import { app } from '#lib/schema.js'
import { imageEditorMachine } from '../../images/image-editor.js'
import {
	transactionAttachmentReplacementMachine,
	type AttachmentReplacementInput,
	type AttachmentReplacementOutput
} from './transaction-attachment-replacement.js'
import {
	MAX_TRANSACTION_ATTACHMENT_BYTES,
	isTransactionAttachmentType
} from '#lib/domain/transaction-attachments.js'
import { setup, types, createAsyncLogic, matchesState } from 'xstate'
import type { ActorRefFrom, OutputFrom, SnapshotFrom } from 'xstate'
import type { EventPayload } from '../../../contracts/event-payload.js'

type ImageReference = { id: string; fileId: string }
export type SavedImageObservation = {
	editable: boolean
	images: readonly ImageReference[]
	blockedIds: readonly string[]
}
type Db = Pick<ReturnType<typeof getDb>, 'one' | 'beginTransaction'>
type Input = {
	db: Db
	transaction: AttachmentReplacementInput['transaction']
	observation: SavedImageObservation
}
type Event =
	| { type: 'EDIT'; attachmentId: string }
	| { type: 'OBSERVE'; observation: SavedImageObservation }
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
	const file = row?.file
	if (
		!file ||
		!isTransactionAttachmentType(file.mimeType) ||
		file.sizeBytes < 1 ||
		file.sizeBytes > MAX_TRANSACTION_ATTACHMENT_BYTES
	)
		return false
	const parts = [...(file.parts ?? [])].sort((left, right) => left.partIndex - right.partIndex)
	return (
		parts.length > 0 &&
		parts.every(
			(part, index) =>
				part.partIndex === index && part.data != null && part.data.byteLength === part.sizeBytes
		) &&
		parts.reduce((total, part) => total + part.sizeBytes, 0) === file.sizeBytes
	)
}
const assemble = createAsyncLogic({
	run: async ({ input }: { input: NonNullable<OutputFrom<typeof hydrate>> }) => {
		const file = required(input.file ?? undefined)
		const bytes = new Uint8Array(file.sizeBytes)
		let offset = 0
		for (const part of [...(file.parts ?? [])].sort(
			(left, right) => left.partIndex - right.partIndex
		)) {
			const data = required(part.data ?? undefined)
			bytes.set(data, offset)
			offset += data.byteLength
		}
		return new File([bytes], file.fileName, { type: file.mimeType })
	}
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
type NativeEvent0 =
	| import('xstate').InferEvents<typeof events0>
	| import('xstate').DoneActorEvent<
			| import('xstate').OutputFrom<typeof hydrate>
			| import('xstate').OutputFrom<typeof assemble>
			| import('xstate').OutputFrom<typeof imageEditorMachine>
			| import('xstate').OutputFrom<typeof readBytes>
			| import('xstate').OutputFrom<typeof transactionAttachmentReplacementMachine>
	  >
	| import('xstate').ErrorActorEvent
	| import('xstate').AfterEvent
	| import('xstate').DoneStateEvent
	| import('xstate').SnapshotEvent
	| import('xstate').TimeoutEvent
	| import('xstate').ActorTimeoutEvent
	| import('xstate').ErrorPlatformEvent

/** Reads a saved attachment, invokes the reusable editor, then owns its replacement operation. */
export const savedTransactionImageEditorMachine = setup({
	schemas: {
		context: types<Context>(),
		events: events0,
		input: types<Input>(),
		output: types<{ kind: 'closed' }>(),
		children: {
			hydrate: types<
				import('xstate').ActorRefFrom<
					{
						hydrate: typeof hydrate
						assemble: typeof assemble
						editor: typeof imageEditorMachine
						readBytes: typeof readBytes
						persist: typeof transactionAttachmentReplacementMachine
					}['hydrate']
				>
			>(),
			assemble: types<
				import('xstate').ActorRefFrom<
					{
						hydrate: typeof hydrate
						assemble: typeof assemble
						editor: typeof imageEditorMachine
						readBytes: typeof readBytes
						persist: typeof transactionAttachmentReplacementMachine
					}['assemble']
				>
			>(),
			editor: types<
				import('xstate').ActorRefFrom<
					{
						hydrate: typeof hydrate
						assemble: typeof assemble
						editor: typeof imageEditorMachine
						readBytes: typeof readBytes
						persist: typeof transactionAttachmentReplacementMachine
					}['editor']
				>
			>(),
			readBytes: types<
				import('xstate').ActorRefFrom<
					{
						hydrate: typeof hydrate
						assemble: typeof assemble
						editor: typeof imageEditorMachine
						readBytes: typeof readBytes
						persist: typeof transactionAttachmentReplacementMachine
					}['readBytes']
				>
			>(),
			persist: types<
				import('xstate').ActorRefFrom<
					{
						hydrate: typeof hydrate
						assemble: typeof assemble
						editor: typeof imageEditorMachine
						readBytes: typeof readBytes
						persist: typeof transactionAttachmentReplacementMachine
					}['persist']
				>
			>()
		}
	},
	actors: {
		hydrate,
		assemble,
		editor: imageEditorMachine,
		readBytes,
		persist: transactionAttachmentReplacementMachine
	},
	guards: {},
	actions: {}
}).createMachine({
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
				return { target: '.idle', context: { observation: event.observation } }
			}
			return { context: { observation: event.observation } }
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
					}
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
						}
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
				onDone: (args) => {
					const { context, event } = args
					if (
						event.output !== null &&
						event.output.transaction?.accountId === context.transaction.accountId &&
						event.output.transaction.organizationId === context.transaction.organizationId &&
						completeContents(event.output)
					) {
						return { target: 'assembling', context: { records: event.output } }
					}
					return {
						target: 'idle',
						context: { problem: event.output === null ? 'conflict' : 'unavailable' }
					}
				},
				onError: () => {
					return { target: 'idle', context: { problem: 'unavailable' } }
				}
			}
		},
		assembling: {
			invoke: {
				src: 'assemble',
				input: ({ context }) => required(context.records ?? undefined),
				onDone: (args) => {
					return { target: 'editing', context: { source: args.event.output } }
				},
				onError: () => {
					return { target: 'idle', context: { problem: 'unavailable' } }
				}
			}
		},
		editing: {
			initial: 'open',
			invoke: {
				id: 'editor',
				src: 'editor',
				input: ({ context }) => ({ file: required(context.source), mode: 'perspective' }),
				onDone: (args) => {
					const { context, event } = args
					if (matchesState({ editing: 'shuttingDown' }, args.value)) {
						return { target: 'closed' }
					}
					if (
						matchesState({ editing: 'open' }, args.value) &&
						eligible(required(context.target), context.observation) &&
						event.output.kind === 'applied'
					) {
						return {
							target: 'readingBytes',
							context: { edited: event.output.kind === 'applied' ? event.output.file : undefined }
						}
					}
					if (matchesState({ editing: 'open' }, args.value) && event.output.kind === 'failed') {
						return { target: 'idle', context: { problem: 'editingFailed' } }
					}
					return { target: 'idle' }
				},
				onError: (args) => {
					if (matchesState({ editing: 'shuttingDown' }, args.value)) {
						return { target: 'closed' }
					}
					return { target: 'idle', context: { problem: 'editingFailed' } }
				}
			},
			on: {
				CLOSE: (args, enq) => {
					{
						const command: 'CANCEL' | 'SHUTDOWN' = 'CANCEL'
						const child = args.children.editor
						if (child?.getSnapshot().status === 'active') enq.sendTo(child, { type: command })
					}
					return { target: '.cancelling' }
				},
				SHUTDOWN: (args, enq) => {
					{
						const command: 'CANCEL' | 'SHUTDOWN' = 'SHUTDOWN'
						const child = args.children.editor
						if (child?.getSnapshot().status === 'active') enq.sendTo(child, { type: command })
					}
					return { target: '.shuttingDown' }
				},
				OBSERVE: (args, enq) => {
					const { context, event } = args
					if (invalidObservation(context, event.observation)) {
						{
							const command: 'CANCEL' | 'SHUTDOWN' = 'CANCEL'
							const child = args.children.editor
							if (child?.getSnapshot().status === 'active') enq.sendTo(child, { type: command })
						}
						return {
							target: '.cancelling',
							context: ((args) => ({ observation: (({ event }) => event.observation)(args) }))(args)
						}
					}
					return {
						context: ((args) => ({ observation: (({ event }) => event.observation)(args) }))(args)
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
				onDone: (args) => {
					return { target: 'saving', context: { bytes: args.event.output } }
				},
				onError: () => {
					return { target: 'idle', context: { problem: 'saveFailed' } }
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
				onDone: (args) => {
					if (matchesState({ saving: 'shuttingDown' }, args.value)) {
						return { target: 'closed' }
					}
					return { target: 'idle', context: { problem: saveProblem(args.event.output) } }
				},
				onError: (args) => {
					if (matchesState({ saving: 'shuttingDown' }, args.value)) {
						return { target: 'closed' }
					}
					return { target: 'idle', context: { problem: 'unresolved' } }
				}
			},
			on: {
				CLOSE: (args, enq) => {
					{
						const command: 'CANCEL' | 'SHUTDOWN' = 'CANCEL'
						const child = args.children.persist
						if (child?.getSnapshot().status === 'active') enq.sendTo(child, { type: command })
					}
					return { target: '.cancelling' }
				},
				SHUTDOWN: (args, enq) => {
					{
						const command: 'CANCEL' | 'SHUTDOWN' = 'SHUTDOWN'
						const child = args.children.persist
						if (child?.getSnapshot().status === 'active') enq.sendTo(child, { type: command })
					}
					return { target: '.shuttingDown' }
				},
				OBSERVE: (args, enq) => {
					const { context, event } = args
					if (invalidObservation(context, event.observation)) {
						{
							const command: 'CANCEL' | 'SHUTDOWN' = 'CANCEL'
							const child = args.children.persist
							if (child?.getSnapshot().status === 'active') enq.sendTo(child, { type: command })
						}
						return {
							target: '.cancelling',
							context: ((args) => ({ observation: (({ event }) => event.observation)(args) }))(args)
						}
					}
					return {
						context: ((args) => ({ observation: (({ event }) => event.observation)(args) }))(args)
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

export function savedImageEditorPresentation(
	snapshot: SnapshotFrom<typeof savedTransactionImageEditorMachine>
): {
	editableIds: readonly string[]
	disabledIds: readonly string[]
	problem: Problem
	dialog:
		| { kind: 'loading' | 'saving' }
		| { kind: 'editor'; file: File; actor: ActorRefFrom<typeof imageEditorMachine> }
		| null
} {
	const { target, observation, source } = snapshot.context
	const child = snapshot.children.editor
	const dialog =
		snapshot.matches({ editing: 'open' }) && source && child
			? ({ kind: 'editor', file: source, actor: child } satisfies {
					kind: 'editor'
					file: File
					actor: ActorRefFrom<typeof imageEditorMachine>
				})
			: snapshot.matches('hydrating') || snapshot.matches('assembling')
				? ({ kind: 'loading' } satisfies { kind: 'loading' })
				: snapshot.matches('readingBytes') || snapshot.matches({ saving: 'open' })
					? ({ kind: 'saving' } satisfies { kind: 'saving' })
					: null
	return {
		editableIds: snapshot.matches('idle')
			? observation.images.filter((image) => eligible(image, observation)).map(({ id }) => id)
			: [],
		disabledIds: target ? [...observation.blockedIds, target.id] : observation.blockedIds,
		problem: snapshot.context.problem,
		dialog
	}
}
